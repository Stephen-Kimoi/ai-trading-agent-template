/**
 * Main agent loop — full ERC-8004 + Kraken CLI flow
 *
 * Each tick:
 *   1. Fetch market data via Kraken CLI
 *   2. Strategy.analyze(market) → TradeDecision
 *   3. Format human-readable explanation
 *   4. If BUY/SELL:
 *      a. Build + sign TradeIntent (EIP-712, agentWallet)
 *      b. Submit TradeIntent to RiskRouter — get approval/rejection on-chain
 *      c. If approved: execute via Kraken CLI
 *   5. Generate EIP-712 signed checkpoint (includes intentHash)
 *   6. Post checkpoint hash to ValidationRegistry
 *   7. Append checkpoint to checkpoints.jsonl
 *
 * Swap strategy: change the strategy instantiation at the bottom of this file.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

import { TradingStrategy } from "../types/index.js";
import { getAgentId, getAgentRegistration } from "./identity.js";
import { MomentumStrategy } from "./strategy.js";
import { KrakenClient } from "../exchange/kraken.js";
import { VaultClient } from "../onchain/vault.js";
import { RiskRouterClient } from "../onchain/riskRouter.js";
import { ValidationRegistryClient } from "../onchain/validationRegistry.js";
import { formatExplanation, formatCheckpointLog } from "../explainability/reasoner.js";
import { generateCheckpoint } from "../explainability/checkpoint.js";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const SEPOLIA_CHAIN_ID = 11155111;
const TRADING_PAIR    = process.env.TRADING_PAIR || "XBTUSD";
const POLL_INTERVAL   = parseInt(process.env.POLL_INTERVAL_MS || "30000");
const CHECKPOINTS_FILE = path.join(process.cwd(), "checkpoints.jsonl");
const HOLD_INTENT_HASH = ethers.ZeroHash; // used for HOLD decisions (no intent submitted)

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent runner
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(strategy: TradingStrategy) {
  const rpcUrl           = requireEnv("SEPOLIA_RPC_URL");
  const privateKey       = requireEnv("PRIVATE_KEY");
  const registryAddress  = requireEnv("AGENT_REGISTRY_ADDRESS");
  const vaultAddress     = requireEnv("HACKATHON_VAULT_ADDRESS");
  const routerAddress    = requireEnv("RISK_ROUTER_ADDRESS");
  const validationAddress = requireEnv("VALIDATION_REGISTRY_ADDRESS");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // operatorWallet: owns the ERC-721 token
  const operatorSigner = new ethers.Wallet(privateKey, provider);

  // agentWallet: hot wallet for signing TradeIntents + checkpoints
  // If AGENT_WALLET_PRIVATE_KEY is set, use a separate hot wallet; else reuse operator
  const agentWalletKey = process.env.AGENT_WALLET_PRIVATE_KEY || privateKey;
  const agentWallet = new ethers.Wallet(agentWalletKey, provider);

  // Resolve agent identity (registers ERC-721 on first run)
  const agentId = await getAgentId(operatorSigner, registryAddress, {
    name: "HackathonTradingAgent",
    description: "Autonomous AI trading agent with ERC-8004 identity, Kraken CLI execution, and EIP-712 checkpoints",
    capabilities: ["trading", "analysis", "explainability", "eip712-signing"],
    agentWallet: agentWallet.address,
    agentURI: `data:application/json,${encodeURIComponent(JSON.stringify({
      name: "HackathonTradingAgent",
      description: "ERC-8004 compliant AI trading agent",
      capabilities: ["trading", "analysis", "eip712-signing"],
      agentWallet: agentWallet.address,
      version: "1.0.0",
    }))}`,
  });

  // Fetch registration to confirm agentWallet
  const reg = await getAgentRegistration(provider, registryAddress, agentId);
  console.log(`[agent] agentWallet: ${reg.agentWallet}`);

  // Init clients
  const kraken     = new KrakenClient();
  const vault      = new VaultClient(vaultAddress, provider);
  const riskRouter = new RiskRouterClient(routerAddress, agentWallet, SEPOLIA_CHAIN_ID);
  const validation = new ValidationRegistryClient(validationAddress, agentWallet);

  console.log(`\n[agent] Starting agent loop`);
  console.log(`[agent] agentId:  ${agentId}`);
  console.log(`[agent] Pair:     ${TRADING_PAIR}`);
  console.log(`[agent] Interval: ${POLL_INTERVAL / 1000}s`);
  console.log(`[agent] Checkpoints: ${CHECKPOINTS_FILE}\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // Main tick
  // ─────────────────────────────────────────────────────────────────────────

  const tick = async () => {
    try {
      // 1. Fetch market data via Kraken CLI
      const market = await kraken.getTicker(TRADING_PAIR);
      console.log(`[agent] ${TRADING_PAIR} @ $${market.price.toLocaleString()}`);

      // 2. Strategy decision
      const decision = await strategy.analyze(market);

      // 3. Human-readable explanation
      const explanation = formatExplanation(decision, market);
      console.log(explanation);

      let intentHash = HOLD_INTENT_HASH;

      // 4. Actionable trade: submit signed TradeIntent to RiskRouter
      if (decision.action !== "HOLD" && decision.amount > 0) {

        // 4a. Build + sign the TradeIntent (EIP-712)
        const intent = await riskRouter.buildIntent(
          agentId,
          agentWallet.address,
          decision.pair,
          decision.action as "BUY" | "SELL",
          decision.amount
        );
        const signed = await riskRouter.signIntent(intent, agentWallet);
        intentHash = signed.intentHash;

        console.log(`[agent] TradeIntent signed. nonce=${intent.nonce}, deadline=${new Date(Number(intent.deadline) * 1000).toISOString()}`);

        // 4b. Submit to RiskRouter — on-chain validation
        const validation_result = await riskRouter.submitIntent(signed);

        if (!validation_result.approved) {
          console.warn(`[agent] TradeIntent REJECTED by RiskRouter: ${validation_result.reason}`);
          // Don't execute — fall through to checkpoint (HOLD behaviour)
          decision.action = "HOLD";
          decision.amount = 0;
          decision.reasoning += ` [BLOCKED by RiskRouter: ${validation_result.reason}]`;
        } else {
          // 4c. Execute via Kraken CLI
          const volumeBase = (decision.amount / market.price).toFixed(8);
          const result = await kraken.placeOrder({
            pair:      decision.pair,
            type:      decision.action === "BUY" ? "buy" : "sell",
            ordertype: "market",
            volume:    volumeBase,
          });
          console.log(`[agent] Order placed: ${result.txid.join(", ")}`);
          console.log(`[agent] ${result.descr.order}`);
        }
      }

      // 5. Generate EIP-712 signed checkpoint
      const checkpoint = await generateCheckpoint(
        agentId,
        decision,
        market,
        intentHash,
        agentWallet,
        registryAddress,
        SEPOLIA_CHAIN_ID
      );

      console.log(formatCheckpointLog(checkpoint));

      // 6. Post checkpoint hash to ValidationRegistry
      const cp = checkpoint as typeof checkpoint & { checkpointHash?: string };
      if (cp.checkpointHash) {
        try {
          await validation.postCheckpointAttestation(
            agentId,
            cp.checkpointHash,
            Math.round(decision.confidence * 100), // self-assessed score
            `${decision.action} ${decision.pair} @ $${market.price}`
          );
          console.log(`[agent] Checkpoint posted to ValidationRegistry: ${cp.checkpointHash.slice(0, 20)}...`);
        } catch (e) {
          console.warn(`[agent] ValidationRegistry post failed (non-fatal):`, e);
        }
      }

      // 7. Persist to checkpoints.jsonl
      fs.appendFileSync(CHECKPOINTS_FILE, JSON.stringify(checkpoint) + "\n");

    } catch (err) {
      console.error(`[agent] Error in tick:`, err);
    }
  };

  await tick();
  setInterval(tick, POLL_INTERVAL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point — swap strategy here
// ─────────────────────────────────────────────────────────────────────────────

// ── SWAP YOUR STRATEGY HERE ─────────────────────────────────────────────────
// import { LLMStrategy } from "./strategy.js";
// const strategy = new LLMStrategy();
const strategy = new MomentumStrategy(5, 100);
// ────────────────────────────────────────────────────────────────────────────

runAgent(strategy).catch((err) => {
  console.error("[agent] Fatal error:", err);
  process.exit(1);
});
