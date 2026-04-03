/**
 * TradingStrategy interface + example implementations.
 * ALL FIXES APPLIED:
 * ✅ FIX #1: MomentumStrategy - Added volume validation
 * ✅ FIX #2: VolumeConfirmedMomentumStrategy - Corrected OBV calculation
 * ✅ FIX #3: VolumeConfirmedMomentumStrategy - Added VWAP calculation
 * ✅ FIX #4: LLMStrategy - Configurable model name
 * ✅ FIX #5: VolumeConfirmedMomentumStrategy - Position size tracking for stop-loss
 */

import { MarketData, TradeDecision, TradingStrategy } from "../types/index";
import Groq from "groq-sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Simple momentum strategy (no LLM — good for testing)
// ✅ FIX #1: Added volume validation
// ─────────────────────────────────────────────────────────────────────────────

export class MomentumStrategy implements TradingStrategy {
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];  // ✅ FIX #1: Track volume history
  private readonly windowSize: number;
  private readonly tradeAmountUsd: number;

  constructor(windowSize = 5, tradeAmountUsd = 100) {
    this.windowSize = windowSize;
    this.tradeAmountUsd = tradeAmountUsd;
  }

  async analyze(data: MarketData): Promise<TradeDecision> {
    this.priceHistory.push(data.price);
    if (this.priceHistory.length > this.windowSize) this.priceHistory.shift();

    // ✅ FIX #1: Track volume history
    this.volumeHistory.push(data.volume);
    if (this.volumeHistory.length > this.windowSize) this.volumeHistory.shift();

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

    // ✅ FIX #1: Calculate average volume for validation
    const avgVolume = this.volumeHistory.reduce((a, b) => a + b, 0) / this.volumeHistory.length;
    const volumeConfirmed = data.volume > avgVolume * 1.5; // 50% above average

    let action: TradeDecision["action"] = "HOLD";
    let confidence = 0.5;
    let reasoning = "";

    // ✅ FIX #1: Add volume check to BUY condition
    if (changePct > 0.5 && spread < 0.1 && volumeConfirmed) {
      action = "BUY";
      confidence = Math.min(0.9, 0.5 + Math.abs(changePct) / 10);
      reasoning = `Upward momentum: price rose ${changePct.toFixed(2)}% + volume confirmed. Over ${this.windowSize} ticks.`;
    } 
    // ✅ FIX #1: Add volume check to SELL condition
    else if (changePct < -0.5 && volumeConfirmed) {
      action = "SELL";
      confidence = Math.min(0.9, 0.5 + Math.abs(changePct) / 10);
      reasoning = `Downward momentum: price fell ${Math.abs(changePct).toFixed(2)}% + volume confirmed. Over ${this.windowSize} ticks.`;
    } else {
      reasoning = `No clear momentum (${changePct.toFixed(2)}% change, vol=${volumeConfirmed ? 'OK' : 'LOW'}). Holding.`;
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
// Your Volume + OBV + VWAP strategy (rule-based — exactly as you designed)
// ✅ FIX #2: Corrected OBV calculation
// ✅ FIX #3: Added VWAP calculation
// ✅ FIX #5: Position size tracking for stop-loss
// ─────────────────────────────────────────────────────────────────────────────

export class VolumeConfirmedMomentumStrategy implements TradingStrategy {
  private readonly VOLUME_PERCENTILE = 75;
  private readonly OBV_SMA_PERIOD = 5;
  private readonly VOLUME_LOOKBACK = 20;
  private readonly MIN_SESSION_BARS = parseInt(process.env.MIN_SESSION_BARS || "30");
  private readonly tradeAmountUsd = 250;

  private obvHistory: number[] = [];
  private volumeHistory: number[] = [];
  private currentOBV: number = 0;
  private lastPrice: number = 0;
  private barCount: number = 0;
  private entryPrice: number | null = null;

  // ✅ FIX #3: VWAP calculation tracking
  private cumulativeVolume: number = 0;
  private cumulativePriceVolume: number = 0;

  // ✅ FIX #5: Position size tracking
  private currentPositionSize: number = 0;

  async analyze(data: MarketData): Promise<TradeDecision> {
    this.barCount++;

    // ✅ FIX #3: Calculate VWAP properly
    this.cumulativePriceVolume += data.price * data.volume;
    this.cumulativeVolume += data.volume;
    const vwap = this.cumulativeVolume > 0 
      ? this.cumulativePriceVolume / this.cumulativeVolume 
      : data.price;

    // ✅ FIX #2: Correct OBV calculation (not direction * volume)
    if (data.price > this.lastPrice) {
      this.currentOBV += data.volume;      // Price up: add volume
    } else if (data.price < this.lastPrice) {
      this.currentOBV -= data.volume;      // Price down: subtract volume
    }
    // If price unchanged: no change to OBV (don't modify it)

    this.obvHistory.push(this.currentOBV);
    if (this.obvHistory.length > this.OBV_SMA_PERIOD) this.obvHistory.shift();

    this.volumeHistory.push(data.volume);
    if (this.volumeHistory.length > this.VOLUME_LOOKBACK) this.volumeHistory.shift();

    this.lastPrice = data.price;

    const obvSMA = this.obvHistory.length === this.OBV_SMA_PERIOD
      ? this.obvHistory.reduce((a, b) => a + b, 0) / this.OBV_SMA_PERIOD
      : this.currentOBV;

    const sortedVolumes = [...this.volumeHistory].sort((a, b) => a - b);
    const idx = Math.floor(this.volumeHistory.length * (this.VOLUME_PERCENTILE / 100));
    const volumeThreshold = sortedVolumes[idx] ?? 0;
    const highVolume = data.volume > volumeThreshold;

   const sessionReady =
  this.barCount > this.MIN_SESSION_BARS ||
  process.env.DEV_MODE === "true";

    // ✅ FIX #5: Check stop-loss with actual position size
    if (this.entryPrice && this.currentPositionSize > 0 && 
        (data.price / this.entryPrice - 1) < -0.02) {
      const exitAmount = this.currentPositionSize * data.price;
      this.entryPrice = null;
      this.currentPositionSize = 0;
      return {
        action: "SELL",
        asset: data.pair.replace("USD", ""),
        pair: data.pair,
        amount: exitAmount,  // ✅ FIX #5: Use actual position value
        confidence: 1.0,
        reasoning: "🚨 HARD STOP-LOSS triggered (-2%)",
      };
    }

    // BUY
    if (
      this.currentOBV > obvSMA &&
      data.price > vwap &&
      highVolume &&
      sessionReady
    ) {
      this.entryPrice = data.price;
      this.currentPositionSize = this.tradeAmountUsd / data.price;  // ✅ FIX #5: Track size
      return {
        action: "BUY",
        asset: data.pair.replace("USD", ""),
        pair: data.pair,
        amount: this.tradeAmountUsd,
        confidence: 0.85,
        reasoning: `Strong BUY: OBV > SMA(${this.OBV_SMA_PERIOD}), price > VWAP, volume > ${this.VOLUME_PERCENTILE}th percentile`,
      };
    }

    // SELL (exit)
    if (
      this.currentOBV < obvSMA &&
      data.price < vwap &&
      highVolume
    ) {
      // ✅ FIX #5: Calculate exit value based on actual position
      const exitAmount = this.currentPositionSize > 0 
        ? this.currentPositionSize * data.price 
        : this.tradeAmountUsd;
      this.entryPrice = null;
      this.currentPositionSize = 0;  // ✅ FIX #5: Clear position
      return {
        action: "SELL",
        asset: data.pair.replace("USD", ""),
        pair: data.pair,
        amount: exitAmount,  // ✅ FIX #5: Use actual calculated amount
        confidence: 0.85,
        reasoning: `Strong SELL: OBV < SMA(${this.OBV_SMA_PERIOD}), price < VWAP, volume spike`,
      };
    }

    // HOLD
    let reason = "HOLD - ";
    if (!sessionReady) reason += "First 15 min VWAP warm-up";
    else if (!highVolume) reason += "Volume below threshold";
    else if (this.currentOBV > obvSMA && data.price < vwap) reason += "OBV up but price < VWAP";
    else if (this.currentOBV < obvSMA && data.price > vwap) reason += "OBV down but price > VWAP";
    else reason += "No clear confluence";

    return {
      action: "HOLD",
      asset: data.pair.replace("USD", ""),
      pair: data.pair,
      amount: 0,
      confidence: 0.4,
      reasoning: reason,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM-backed strategy (your rules + Groq intelligence)
// ✅ FIX #4: Configurable model name via constructor + env var
// ─────────────────────────────────────────────────────────────────────────────

export class LLMStrategy implements TradingStrategy {
  private client: Groq;
  private readonly modelId: string;  // ✅ FIX #4: Model configurable

  constructor(modelId?: string) {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    // ✅ FIX #4: Allow model override via constructor or env var
    this.modelId = modelId || process.env.LLM_MODEL || "llama-3.3-70b-versatile";
  }

  async analyze(data: MarketData): Promise<TradeDecision> {
    const prompt = `You are an elite crypto trading agent using this PRECISE strategy:

BUY only when ALL three are true:
- OBV > OBV_SMA(5)
- price > VWAP
- volume > 75th percentile of last 20 periods

SELL (exit) only when ALL three are true:
- OBV < OBV_SMA(5)
- price < VWAP
- volume > 75th percentile of last 20 periods

HOLD in these cases:
- OBV and VWAP conflict
- volume below threshold
- first 15 minutes of session
- 2% stop-loss from entry price

Current market snapshot:
Pair: ${data.pair}
Price: $${data.price}
Volume: ${data.volume}
Bid/Ask: ${data.bid} / ${data.ask}

Respond with VALID JSON ONLY:
{
  "action": "BUY" | "SELL" | "HOLD",
  "amount": number,
  "confidence": number,
  "reasoning": string
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelId,  // ✅ FIX #4: Use configurable model
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 300,
      });

      const text = response.choices[0].message.content || '{"action":"HOLD","amount":0,"confidence":0.5,"reasoning":"Parse error"}';
      const parsed = JSON.parse(text.trim());

      return {
        action: parsed.action || "HOLD",
        asset: data.pair.replace("USD", ""),
        pair: data.pair,
        amount: parsed.amount ?? 0,
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning || "LLM decision",
      };
    } catch (e) {
      console.error("LLM error:", e);
      return {
        action: "HOLD",
        asset: data.pair.replace("USD", ""),
        pair: data.pair,
        amount: 0,
        confidence: 0.3,
        reasoning: "LLM call failed — holding",
      };
    }
  }
}