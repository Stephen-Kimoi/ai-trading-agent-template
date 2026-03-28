# Part 7: Using This as a Reusable Template

## The architecture in one picture

```
┌────────────────────────────────────────────────────────────────┐
│                     YOUR STRATEGY (swap here)                  │
│  implements TradingStrategy { analyze(MarketData): TradeDecision }  │
└──────────────────────────────┬─────────────────────────────────┘
                               │ TradeDecision
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                     FIXED SCAFFOLDING                          │
│                                                                │
│  Identity     ERC-8004 AgentRegistry (Sepolia)                │
│  Vault        Vault.allocatedCapital[agentId]                 │
│  Risk         RiskRouter.validateTrade(agentId, size)         │
│  Exchange     Kraken REST API (paper or live)                 │
│  Explain      formatExplanation(decision, market)             │
│  Checkpoint   EIP-712 signTypedData → checkpoints.jsonl       │
└────────────────────────────────────────────────────────────────┘
```

Everything below the dashed line is provided by this template. You only need to implement `analyze()`.

---

## How to swap in your own strategy

### Option A: Simple algorithmic strategy

Implement [`TradingStrategy`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/agent/strategy.ts) directly:

```typescript
// src/agent/my-strategy.ts
import { MarketData, TradeDecision, TradingStrategy } from "../types/index";

export class MyStrategy implements TradingStrategy {
  async analyze(data: MarketData): Promise<TradeDecision> {
    // Your logic here — technical indicators, ML model, anything
    const action = data.price > data.vwap ? "BUY" : "SELL";

    return {
      action,
      asset: "XBT",
      pair: data.pair,
      amount: 100,
      confidence: 0.7,
      reasoning: `Price ($${data.price}) is ${action === "BUY" ? "above" : "below"} VWAP ($${data.vwap.toFixed(2)}). ${action}.`,
    };
  }
}
```

Then in [`src/agent/index.ts` L28 & L211](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/agent/index.ts#L28), swap the strategy import:

```typescript
// Before:
import { MomentumStrategy } from "./strategy";
const strategy = new MomentumStrategy(5, 100);

// After:
import { MyStrategy } from "./my-strategy.js";
const strategy = new MyStrategy();
```

That's it. Everything else — identity, vault, risk checks, Kraken execution, checkpoints — runs unchanged.

---

### Option B: Claude API strategy

Full stub in [`src/agent/strategy.ts` L90](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/agent/strategy.ts#L90) — uncomment and fill in your client:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { MarketData, TradeDecision, TradingStrategy } from "../types/index";

export class ClaudeStrategy implements TradingStrategy {
  private client = new Anthropic();

  async analyze(data: MarketData): Promise<TradeDecision> {
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: `You are a crypto trading agent. Respond ONLY with valid JSON matching:
        { action: "BUY"|"SELL"|"HOLD", amount: number, confidence: number, reasoning: string }
        reasoning must reference specific numbers from the market data.`,
      messages: [{
        role: "user",
        content: `Analyze: pair=${data.pair} price=${data.price} high=${data.high} low=${data.low} vwap=${data.vwap} volume=${data.volume}`,
      }],
    });

    const parsed = JSON.parse(response.content[0].type === "text" ? response.content[0].text : "{}");
    return {
      ...parsed,
      asset: data.pair.replace("USD", ""),
      pair: data.pair,
    };
  }
}
```

Add to `.env`: `ANTHROPIC_API_KEY=your_key`

---

### Option C: Groq / Llama strategy

See also [`src/agent/strategy.ts` L27](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/agent/strategy.ts#L27) for the `MomentumStrategy` reference implementation:

```typescript
import Groq from "groq-sdk";
import { MarketData, TradeDecision, TradingStrategy } from "../types/index";

export class GroqStrategy implements TradingStrategy {
  private client = new Groq({ apiKey: process.env.GROQ_API_KEY });

  async analyze(data: MarketData): Promise<TradeDecision> {
    const completion = await this.client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `Trading agent. Return JSON: { action, amount, confidence, reasoning }`,
        },
        {
          role: "user",
          content: JSON.stringify({ pair: data.pair, price: data.price, high: data.high, low: data.low, vwap: data.vwap }),
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    return { ...parsed, asset: data.pair.replace("USD", ""), pair: data.pair };
  }
}
```

---

## What teams can customize

| Layer | Customizable? | How |
|-------|--------------|-----|
| Trading strategy / model | ✅ Yes | Implement [`TradingStrategy`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/agent/strategy.ts#L27) |
| Trading pair | ✅ Yes | [`TRADING_PAIR`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/agent/index.ts#L41) in `.env` |
| Poll interval | ✅ Yes | [`POLL_INTERVAL_MS`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/agent/index.ts#L42) in `.env` |
| Risk parameters | ✅ Yes | [`setRiskParams()`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/onchain/riskRouter.ts#L183) call |
| Agent metadata | ✅ Yes | Edit name/description/capabilities in [`register-agent.ts`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/scripts/register-agent.ts#L48) |
| ERC-8004 identity scheme | ❌ Fixed | Same for all agents |
| Vault + RiskRouter contracts | ❌ Fixed | Same contracts, per-agent config |
| Kraken API client | ❌ Fixed | [`src/exchange/kraken.ts`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/exchange/kraken.ts) |
| EIP-712 checkpoint format | ❌ Fixed | [`src/explainability/checkpoint.ts`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/explainability/checkpoint.ts#L28) |

---

## Checklist for a new team

1. `git clone https://github.com/Stephen-Kimoi/ai-trading-agent-template && cd ai-trading-agent-template`
2. `npm install`
3. `cp .env.example .env` and fill in keys
4. `npx hardhat run scripts/deploy.ts --network sepolia` — deploy contracts
5. Add all 5 contract addresses to `.env`
6. `npm run register` — register your agent on-chain
7. Add `AGENT_ID` to `.env`
8. Write your strategy in `src/agent/my-strategy.ts`
9. Swap the strategy import in `src/agent/index.ts`
10. Run the agent and dashboard in two terminals:
   ```bash
   npm run run-agent    # Terminal 1
   npm run dashboard    # Terminal 2 → http://localhost:3000
   ```

---

## Going to production

When you're ready to trade for real:
1. Set `KRAKEN_SANDBOX=false` in `.env`
2. Ensure your vault has allocated capital for your agent
3. Set sensible risk params via [`setRiskParams()`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/onchain/riskRouter.ts#L183)
4. Monitor the dashboard (`npm run dashboard`) for live decisions and signed checkpoints
5. All checkpoints are also written to `checkpoints.jsonl` for offline audit

---

## Dashboard

The project ships with a live web dashboard ([`scripts/dashboard.ts`](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/scripts/dashboard.ts)) that reads from `checkpoints.jsonl` and auto-refreshes every 5 seconds:

```bash
npm run dashboard   # → http://localhost:3000
```

It shows:
- **Live BTC price** with tick-by-tick change
- **Last decision** (HOLD / BUY / SELL) with colour indicator
- **Price chart** of the last 20 ticks
- **Agent info** — agentId, wallet, pair, checkpoint count
- **Checkpoint feed** — every decision as a card with reasoning, confidence bar, and truncated EIP-712 signature

Run it alongside `npm run run-agent` for a complete view of the agent in action.

---

Congratulations — you have a production-ready AI trading agent with on-chain identity, risk controls, cryptographic explainability, and a live dashboard.
