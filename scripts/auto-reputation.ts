/**
 * auto-reputation.ts
 * Judge-bot: reads every registered agent's on-chain metrics and submits
 * a computed reputation score to ReputationRegistry from a dedicated
 * judge wallet (not the operator of any agent).
 *
 * Scoring formula (0-100 pts):
 *   Validation avg score  * 0.50  =>  0-50 pts
 *   Trades submitted      * 3     =>  0-30 pts  (capped at 10 trades)
 *   Vault capital claimed          =>  0 or 10 pts
 *   Any validation posted          =>  0 or 10 pts  (activity bonus)
 *
 * Run once:
 *   npx hardhat run scripts/auto-reputation.ts --network sepolia
 *
 * Cron every 4 h (add to crontab with: crontab -e):
 *   0 0,4,8,12,16,20 * * * cd /root/ai-trading-agent-tutorial
 *     && npx hardhat run scripts/auto-reputation.ts --network sepolia
 *     >> /var/log/auto-rep.log 2>&1
 */

import { ethers } from "hardhat";

// Contract addresses (Sepolia)
const REGISTRY_ADDR   = "0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3";
const VAULT_ADDR      = "0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90";
const ROUTER_ADDR     = "0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC";
const VALIDATION_ADDR = "0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1";
const REPUTATION_ADDR = "0x423a9904e39537a9997fbaF0f220d79D7d545763";

// Judge wallet -- rotates every 4h so the bot can re-score agents as they improve.
// Each 4h slot gets a unique deterministic wallet derived from the slot index.
// All wallets are pre-funded by scripts/prefund-judges.ts before the hackathon ends.
const RUN_SLOT = Math.floor(Date.now() / (4 * 3600_000)); // increments every 4h
const JUDGE_WALLET_SEED = `lablab-hackathon-judge-wallet-slot-${RUN_SLOT}`;

const MIN_JUDGE_BALANCE = ethers.parseEther("0.003");

// ABIs
const REGISTRY_ABI = [
  "function totalAgents() external view returns (uint256)",
  "function getAgent(uint256) view returns (tuple(address operatorWallet, address agentWallet, string name, string description, string[] capabilities, uint256 registeredAt, bool active) agent)",
];

const VAULT_ABI = [
  "function hasClaimed(uint256 agentId) external view returns (bool)",
];

const ROUTER_ABI = [
  "function getIntentNonce(uint256 agentId) external view returns (uint256)",
];

const VALIDATION_ABI = [
  "function getAverageValidationScore(uint256 agentId) external view returns (uint256)",
];

const REPUTATION_ABI = [
  "function submitFeedback(uint256 agentId, uint8 score, bytes32 outcomeRef, string comment, uint8 feedbackType) external",
  "function getAverageScore(uint256 agentId) external view returns (uint256)",
];

// Scoring
interface AgentMetrics {
  validationScore: bigint;
  tradeCount:      bigint;
  claimed:         boolean;
}

function computeScore(m: AgentMetrics): number {
  // 0-50: validation quality
  const valPts      = Math.floor(Number(m.validationScore) * 0.5);
  // 0-30: trading activity (3 pts/trade, cap 10)
  const tradePts    = Math.min(Number(m.tradeCount), 10) * 3;
  // 0-10: committed capital
  const vaultPts    = m.claimed ? 10 : 0;
  // 0-10: activity bonus (has posted at least one checkpoint)
  const activityPts = m.validationScore > 0n ? 10 : 0;

  return Math.min(100, valPts + tradePts + vaultPts + activityPts);
}

function scoreComment(m: AgentMetrics, score: number): string {
  return (
    "Auto-scored by judge bot. " +
    "Validation avg: " + m.validationScore + "/100. " +
    "Trades submitted: " + m.tradeCount + ". " +
    "Vault claimed: " + m.claimed + ". " +
    "Computed score: " + score + "/100."
  );
}

