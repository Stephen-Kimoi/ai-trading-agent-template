/**
 * EIP-712 Signed Checkpoints
 *
 * Produces machine-verifiable artifacts for every trade decision. The checkpoint
 * is signed by the agent's agentWallet (the hot wallet registered in AgentRegistry).
 *
 * Key change from v1: agentId is now a uint256 (ERC-721 token ID), not bytes32.
 * The checkpoint hash (EIP-712 digest) is also submitted to the ValidationRegistry
 * so validators can score the agent's decisions on-chain.
 */

import { ethers } from "ethers";
import { MarketData, TradeCheckpoint, TradeDecision } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// EIP-712 domain and type definitions
// ─────────────────────────────────────────────────────────────────────────────

export function buildDomain(registryAddress: string, chainId: number): ethers.TypedDataDomain {
  return {
    name: "AITradingAgent",
    version: "1",
    chainId,
    verifyingContract: registryAddress,
  };
}

export const CHECKPOINT_TYPES = {
  TradeCheckpoint: [
    { name: "agentId",           type: "uint256" }, // ERC-721 token ID
    { name: "timestamp",         type: "uint256" },
    { name: "action",            type: "string"  },
    { name: "asset",             type: "string"  },
    { name: "pair",              type: "string"  },
    { name: "amountUsdScaled",   type: "uint256" }, // amountUsd * 100
    { name: "priceUsdScaled",    type: "uint256" }, // priceUsd * 100
    { name: "reasoningHash",     type: "bytes32" }, // keccak256(reasoning)
    { name: "confidenceScaled",  type: "uint256" }, // confidence * 1000
    { name: "intentHash",        type: "bytes32" }, // hash of the approved TradeIntent
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Generate a signed checkpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an EIP-712 signed checkpoint for a trade decision.
 * Signed by the agent's agentWallet (hot wallet).
 *
 * @param agentId          ERC-721 token ID (uint256)
 * @param decision         Trade decision from the strategy
 * @param market           Market data at decision time
 * @param intentHash       Hash of the approved TradeIntent (or "0x00...00" for HOLD)
 * @param agentWalletSigner The agent's hot wallet (registered in AgentRegistry)
 * @param registryAddress  AgentRegistry contract address (for EIP-712 domain)
 * @param chainId          Chain ID (11155111 for Sepolia)
 */
export async function generateCheckpoint(
  agentId: bigint,
  decision: TradeDecision,
  market: MarketData,
  intentHash: string,
  agentWalletSigner: ethers.Wallet,
  registryAddress: string,
  chainId: number
): Promise<TradeCheckpoint> {
  const timestamp = Math.floor(Date.now() / 1000);
  const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes(decision.reasoning));

  const value = {
    agentId,
    timestamp:          BigInt(timestamp),
    action:             decision.action,
    asset:              decision.asset,
    pair:               decision.pair,
    amountUsdScaled:    BigInt(Math.round(decision.amount * 100)),
    priceUsdScaled:     BigInt(Math.round(market.price * 100)),
    reasoningHash,
    confidenceScaled:   BigInt(Math.round(decision.confidence * 1000)),
    intentHash:         intentHash as `0x${string}`,
  };

  const domain = buildDomain(registryAddress, chainId);
  const signature = await agentWalletSigner.signTypedData(domain, CHECKPOINT_TYPES, value);

  // The EIP-712 digest — this is what gets submitted to the ValidationRegistry
  const checkpointHash = ethers.TypedDataEncoder.hash(domain, CHECKPOINT_TYPES, value);

  return {
    agentId: agentId.toString(),
    timestamp,
    action:      decision.action,
    asset:       decision.asset,
    pair:        decision.pair,
    amountUsd:   decision.amount,
    priceUsd:    market.price,
    reasoning:   decision.reasoning,
    reasoningHash,
    confidence:  decision.confidence,
    intentHash,
    signature,
    signerAddress: await agentWalletSigner.getAddress(),
    checkpointHash,  // extra field — not in the interface but appended to JSON
  } as TradeCheckpoint & { checkpointHash: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify a checkpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a checkpoint's EIP-712 signature recovers to expectedSigner.
 */
export function verifyCheckpoint(
  checkpoint: TradeCheckpoint & { checkpointHash?: string },
  registryAddress: string,
  chainId: number,
  expectedSigner: string
): boolean {
  const domain = buildDomain(registryAddress, chainId);
  const value = {
    agentId:          BigInt(checkpoint.agentId),
    timestamp:        BigInt(checkpoint.timestamp),
    action:           checkpoint.action,
    asset:            checkpoint.asset,
    pair:             checkpoint.pair,
    amountUsdScaled:  BigInt(Math.round(checkpoint.amountUsd * 100)),
    priceUsdScaled:   BigInt(Math.round(checkpoint.priceUsd * 100)),
    reasoningHash:    checkpoint.reasoningHash as `0x${string}`,
    confidenceScaled: BigInt(Math.round(checkpoint.confidence * 1000)),
    intentHash:       checkpoint.intentHash as `0x${string}`,
  };

  const recovered = ethers.verifyTypedData(domain, CHECKPOINT_TYPES, value, checkpoint.signature);
  return recovered.toLowerCase() === expectedSigner.toLowerCase();
}

/**
 * Verify that the plain-text reasoning string matches its hash in the checkpoint.
 * Prevents tampering with the explanation after signing.
 */
export function verifyReasoningIntegrity(checkpoint: TradeCheckpoint): boolean {
  const expected = ethers.keccak256(ethers.toUtf8Bytes(checkpoint.reasoning));
  return expected === checkpoint.reasoningHash;
}

/**
 * Compute the EIP-712 digest for a checkpoint (for ValidationRegistry submission).
 */
export function computeCheckpointHash(
  checkpoint: TradeCheckpoint,
  registryAddress: string,
  chainId: number
): string {
  const domain = buildDomain(registryAddress, chainId);
  const value = {
    agentId:          BigInt(checkpoint.agentId),
    timestamp:        BigInt(checkpoint.timestamp),
    action:           checkpoint.action,
    asset:            checkpoint.asset,
    pair:             checkpoint.pair,
    amountUsdScaled:  BigInt(Math.round(checkpoint.amountUsd * 100)),
    priceUsdScaled:   BigInt(Math.round(checkpoint.priceUsd * 100)),
    reasoningHash:    checkpoint.reasoningHash as `0x${string}`,
    confidenceScaled: BigInt(Math.round(checkpoint.confidence * 1000)),
    intentHash:       checkpoint.intentHash as `0x${string}`,
  };
  return ethers.TypedDataEncoder.hash(domain, CHECKPOINT_TYPES, value);
}
