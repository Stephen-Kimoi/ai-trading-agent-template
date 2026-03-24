/**
 * Register your AI agent on-chain via ERC-8004 (ERC-721 mint).
 *
 * Usage:
 *   npx ts-node scripts/register-agent.ts
 *
 * Prerequisites:
 *   - Contracts deployed (run deploy.ts first)
 *   - AGENT_REGISTRY_ADDRESS in .env
 *   - PRIVATE_KEY + SEPOLIA_RPC_URL in .env
 *
 * What it does:
 *   1. Mints an ERC-721 token to your wallet — this is your agent's on-chain identity
 *   2. Registers agentWallet (hot wallet for signing)
 *   3. Prints the agentId (token ID) — add it to .env as AGENT_ID
 *   4. Optionally sets risk params on the RiskRouter
 */

import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { getAgentId } from "../src/agent/identity.js";

async function main() {
  const rpcUrl          = process.env.SEPOLIA_RPC_URL;
  const privateKey      = process.env.PRIVATE_KEY;
  const registryAddress = process.env.AGENT_REGISTRY_ADDRESS;
  const routerAddress   = process.env.RISK_ROUTER_ADDRESS;

  if (!rpcUrl)          throw new Error("Missing SEPOLIA_RPC_URL");
  if (!privateKey)      throw new Error("Missing PRIVATE_KEY");
  if (!registryAddress) throw new Error("Missing AGENT_REGISTRY_ADDRESS — run deploy.ts first");

  const provider       = new ethers.JsonRpcProvider(rpcUrl);
  const operatorSigner = new ethers.Wallet(privateKey, provider);

  // Agent hot wallet: use AGENT_WALLET_PRIVATE_KEY if set, else same as operator
  const agentWalletKey = process.env.AGENT_WALLET_PRIVATE_KEY || privateKey;
  const agentWallet    = new ethers.Wallet(agentWalletKey);

  console.log(`\nOperator wallet: ${operatorSigner.address}`);
  console.log(`Agent wallet:    ${agentWallet.address}`);
  console.log(`AgentRegistry:   ${registryAddress}\n`);

  // Register agent (mints ERC-721)
  const agentId = await getAgentId(operatorSigner, registryAddress, {
    name: "HackathonTradingAgent",
    description: "Autonomous AI trading agent with ERC-8004 identity, Kraken CLI execution, and EIP-712 checkpoints",
    capabilities: ["trading", "analysis", "explainability", "eip712-signing"],
    agentWallet: agentWallet.address,
    agentURI: `data:application/json,${encodeURIComponent(JSON.stringify({
      name: "HackathonTradingAgent",
      version: "1.0.0",
      agentWallet: agentWallet.address,
      capabilities: ["trading", "analysis", "eip712-signing"],
    }))}`,
  });

  console.log(`\nAgent registered!`);
  console.log(`agentId (ERC-721 token ID): ${agentId}`);
  console.log(`\nAdd to .env:`);
  console.log(`  AGENT_ID=${agentId}`);
  if (agentWalletKey !== privateKey) {
    console.log(`  AGENT_WALLET_PRIVATE_KEY=${agentWalletKey}`);
  }

  // Optionally configure risk params
  if (routerAddress) {
    const RISK_ROUTER_ABI = [
      "function setRiskParams(uint256 agentId, uint256 maxPositionUsdScaled, uint256 maxDrawdownBps, uint256 maxTradesPerHour) external",
    ];
    const router = new ethers.Contract(routerAddress, RISK_ROUTER_ABI, operatorSigner);

    console.log(`\nSetting default risk params on RiskRouter...`);
    const tx = await router.setRiskParams(
      agentId,
      BigInt(50000),  // maxPositionUsdScaled: $500 max per trade (500 * 100)
      BigInt(500),    // maxDrawdownBps: 5%
      BigInt(10)      // maxTradesPerHour: 10
    );
    await tx.wait();
    console.log(`Risk params set: maxPosition=$500, maxDrawdown=5%, maxTrades/hr=10`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
