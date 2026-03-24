// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./AgentRegistry.sol";

/**
 * @title RiskRouter
 * @notice Enforces per-agent risk rules via EIP-712 signed TradeIntents.
 *
 * The flow is:
 *   1. Agent constructs a TradeIntent (pair, action, amount, deadline, nonce)
 *   2. Agent signs the intent with EIP-712 using its registered agentWallet
 *   3. Agent submits the signed intent to submitTradeIntent()
 *   4. RiskRouter verifies the signature against the AgentRegistry
 *   5. RiskRouter validates risk parameters (position size, frequency, etc.)
 *   6. If approved: emits TradeApproved — agent proceeds to execute via Kraken
 *   7. If rejected: emits TradeRejected — trade is blocked on-chain
 *
 * This pattern means every trade decision has:
 *   - A cryptographic proof of agent intent (EIP-712 signature)
 *   - An on-chain record of approval or rejection (events)
 *   - Replay protection (nonce + deadline)
 *
 * The hackathon-provided vault and risk router follow this same pattern.
 * When connecting to the hackathon infrastructure, you submit the same
 * signed TradeIntent to the provided router contract address.
 */
contract RiskRouter is EIP712 {
    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct TradeIntent {
        uint256 agentId;
        address agentWallet;       // Must match AgentRegistry.agents[agentId].agentWallet
        string  pair;              // e.g. "XBTUSD"
        string  action;            // "BUY" or "SELL"
        uint256 amountUsdScaled;   // USD * 100 (e.g. 50000 = $500.00)
        uint256 maxSlippageBps;    // Max acceptable slippage in basis points
        uint256 nonce;             // Replay protection — must match stored nonce
        uint256 deadline;          // Unix timestamp after which intent is invalid
    }

    struct RiskParams {
        uint256 maxPositionUsdScaled; // Max single trade in USD * 100
        uint256 maxDrawdownBps;       // Max drawdown in basis points (500 = 5%)
        uint256 maxTradesPerHour;     // Max trades per rolling hour window
        bool    active;
    }

    struct TradeRecord {
        uint256 count;
        uint256 windowStart;
    }

    // EIP-712 typehash for TradeIntent
    bytes32 public constant TRADE_INTENT_TYPEHASH = keccak256(
        "TradeIntent(uint256 agentId,address agentWallet,string pair,string action,"
        "uint256 amountUsdScaled,uint256 maxSlippageBps,uint256 nonce,uint256 deadline)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    address public owner;
    AgentRegistry public immutable agentRegistry;

    mapping(uint256 => RiskParams)  public riskParams;
    mapping(uint256 => TradeRecord) private _tradeRecords;
    mapping(uint256 => uint256)     private _intentNonces; // agentId → next nonce

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event TradeIntentSubmitted(
        uint256 indexed agentId,
        bytes32 indexed intentHash,
        string pair,
        string action,
        uint256 amountUsdScaled
    );
    event TradeApproved(uint256 indexed agentId, bytes32 indexed intentHash, uint256 amountUsdScaled);
    event TradeRejected(uint256 indexed agentId, bytes32 indexed intentHash, string reason);
    event RiskParamsSet(uint256 indexed agentId, uint256 maxPositionUsdScaled, uint256 maxTradesPerHour);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address agentRegistryAddress)
        EIP712("RiskRouter", "1")
    {
        owner = msg.sender;
        agentRegistry = AgentRegistry(agentRegistryAddress);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "RiskRouter: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Risk parameter configuration
    // ─────────────────────────────────────────────────────────────────────────

    function setRiskParams(
        uint256 agentId,
        uint256 maxPositionUsdScaled,
        uint256 maxDrawdownBps,
        uint256 maxTradesPerHour
    ) external onlyOwner {
        require(maxPositionUsdScaled > 0, "RiskRouter: invalid maxPosition");
        require(maxDrawdownBps <= 10000, "RiskRouter: drawdown cannot exceed 100%");
        require(maxTradesPerHour > 0, "RiskRouter: invalid maxTradesPerHour");

        riskParams[agentId] = RiskParams({
            maxPositionUsdScaled: maxPositionUsdScaled,
            maxDrawdownBps: maxDrawdownBps,
            maxTradesPerHour: maxTradesPerHour,
            active: true
        });

        emit RiskParamsSet(agentId, maxPositionUsdScaled, maxTradesPerHour);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TradeIntent submission
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Submit a signed TradeIntent for validation.
     *
     * The agent:
     *   1. Builds a TradeIntent struct off-chain
     *   2. Signs it with EIP-712 using its agentWallet
     *   3. Submits intent + signature here
     *
     * The router:
     *   1. Verifies the signature recovers to the agent's registered agentWallet
     *   2. Checks deadline hasn't passed
     *   3. Validates nonce (replay protection)
     *   4. Applies risk rules
     *   5. Emits TradeApproved or TradeRejected
     *
     * @param intent     The trade intent struct.
     * @param signature  EIP-712 signature over the intent, from agentWallet.
     * @return approved  True if the intent passes all checks.
     * @return reason    Empty if approved; rejection reason if not.
     */
    function submitTradeIntent(
        TradeIntent calldata intent,
        bytes calldata signature
    ) external returns (bool approved, string memory reason) {
        bytes32 intentHash = _hashTradeIntent(intent);

        emit TradeIntentSubmitted(intent.agentId, intentHash, intent.pair, intent.action, intent.amountUsdScaled);

        // 1. Verify deadline
        if (block.timestamp > intent.deadline) {
            emit TradeRejected(intent.agentId, intentHash, "Intent expired");
            return (false, "Intent expired");
        }

        // 2. Verify nonce
        if (intent.nonce != _intentNonces[intent.agentId]) {
            emit TradeRejected(intent.agentId, intentHash, "Invalid nonce");
            return (false, "Invalid nonce");
        }

        // 3. Verify signature against AgentRegistry
        AgentRegistry.AgentRegistration memory reg = agentRegistry.getAgent(intent.agentId);
        require(intent.agentWallet == reg.agentWallet, "RiskRouter: agentWallet mismatch");

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(
                TRADE_INTENT_TYPEHASH,
                intent.agentId,
                intent.agentWallet,
                keccak256(bytes(intent.pair)),
                keccak256(bytes(intent.action)),
                intent.amountUsdScaled,
                intent.maxSlippageBps,
                intent.nonce,
                intent.deadline
            ))
        );
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != reg.agentWallet) {
            emit TradeRejected(intent.agentId, intentHash, "Invalid signature");
            return (false, "Invalid signature");
        }

        // 4. Risk validation
        (approved, reason) = _validateRisk(intent.agentId, intent.amountUsdScaled);
        if (!approved) {
            emit TradeRejected(intent.agentId, intentHash, reason);
            return (false, reason);
        }

        // 5. Consume nonce + record trade
        _intentNonces[intent.agentId]++;
        _recordTrade(intent.agentId);

        emit TradeApproved(intent.agentId, intentHash, intent.amountUsdScaled);
        return (true, "");
    }

    /**
     * @notice Simulate intent validation without state changes (off-chain pre-flight).
     */
    function simulateIntent(
        TradeIntent calldata intent
    ) external view returns (bool approved, string memory reason) {
        if (block.timestamp > intent.deadline) return (false, "Intent expired");
        if (intent.nonce != _intentNonces[intent.agentId]) return (false, "Invalid nonce");
        return _validateRisk(intent.agentId, intent.amountUsdScaled);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _validateRisk(
        uint256 agentId,
        uint256 amountUsdScaled
    ) internal view returns (bool, string memory) {
        RiskParams storage params = riskParams[agentId];

        if (!params.active) {
            // Default conservative cap: $1,000
            if (amountUsdScaled > 100000) return (false, "No risk params: exceeds $1000 default cap");
        } else {
            if (amountUsdScaled > params.maxPositionUsdScaled) return (false, "Exceeds maxPositionSize");

            TradeRecord storage record = _tradeRecords[agentId];
            uint256 currentCount = (block.timestamp >= record.windowStart + 1 hours)
                ? 0 : record.count;
            if (currentCount >= params.maxTradesPerHour) return (false, "Exceeds maxTradesPerHour");
        }

        return (true, "");
    }

    function _recordTrade(uint256 agentId) internal {
        TradeRecord storage record = _tradeRecords[agentId];
        if (block.timestamp >= record.windowStart + 1 hours) {
            record.windowStart = block.timestamp;
            record.count = 1;
        } else {
            record.count++;
        }
    }

    function _hashTradeIntent(TradeIntent calldata intent) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            intent.agentId,
            intent.agentWallet,
            keccak256(bytes(intent.pair)),
            keccak256(bytes(intent.action)),
            intent.amountUsdScaled,
            intent.nonce,
            intent.deadline
        ));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getIntentNonce(uint256 agentId) external view returns (uint256) {
        return _intentNonces[agentId];
    }

    function getTradeRecord(uint256 agentId) external view returns (uint256 count, uint256 windowStart) {
        TradeRecord storage r = _tradeRecords[agentId];
        return (r.count, r.windowStart);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
