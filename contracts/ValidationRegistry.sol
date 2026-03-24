// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgentRegistry.sol";

/**
 * @title ValidationRegistry
 * @notice On-chain validation artifact store for ERC-8004 agents.
 *
 * Validators (whitelisted addresses, or open depending on configuration) post
 * scored attestations for specific agent checkpoints. An attestation links:
 *   - An agent (agentId)
 *   - A specific checkpoint or action (checkpointHash — the EIP-712 digest)
 *   - A validator score
 *   - Optional proof bytes (TEE attestation, zkML proof, or off-chain hash)
 *
 * This is where "Proof of Work means actual computational work" — attestations
 * can carry cryptographic proofs that the agent ran correctly and honestly.
 *
 * For the hackathon:
 *   - The lablab.ai leaderboard reads validator scores from this registry
 *   - Your EIP-712 signed checkpoints are submitted here as the checkpointHash
 *   - Validator scores feed into the on-chain reputation + leaderboard ranking
 */
contract ValidationRegistry {
    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    enum ProofType {
        NONE,          // No cryptographic proof — human validator judgment
        EIP712,        // EIP-712 signed checkpoint (standard for this hackathon)
        TEE,           // Trusted Execution Environment attestation
        ZKML           // Zero-knowledge ML proof
    }

    struct Attestation {
        uint256  agentId;
        address  validator;
        bytes32  checkpointHash;   // EIP-712 digest of the signed checkpoint
        uint8    score;            // 0–100 validation quality score
        ProofType proofType;
        bytes    proof;            // Raw proof bytes (empty for NONE/EIP712)
        string   notes;
        uint256  timestamp;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    AgentRegistry public immutable agentRegistry;
    address public owner;
    bool public openValidation;  // if true, anyone can post; if false, whitelist only

    mapping(address => bool) public validators;
    mapping(uint256 => Attestation[]) private _attestations;       // agentId → []
    mapping(bytes32 => Attestation) public checkpointAttestations; // checkpointHash → attestation
    mapping(uint256 => uint256) public attestationCount;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event AttestationPosted(
        uint256 indexed agentId,
        address indexed validator,
        bytes32 indexed checkpointHash,
        uint8 score,
        ProofType proofType
    );
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address agentRegistryAddress, bool _openValidation) {
        agentRegistry = AgentRegistry(agentRegistryAddress);
        owner = msg.sender;
        openValidation = _openValidation;
        // Owner is a validator by default
        validators[msg.sender] = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ValidationRegistry: not owner");
        _;
    }

    modifier onlyValidator() {
        require(
            openValidation || validators[msg.sender],
            "ValidationRegistry: not an authorized validator"
        );
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Validator management
    // ─────────────────────────────────────────────────────────────────────────

    function addValidator(address validator) external onlyOwner {
        validators[validator] = true;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        validators[validator] = false;
        emit ValidatorRemoved(validator);
    }

    function setOpenValidation(bool open) external onlyOwner {
        openValidation = open;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Attestation posting
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Post a validation attestation for an agent's checkpoint.
     * @param agentId         ERC-721 agent token ID.
     * @param checkpointHash  EIP-712 digest of the trade checkpoint being validated.
     * @param score           Quality score 0–100.
     * @param proofType       Type of cryptographic proof (if any).
     * @param proof           Raw proof bytes (pass bytes("") for EIP712 type).
     * @param notes           Optional human-readable validation notes.
     */
    function postAttestation(
        uint256 agentId,
        bytes32 checkpointHash,
        uint8 score,
        ProofType proofType,
        bytes calldata proof,
        string calldata notes
    ) external onlyValidator {
        require(agentRegistry.isRegistered(agentId), "ValidationRegistry: agent not registered");
        require(checkpointHash != bytes32(0), "ValidationRegistry: checkpointHash required");
        require(score <= 100, "ValidationRegistry: score must be 0-100");

        Attestation memory attestation = Attestation({
            agentId: agentId,
            validator: msg.sender,
            checkpointHash: checkpointHash,
            score: score,
            proofType: proofType,
            proof: proof,
            notes: notes,
            timestamp: block.timestamp
        });

        _attestations[agentId].push(attestation);
        checkpointAttestations[checkpointHash] = attestation;
        attestationCount[agentId]++;

        emit AttestationPosted(agentId, msg.sender, checkpointHash, score, proofType);
    }

    /**
     * @notice Convenience: post an EIP-712 checkpoint attestation.
     *         The checkpoint hash is the EIP-712 digest that the agent signed.
     */
    function postEIP712Attestation(
        uint256 agentId,
        bytes32 checkpointHash,
        uint8 score,
        string calldata notes
    ) external onlyValidator {
        this.postAttestation(agentId, checkpointHash, score, ProofType.EIP712, bytes(""), notes);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getAttestations(uint256 agentId) external view returns (Attestation[] memory) {
        return _attestations[agentId];
    }

    function getAverageValidationScore(uint256 agentId) external view returns (uint256) {
        Attestation[] storage atts = _attestations[agentId];
        if (atts.length == 0) return 0;
        uint256 total = 0;
        for (uint256 i = 0; i < atts.length; i++) {
            total += atts[i].score;
        }
        return total / atts.length;
    }

    function getAttestation(bytes32 checkpointHash) external view returns (Attestation memory) {
        return checkpointAttestations[checkpointHash];
    }
}
