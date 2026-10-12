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
    mapping(address => bool) public isUpdater;
    mapping(address => Feed) public feeds;

    event PriceUpdated(address indexed token, uint256 price, uint8 confidence, uint64 updatedAt);
    event UpdaterSet(address indexed updater, bool allowed);

    constructor() {
        owner = msg.sender;
        isUpdater[msg.sender] = true;
    }

    function setUpdater(address updater, bool allowed) external {
        require(msg.sender == owner, "owner");
        isUpdater[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    function setPrices(address[] calldata tokens, uint256[] calldata prices, uint8[] calldata confidences) external {
        require(isUpdater[msg.sender], "updater");
        require(tokens.length == prices.length && prices.length == confidences.length, "length");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(prices[i] > 0 && confidences[i] <= 100, "value");
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
