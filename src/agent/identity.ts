/**
 * ERC-8004 Agent Identity (ERC-721 based)
 *
 * Handles agent registration on the AgentRegistry contract. Each agent is an
 * ERC-721 NFT — the token ID is the agentId used across all on-chain systems.
 *
 * Two wallet roles:
 *   - operatorWallet: owns the ERC-721 token, calls register(). Usually a cold wallet.
 *   - agentWallet:    hot wallet the agent uses for signing TradeIntents + checkpoints.
 *                     Can be the same as operatorWallet for simplicity.
 *
 * On first run: registers the agent, prints the agentId, writes to agent-id.json.
 * On subsequent runs: reads AGENT_ID from env, verifies it's still registered.
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const REGISTRY_ABI = [
  "function register(address agentWallet, string name, string description, string[] capabilities, string agentURI) external returns (uint256 agentId)",
  "function getAgent(uint256 agentId) external view returns (tuple(address operatorWallet, address agentWallet, string name, string description, string[] capabilities, uint256 registeredAt, bool active))",
  "function isRegistered(uint256 agentId) external view returns (bool)",
  "function ownerOf(uint256 agentId) external view returns (address)",
  "function walletToAgentId(address agentWallet) external view returns (uint256)",
  "event AgentRegistered(uint256 indexed agentId, address indexed operatorWallet, address indexed agentWallet, string name)",
];

export interface AgentIdentityConfig {
  name: string;
  description: string;
  capabilities: string[];
  agentWallet: string;   // Hot wallet for signing (can be same as operator)
  agentURI: string;      // URI for Agent Registration JSON (use "ipfs://" or "https://")
}

let _agentId: bigint | null = null;

/**
 * Returns the agent's ERC-721 token ID. Registers on-chain if not already registered.
 *
 * @param operatorSigner  Wallet that owns the agent token (pays for registration gas)
 * @param registryAddress Deployed AgentRegistry contract address
 * @param config          Agent identity configuration
 */
export async function getAgentId(
  operatorSigner: ethers.Signer,
  registryAddress: string,
  config: AgentIdentityConfig
): Promise<bigint> {
  if (_agentId !== null) return _agentId;

  // Check env first
  if (process.env.AGENT_ID) {
    _agentId = BigInt(process.env.AGENT_ID);
    console.log(`[identity] Loaded agentId from env: ${_agentId}`);
    return _agentId;
  }

  // Check if this agentWallet is already registered
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, operatorSigner);
  const existing = await registry.walletToAgentId(config.agentWallet);
  if (existing > 0n) {
    _agentId = existing;
    console.log(`[identity] agentWallet already registered as agentId: ${_agentId}`);
    console.log(`[identity] Add to .env: AGENT_ID=${_agentId}`);
    return _agentId;
  }

  // Register — mints ERC-721 token
  console.log("[identity] Registering new agent on-chain (ERC-721 mint)...");
  const tx = await registry.register(
    config.agentWallet,
    config.name,
    config.description,
    config.capabilities,
    config.agentURI
  );

  console.log(`[identity] Registration tx: ${tx.hash}`);
  const receipt = await tx.wait();

  // Parse AgentRegistered event to get agentId
  const iface = new ethers.Interface(REGISTRY_ABI);
  let agentId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "AgentRegistered") {
        agentId = parsed.args.agentId;
        break;
      }
    } catch { /* not our event */ }
  }

  if (agentId === null) throw new Error("[identity] Could not parse AgentRegistered event");

  _agentId = agentId;
  console.log(`[identity] Agent registered! Token ID (agentId): ${agentId}`);
  console.log(`[identity] Add to .env: AGENT_ID=${agentId}`);

  // Write to agent-id.json
  const outPath = path.join(process.cwd(), "agent-id.json");
  fs.writeFileSync(outPath, JSON.stringify({ agentId: agentId.toString(), txHash: tx.hash }, null, 2));
  console.log(`[identity] Saved to ${outPath}`);

  return agentId;
}

/**
 * Fetch the full on-chain registration for an agent.
 */
export async function getAgentRegistration(
  provider: ethers.Provider,
  registryAddress: string,
  agentId: bigint
) {
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
  const reg = await registry.getAgent(agentId);
  return {
    operatorWallet: reg.operatorWallet,
    agentWallet: reg.agentWallet,
    name: reg.name,
    description: reg.description,
    capabilities: reg.capabilities,
    registeredAt: Number(reg.registeredAt),
    active: reg.active,
  };
}

/**
 * Verify that an agentId is still registered and active.
 */
export async function verifyRegistration(
  provider: ethers.Provider,
  registryAddress: string,
  agentId: bigint
): Promise<boolean> {
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
  const isReg = await registry.isRegistered(agentId);
  if (!isReg) return false;
  const reg = await registry.getAgent(agentId);
  return reg.active;
}
