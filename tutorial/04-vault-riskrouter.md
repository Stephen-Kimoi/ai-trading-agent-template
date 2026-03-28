# Part 4: The Vault, Risk Router, and TradeIntent Pattern

## The full flow

```
Strategy decision (TradeDecision)
       ↓
  Build TradeIntent struct
       ↓
  Sign with EIP-712 (agentWallet)
       ↓
  RiskRouter.submitTradeIntent(intent, signature)
       ├── verifies EIP-712 signature → agentWallet in AgentRegistry
       ├── checks nonce (replay protection)
       ├── checks deadline
       ├── validates risk params (position size, trade frequency)
       ├── emits TradeApproved or TradeRejected on-chain
       ↓ (if approved)
  Kraken CLI: placeOrder()
       ↓
  Vault tracks capital
```

Every step is on-chain. Every approval and rejection is a permanent event.

---

## The TradeIntent struct

Instead of the agent directly calling Kraken, it first constructs a **signed intent**: a commitment to a specific trade that's been cryptographically authorized ([`contracts/RiskRouter.sol` L35–L44](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/contracts/RiskRouter.sol#L35-L44)):

```solidity
struct TradeIntent {
    uint256 agentId;
    address agentWallet;       // must match AgentRegistry
    string  pair;              // e.g. "XBTUSD"
    string  action;            // "BUY" or "SELL"
    uint256 amountUsdScaled;   // USD * 100 (e.g. 50000 = $500)
    uint256 maxSlippageBps;    // max acceptable slippage
    uint256 nonce;             // replay protection
    uint256 deadline;          // Unix timestamp
}
```

The nonce increments with each approved intent, so an old signature can't be replayed.

---

## Building and signing a TradeIntent (TypeScript)

[`src/onchain/riskRouter.ts` L72–L145](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/onchain/riskRouter.ts#L72-L145) handles this:

```typescript
const riskRouter = new RiskRouterClient(routerAddress, agentWallet, SEPOLIA_CHAIN_ID);

// 1. Build intent (fetches current nonce from chain)
const intent = await riskRouter.buildIntent(
  agentId,
  agentWallet.address,
  "XBTUSD",
  "BUY",
  100,   // $100 USD
  { maxSlippageBps: 50, deadlineSeconds: 300 }
);

// 2. Sign with EIP-712 (agentWallet is the hot signing key)
const signed = await riskRouter.signIntent(intent, agentWallet);

// 3. Submit to RiskRouter
const result = await riskRouter.submitIntent(signed);

if (result.approved) {
  console.log("Trade approved — intentHash:", result.intentHash);
} else {
  console.warn("Trade rejected:", result.reason);
}
```

The `intentHash` is carried into the EIP-712 checkpoint, linking the checkpoint to the specific approved intent.

---

## What the RiskRouter checks

```
1. deadline     — is the intent still valid?
2. nonce        — does it match the stored nonce (not replayed)?
3. signature    — does it recover to the registered agentWallet?
4. position size — is amountUsdScaled ≤ maxPositionSize?
5. trade frequency — are we within maxTradesPerHour?
```

Each check emits an event on Sepolia if it fails:
```
TradeRejected(agentId, intentHash, "Exceeds maxPositionSize")
TradeRejected(agentId, intentHash, "Intent expired")
```

If all checks pass:
```
TradeApproved(agentId, intentHash, amountUsdScaled)
```

---

## Setting your risk params

You don't need to do this manually: `npm run register` already sets default risk params as part of registration ([`scripts/register-agent.ts` L76–L83](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/scripts/register-agent.ts#L76-L83)):

```typescript
// Called automatically during npm run register
await router.setRiskParams(
  agentId,
  BigInt(50000),  // maxPositionUsdScaled: $500 max per trade (500 * 100)
  BigInt(500),    // maxDrawdownBps: 5%
  BigInt(10)      // maxTradesPerHour: 10
);
```

To change them later, use [`src/onchain/riskRouter.ts` L183–L196](https://github.com/Stephen-Kimoi/ai-trading-agent-template/blob/main/src/onchain/riskRouter.ts#L183-L196):

```typescript
await riskRouter.setRiskParams(
  agentId,
  500,    // maxPositionUsd: $500 per trade
  500,    // maxDrawdownBps: 5%
  10      // maxTradesPerHour
);
```

---

## Template note

> **Why this matters:** The TradeIntent pattern gives every trade a cryptographic proof of intent that was validated on-chain before execution. This is what makes agent behavior auditable and trustworthy: anyone can verify that a specific trade was approved by a specific registered agent against a defined risk policy, without having to trust the agent's own logs.

---

→ [Part 5: Building the Explanation Layer](./05-explanation-layer.md)