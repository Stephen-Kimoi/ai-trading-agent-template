# Part 2: Registering Your Agent On-Chain (ERC-721)

## Why ERC-721?

Your agent's identity is an NFT. This means:
- **agentId** is a `uint256` token ID — stable, unique, gas-efficient to store
- The token is **transferable**: sell a well-performing agent along with its on-chain reputation
- Standard ERC-721 interfaces mean wallets, marketplaces, and indexers understand it natively
- Token URI points to your Agent Registration JSON (metadata about capabilities and endpoints)

---

## Prerequisites

- Node.js 20+ installed
- Sepolia ETH (get from [sepoliafaucet.com](https://sepoliafaucet.com))
- Infura or Alchemy Sepolia RPC URL
- Kraken CLI installed (see Part 3)
- `npm install` done in project root

---

## Step 1: Configure your environment

```bash
cp .env.example .env
```

Fill in at minimum:

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PRIVATE_KEY=0xYOUR_OPERATOR_WALLET_PRIVATE_KEY

# Optional: separate hot wallet for signing. Defaults to PRIVATE_KEY.
AGENT_WALLET_PRIVATE_KEY=0xYOUR_HOT_WALLET_KEY
```

**Two wallet roles:**
| Wallet | Role | Recommended |
|--------|------|-------------|
| `PRIVATE_KEY` (operatorWallet) | Owns the ERC-721 token, pays gas | Cold wallet / hardware wallet |
| `AGENT_WALLET_PRIVATE_KEY` (agentWallet) | Signs TradeIntents + checkpoints at runtime | Separate hot wallet |

For testing, the same key for both is fine.

---

## Step 2: Deploy the five contracts

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

Output:

```
1/5 Deploying AgentRegistry (ERC-721)...
   AgentRegistry: 0xABC...
2/5 Deploying HackathonVault...
   HackathonVault: 0xDEF...
3/5 Deploying RiskRouter...
   RiskRouter: 0xGHI...
4/5 Deploying ReputationRegistry...
   ReputationRegistry: 0xJKL...
5/5 Deploying ValidationRegistry...
   ValidationRegistry: 0xMNO...

── Add these to your .env ──────────────────────────────────────────
AGENT_REGISTRY_ADDRESS=0xABC...
HACKATHON_VAULT_ADDRESS=0xDEF...
RISK_ROUTER_ADDRESS=0xGHI...
REPUTATION_REGISTRY_ADDRESS=0xJKL...
VALIDATION_REGISTRY_ADDRESS=0xMNO...
────────────────────────────────────────────────────────────────────
```

Copy all five addresses to your `.env`.

> **Hackathon note:** If the hackathon provides pre-deployed contract addresses, use those instead and skip this step. Your own contracts are for local testing and development.

---

## Step 3: Register your agent

```bash
npm run register
```

Output:

```
Operator wallet: 0xYourOperatorAddress
Agent wallet:    0xYourAgentWalletAddress
AgentRegistry:   0xABC...

[identity] Registering new agent on-chain (ERC-721 mint)...
[identity] Registration tx: 0xTXHASH...
[identity] Agent registered! Token ID (agentId): 0
[identity] Add to .env: AGENT_ID=0
[identity] Saved to agent-id.json

Agent registered!
agentId (ERC-721 token ID): 0

Add to .env:
  AGENT_ID=0

Setting default risk params on RiskRouter...
Risk params set: maxPosition=$500, maxDrawdown=5%, maxTrades/hr=10
```

Add `AGENT_ID=0` (or whatever token ID you received) to your `.env`.

---

## Step 4: Verify on Etherscan

Open Sepolia Etherscan → your `AGENT_REGISTRY_ADDRESS` → **Events** tab:

```
AgentRegistered
  agentId (token ID): 0
  operatorWallet:     0xYourOperatorAddress
  agentWallet:        0xYourAgentWalletAddress
  name:               HackathonTradingAgent
```

You can also check the **ERC-721 Transfers** tab — you'll see the mint event transferring token ID `0` from the zero address to your wallet.

---

## What the registration looks like under the hood

`scripts/register-agent.ts` calls `src/agent/identity.ts`:

```typescript
const agentId = await getAgentId(operatorSigner, registryAddress, {
  name: "HackathonTradingAgent",
  agentWallet: agentWallet.address,
  capabilities: ["trading", "analysis", "eip712-signing"],
  agentURI: "ipfs://...",  // or data URI
  ...
});
```

Which calls `register()` on the contract:

```solidity
function register(
    address agentWallet,
    string calldata name,
    string calldata description,
    string[] calldata capabilities,
    string calldata agentURI
) external returns (uint256 agentId) {
    agentId = _nextAgentId++;
    _mint(msg.sender, agentId);   // <-- ERC-721 mint
    _setTokenURI(agentId, agentURI);
    // ... stores metadata
    emit AgentRegistered(agentId, msg.sender, agentWallet, name);
}
```

The token ID is auto-incrementing from 0. Your `agentId` is unique and permanent.

---

## Template note

> **For hackathon teams:** Once registered, your `agentId` is your identity anchor across all systems — Vault allocation, RiskRouter risk params, EIP-712 checkpoint signing, and ValidationRegistry attestations. Swapping your strategy never touches this layer.

---

→ [Part 3: Connecting to Kraken CLI](./03-kraken-connection.md)
