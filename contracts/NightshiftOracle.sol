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
///         Reverts on a missing or stale price, so a Morpho market can't borrow or liquidate on an old number.
contract MorphoOracleAdapter {
    NightshiftOracle public immutable oracle;
    address public immutable collateral;
    uint256 public immutable maxAge;

    constructor(NightshiftOracle oracle_, address collateral_, uint256 maxAge_) {
        require(address(oracle_) != address(0) && collateral_ != address(0), "zero");
        require(maxAge_ > 0, "maxAge");
        oracle = oracle_;
        collateral = collateral_;
        maxAge = maxAge_;
    }

    function price() external view returns (uint256) {
        (uint256 p, , uint64 updatedAt) = oracle.getPrice(collateral);
        require(p > 0, "no price");
        require(block.timestamp - updatedAt <= maxAge, "stale price");
        return p * 1e18;
    }
}

/// @title NightshiftAggregatorV3: one Nightshift feed through Chainlink's AggregatorV3Interface.
/// @notice USD price with 8 decimals, like Chainlink's USD feeds. There is no round history: roundId is the update
///         time, and getRoundData answers only for the latest round. `confidence()` adds Nightshift's 0-100 score.
///         Consumers must check `updatedAt` for staleness, as with any Chainlink feed.
contract NightshiftAggregatorV3 {
    NightshiftOracle public immutable oracle;
    address public immutable token;
    string public description;
    uint8 public constant decimals = 8;
    uint256 public constant version = 1;

    constructor(NightshiftOracle oracle_, address token_, string memory description_) {
        require(address(oracle_) != address(0) && token_ != address(0), "zero");
        oracle = oracle_;
        token = token_;
        description = description_;
    }

    function latestRoundData()
        public
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (uint256 p, , uint64 t) = oracle.getPrice(token);
        require(p > 0, "no price");
        roundId = uint80(t);
        answer = int256(p / 1e10); // 18 → 8 decimals
        startedAt = t;
        updatedAt = t;
        answeredInRound = roundId;
    }

    function getRoundData(uint80 roundId_)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = latestRoundData();
        require(roundId_ == roundId, "no history");
    }

    function latestAnswer() external view returns (int256 answer) {
        (, answer, , , ) = latestRoundData();
    }

    function latestTimestamp() external view returns (uint256 updatedAt) {
        (, , , updatedAt, ) = latestRoundData();
    }

    /// @notice Nightshift's confidence in the current price, 0-100 (as pushed; it falls the longer markets are closed).
    function confidence() external view returns (uint8 c) {
        (, c, ) = oracle.getPrice(token);
    }
}
