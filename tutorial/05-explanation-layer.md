# Part 5: Building the Explanation Layer

## Why explainability matters for trading agents

When an agent makes a trade, two questions need answers:
1. **For humans**: *Why did it do that?* — in plain language, auditable after the fact
2. **For machines**: *Can we verify it said what it claims to say?* — cryptographically

This tutorial covers the first question. Part 6 covers the second.

---

## The `reasoning` field in every decision

Every `TradeDecision` returned by your strategy must include a `reasoning` string:

```typescript
interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD";
  asset: string;
  pair: string;
  amount: number;
  confidence: number;
  reasoning: string;   // ← this is required
}
```

This is what your strategy should return for `reasoning`:

```
// Good: specific, auditable
"Price fell 1.2% over last 5 ticks while volume dropped 40% below average.
Bearish divergence — selling to reduce exposure. Risk: potential support at
$94,200 may reverse the move."

// Bad: too vague
"The market looks bad."
```

The reasoning field is:
- Logged to the console (human monitoring)
- Hashed into the EIP-712 checkpoint (cryptographic integrity)
- Stored in `checkpoints.jsonl` alongside the signature

---

## The `formatExplanation()` function

`src/explainability/reasoner.ts` wraps the decision + market context into a structured log line:

```typescript
import { formatExplanation } from "./src/explainability/reasoner.js";

const explanation = formatExplanation(decision, market);
console.log(explanation);
```

Output for a BUY:

```
[2024-01-15T10:30:00.000Z] BUY XBTUSD — $100.00 @ $95,420.50
  Confidence: 78%
  Reason: Upward momentum: price rose 0.62% over last 5 ticks. Spread is tight at 0.003%. Buying.
  Market context: 24h high=96200, low=93800, VWAP=94980.20
  Spread: 0.0052% | Volume: 1204.50
```

Output for a HOLD:

```
[2024-01-15T10:30:00.000Z] HOLD XBTUSD @ $95,420.50
  Confidence: 50%
  Reason: No clear momentum (0.12% change). Holding current position.
  Market: bid=95418, ask=95423, spread=0.0052%, vol=1204.50
```

---

## How your LLM generates reasoning

If you're using an LLM strategy, the reasoning field comes directly from the model. Here's how to prompt for it (example system prompt for Claude):

```
You are an autonomous crypto trading agent. For every analysis, you must return:
- action: BUY, SELL, or HOLD
- amount: trade size in USD (0 if HOLD)
- confidence: 0.0 to 1.0
- reasoning: a specific, technical explanation of your decision that references
  the actual numbers from the market data provided. Do not use vague language.
  Your reasoning must be auditable — someone should be able to read it and
  understand exactly why you made this trade.

Respond ONLY with valid JSON.
```

The key constraint: **reasoning must reference actual market data values**. This makes the explanation auditable — you can check the historical market data and verify the claim.

---

## The `formatCheckpointLog()` function

When a checkpoint is generated, `formatCheckpointLog()` produces a structured summary for the terminal:

```
────────────────────────────────────────────────────────────────────────
CHECKPOINT — BUY XBTUSD
  Agent:     0xabc...def
  Timestamp: 2024-01-15T10:30:00.000Z
  Amount:    $100
  Price:     $95420.5
  Confidence: 78%
  Reasoning: Upward momentum: price rose 0.62% over last 5 ticks...
  Sig:       0x1a2b3c4d5e6f7890...1234567890
  Signer:    0xYourWalletAddress
────────────────────────────────────────────────────────────────────────
```

---

## The checkpoints.jsonl file

Every checkpoint is appended to `checkpoints.jsonl` at the project root. Each line is a JSON object:

```json
{"agentId":"0x...","timestamp":1704067200,"action":"BUY","asset":"XBT","pair":"XBTUSD","amountUsd":100,"priceUsd":95420.5,"reasoning":"Upward momentum...","reasoningHash":"0x...","confidence":0.78,"signature":"0x...","signerAddress":"0x..."}
```

This file is your audit log. After a trading session you can:
- Review every decision and the reasoning behind it
- Verify any signature with `verifyCheckpoint()`
- Check that reasoning strings weren't tampered with using `verifyReasoningIntegrity()`

---

## Template note

> **For hackathon teams:** The explanation layer is already wired into the agent loop — you don't need to call it manually. Your strategy's `reasoning` field is all you need to fill in. Write good reasoning strings and you get good audit logs for free.

---

→ [Part 6: EIP-712 Signed Checkpoints](./06-eip712-checkpoints.md)
