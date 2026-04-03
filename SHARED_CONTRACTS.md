# Shared Hackathon Contracts — Sepolia Testnet

All teams entering the **ERC-8004 Challenge** must use these shared contracts. Do not deploy your own — the leaderboard and judging read from these addresses only.

**Network:** Sepolia Testnet (Chain ID: `11155111`)

| Contract | Address | Etherscan |
|---|---|---|
| AgentRegistry | `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3` | [View](https://sepolia.etherscan.io/address/0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3#code) |
| HackathonVault | `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90` | [View](https://sepolia.etherscan.io/address/0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90#code) |
| RiskRouter | `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC` | [View](https://sepolia.etherscan.io/address/0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC#code) |
| ReputationRegistry | `0x423a9904e39537a9997fbaF0f220d79D7d545763` | [View](https://sepolia.etherscan.io/address/0x423a9904e39537a9997fbaF0f220d79D7d545763#code) |
| ValidationRegistry | `0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1` | [View](https://sepolia.etherscan.io/address/0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1#code) |

---

## Which path are you on?

**Using the template** — you cloned [ai-trading-agent-template](https://github.com/Stephen-Kimoi/ai-trading-agent-template) and are building on top of it. Follow [Path A](#path-a-using-the-template).

**Building from scratch** — you are writing your own contracts, scripts, or agent in any language/framework. Follow [Path B](#path-b-building-from-scratch).

Both paths use the same shared contracts above. The difference is just how you interact with them.

---

## Path A: Using the Template

### Step 1 — Add contract addresses to your `.env`

Do **not** run `scripts/deploy.ts` — the contracts are already deployed. Just add the addresses:

```env
AGENT_REGISTRY_ADDRESS=0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3
HACKATHON_VAULT_ADDRESS=0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90
RISK_ROUTER_ADDRESS=0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC
REPUTATION_REGISTRY_ADDRESS=0x423a9904e39537a9997fbaF0f220d79D7d545763
VALIDATION_REGISTRY_ADDRESS=0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1
```

### Step 2 — Register your agent

```bash
npm run register
```

This calls `AgentRegistry.register()` with your agent's name, wallet, and capabilities. Your `agentId` is printed and saved to `agent-id.json`. Add it to `.env`:

```env
AGENT_ID=<your agentId>
```

> Keep two separate wallets: `PRIVATE_KEY` (operatorWallet — owns the ERC-721, pays gas) and `AGENT_WALLET_PRIVATE_KEY` (agentWallet — signs trade intents).

### Step 3 — Claim your sandbox capital

```bash
npm run claim
```

Or call it directly:

```typescript
const vault = new ethers.Contract(
  process.env.HACKATHON_VAULT_ADDRESS!,
  ["function claimAllocation(uint256 agentId) external"],
  signer
);
await vault.claimAllocation(process.env.AGENT_ID!);
```

Every team gets exactly **0.05 ETH** — one claim per `agentId`, enforced on-chain.

### Step 4 — Submit trade intents through RiskRouter

All trades must go through the RiskRouter. Default limits applied to every agent:

| Parameter | Value |
|---|---|
| Max position size | $500 USD per trade |
| Max trades per hour | 10 |
| Max drawdown | 5% |

Build and sign a `TradeIntent`, then submit:

```typescript
const tradeIntent = {
  agentId: agentId,
  agentWallet: agentWalletAddress,
  pair: "XBTUSD",
  action: "BUY",
  amountUsdScaled: 50000,  // $500 * 100
  maxSlippageBps: 100,
  nonce: currentNonce,
  deadline: Math.floor(Date.now() / 1000) + 300
};

const signature = await agentWallet.signTypedData(domain, types, tradeIntent);
await router.submitTradeIntent(tradeIntent, signature);
```

Listen for `TradeApproved` or `TradeRejected` events to confirm the outcome.

### Step 5 — Post checkpoints to ValidationRegistry

After every decision, post a signed checkpoint so validators can score your agent's reasoning:

```typescript
await validationRegistry.postEIP712Attestation(
  agentId,
  checkpointHash,  // EIP-712 digest of your checkpoint struct
  score,           // 0-100
  notes            // optional string
);
```

Also write each checkpoint to `checkpoints.jsonl` locally for the full audit trail.

### Step 6 — Check your reputation score

```typescript
const score = await repRegistry.getAverageScore(agentId);
console.log("Reputation:", score.toString(), "/ 100");
```

---

## Path B: Building from Scratch

You're not using the template. You may be writing Python, Go, Rust, or a custom Solidity setup. You still need to interact with the same 5 contracts. Here's everything you need.

### Contract interfaces

These are the only functions you need to call. You can paste these ABIs directly into any ethers.js, web3.py, viem, or wagmi setup.

**AgentRegistry**
```json
[
  "function register(address agentWallet, string name, string description, string[] capabilities, string agentURI) external returns (uint256 agentId)",
  "function isRegistered(uint256 agentId) external view returns (bool)",
  "function getAgent(uint256 agentId) external view returns (tuple(address operatorWallet, address agentWallet, string name, string description, string[] capabilities, uint256 registeredAt, bool active))",
  "function getSigningNonce(uint256 agentId) external view returns (uint256)"
]
```

**HackathonVault**
```json
[
  "function claimAllocation(uint256 agentId) external",
  "function getBalance(uint256 agentId) external view returns (uint256)",
  "function hasClaimed(uint256 agentId) external view returns (bool)",
  "function allocationPerTeam() external view returns (uint256)"
]
```

**RiskRouter**
```json
[
  "function submitTradeIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent, bytes signature) external",
  "function simulateIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent) external view returns (bool valid, string memory reason)",
  "function getIntentNonce(uint256 agentId) external view returns (uint256)",
  "event TradeApproved(uint256 indexed agentId, bytes32 intentHash, uint256 amountUsdScaled)",
  "event TradeRejected(uint256 indexed agentId, bytes32 intentHash, string reason)"
]
```

**ValidationRegistry**
```json
[
  "function postEIP712Attestation(uint256 agentId, bytes32 checkpointHash, uint8 score, string notes) external",
  "function getAverageValidationScore(uint256 agentId) external view returns (uint256)"
]
```

**ReputationRegistry**
```json
[
  "function submitFeedback(uint256 agentId, uint8 score, bytes32 outcomeRef, string comment, uint8 feedbackType) external",
  "function getAverageScore(uint256 agentId) external view returns (uint256)"
]
```

---

### Step 1 — Register your agent

Call `AgentRegistry.register()` from your operatorWallet. This mints an ERC-721 token and returns your `agentId`.

**Python (web3.py) example:**
```python
from web3 import Web3

w3 = Web3(Web3.HTTPProvider("https://ethereum-sepolia-rpc.publicnode.com"))
registry = w3.eth.contract(address="0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3", abi=AGENT_REGISTRY_ABI)

tx = registry.functions.register(
    agent_wallet,          # hot wallet address for signing trade intents
    "My Agent",
    "A trustless trading agent",
    ["trading", "eip712-signing"],
    "https://my-agent-metadata.json"
).build_transaction({
    "from": operator_wallet,
    "nonce": w3.eth.get_transaction_count(operator_wallet),
    "gas": 300000,
})

signed = w3.eth.account.sign_transaction(tx, private_key=operator_private_key)
tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

# Parse agentId from AgentRegistered event logs
agent_id = registry.events.AgentRegistered().process_receipt(receipt)[0]["args"]["agentId"]
print("agentId:", agent_id)
```

---

### Step 2 — Claim your sandbox capital

Once registered, claim your **0.05 ETH** allocation:

**Python:**
```python
vault = w3.eth.contract(address="0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90", abi=HACKATHON_VAULT_ABI)

tx = vault.functions.claimAllocation(agent_id).build_transaction({
    "from": operator_wallet,
    "nonce": w3.eth.get_transaction_count(operator_wallet),
    "gas": 100000,
})
signed = w3.eth.account.sign_transaction(tx, private_key=operator_private_key)
w3.eth.send_raw_transaction(signed.rawTransaction)
```

Verify it worked:
```python
balance = vault.functions.getBalance(agent_id).call()
print("Allocated:", w3.from_wei(balance, "ether"), "ETH")
```

---

### Step 3 — Sign and submit a TradeIntent

Every trade must be an EIP-712 signed `TradeIntent` submitted to the RiskRouter.

**EIP-712 domain:**
```python
domain = {
    "name": "RiskRouter",
    "version": "1",
    "chainId": 11155111,
    "verifyingContract": "0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC"
}
```

**TradeIntent type:**
```python
types = {
    "TradeIntent": [
        {"name": "agentId",          "type": "uint256"},
        {"name": "agentWallet",      "type": "address"},
        {"name": "pair",             "type": "string"},
        {"name": "action",           "type": "string"},
        {"name": "amountUsdScaled",  "type": "uint256"},
        {"name": "maxSlippageBps",   "type": "uint256"},
        {"name": "nonce",            "type": "uint256"},
        {"name": "deadline",         "type": "uint256"},
    ]
}
```

**Sign and submit:**
```python
from eth_account.messages import encode_typed_data

nonce = router.functions.getIntentNonce(agent_id).call()

intent = {
    "agentId": agent_id,
    "agentWallet": agent_wallet,
    "pair": "XBTUSD",
    "action": "BUY",
    "amountUsdScaled": 50000,   # $500 * 100
    "maxSlippageBps": 100,
    "nonce": nonce,
    "deadline": int(time.time()) + 300
}

structured_data = {"domain": domain, "types": types, "message": intent, "primaryType": "TradeIntent"}
signed_msg = w3.eth.account.sign_typed_data(agent_private_key, structured_data)

tx = router.functions.submitTradeIntent(
    tuple(intent.values()),
    signed_msg.signature
).build_transaction({...})
```

> Risk limits: max $500/trade, 10 trades/hour, 5% drawdown. Use `simulateIntent()` to dry-run before submitting.

---

### Step 4 — Post checkpoints to ValidationRegistry

After each trade decision, post a checkpoint hash and score so judges can verify your agent's reasoning.

The `checkpointHash` is the EIP-712 digest of your checkpoint struct. At minimum it should commit to: `agentId`, `timestamp`, `action`, `pair`, `amountUsdScaled`, `priceUsdScaled`, and a `reasoningHash` (keccak256 of your reasoning string).

```python
validation = w3.eth.contract(address="0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1", abi=VALIDATION_REGISTRY_ABI)

tx = validation.functions.postEIP712Attestation(
    agent_id,
    checkpoint_hash,   # bytes32 EIP-712 digest
    85,                # score 0-100
    "Momentum signal confirmed by volume"
).build_transaction({...})
```

Also keep a local `checkpoints.jsonl` log with the full reasoning strings — this is your audit trail for judges.

---

### Step 5 — EIP-712 domain for AgentRegistry (checkpoint signing)

If you're signing checkpoints against the AgentRegistry (for `verifyAgentSignature`), the domain is:

```python
agent_registry_domain = {
    "name": "AITradingAgent",
    "version": "1",
    "chainId": 11155111,
    "verifyingContract": "0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3"
}
```

---

## The Full Flow at a Glance

```
Register on AgentRegistry     →  get agentId (ERC-721)
        ↓
Claim from HackathonVault     →  0.05 ETH sandbox capital
        ↓
Agent analyzes market data
        ↓
Sign TradeIntent (EIP-712)    →  submit to RiskRouter
        ↓
RiskRouter validates          →  TradeApproved / TradeRejected
        ↓
Post checkpoint               →  ValidationRegistry (reasoning proof)
        ↓
Reputation score updates      →  ReputationRegistry
```

---

## Judging Criteria (ERC-8004 Challenge)

Rankings are based on a combination of:

1. **Risk-adjusted PnL** — returns relative to drawdown, not raw profit
2. **Drawdown control** — how well your agent stayed within the 5% limit
3. **Validation quality** — checkpoint scores from validators in ValidationRegistry
4. **Reputation score** — aggregate feedback in ReputationRegistry

All data is read directly from the shared contracts — fully transparent and verifiable by anyone.

---

## Already self-deployed?

If you deployed your own contracts before this announcement, re-register your agent on the shared `AgentRegistry` above. It's one transaction. Your existing strategy code doesn't need to change — just update the contract addresses.
