// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title HackathonVault
 * @notice Capital vault that holds ETH and tracks per-agent allocations.
 *
 * The vault is the financial backbone of the trading agent system. It ensures
 * that every trade is backed by real allocated capital and that no agent can
 * spend more than its allocated share. This is the "trust" layer — anyone can
 * inspect how much capital each agentId controls.
 *
 * In production you'd extend this with ERC-20 support (e.g. USDC). For the
 * hackathon template, ETH on Sepolia is sufficient.
 */
contract HackathonVault {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    address public owner;
    mapping(bytes32 => uint256) public allocatedCapital; // agentId → wei
    uint256 public totalAllocated;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Deposited(address indexed from, uint256 amount);
    event CapitalAllocated(bytes32 indexed agentId, uint256 amount);
    event CapitalReleased(bytes32 indexed agentId, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "HackathonVault: not owner");
        _;
    }

    // -------------------------------------------------------------------------
    // Funding
    // -------------------------------------------------------------------------

    /**
     * @notice Deposit ETH into the vault.
     */
    function deposit() external payable {
        require(msg.value > 0, "HackathonVault: zero deposit");
        emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // -------------------------------------------------------------------------
    // Capital management (owner-controlled for hackathon simplicity)
    // -------------------------------------------------------------------------

    /**
     * @notice Allocate capital to a specific agent.
     * @dev In production this would be gated by agent registration checks.
     */
    function allocate(bytes32 agentId, uint256 amount) external onlyOwner {
        require(
            address(this).balance >= totalAllocated + amount,
            "HackathonVault: insufficient unallocated balance"
        );
        allocatedCapital[agentId] += amount;
        totalAllocated += amount;
        emit CapitalAllocated(agentId, amount);
    }

    /**
     * @notice Release capital from an agent back to the unallocated pool.
     */
    function release(bytes32 agentId, uint256 amount) external onlyOwner {
        require(allocatedCapital[agentId] >= amount, "HackathonVault: insufficient allocation");
        allocatedCapital[agentId] -= amount;
        totalAllocated -= amount;
        emit CapitalReleased(agentId, amount);
    }

    /**
     * @notice Withdraw unallocated ETH from the vault (owner only).
     */
    function withdraw(uint256 amount) external onlyOwner {
        uint256 unallocated = address(this).balance - totalAllocated;
        require(amount <= unallocated, "HackathonVault: would drain allocated capital");
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "HackathonVault: transfer failed");
        emit Withdrawn(owner, amount);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getBalance(bytes32 agentId) external view returns (uint256) {
        return allocatedCapital[agentId];
    }

    function totalVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function unallocatedBalance() external view returns (uint256) {
        return address(this).balance - totalAllocated;
    }
}
