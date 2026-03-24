/**
 * ValidationRegistry — TypeScript integration layer
 *
 * The agent uses this to submit its EIP-712 signed checkpoints as validation
 * artifacts. Validators (and the hackathon leaderboard) read attestation scores
 * from here to rank agents by validation quality, not just raw PnL.
 *
 * Flow:
 *   1. Agent generates EIP-712 signed checkpoint (checkpoint.ts)
 *   2. Agent computes the EIP-712 digest (checkpointHash)
 *   3. Agent posts self-attestation: postAttestation(agentId, checkpointHash, ...)
 *   4. Third-party validators optionally post their own scores on the same hash
 *   5. Hackathon leaderboard queries getAverageValidationScore() per agent
 */

import { ethers } from "ethers";

const VALIDATION_ABI = [
  "function postAttestation(uint256 agentId, bytes32 checkpointHash, uint8 score, uint8 proofType, bytes proof, string notes) external",
  "function postEIP712Attestation(uint256 agentId, bytes32 checkpointHash, uint8 score, string notes) external",
  "function getAttestations(uint256 agentId) external view returns (tuple(uint256 agentId, address validator, bytes32 checkpointHash, uint8 score, uint8 proofType, bytes proof, string notes, uint256 timestamp)[])",
  "function getAverageValidationScore(uint256 agentId) external view returns (uint256)",
  "function getAttestation(bytes32 checkpointHash) external view returns (tuple(uint256 agentId, address validator, bytes32 checkpointHash, uint8 score, uint8 proofType, bytes proof, string notes, uint256 timestamp))",
  "function attestationCount(uint256 agentId) external view returns (uint256)",
  "event AttestationPosted(uint256 indexed agentId, address indexed validator, bytes32 indexed checkpointHash, uint8 score, uint8 proofType)",
];

export enum ProofType {
  NONE = 0,
  EIP712 = 1,
  TEE = 2,
  ZKML = 3,
}

export interface Attestation {
  agentId: bigint;
  validator: string;
  checkpointHash: string;
  score: number;
  proofType: ProofType;
  proof: string;
  notes: string;
  timestamp: number;
}

export class ValidationRegistryClient {
  private contract: ethers.Contract;

  constructor(registryAddress: string, signerOrProvider: ethers.Signer | ethers.Provider) {
    this.contract = new ethers.Contract(registryAddress, VALIDATION_ABI, signerOrProvider);
  }

  /**
   * Post an EIP-712 checkpoint attestation.
   * Call this after generating each signed checkpoint to record it on-chain.
   *
   * @param agentId        ERC-721 agent token ID
   * @param checkpointHash The EIP-712 digest of the signed checkpoint
   * @param score          Self-assessed quality score 0–100 (validators override this)
   * @param notes          Optional description of the checkpoint
   */
  async postCheckpointAttestation(
    agentId: bigint,
    checkpointHash: string,
    score: number,
    notes: string
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.postEIP712Attestation(agentId, checkpointHash, score, notes);
    return tx.wait();
  }

  /**
   * Post a full attestation with proof bytes (for TEE or zkML proofs).
   */
  async postAttestation(
    agentId: bigint,
    checkpointHash: string,
    score: number,
    proofType: ProofType,
    proof: Uint8Array | string,
    notes: string
  ): Promise<ethers.TransactionReceipt> {
    const proofBytes = typeof proof === "string" ? proof : ethers.hexlify(proof);
    const tx = await this.contract.postAttestation(
      agentId, checkpointHash, score, proofType, proofBytes, notes
    );
    return tx.wait();
  }

  /**
   * Get all attestations for an agent.
   */
  async getAttestations(agentId: bigint): Promise<Attestation[]> {
    const atts = await this.contract.getAttestations(agentId);
    return atts.map((a: { agentId: bigint; validator: string; checkpointHash: string; score: bigint; proofType: bigint; proof: string; notes: string; timestamp: bigint }) => ({
      agentId: a.agentId,
      validator: a.validator,
      checkpointHash: a.checkpointHash,
      score: Number(a.score),
      proofType: Number(a.proofType) as ProofType,
      proof: a.proof,
      notes: a.notes,
      timestamp: Number(a.timestamp),
    }));
  }

  /**
   * Get the average validation score across all attestations for an agent.
   */
  async getAverageScore(agentId: bigint): Promise<number> {
    return Number(await this.contract.getAverageValidationScore(agentId));
  }
}
