// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    function isRegistered(uint256 agentId) external view returns (bool);
}

/**
 * @title HackathonVault
 * @notice Capital vault that holds ETH and tracks per-agent allocations.
 *
 * Teams self-serve their allocation by calling claimAllocation(agentId) after
 * registering on the AgentRegistry. Each agentId gets exactly allocationPerTeam
 * wei — one claim per agent, enforced on-chain.
 */
contract HackathonVault {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    address public owner;
    IAgentRegistry public agentRegistry;
    uint256 public allocationPerTeam;

    mapping(uint256 => uint256) public allocatedCapital; // agentId → wei
    mapping(uint256 => bool) public hasClaimed;          // agentId → claimed
    uint256 public totalAllocated;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Deposited(address indexed from, uint256 amount);
    event CapitalAllocated(uint256 indexed agentId, uint256 amount);
    event CapitalReleased(uint256 indexed agentId, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AllocationPerTeamUpdated(uint256 oldAmount, uint256 newAmount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _agentRegistry, uint256 _allocationPerTeam) {
        owner = msg.sender;
        agentRegistry = IAgentRegistry(_agentRegistry);
        allocationPerTeam = _allocationPerTeam;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "HackathonVault: not owner");
        _;
    }

    // -------------------------------------------------------------------------
    // Funding
    // -------------------------------------------------------------------------

    function deposit() external payable {
        require(msg.value > 0, "HackathonVault: zero deposit");
        emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // -------------------------------------------------------------------------
    // Self-serve claim (called by teams after registering their agent)
    // -------------------------------------------------------------------------

    /**
     * @notice Claim the fixed sandbox capital allocation for a registered agent.
     * @dev Anyone can call this for any agentId — but only once per agent.
     *      Reverts if the vault is underfunded or the agent is not registered.
     */
    function claimAllocation(uint256 agentId) external {
        require(agentRegistry.isRegistered(agentId), "HackathonVault: agent not registered");
        require(!hasClaimed[agentId], "HackathonVault: already claimed");
        require(
            address(this).balance >= totalAllocated + allocationPerTeam,
            "HackathonVault: vault underfunded"
        );

        hasClaimed[agentId] = true;
        allocatedCapital[agentId] += allocationPerTeam;
        totalAllocated += allocationPerTeam;

        emit CapitalAllocated(agentId, allocationPerTeam);
    }

    // -------------------------------------------------------------------------
    // Owner-controlled management
    // -------------------------------------------------------------------------

    /**
     * @notice Manually allocate capital to an agent (owner override).
     */
    function allocate(uint256 agentId, uint256 amount) external onlyOwner {
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
    function release(uint256 agentId, uint256 amount) external onlyOwner {
        require(allocatedCapital[agentId] >= amount, "HackathonVault: insufficient allocation");
        allocatedCapital[agentId] -= amount;
        totalAllocated -= amount;
        emit CapitalReleased(agentId, amount);
    }

    /**
     * @notice Update the fixed allocation amount per team.
     */
    function setAllocationPerTeam(uint256 newAmount) external onlyOwner {
        emit AllocationPerTeamUpdated(allocationPerTeam, newAmount);
        allocationPerTeam = newAmount;
    }

    /**
     * @notice Withdraw unallocated ETH from the vault.
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

    function getBalance(uint256 agentId) external view returns (uint256) {
        return allocatedCapital[agentId];
    }

    function totalVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function unallocatedBalance() external view returns (uint256) {
        return address(this).balance - totalAllocated;
    }
}
