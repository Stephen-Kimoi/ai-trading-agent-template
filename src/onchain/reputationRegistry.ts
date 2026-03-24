/**
 * ReputationRegistry — TypeScript integration layer
 *
 * Used by validators (or counterparties) to post feedback on agent performance.
 * The agent itself does NOT call this — it's called by the parties that interact
 * with the agent after a trade or task is completed.
 *
 * The hackathon leaderboard reads average reputation scores from this registry
 * to factor into the overall ranking alongside PnL.
 */

import { ethers } from "ethers";

const REPUTATION_ABI = [
  "function submitFeedback(uint256 agentId, uint8 score, bytes32 outcomeRef, string comment, uint8 feedbackType) external",
  "function getAverageScore(uint256 agentId) external view returns (uint256)",
  "function getFeedbackHistory(uint256 agentId) external view returns (tuple(address rater, uint8 score, bytes32 outcomeRef, string comment, uint256 timestamp, uint8 feedbackType)[])",
  "function hasRated(uint256 agentId, address rater) external view returns (bool)",
  "function reputation(uint256 agentId) external view returns (uint256 totalScore, uint256 feedbackCount, uint256 lastUpdated)",
  "event FeedbackSubmitted(uint256 indexed agentId, address indexed rater, uint8 score, bytes32 outcomeRef, uint8 feedbackType)",
];

export enum FeedbackType {
  TRADE_EXECUTION = 0,
  RISK_MANAGEMENT = 1,
  STRATEGY_QUALITY = 2,
  GENERAL = 3,
}

export interface FeedbackEntry {
  rater: string;
  score: number;
  outcomeRef: string;
  comment: string;
  timestamp: number;
  feedbackType: FeedbackType;
}

export class ReputationRegistryClient {
  private contract: ethers.Contract;

  constructor(registryAddress: string, signerOrProvider: ethers.Signer | ethers.Provider) {
    this.contract = new ethers.Contract(registryAddress, REPUTATION_ABI, signerOrProvider);
  }

  /**
   * Submit feedback for an agent after a completed trade or task.
   *
   * @param agentId     ERC-721 agent token ID
   * @param score       Quality score 1–100
   * @param outcomeRef  Hash anchoring feedback to an objective outcome
   *                    (e.g. ethers.keccak256 of a trade tx hash or checkpoint hash)
   * @param comment     Optional description
   * @param type        Category of feedback
   */
  async submitFeedback(
    agentId: bigint,
    score: number,
    outcomeRef: string,
    comment: string,
    type: FeedbackType = FeedbackType.TRADE_EXECUTION
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.submitFeedback(agentId, score, outcomeRef, comment, type);
    return tx.wait();
  }

  /**
   * Get the average reputation score for an agent (0 if no feedback yet).
   */
  async getAverageScore(agentId: bigint): Promise<number> {
    return Number(await this.contract.getAverageScore(agentId));
  }

  /**
   * Get the full feedback history for an agent.
   */
  async getFeedbackHistory(agentId: bigint): Promise<FeedbackEntry[]> {
    const entries = await this.contract.getFeedbackHistory(agentId);
    return entries.map((e: { rater: string; score: bigint; outcomeRef: string; comment: string; timestamp: bigint; feedbackType: bigint }) => ({
      rater: e.rater,
      score: Number(e.score),
      outcomeRef: e.outcomeRef,
      comment: e.comment,
      timestamp: Number(e.timestamp),
      feedbackType: Number(e.feedbackType) as FeedbackType,
    }));
  }

  /**
   * Check if an address has already rated an agent.
   */
  async hasRated(agentId: bigint, raterAddress: string): Promise<boolean> {
    return this.contract.hasRated(agentId, raterAddress);
  }

  /**
   * Get reputation summary (totalScore, feedbackCount, lastUpdated).
   */
  async getReputationSummary(agentId: bigint) {
    const r = await this.contract.reputation(agentId);
    return {
      totalScore: Number(r.totalScore),
      feedbackCount: Number(r.feedbackCount),
      lastUpdated: Number(r.lastUpdated),
      averageScore: r.feedbackCount > 0n ? Number(r.totalScore) / Number(r.feedbackCount) : 0,
    };
  }
}
