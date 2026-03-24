/**
 * TradingStrategy interface + example implementations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO SWAP IN YOUR OWN MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Create a class that implements TradingStrategy
 * 2. In your analyze() method, call your LLM / algorithm with the MarketData
 * 3. Return a TradeDecision — the rest of the agent picks it up automatically
 *
 * Example with Claude:
 *   import Anthropic from "@anthropic-ai/sdk";
 *   class ClaudeStrategy implements TradingStrategy { ... }
 *
 * Example with Groq:
 *   import Groq from "groq-sdk";
 *   class GroqStrategy implements TradingStrategy { ... }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { MarketData, TradeDecision, TradingStrategy } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Simple momentum strategy (no LLM — good for testing the template)
// ─────────────────────────────────────────────────────────────────────────────

export class MomentumStrategy implements TradingStrategy {
  private priceHistory: number[] = [];
  private readonly windowSize: number;
  private readonly tradeAmountUsd: number;

  constructor(windowSize = 5, tradeAmountUsd = 100) {
    this.windowSize = windowSize;
    this.tradeAmountUsd = tradeAmountUsd;
  }

  async analyze(data: MarketData): Promise<TradeDecision> {
    this.priceHistory.push(data.price);
    if (this.priceHistory.length > this.windowSize) {
      this.priceHistory.shift();
    }

    if (this.priceHistory.length < this.windowSize) {
      return {
        action: "HOLD",
        asset: data.pair.replace("USD", ""),
        pair: data.pair,
        amount: 0,
        confidence: 0.5,
        reasoning: `Warming up: have ${this.priceHistory.length}/${this.windowSize} price samples. Holding.`,
      };
    }

    const first = this.priceHistory[0];
    const last = this.priceHistory[this.priceHistory.length - 1];
    const changePct = ((last - first) / first) * 100;
    const spread = ((data.ask - data.bid) / data.price) * 100;

    let action: TradeDecision["action"] = "HOLD";
    let confidence = 0.5;
    let reasoning = "";

    if (changePct > 0.5 && spread < 0.1) {
      action = "BUY";
      confidence = Math.min(0.9, 0.5 + Math.abs(changePct) / 10);
      reasoning = `Upward momentum: price rose ${changePct.toFixed(2)}% over last ${this.windowSize} ticks. Spread is tight at ${spread.toFixed(3)}%. Buying.`;
    } else if (changePct < -0.5) {
      action = "SELL";
      confidence = Math.min(0.9, 0.5 + Math.abs(changePct) / 10);
      reasoning = `Downward momentum: price fell ${Math.abs(changePct).toFixed(2)}% over last ${this.windowSize} ticks. Selling to avoid further loss.`;
    } else {
      reasoning = `No clear momentum (${changePct.toFixed(2)}% change). Holding current position.`;
    }

    return {
      action,
      asset: data.pair.replace("USD", ""),
      pair: data.pair,
      amount: action === "HOLD" ? 0 : this.tradeAmountUsd,
      confidence,
      reasoning,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM-backed strategy stub — replace the body of analyze() with your model call
// ─────────────────────────────────────────────────────────────────────────────

export class LLMStrategy implements TradingStrategy {
  // Add your LLM client here, e.g.:
  // private client: Anthropic;
  // constructor() { this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }

  async analyze(data: MarketData): Promise<TradeDecision> {
    // ── REPLACE THIS with your actual LLM call ────────────────────────────
    //
    // const response = await this.client.messages.create({
    //   model: "claude-sonnet-4-6",
    //   max_tokens: 500,
    //   messages: [{
    //     role: "user",
    //     content: `You are a crypto trading agent. Here is the current market data:
    //       Pair: ${data.pair}
    //       Price: $${data.price}
    //       24h High: $${data.high}, Low: $${data.low}
    //       Volume: ${data.volume}
    //       VWAP: $${data.vwap}
    //
    //       Respond with JSON: { action: "BUY"|"SELL"|"HOLD", amount: number, confidence: 0-1, reasoning: string }`
    //   }]
    // });
    // const parsed = JSON.parse(response.content[0].text);
    // return { ...parsed, asset: "BTC", pair: data.pair };
    //
    // ─────────────────────────────────────────────────────────────────────

    // Stub: always HOLD until you wire in your model
    return {
      action: "HOLD",
      asset: data.pair.replace("USD", ""),
      pair: data.pair,
      amount: 0,
      confidence: 0.5,
      reasoning: "LLMStrategy stub — wire in your model in src/agent/strategy.ts",
    };
  }
}
