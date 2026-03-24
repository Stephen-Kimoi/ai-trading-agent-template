// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgentRegistry.sol";

/**
 * @title ReputationRegistry
 * @notice On-chain reputation accumulation for ERC-8004 agents.
 *
 * When an agent completes a task (e.g. a trade), any counterparty or validator
 * can submit signed feedback. The registry aggregates scores and prevents
 * self-rating (operators cannot rate their own agents).
 *
 * Reputation is public and queryable — any contract or off-chain system can
 * read an agent's score before deciding whether to interact with it.
 *
 * Anti-sybil protections:
 *   1. Operators and owners cannot rate their own agents
 *   2. Each rater address can only submit once per agent (one review per wallet)
 *   3. Feedback requires an on-chain reference (e.g. a tx hash or checkpoint hash)
 *      so ratings are anchored to objective outcomes, not arbitrary opinions
 */
contract ReputationRegistry {
    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct FeedbackEntry {
        address rater;
        uint8   score;        // 1–100
        bytes32 outcomeRef;   // keccak256 of tx hash, checkpoint hash, or trade ID
        string  comment;
        uint256 timestamp;
        FeedbackType feedbackType;
    }

    enum FeedbackType {
        TRADE_EXECUTION,   // Agent executed a trade on behalf of rater
        RISK_MANAGEMENT,   // Agent managed risk correctly
        STRATEGY_QUALITY,  // Signal quality / alpha generated
        GENERAL
    }

    struct ReputationSummary {
        uint256 totalScore;
        uint256 feedbackCount;
        uint256 lastUpdated;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    AgentRegistry public immutable agentRegistry;

    mapping(uint256 => ReputationSummary) public reputation;
    mapping(uint256 => FeedbackEntry[]) private _feedbackHistory;
    // agentId → rater → has rated
    mapping(uint256 => mapping(address => bool)) private _hasRated;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event FeedbackSubmitted(
        uint256 indexed agentId,
        address indexed rater,
        uint8 score,
        bytes32 outcomeRef,
        FeedbackType feedbackType
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address agentRegistryAddress) {
        agentRegistry = AgentRegistry(agentRegistryAddress);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Feedback submission
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Submit feedback for an agent after interacting with it.
     * @param agentId      The ERC-721 agent token ID.
     * @param score        Score 1–100 (100 = best).
     * @param outcomeRef   Hash anchoring this feedback to an objective outcome
     *                     (e.g. keccak256 of a trade tx hash or EIP-712 checkpoint hash).
     * @param comment      Optional plain-text comment.
     * @param feedbackType Category of feedback.
     */
    function submitFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 outcomeRef,
        string calldata comment,
        FeedbackType feedbackType
    ) external {
        require(agentRegistry.isRegistered(agentId), "ReputationRegistry: agent not registered");
        require(score >= 1 && score <= 100, "ReputationRegistry: score must be 1-100");
        require(outcomeRef != bytes32(0), "ReputationRegistry: outcomeRef required");
        require(!_hasRated[agentId][msg.sender], "ReputationRegistry: already rated this agent");

        // Anti-sybil: operator/owner cannot rate their own agent
        AgentRegistry.AgentRegistration memory reg = agentRegistry.getAgent(agentId);
        require(msg.sender != reg.operatorWallet, "ReputationRegistry: operator cannot self-rate");
        require(msg.sender != agentRegistry.ownerOf(agentId), "ReputationRegistry: owner cannot self-rate");
        require(msg.sender != reg.agentWallet, "ReputationRegistry: agent wallet cannot self-rate");

        _hasRated[agentId][msg.sender] = true;

        _feedbackHistory[agentId].push(FeedbackEntry({
            rater: msg.sender,
            score: score,
            outcomeRef: outcomeRef,
            comment: comment,
            timestamp: block.timestamp,
            feedbackType: feedbackType
        }));

        ReputationSummary storage rep = reputation[agentId];
        rep.totalScore += score;
        rep.feedbackCount++;
        rep.lastUpdated = block.timestamp;

        emit FeedbackSubmitted(agentId, msg.sender, score, outcomeRef, feedbackType);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Get the average reputation score for an agent (0 if no feedback).
     */
    function getAverageScore(uint256 agentId) external view returns (uint256) {
        ReputationSummary storage rep = reputation[agentId];
        if (rep.feedbackCount == 0) return 0;
        return rep.totalScore / rep.feedbackCount;
    }

    /**
     * @notice Get the full feedback history for an agent.
     */
    function getFeedbackHistory(uint256 agentId) external view returns (FeedbackEntry[] memory) {
        return _feedbackHistory[agentId];
    }

    /**
     * @notice Get paginated feedback history.
     */
    function getFeedbackPage(
        uint256 agentId,
        uint256 offset,
        uint256 limit
    ) external view returns (FeedbackEntry[] memory page) {
        FeedbackEntry[] storage history = _feedbackHistory[agentId];
        uint256 len = history.length;
        if (offset >= len) return new FeedbackEntry[](0);
        uint256 end = offset + limit > len ? len : offset + limit;
        page = new FeedbackEntry[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = history[i];
        }
    }

    function hasRated(uint256 agentId, address rater) external view returns (bool) {
        return _hasRated[agentId][rater];
    }
}
