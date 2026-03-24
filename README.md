# AI Trading Agent Template

A complete, reusable AI trading agent with:
- **On-chain identity** via ERC-8004 Agent Registry (Sepolia)
- **Trade execution** via Kraken REST API (paper trading supported)
- **Capital management** via Hackathon Vault + Risk Router contracts
- **Cryptographic explainability** via EIP-712 signed checkpoints

Any team can pick this up, swap in their own model or strategy, and run it — the identity, risk, and audit layers stay the same.

---

## Architecture

```
Your Strategy (TradingStrategy interface)
       ↓
  [On-chain] RiskRouter.validateTrade()
       ↓
  [Exchange] Kraken.placeOrder()
       ↓
  [Explainability] formatExplanation() + generateCheckpoint()
       ↓
  checkpoints.jsonl  (signed audit log)
```

---

## Prerequisites

- Node.js 20+
- Sepolia ETH ([sepoliafaucet.com](https://sepoliafaucet.com))
- Infura or Alchemy Sepolia RPC URL
- Kraken account with API keys

---

## Setup

```bash
git clone <this-repo>
cd ai-trading-agent-tutorial
npm install
cp .env.example .env
# Fill in SEPOLIA_RPC_URL, PRIVATE_KEY, KRAKEN_API_KEY, KRAKEN_API_SECRET
```

---

## Quickstart

### 1. Deploy contracts

```bash
npx hardhat run scripts/deploy.ts --network sepolia
# Copy the 3 addresses printed to your .env
```

### 2. Register your agent

```bash
npx ts-node scripts/register-agent.ts
# Copy AGENT_ID to your .env
```

### 3. Run the agent (sandbox mode)

```bash
# Make sure KRAKEN_SANDBOX=true in .env
npx ts-node scripts/run-agent.ts
```

You'll see live market data, trade decisions, human-readable explanations, and signed checkpoints printed to the console. Every checkpoint is appended to `checkpoints.jsonl`.

---

## Swap in your own strategy

Edit `src/agent/index.ts`:

```typescript
// Replace this:
import { MomentumStrategy } from "./strategy.js";
const strategy = new MomentumStrategy(5, 100);

// With your own:
import { MyStrategy } from "./my-strategy.js";
const strategy = new MyStrategy();
```

Your strategy only needs to implement one method:

```typescript
interface TradingStrategy {
  analyze(data: MarketData): Promise<TradeDecision>;
}
```

See `src/agent/strategy.ts` for examples including LLM strategy stubs.

---

## Tutorial

Step-by-step walkthrough in the `tutorial/` folder:

1. [What is ERC-8004 and why does it matter?](tutorial/01-erc8004-intro.md)
2. [Registering your agent on-chain](tutorial/02-register-agent.md)
3. [Connecting to Kraken API](tutorial/03-kraken-connection.md)
4. [The Vault and Risk Router](tutorial/04-vault-riskrouter.md)
5. [Building the explanation layer](tutorial/05-explanation-layer.md)
6. [EIP-712 signed checkpoints](tutorial/06-eip712-checkpoints.md)
7. [Using this as a reusable template](tutorial/07-reusable-template.md)

---

## Project structure

```
contracts/
  AgentRegistry.sol      # ERC-8004 agent identity registry
  HackathonVault.sol     # Capital vault with per-agent allocation
  RiskRouter.sol         # On-chain risk validation

src/
  types/index.ts         # Shared TypeScript interfaces
  agent/
    index.ts             # Main agent loop
    identity.ts          # ERC-8004 registration
    strategy.ts          # TradingStrategy interface + example strategies
  exchange/
    kraken.ts            # Kraken REST API client
  onchain/
    vault.ts             # Vault contract interactions
    riskRouter.ts        # RiskRouter contract interactions
  explainability/
    reasoner.ts          # Human-readable explanation formatter
    checkpoint.ts        # EIP-712 checkpoint generation + verification

scripts/
  deploy.ts              # Deploy all contracts to Sepolia
  register-agent.ts      # Register agent on-chain
  run-agent.ts           # Run the agent
```

---

## Verify a checkpoint

```typescript
import { verifyCheckpoint } from "./src/explainability/checkpoint.js";

const valid = verifyCheckpoint(
  checkpoint,
  process.env.AGENT_REGISTRY_ADDRESS!,
  11155111,
  process.env.EXPECTED_SIGNER_ADDRESS!
);
console.log(valid); // true
```

---

## License

MIT
