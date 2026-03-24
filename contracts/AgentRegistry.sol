// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC-721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC-721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AgentRegistry
 * @notice ERC-8004 compliant AI Agent Identity Registry — each agent is an ERC-721 NFT.
 *
 * Why ERC-721?
 * - Agent identity becomes a transferable asset: a high-reputation trading agent
 *   can be sold along with its on-chain track record.
 * - Standard token interfaces mean wallets, indexers, and marketplaces all
 *   understand agent identities without custom tooling.
 * - Token ID (agentId) is an auto-incrementing uint256 — stable, unique, cheap to store.
 *
 * Each token URI points to an Agent Registration JSON (off-chain or IPFS) containing:
 *   { name, description, capabilities[], agentWallet, endpoints[], version }
 *
 * EIP-712 support: agents can sign typed messages that are verifiable against their
 * registered agentWallet — linking off-chain AI actions to on-chain identity.
 *
 * ERC-8004 spec: https://eips.ethereum.org/EIPS/eip-8004
 */
contract AgentRegistry is ERC721URIStorage, EIP712 {
    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct AgentRegistration {
        address operatorWallet;  // Wallet that owns/controls this agent token
        address agentWallet;     // Hot wallet the agent uses for signing
        string  name;
        string  description;
        string[] capabilities;   // e.g. ["trading", "analysis", "eip712-signing"]
        uint256 registeredAt;
        bool    active;
    }

    // EIP-712 typed hash for agent-signed messages
    bytes32 public constant AGENT_MESSAGE_TYPEHASH = keccak256(
        "AgentMessage(uint256 agentId,address agentWallet,uint256 nonce,bytes32 contentHash)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    uint256 private _nextAgentId;
    mapping(uint256 => AgentRegistration) public agents;
    mapping(address => uint256) public walletToAgentId;  // agentWallet → agentId
    mapping(uint256 => uint256) private _signingNonces;  // agentId → nonce

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed operatorWallet,
        address indexed agentWallet,
        string name
    );
    event AgentWalletUpdated(uint256 indexed agentId, address newAgentWallet);
    event AgentDeactivated(uint256 indexed agentId);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor()
        ERC721("ERC-8004 Agent Registry", "AGENT")
        EIP712("AgentRegistry", "1")
    {}

    // ─────────────────────────────────────────────────────────────────────────
    // Registration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a new AI agent — mints an ERC-721 token to the caller.
     * @param agentWallet    Hot wallet address the agent signs messages with.
     * @param name           Human-readable agent name.
     * @param description    What the agent does.
     * @param capabilities   Array of capability strings.
     * @param agentURI       URI pointing to the Agent Registration JSON (IPFS or https).
     * @return agentId       The ERC-721 token ID — this is the agent's on-chain identity.
     */
    function register(
        address agentWallet,
        string calldata name,
        string calldata description,
        string[] calldata capabilities,
        string calldata agentURI
    ) external returns (uint256 agentId) {
        require(bytes(name).length > 0, "AgentRegistry: name required");
        require(agentWallet != address(0), "AgentRegistry: invalid agentWallet");
        require(walletToAgentId[agentWallet] == 0, "AgentRegistry: agentWallet already registered");

        agentId = _nextAgentId++;
        _mint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);

        agents[agentId] = AgentRegistration({
            operatorWallet: msg.sender,
            agentWallet: agentWallet,
            name: name,
            description: description,
            capabilities: capabilities,
            registeredAt: block.timestamp,
            active: true
        });

        walletToAgentId[agentWallet] = agentId;

        emit AgentRegistered(agentId, msg.sender, agentWallet, name);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Management (token owner only)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Update the agent's hot signing wallet.
     */
    function updateAgentWallet(uint256 agentId, address newAgentWallet) external {
        require(ownerOf(agentId) == msg.sender, "AgentRegistry: not token owner");
        require(newAgentWallet != address(0), "AgentRegistry: invalid wallet");

        address old = agents[agentId].agentWallet;
        delete walletToAgentId[old];

        agents[agentId].agentWallet = newAgentWallet;
        walletToAgentId[newAgentWallet] = agentId;

        emit AgentWalletUpdated(agentId, newAgentWallet);
    }

    /**
     * @notice Update the agent's metadata URI.
     */
    function updateAgentURI(uint256 agentId, string calldata newURI) external {
        require(ownerOf(agentId) == msg.sender, "AgentRegistry: not token owner");
        _setTokenURI(agentId, newURI);
    }

    /**
     * @notice Deactivate an agent (does not burn the token — history preserved).
     */
    function deactivate(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "AgentRegistry: not token owner");
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EIP-712 agent message verification
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Verify that a message was signed by the agent's registered agentWallet.
     * @param agentId     The agent's token ID.
     * @param contentHash keccak256 of the message content.
     * @param signature   EIP-712 signature from the agentWallet.
     * @return valid      True if the signature recovers to the agent's registered wallet.
     */
    function verifyAgentSignature(
        uint256 agentId,
        bytes32 contentHash,
        bytes calldata signature
    ) external view returns (bool valid) {
        AgentRegistration storage reg = agents[agentId];
        bytes32 structHash = keccak256(abi.encode(
            AGENT_MESSAGE_TYPEHASH,
            agentId,
            reg.agentWallet,
            _signingNonces[agentId],
            contentHash
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        return recovered == reg.agentWallet;
    }

    /**
     * @notice Increment the agent's signing nonce (replay protection).
     *         Call after consuming a signature.
     */
    function incrementNonce(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "AgentRegistry: not token owner");
        _signingNonces[agentId]++;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getAgent(uint256 agentId) external view returns (AgentRegistration memory) {
        require(_ownerOf(agentId) != address(0), "AgentRegistry: nonexistent token");
        return agents[agentId];
    }

    function isRegistered(uint256 agentId) external view returns (bool) {
        return _ownerOf(agentId) != address(0);
    }

    function getSigningNonce(uint256 agentId) external view returns (uint256) {
        return _signingNonces[agentId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function totalAgents() external view returns (uint256) {
        return _nextAgentId;
    }
}
