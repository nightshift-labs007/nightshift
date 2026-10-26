// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IStackToken {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IStackOracle {
    function getPrice(address token) external view returns (uint256 price, uint8 confidence, uint64 updatedAt);
}

/// @notice Where Stack buys. On the Base demo this is StackDemoPool; on Robinhood Chain it will be a Uniswap route.
interface IStackVenue {
    function buy(address asset, uint256 amountIn, uint256 minOut, address to) external returns (uint256 out);
}

/// @title StackPlan: non-custodial recurring buys (SIP) that only execute at a fair price.
/// @notice A user creates a plan ("buy 20 USDG of GLD every week"), approves the loan token to this contract for the
///         plan's budget, and anyone (normally the keeper) may call execute() once a window is open. execute() pulls
///         exactly one installment from the owner, buys through the venue, and sends the asset straight back to the
///         owner in the same transaction. The contract itself enforces the guard, so a careless or malicious keeper
///         can at worst fail to execute; it can never make a user overpay. No funds are ever held here between calls.
///
///         Guard (all must hold): the Oracle price is fresh, its confidence meets the plan's floor, and the venue
///         delivers at least `amount / (fairValue * (1 + maxPremium))` tokens, i.e. never more than the allowed
///         premium over the Nightshift fair value. Properties S1 to S6 are stated in formal/ and mirrored in the tests.
///
///         v1 scope: one asset per plan (a "Both" plan is two plans), fixed amount, skip-and-roll fallback. The loan
///         token is treated as one US dollar per token.
contract StackPlan {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    enum Status {
        Active,
        Paused,
        Cancelled
    }

    struct Plan {
        address owner;
        address asset;
        uint128 amountPerRun; // loan-token units
        uint128 budget; // the most this plan may ever spend (the cap the user signed for)
        uint128 spent;
        uint40 nextRun; // the window opens here
        uint40 expiry; // no run after this time
        uint32 interval; // seconds between runs
        uint32 window; // seconds a run may be executed after nextRun
        uint32 runs; // completed runs
        uint16 maxPremiumBps; // over Oracle fair value
        uint8 minConfidence;
        Status status;
    }

    struct AssetRule {
        bool allowed;
        uint16 maxPremiumCapBps; // plans may not allow a larger premium than this
    }

    address public owner;
    IStackToken public immutable loanToken;
    IStackOracle public immutable oracle;
    IStackVenue public venue;

    uint256 public minInterval; // seconds
    uint256 public maxPerRun; // loan-token units
    uint256 public maxOracleAge; // seconds
    uint8 public confidenceFloor; // plans may not set a lower minConfidence

    Plan[] internal plans;
    mapping(address => AssetRule) public assets;
    mapping(address => uint256[]) internal plansByOwner;

    uint256 private _lock = 1;

    event PlanCreated(uint256 indexed planId, address indexed owner, address indexed asset, uint256 amountPerRun, uint256 interval, uint256 firstRun, uint256 budget);
    event Executed(uint256 indexed planId, address indexed owner, address indexed asset, uint256 spent, uint256 bought, uint256 fairPrice, uint256 premiumBps, uint256 runs);
    event Skipped(uint256 indexed planId, address indexed owner, uint256 nextRun);
    event StatusChanged(uint256 indexed planId, Status status);
    event AssetSet(address indexed asset, bool allowed, uint16 maxPremiumCapBps);
    event VenueSet(address indexed venue);
    event LimitsSet(uint256 minInterval, uint256 maxPerRun, uint256 maxOracleAge, uint8 confidenceFloor);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "owner");
        _;
    }

    constructor(IStackToken loanToken_, IStackOracle oracle_, IStackVenue venue_) {
        owner = msg.sender;
        loanToken = loanToken_;
        oracle = oracle_;
        venue = venue_;
        minInterval = 1 hours; // the demo; real-token deployments use 1 days
        maxPerRun = 1_000 * 10 ** loanToken_.decimals();
        maxOracleAge = 1 hours;
        confidenceFloor = 75;
    }

    // ---------------------------------------------------------------- admin

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice The allowlist (S6): plans can only ever buy these tokens. Never user-supplied.
    function setAsset(address asset, bool allowed, uint16 maxPremiumCapBps) external onlyOwner {
        require(maxPremiumCapBps <= 500, "premium cap");
        assets[asset] = AssetRule(allowed, maxPremiumCapBps);
        emit AssetSet(asset, allowed, maxPremiumCapBps);
    }

    function setVenue(IStackVenue venue_) external onlyOwner {
        require(address(venue_) != address(0), "zero");
        venue = venue_;
        emit VenueSet(address(venue_));
    }

    function setLimits(uint256 minInterval_, uint256 maxPerRun_, uint256 maxOracleAge_, uint8 confidenceFloor_) external onlyOwner {
        require(minInterval_ >= 1 hours && maxPerRun_ > 0 && maxOracleAge_ >= 5 minutes && maxOracleAge_ <= 1 days && confidenceFloor_ >= 50 && confidenceFloor_ <= 100, "limits");
        minInterval = minInterval_;
        maxPerRun = maxPerRun_;
        maxOracleAge = maxOracleAge_;
        confidenceFloor = confidenceFloor_;
        emit LimitsSet(minInterval_, maxPerRun_, maxOracleAge_, confidenceFloor_);
    }

    // ---------------------------------------------------------------- user actions

    /// @notice Creates a plan. The caller must also approve the loan token to this contract for at least `budget`.
    function createPlan(
        address asset,
        uint128 amountPerRun,
        uint32 interval,
        uint40 firstRun,
        uint32 window,
        uint16 maxPremiumBps,
        uint8 minConfidence,
        uint128 budget,
        uint40 expiry
    ) external returns (uint256 planId) {
        AssetRule memory rule = assets[asset];
        require(rule.allowed, "asset");
        require(amountPerRun > 0 && amountPerRun <= maxPerRun, "amount");
        require(interval >= minInterval, "interval");
        require(window >= 5 minutes && window <= interval, "window");
        require(maxPremiumBps <= rule.maxPremiumCapBps, "premium");
        require(minConfidence >= confidenceFloor && minConfidence <= 100, "confidence");
        require(budget >= amountPerRun, "budget");
        require(firstRun >= block.timestamp, "start");
        require(expiry > firstRun, "expiry");

        planId = plans.length;
        plans.push(Plan(msg.sender, asset, amountPerRun, budget, 0, firstRun, expiry, interval, window, 0, maxPremiumBps, minConfidence, Status.Active));
        plansByOwner[msg.sender].push(planId);
        emit PlanCreated(planId, msg.sender, asset, amountPerRun, interval, firstRun, budget);
    }

    function pause(uint256 planId) external {
        Plan storage p = _own(planId);
        require(p.status == Status.Active, "status");
        p.status = Status.Paused;
        emit StatusChanged(planId, Status.Paused);
    }

    /// @notice Resumes a paused plan. If its window already passed, it restarts from the next slot, never retroactively.
    function resume(uint256 planId) external {
        Plan storage p = _own(planId);
        require(p.status == Status.Paused, "status");
        if (block.timestamp > uint256(p.nextRun) + p.window) p.nextRun = _nextSlot(p);
        p.status = Status.Active;
        emit StatusChanged(planId, Status.Active);
    }

    /// @notice Permanently stops a plan (S5). Revoke the loan-token approval in the same transaction from the app.
    function cancel(uint256 planId) external {
        Plan storage p = _own(planId);
        require(p.status != Status.Cancelled, "status");
        p.status = Status.Cancelled;
        emit StatusChanged(planId, Status.Cancelled);
    }

    // ---------------------------------------------------------------- execution (permissionless)

    /// @notice Runs one installment if, and only if, every guard condition holds.
    function execute(uint256 planId) external nonReentrant returns (uint256 bought) {
        Plan storage p = plans[planId];
        require(p.status == Status.Active, "not active");
        require(block.timestamp >= p.nextRun, "too early");
        require(block.timestamp <= uint256(p.nextRun) + p.window, "window closed");
        require(block.timestamp <= p.expiry, "expired");
        require(assets[p.asset].allowed, "asset");
        uint256 amount = p.amountPerRun;
        require(amount <= maxPerRun, "amount");
        require(uint256(p.spent) + amount <= p.budget, "budget"); // S2

        // guard: fresh price, enough confidence (S4)
        (uint256 price, uint8 confidence, uint64 updatedAt) = oracle.getPrice(p.asset);
        require(price > 0, "no price");
        require(block.timestamp - updatedAt <= maxOracleAge, "stale price");
        require(confidence >= p.minConfidence, "low confidence");

        // the least the venue may deliver: amount / (fair value * (1 + max premium)), rounded up so the bound is strict (S1)
        uint256 value = (amount * WAD) / (10 ** loanToken.decimals()); // loan token is worth $1
        uint256 maxPrice = (price * (BPS + p.maxPremiumBps) + BPS - 1) / BPS;
        uint256 minOut = (value * WAD + maxPrice - 1) / maxPrice;

        // effects first
        p.spent += uint128(amount);
        p.runs += 1;
        p.nextRun += p.interval;
        address who = p.owner;
        address asset = p.asset;

        // interactions: pull one installment, buy, hand the asset to the owner. Nothing stays in this contract.
        require(loanToken.transferFrom(who, address(this), amount), "pull");
        require(loanToken.approve(address(venue), amount), "approve");
        uint256 before = IStackToken(asset).balanceOf(address(this));
        bought = venue.buy(asset, amount, minOut, address(this));
        require(loanToken.approve(address(venue), 0), "approve reset");
        uint256 received = IStackToken(asset).balanceOf(address(this)) - before;
        require(received >= minOut && bought >= minOut && received >= bought, "price too high"); // S1
        require(IStackToken(asset).transfer(who, received), "deliver"); // S6: only to the plan owner

        // paid price vs fair value, for the record
        uint256 paid = (value * WAD) / received; // USD per token
        uint256 premium = paid > price ? ((paid - price) * BPS) / price : 0;
        emit Executed(planId, who, asset, amount, received, price, premium, p.runs);
        bought = received;
    }

    /// @notice If a plan's window passed without a fill, anyone can roll it to the next slot so it doesn't stall.
    function skip(uint256 planId) external {
        Plan storage p = plans[planId];
        require(p.status == Status.Active, "not active");
        require(block.timestamp > uint256(p.nextRun) + p.window, "window open");
        p.nextRun = _nextSlot(p);
        emit Skipped(planId, p.owner, p.nextRun);
    }

    // ---------------------------------------------------------------- views

    function planCount() external view returns (uint256) {
        return plans.length;
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return plans[planId];
    }

    function plansOf(address user) external view returns (uint256[] memory) {
        return plansByOwner[user];
    }

    /// @notice A page of plans, for the keeper and the app.
    function getPlans(uint256 offset, uint256 limit) external view returns (Plan[] memory out) {
        uint256 end = offset + limit > plans.length ? plans.length : offset + limit;
        if (offset >= end) return new Plan[](0);
        out = new Plan[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = plans[i];
    }

    /// @notice Whether a plan is inside its window and within budget and expiry (the guard still decides at execution).
    function isDue(uint256 planId) external view returns (bool) {
        Plan storage p = plans[planId];
        return p.status == Status.Active && block.timestamp >= p.nextRun && block.timestamp <= uint256(p.nextRun) + p.window && block.timestamp <= p.expiry && uint256(p.spent) + p.amountPerRun <= p.budget;
    }

    // ---------------------------------------------------------------- internal

    function _own(uint256 planId) internal view returns (Plan storage p) {
        p = plans[planId];
        require(p.owner == msg.sender, "not your plan");
    }

    /// @dev The first slot (nextRun plus a whole number of intervals) whose window has not closed yet.
    function _nextSlot(Plan storage p) internal view returns (uint40) {
        uint256 next = p.nextRun;
        if (block.timestamp > next + p.window) {
            uint256 missed = (block.timestamp - next - p.window) / p.interval + 1;
            next += missed * p.interval;
        }
        return uint40(next);
    }
}
