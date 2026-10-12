// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title NightshiftOracle: on-chain store of the off-chain Nightshift fair values.
/// @notice An authorised updater (the keeper) pushes fair value and confidence per collateral token.
contract NightshiftOracle {
    struct Feed {
        uint256 price; // USD per token, 18 decimals
        uint8 confidence; // 0-100
        uint64 updatedAt;
    }

    address public owner;
    /// @notice A single update may move a price by at most this much (basis points). Larger moves are skipped and
    ///         must be confirmed by the owner with forceSetPrices, so one bad push cannot trigger mass liquidations.
    uint256 public maxMoveBps = 1500;
    mapping(address => bool) public isUpdater;
    mapping(address => Feed) public feeds;

    event PriceUpdated(address indexed token, uint256 price, uint8 confidence, uint64 updatedAt);
    event UpdaterSet(address indexed updater, bool allowed);
    event PriceSkipped(address indexed token, uint256 previous, uint256 proposed);
    event MaxMoveSet(uint256 bps);

    constructor() {
        owner = msg.sender;
        isUpdater[msg.sender] = true;
    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Hands every owner power (prices override, markets, roles) to a new address, e.g. the team's own wallet.
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "owner");
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setUpdater(address updater, bool allowed) external {
        require(msg.sender == owner, "owner");
        isUpdater[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    function setMaxMoveBps(uint256 bps) external {
        require(msg.sender == owner, "owner");
        require(bps >= 100 && bps <= 10_000, "bps");
        maxMoveBps = bps;
        emit MaxMoveSet(bps);
    }

    function setPrices(address[] calldata tokens, uint256[] calldata prices, uint8[] calldata confidences) external {
        require(isUpdater[msg.sender], "updater");
        _set(tokens, prices, confidences, true);
    }

    /// @notice Owner override for a genuine move larger than maxMoveBps (e.g. a real crash).
    function forceSetPrices(address[] calldata tokens, uint256[] calldata prices, uint8[] calldata confidences) external {
        require(msg.sender == owner, "owner");
        _set(tokens, prices, confidences, false);
    }

    function _set(address[] calldata tokens, uint256[] calldata prices, uint8[] calldata confidences, bool bounded) internal {
        require(tokens.length == prices.length && prices.length == confidences.length, "length");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(prices[i] > 0 && confidences[i] <= 100, "value");
            uint256 prev = feeds[tokens[i]].price;
            if (bounded && prev > 0) {
                uint256 diff = prices[i] > prev ? prices[i] - prev : prev - prices[i];
                if (diff * 10_000 > prev * maxMoveBps) {
                    emit PriceSkipped(tokens[i], prev, prices[i]);
                    continue;
                }
            }
            feeds[tokens[i]] = Feed(prices[i], confidences[i], uint64(block.timestamp));
            emit PriceUpdated(tokens[i], prices[i], confidences[i], uint64(block.timestamp));
        }
    }

    function getPrice(address token) external view returns (uint256 price, uint8 confidence, uint64 updatedAt) {
        Feed memory f = feeds[token];
        return (f.price, f.confidence, f.updatedAt);
    }
}

/// @title MorphoOracleAdapter: exposes one Nightshift feed through Morpho Blue's IOracle interface.
/// @notice Morpho expects `price()` = collateral price in loan-token units, scaled by
///         1e36 * 10^(loanDecimals - collateralDecimals). Both tokens here have 18 decimals.
contract MorphoOracleAdapter {
    NightshiftOracle public immutable oracle;
    address public immutable collateral;

    constructor(NightshiftOracle oracle_, address collateral_) {
        oracle = oracle_;
        collateral = collateral_;
    }

    function price() external view returns (uint256) {
        (uint256 p, , ) = oracle.getPrice(collateral);
        return p * 1e18;
    }
}
