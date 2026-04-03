/**
 * Deploy all five contracts to Sepolia.
 *
 * Deploys (in order — later contracts depend on AgentRegistry address):
 *   1. AgentRegistry        (ERC-721 identity)
 *   2. HackathonVault       (capital management)
 *   3. RiskRouter           (trade validation — needs AgentRegistry)
 *   4. ReputationRegistry   (feedback + reputation — needs AgentRegistry)
 *   5. ValidationRegistry   (attestations — needs AgentRegistry)
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *
 * After running: copy the printed addresses into your .env
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying with account: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH\n`);

  // 1. AgentRegistry (ERC-721)
  console.log("1/5 Deploying AgentRegistry (ERC-721)...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`   AgentRegistry: ${registryAddress}`);

  // 2. HackathonVault (0.05 ETH fixed allocation per team)
  const allocationPerTeam = ethers.parseEther("0.05");
  console.log("2/5 Deploying HackathonVault...");
  const HackathonVault = await ethers.getContractFactory("HackathonVault");
  const vault = await HackathonVault.deploy(registryAddress, allocationPerTeam);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`   HackathonVault: ${vaultAddress}`);

  // 3. RiskRouter (needs AgentRegistry)
  console.log("3/5 Deploying RiskRouter...");
  const RiskRouter = await ethers.getContractFactory("RiskRouter");
  const router = await RiskRouter.deploy(registryAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`   RiskRouter: ${routerAddress}`);

  // 4. ReputationRegistry (needs AgentRegistry)
  console.log("4/5 Deploying ReputationRegistry...");
  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
  const reputation = await ReputationRegistry.deploy(registryAddress);
  await reputation.waitForDeployment();
  const reputationAddress = await reputation.getAddress();
  console.log(`   ReputationRegistry: ${reputationAddress}`);

  // 5. ValidationRegistry (needs AgentRegistry, open validation for hackathon)
  console.log("5/5 Deploying ValidationRegistry...");
  const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry");
  const validation = await ValidationRegistry.deploy(registryAddress, true); // openValidation=true
  await validation.waitForDeployment();
  const validationAddress = await validation.getAddress();
  console.log(`   ValidationRegistry: ${validationAddress}`);

  // Save deployed.json
  const deployed = {
    network: "sepolia",
    chainId: 11155111,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    AgentRegistry: registryAddress,
    HackathonVault: vaultAddress,
    RiskRouter: routerAddress,
    ReputationRegistry: reputationAddress,
    ValidationRegistry: validationAddress,
  };
  const outPath = path.join(process.cwd(), "deployed.json");
  fs.writeFileSync(outPath, JSON.stringify(deployed, null, 2));
  console.log(`\nSaved to: ${outPath}`);

  // .env additions
  console.log("\n── Add these to your .env ──────────────────────────────────────────");
  console.log(`AGENT_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`HACKATHON_VAULT_ADDRESS=${vaultAddress}`);
  console.log(`RISK_ROUTER_ADDRESS=${routerAddress}`);
  console.log(`REPUTATION_REGISTRY_ADDRESS=${reputationAddress}`);
  console.log(`VALIDATION_REGISTRY_ADDRESS=${validationAddress}`);
  console.log("────────────────────────────────────────────────────────────────────\n");

  console.log("Verify on Etherscan:");
  console.log(`  npx hardhat verify --network sepolia ${registryAddress}`);
  console.log(`  npx hardhat verify --network sepolia ${vaultAddress} "${registryAddress}" "50000000000000000"`);
  console.log(`  npx hardhat verify --network sepolia ${routerAddress} "${registryAddress}"`);
  console.log(`  npx hardhat verify --network sepolia ${reputationAddress} "${registryAddress}"`);
  console.log(`  npx hardhat verify --network sepolia ${validationAddress} "${registryAddress}" true`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