// Main
async function main() {
  const [deployer] = await ethers.getSigners();
  const provider   = deployer.provider!;

  // Judge wallet -- not a hardhat signer, connected to the same provider
  const judgeWallet = new ethers.Wallet(ethers.id(JUDGE_WALLET_SEED), provider);

  console.log("\n" + "=".repeat(60));
  console.log("  Auto-Reputation Bot  --  ERC-8004 Judge");
  console.log("=".repeat(60));
  console.log("Timestamp:    " + new Date().toISOString());
  console.log("Judge wallet: " + judgeWallet.address);

  const judgeBalance = await provider.getBalance(judgeWallet.address);
  console.log("Judge ETH:    " + ethers.formatEther(judgeBalance) + " ETH");

  if (judgeBalance < MIN_JUDGE_BALANCE) {
    console.error(
      "\nERROR: Judge wallet underfunded.\n" +
      "  Send at least 0.01 Sepolia ETH to: " + judgeWallet.address + "\n" +
      "  Faucet: https://sepoliafaucet.com\n"
    );
    process.exit(1);
  }

  // Read-only contracts use provider; write contract uses judgeWallet
  const registry   = new ethers.Contract(REGISTRY_ADDR,   REGISTRY_ABI,   provider);
  const vault      = new ethers.Contract(VAULT_ADDR,      VAULT_ABI,      provider);
  const router     = new ethers.Contract(ROUTER_ADDR,     ROUTER_ABI,     provider);
  const validation = new ethers.Contract(VALIDATION_ADDR, VALIDATION_ABI, provider);
  const reputation = new ethers.Contract(REPUTATION_ADDR, REPUTATION_ABI, judgeWallet);

  const total: bigint = await registry.totalAgents();
  console.log("\nAgents on registry: " + total + "\n");
  console.log("-".repeat(60));

  type Result = { id: number; name: string; score: number; prev: number; ok: boolean; err?: string };
  const results: Result[] = [];

  for (let id = 1n; id <= total; id++) {
    const label = "[" + id + "/" + total + "]";

    let agentName = "Agent #" + id;
    try {
      const agent = await registry.getAgent(id);

      if (!agent.active) {
        console.log(label + " #" + id + " -- inactive, skipping");
        continue;
      }

      agentName = agent.name;

      // Judge must not be the operator of this agent
      if (agent.operatorWallet.toLowerCase() === judgeWallet.address.toLowerCase()) {
        console.log(label + " " + agentName + " -- judge is operator, skipping");
        continue;
      }

      // Fetch all metrics in parallel
      const [valScore, tradeCount, claimed, prevRep] = await Promise.all([
        validation.getAverageValidationScore(id) as Promise<bigint>,
        router.getIntentNonce(id)                 as Promise<bigint>,
        vault.hasClaimed(id)                      as Promise<boolean>,
        reputation.getAverageScore(id)            as Promise<bigint>,
      ]);

      const metrics: AgentMetrics = { validationScore: valScore, tradeCount, claimed };
      const score   = computeScore(metrics);

      // Skip fully inactive agents -- contract rejects score 0
      if (score === 0) {
        console.log(label + " " + agentName + " -- score 0 (no activity), skipping");
        continue;
      }

      const comment = scoreComment(metrics, score);

      // outcomeRef -- deterministic per (agentId + run timestamp rounded to 4h)
      const roundedTs  = Math.floor(Date.now() / (4 * 3600_000)) * (4 * 3600_000);
      const outcomeRef = ethers.keccak256(
        ethers.toUtf8Bytes("judge-" + id + "-" + valScore + "-" + tradeCount + "-" + roundedTs)
      );

      process.stdout.write(
        label + " " + agentName.padEnd(26) +
        " val=" + String(valScore).padStart(3) +
        " trades=" + String(tradeCount).padStart(3) +
        " claimed=" + (claimed ? "Y" : "N") +
        " => " + score + "/100" +
        " (prev " + prevRep + ") ... "
      );

      const tx = await reputation.submitFeedback(
        id,
        score,       // uint8 0-100
        outcomeRef,  // bytes32
        comment,     // string
        0            // feedbackType 0 = TRADE_PERFORMANCE
      );
      await tx.wait();

      console.log("OK");
      results.push({ id: Number(id), name: agentName, score, prev: Number(prevRep), ok: true });

    } catch (err: any) {
      const msg = err?.reason ?? err?.message ?? String(err);
      console.log("FAILED: " + msg.slice(0, 80));
      results.push({ id: Number(id), name: agentName, score: 0, prev: 0, ok: false, err: msg });
    }
  }

  // Summary
  const ok     = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  console.log("\n" + "=".repeat(60));
  console.log("  Done -- " + ok.length + " scored, " + failed.length + " failed");
  console.log("=".repeat(60));

  if (ok.length > 0) {
    console.log("\n  Agent".padEnd(30) + "Score".padEnd(8) + "Change");
    console.log("  " + "-".repeat(40));
    for (const r of ok.sort((a, b) => b.score - a.score)) {
      const delta    = r.score - r.prev;
      const deltaStr = delta > 0 ? ("+" + delta) : delta < 0 ? String(delta) : "+/-0";
      console.log("  " + r.name.padEnd(28) + String(r.score).padEnd(7) + deltaStr);
    }
  }

  if (failed.length > 0) {
    console.log("\n  Failed:");
    for (const r of failed) {
      console.log("  #" + r.id + " " + r.name + ": " + (r.err ?? "").slice(0, 60));
    }
  }

  const remaining = await provider.getBalance(judgeWallet.address);
  console.log("\nJudge wallet remaining: " + ethers.formatEther(remaining) + " ETH\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
