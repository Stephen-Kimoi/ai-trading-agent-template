/**
 * claim-vault.ts
 * Claims the sandbox capital allocation from HackathonVault for your registered agent.
 * Each agentId can only claim once — the contract enforces this on-chain.
 *
 * Run:
 *   npx hardhat run scripts/claim-vault.ts --network sepolia
 *
 * Requires in .env:
 *   PRIVATE_KEY            — operator wallet private key
 *   HACKATHON_VAULT_ADDRESS — vault contract address
 *   AGENT_ID               — your registered agent token ID
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const VAULT_ABI = [
  "function claimAllocation(uint256 agentId) external",
  "function hasClaimed(uint256 agentId) external view returns (bool)",
  "function getBalance(uint256 agentId) external view returns (uint256)",
  "function allocationPerTeam() external view returns (uint256)",
];

async function main() {
  const [operator] = await ethers.getSigners();

  const vaultAddress = process.env.HACKATHON_VAULT_ADDRESS;
  const agentId      = process.env.AGENT_ID;

  if (!vaultAddress || !agentId) {
    console.error("ERROR: Set HACKATHON_VAULT_ADDRESS and AGENT_ID in your .env file.");
    process.exit(1);
  }

  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, operator);

  const already = await vault.hasClaimed(agentId);
  if (already) {
    const balance   = await vault.getBalance(agentId);
    console.log(`Agent #${agentId} has already claimed.`);
    console.log(`Current vault balance: ${ethers.formatEther(balance)} ETH`);
    return;
  }

  const allocation = await vault.allocationPerTeam();
  console.log(`Claiming ${ethers.formatEther(allocation)} ETH for agent #${agentId}...`);

  const tx = await vault.claimAllocation(agentId);
  console.log("Tx sent:", tx.hash);
  await tx.wait();

  const balance = await vault.getBalance(agentId);
  console.log(`Claimed! Vault balance for agent #${agentId}: ${ethers.formatEther(balance)} ETH`);
}

main().catch((e) => { console.error(e); process.exit(1); });
