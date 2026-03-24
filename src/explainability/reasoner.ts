/**
 * Human-readable trade explanation formatter.
 *
 * Every trade decision gets a plain-language explanation that answers:
 *  - What did the agent decide to do?
 *  - Why? (from the strategy's reasoning field)
 *  - How confident was it?
 *  - What was the market context at the time?
 *
 * These explanations are also hashed into the EIP-712 checkpoint so they're
 * cryptographically tied to the on-chain record.
 */

import { MarketData, TradeCheckpoint, TradeDecision } from "../types/index.js";

/**
 * Produce a single human-readable explanation string for a trade decision.
 */
export function formatExplanation(decision: TradeDecision, market: MarketData): string {
  const action = decision.action;
  const pair = market.pair;
  const price = market.price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const confidencePct = (decision.confidence * 100).toFixed(0);
  const spread = (((market.ask - market.bid) / market.price) * 100).toFixed(4);
  const time = new Date().toISOString();

  if (action === "HOLD") {
    return (
      `[${time}] HOLD ${pair} @ ${price}\n` +
      `  Confidence: ${confidencePct}%\n` +
      `  Reason: ${decision.reasoning}\n` +
      `  Market: bid=${market.bid}, ask=${market.ask}, spread=${spread}%, vol=${market.volume.toFixed(2)}`
    );
  }

  const amountStr = decision.amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    `[${time}] ${action} ${pair} — ${amountStr} @ ${price}\n` +
    `  Confidence: ${confidencePct}%\n` +
    `  Reason: ${decision.reasoning}\n` +
    `  Market context: 24h high=${market.high}, low=${market.low}, VWAP=${market.vwap.toFixed(2)}\n` +
    `  Spread: ${spread}% | Volume: ${market.volume.toFixed(2)}`
  );
}

/**
 * Format a checkpoint for console output — useful for live monitoring.
 */
export function formatCheckpointLog(checkpoint: TradeCheckpoint): string {
  return (
    `\n${"─".repeat(72)}\n` +
    `CHECKPOINT — ${checkpoint.action} ${checkpoint.pair}\n` +
    `  Agent:     ${checkpoint.agentId}\n` +
    `  Timestamp: ${new Date(checkpoint.timestamp * 1000).toISOString()}\n` +
    `  Amount:    $${checkpoint.amountUsd}\n` +
    `  Price:     $${checkpoint.priceUsd}\n` +
    `  Confidence: ${(checkpoint.confidence * 100).toFixed(0)}%\n` +
    `  Reasoning: ${checkpoint.reasoning}\n` +
    `  Sig:       ${checkpoint.signature.slice(0, 20)}...${checkpoint.signature.slice(-10)}\n` +
    `  Signer:    ${checkpoint.signerAddress}\n` +
    `${"─".repeat(72)}\n`
  );
}
