# Part 1: What Is ERC-8004 and Why Does It Matter?

## The problem: your AI agent is a ghost

You build a trading bot. It runs, it trades, it makes decisions. But from the blockchain's perspective, it doesn't exist. There's just a wallet address — no identity, no record of what the agent is, who operates it, or what it's supposed to do.

This creates real problems:
- **No accountability**: anyone can claim any wallet address is their "AI agent"
- **No discoverability**: other contracts can't verify they're talking to an authorized agent
- **No reputation**: the agent builds no on-chain history that others can trust

ERC-8004 solves this.

---

## What ERC-8004 is

ERC-8004 is a standard for **AI Agent Identity Registry** on Ethereum. It defines a registry contract where agents can be registered with structured metadata, and every registration produces a unique, verifiable `agentId`.

Think of it like ENS (Ethereum Name Service), but for AI agents instead of human-readable names.

### What gets stored on-chain

```solidity
struct AgentMetadata {
    string name;           // Human-readable agent name
    string description;    // What the agent does
    string[] capabilities; // e.g. ["trading", "analysis", "reporting"]
    address operator;      // Address that controls this agent
    bytes publicKey;       // Optional: agent's signing public key
}
```

### What you get back: `agentId`

When you call `registerAgent()`, the contract returns a `bytes32` identifier:

```solidity
agentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, nonce));
```

This `agentId` becomes the agent's **persistent on-chain identity** — used for:
- Capital allocation in the Hackathon Vault
- Risk validation in the Risk Router
- Cryptographic signing in EIP-712 checkpoints

---

## Why it matters for hackathon teams

### 1. The identity layer is already built

By using ERC-8004, every team's agent automatically gets a verifiable identity without having to invent their own scheme. The registry is the shared ground truth.

### 2. Reputation becomes composable

Because `agentId` is persistent and tied to on-chain activity, every trade, every checkpoint, every vault interaction is linked to that identity. Future systems could build reputation scores, whitelists, or risk tiers on top of this.

### 3. The scaffolding stays the same

This is the "reusable template" angle: the identity, reputation system, and validation scaffolding (ERC-8004 → Vault → RiskRouter → EIP-712) stay constant across teams. What changes is the strategy inside. Your agent's identity doesn't care if you're running a momentum strategy, an LLM, or a neural network.

---

## The AgentRegistry contract

Here's the core of `contracts/AgentRegistry.sol`:

```solidity
// Register a new agent — returns a unique agentId
function registerAgent(AgentMetadata calldata meta) external returns (bytes32 agentId) {
    require(meta.operator == msg.sender, "operator must be caller");

    uint256 nonce = _nonces[msg.sender]++;
    agentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, nonce));

    _agents[agentId] = meta;
    _registered[agentId] = true;

    emit AgentRegistered(agentId, msg.sender, meta.name);
}
```

Key properties:
- **Caller must be the operator**: prevents someone from registering an agent they don't control
- **Deterministic but unique**: same operator can register multiple agents (different nonces)
- **Immutable operator + name**: can update description/capabilities but not identity fields
- **Emits an event**: `AgentRegistered(agentId, operator, name)` — queryable on Etherscan

---

## Next step

In Part 2, you'll deploy the AgentRegistry to Sepolia and register your first agent.

→ [Part 2: Registering Your Agent On-Chain](./02-register-agent.md)
