# Part 6: EIP-712 Signed Checkpoints

## What problem this solves

Your agent writes "I bought BTC because the momentum was strong" to a log file. But a log file is just text — anyone could edit it. How do you prove that:
1. A specific agent made a specific decision
2. At a specific time
3. With a specific piece of reasoning
4. And that nothing was tampered with afterward?

**EIP-712 signatures** solve this. Every trade decision is cryptographically signed by the agent's private key over structured data that includes all of the above.

---

## What EIP-712 is

EIP-712 is the Ethereum standard for signing **typed structured data** (as opposed to raw bytes). It produces human-readable signing prompts in wallets and prevents signature replay attacks across different contracts and chains.

A signature under EIP-712 proves:
- The signer held the private key at signing time
- The signed data has not been modified
- The signature was intended for this specific contract + chain (via the domain separator)

---

## The checkpoint schema

`src/explainability/checkpoint.ts` defines the typed structure:

```typescript
const domain = {
  name: "AITradingAgent",
  version: "1",
  chainId: 11155111,          // Sepolia
  verifyingContract: REGISTRY_ADDRESS,
};

const types = {
  TradeCheckpoint: [
    { name: "agentId",           type: "uint256" }, // ERC-721 token ID
    { name: "timestamp",         type: "uint256" },
    { name: "action",            type: "string"  },
    { name: "asset",             type: "string"  },
    { name: "pair",              type: "string"  },
    { name: "amountUsdScaled",   type: "uint256" }, // USD * 100
    { name: "priceUsdScaled",    type: "uint256" }, // USD * 100
    { name: "reasoningHash",     type: "bytes32" }, // keccak256(reasoning)
    { name: "confidenceScaled",  type: "uint256" }, // confidence * 1000
    { name: "intentHash",        type: "bytes32" }, // hash of the approved TradeIntent
  ],
};
```

Why `reasoningHash` instead of the full reasoning string?
- Strings can be arbitrarily long — hashing keeps the signed payload compact
- The hash is a commitment: if you have the hash and the original string, you can verify they match
- The full reasoning string is stored alongside the checkpoint in `checkpoints.jsonl`

---

## Generating a checkpoint

```typescript
import { generateCheckpoint } from "./src/explainability/checkpoint.js";

const checkpoint = await generateCheckpoint(
  agentId,         // bytes32 ERC-8004 identity
  decision,        // TradeDecision from your strategy
  market,          // MarketData at decision time
  signer,          // ethers.Wallet — the agent's signing key
  registryAddress, // AgentRegistry address (for domain separator)
  11155111         // Sepolia chain ID
);

// checkpoint.signature = "0x1a2b3c..."
// checkpoint.signerAddress = "0xYourWalletAddress"
// checkpoint.reasoningHash = keccak256(decision.reasoning)
```

Internally this calls `wallet.signTypedData(domain, types, value)` — ethers.js v6's EIP-712 signing method.

---

## Verifying a checkpoint

Anyone can verify a checkpoint without trusting any intermediary:

```typescript
import { verifyCheckpoint, verifyReasoningIntegrity } from "./src/explainability/checkpoint.js";

// 1. Verify the signature recovers to the expected signer
const sigValid = verifyCheckpoint(
  checkpoint,
  registryAddress,
  11155111,
  expectedSignerAddress
);
console.log(`Signature valid: ${sigValid}`);  // true

// 2. Verify the reasoning string wasn't tampered with
const reasoningValid = verifyReasoningIntegrity(checkpoint);
console.log(`Reasoning hash matches: ${reasoningValid}`);  // true
```

Under the hood this uses `ethers.verifyTypedData()`:

```typescript
const recovered = ethers.verifyTypedData(domain, CHECKPOINT_TYPES, value, checkpoint.signature);
return recovered.toLowerCase() === expectedSigner.toLowerCase();
```

---

## Reading checkpoints from checkpoints.jsonl

```typescript
import * as fs from "fs";
import { verifyCheckpoint } from "./src/explainability/checkpoint.js";

const lines = fs.readFileSync("checkpoints.jsonl", "utf8").trim().split("\n");
const checkpoints = lines.map(l => JSON.parse(l));

for (const cp of checkpoints) {
  const valid = verifyCheckpoint(cp, registryAddress, 11155111, expectedSigner);
  console.log(`${new Date(cp.timestamp * 1000).toISOString()} | ${cp.action} ${cp.pair} | valid: ${valid}`);
}
```

---

## What you can build on top of this

The signed checkpoint format is a foundation. With it you can:

- **On-chain verification**: a smart contract could call `ecrecover` to verify a checkpoint was produced by a registered agent before allowing an action
- **Reputation scoring**: aggregate checkpoint history to score agents by decision quality
- **Dispute resolution**: if someone claims the agent made a bad decision, the signed checkpoint is the ground truth
- **Compliance**: verifiable audit trail that specific reasoning led to specific trades

---

## Template note

> **For hackathon teams:** Checkpoint generation is automatic — the agent loop calls `generateCheckpoint()` after every decision, including HOLDs. You get a full signed audit trail with zero extra code in your strategy.

---

→ [Part 7: Using This as a Reusable Template](./07-reusable-template.md)
