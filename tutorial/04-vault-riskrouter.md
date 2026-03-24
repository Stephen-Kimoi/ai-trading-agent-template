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

Instead of the agent directly calling Kraken, it first constructs a **signed intent** — a commitment to a specific trade that's been cryptographically authorized:

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

`src/onchain/riskRouter.ts` handles this:

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

After deployment, configure risk params for your agent (owner-only, called by the vault/router deployer):

```typescript
await riskRouter.setRiskParams(
  agentId,
  500,    // maxPositionUsd: $500 per trade
  500,    // maxDrawdownBps: 5%
  10      // maxTradesPerHour
);
```

Or the register script does this automatically. You can also call it directly:

```bash
cast send $RISK_ROUTER_ADDRESS \
  "setRiskParams(uint256,uint256,uint256,uint256)" \
  $AGENT_ID 50000 500 10 \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY
```

---

## Connecting to the hackathon-provided vault + router

The hackathon provides pre-deployed Vault and Risk Router contracts. To connect your agent:

1. Set `HACKATHON_VAULT_ADDRESS` and `RISK_ROUTER_ADDRESS` in `.env` to the provided addresses
2. The `RiskRouterClient` and `VaultClient` will connect to those contracts
3. Re-sign your `TradeIntent` against the hackathon router's domain (different `verifyingContract`)

The interface is identical — the same TypeScript code works with both your own contracts and the hackathon-provided ones.

---

## The HackathonVault

Capital is allocated per-agent. Before sizing a trade, the agent can verify it has sufficient capital:

```typescript
const vault = new VaultClient(vaultAddress, provider);
const hasCapital = await vault.hasSufficientCapital(agentId, 100, ethPrice);
```

The vault tracks `allocatedCapital[agentId]` — the hackathon organizers allocate sandbox capital to each registered team.

---

## Template note

> **For hackathon teams:** The TradeIntent pattern is the critical difference from v1. Every trade now has a cryptographic proof of intent that was validated on-chain before execution. This is what the hackathon judges read on the leaderboard — not just PnL, but validation quality.

---

→ [Part 5: Building the Explanation Layer](./05-explanation-layer.md)
