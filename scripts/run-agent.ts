/**
 * Run the trading agent.
 *
 * Usage:
 *   npx ts-node scripts/run-agent.ts
 *
 * Prerequisites:
 *   - Contracts deployed and addresses in .env
 *   - AGENT_ID set in .env (run register-agent.ts first)
 *   - KRAKEN_API_KEY + KRAKEN_API_SECRET set in .env
 *     (set KRAKEN_SANDBOX=true to use paper trading mode)
 *
 * What it does:
 *   1. Loads the deployed contract addresses
 *   2. Connects the agent to Kraken + on-chain contracts
 *   3. Starts polling the market at POLL_INTERVAL_MS (default 30s)
 *   4. Each tick: decide → validate → explain → checkpoint → (optionally) trade
 *   5. Appends signed checkpoints to checkpoints.jsonl
 */

// The agent entrypoint handles everything — this script just ensures .env is
// loaded and re-exports cleanly as a runnable entrypoint.
import "../src/agent/index.js";
