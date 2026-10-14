// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {NightshiftOracle} from "./NightshiftOracle.sol";

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title NightshiftVault: overcollateralised USDG loans against tokenized-ETF collateral.
/// @notice Follows Morpho Blue's risk rules (LLTV, health factor, liquidation incentive factor) and
///         adds two Nightshift features: borrow limits haircut by Oracle confidence, and an on-chain
///         Guardian that anyone may trigger to de-risk a borrower who opted in.
///         Testnet demo: no interest accrues, and the vault itself is the lender of USDG liquidity.
contract NightshiftVault {
    uint256 internal constant WAD = 1e18;
    uint256 public constant SLIPPAGE_WAD = 0.005e18; // Guardian sells collateral 0.5% below the Oracle price
    /// @notice Prices older than this are refused (the keeper normally pushes every few minutes, weekends included).
    uint256 public constant MAX_PRICE_AGE = 2 days;
    /// @notice Confidence the Vault uses falls by this much per full hour since the last price update, so a stalled
    ///         keeper shrinks borrow limits and then stops new borrowing (below MIN_BORROW_CONFIDENCE).
    uint256 public constant CONFIDENCE_DECAY_PER_HOUR = 1;
    /// @notice No new borrowing while the Oracle is this unsure (existing loans can still repay, add collateral or be protected).
    uint256 public constant MIN_BORROW_CONFIDENCE = 40;

    struct Market {
        bool enabled;
        uint256 lltv; // WAD, e.g. 0.77e18
    }

    struct Position {
        uint256 collateral;
        uint256 debt;
    }

    /// mode: 0 off, 1 alert (UI only), 2 auto-protect
    struct Rule {
        uint8 mode;
        uint256 trigger; // health factor, WAD
        uint256 target; // health factor, WAD
    }

    address public owner;
    IERC20 public immutable loanToken;
    uint256 private locked = 1;

    /// @dev One state-changing call at a time: token callbacks can't re-enter the Vault mid-update.
    modifier nonReentrant() {
        require(locked == 1, "reentrant");
        locked = 2;
        _;
        locked = 1;
    }
    NightshiftOracle public immutable oracle;

    mapping(address => Market) public markets;
    address[] public collaterals;
    mapping(address => mapping(address => Position)) public positions; // user => collateral => position
    mapping(address => mapping(address => Rule)) public rules; // user => collateral => rule

    struct Key {
        address user;
        address collateral;
    }
    Key[] internal keys;
    mapping(address => mapping(address => bool)) internal known;

    event MarketSet(address indexed collateral, uint256 lltv, bool enabled);
    event Deposit(address indexed user, address indexed collateral, uint256 amount);
    event Withdraw(address indexed user, address indexed collateral, uint256 amount);
    event Borrow(address indexed user, address indexed collateral, uint256 amount);
    event Repay(address indexed user, address indexed collateral, uint256 amount);
    event RuleSet(address indexed user, address indexed collateral, uint8 mode, uint256 trigger, uint256 target);
    event Protected(address indexed user, address indexed collateral, uint256 soldCollateral, uint256 repaidDebt, uint256 hfBefore, uint256 hfAfter);
    event Liquidated(address indexed user, address indexed collateral, address indexed liquidator, uint256 repaidDebt, uint256 seizedCollateral);

    constructor(IERC20 loanToken_, NightshiftOracle oracle_) {
        owner = msg.sender;
        loanToken = loanToken_;
        oracle = oracle_;
    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Hands every owner power (prices override, markets, roles) to a new address, e.g. the team's own wallet.
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "owner");
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------- admin

    function setMarket(address collateral, uint256 lltv, bool enabled) external {
        require(msg.sender == owner, "owner");
        require(lltv > 0 && lltv < WAD, "lltv");
        if (markets[collateral].lltv == 0) collaterals.push(collateral);
        markets[collateral] = Market(enabled, lltv);
        emit MarketSet(collateral, lltv, enabled);
    }

    // ---------------------------------------------------------------- views

    function _price(address collateral) internal view returns (uint256 price, uint8 confidence) {
        uint64 updatedAt;
        (price, confidence, updatedAt) = oracle.getPrice(collateral);
        require(price > 0, "no price");
        uint256 age = block.timestamp - updatedAt;
        require(age <= MAX_PRICE_AGE, "stale price");
        uint256 decay = (age / 1 hours) * CONFIDENCE_DECAY_PER_HOUR;
        confidence = decay >= confidence ? 0 : uint8(confidence - decay);
    }

    /// @notice Morpho Blue liquidation incentive factor: min(1.15, 1 / (0.3 * lltv + 0.7)).
    function lif(uint256 lltv) public pure returns (uint256) {
        uint256 v = (WAD * WAD) / ((3 * lltv) / 10 + (7 * WAD) / 10);
        return v > 1.15e18 ? 1.15e18 : v;
    }

    function collateralValue(address user, address collateral) public view returns (uint256) {
        (uint256 price, ) = _price(collateral);
        return (positions[user][collateral].collateral * price) / WAD;
    }

    /// @notice Health factor in WAD: collateral value * LLTV / debt. type(uint256).max when there is no debt.
    function healthFactor(address user, address collateral) public view returns (uint256) {
        Position memory p = positions[user][collateral];
        if (p.debt == 0) return type(uint256).max;
        return (collateralValue(user, collateral) * markets[collateral].lltv) / p.debt;
    }

    /// @notice Nightshift borrow limit: value * LLTV * (1 - (100 - confidence) / 200).
    function borrowLimit(address user, address collateral) public view returns (uint256) {
        (uint256 price, uint8 confidence) = _price(collateral);
        uint256 value = (positions[user][collateral].collateral * price) / WAD;
        uint256 haircut = WAD - ((100 - uint256(confidence)) * WAD) / 200;
        return (((value * markets[collateral].lltv) / WAD) * haircut) / WAD;
    }

    function positionCount() external view returns (uint256) {
        return keys.length;
    }

    function collateralCount() external view returns (uint256) {
        return collaterals.length;
    }

    /// @notice Paged list of every (user, collateral) pair that ever deposited, for keepers and UIs.
    function getPositions(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory users, address[] memory cols, uint256[] memory collateralAmounts, uint256[] memory debts)
    {
        uint256 end = offset + limit > keys.length ? keys.length : offset + limit;
        uint256 n = end > offset ? end - offset : 0;
        users = new address[](n);
        cols = new address[](n);
        collateralAmounts = new uint256[](n);
        debts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            Key memory k = keys[offset + i];
            users[i] = k.user;
            cols[i] = k.collateral;
            collateralAmounts[i] = positions[k.user][k.collateral].collateral;
            debts[i] = positions[k.user][k.collateral].debt;
        }
    }

    // ---------------------------------------------------------------- borrower actions

    function deposit(address collateral, uint256 amount) external nonReentrant {
        require(markets[collateral].enabled, "market");
        require(amount > 0, "amount");
        require(IERC20(collateral).transferFrom(msg.sender, address(this), amount), "transfer");
        positions[msg.sender][collateral].collateral += amount;
        if (!known[msg.sender][collateral]) {
            known[msg.sender][collateral] = true;
            keys.push(Key(msg.sender, collateral));
        }
        emit Deposit(msg.sender, collateral, amount);
    }

    function borrow(address collateral, uint256 amount) external nonReentrant {
        require(markets[collateral].enabled, "market");
        (, uint8 confidence) = _price(collateral);
        require(confidence >= MIN_BORROW_CONFIDENCE, "low confidence");
        Position storage p = positions[msg.sender][collateral];
        p.debt += amount;
        require(p.debt <= borrowLimit(msg.sender, collateral), "over limit");
        require(loanToken.transfer(msg.sender, amount), "liquidity");
        emit Borrow(msg.sender, collateral, amount);
    }

    function repay(address collateral, uint256 amount) external nonReentrant {
        Position storage p = positions[msg.sender][collateral];
        if (amount > p.debt) amount = p.debt;
        p.debt -= amount;
        require(loanToken.transferFrom(msg.sender, address(this), amount), "transfer");
        emit Repay(msg.sender, collateral, amount);
    }

    function withdraw(address collateral, uint256 amount) external nonReentrant {
        Position storage p = positions[msg.sender][collateral];
        require(amount <= p.collateral, "amount");
        p.collateral -= amount;
        if (p.debt > 0) require(healthFactor(msg.sender, collateral) >= 1.1e18, "health");
        require(IERC20(collateral).transfer(msg.sender, amount), "transfer");
        emit Withdraw(msg.sender, collateral, amount);
    }

    /// @notice Opt in to (or out of) Guardian protection for one position.
    function setRule(address collateral, uint8 mode, uint256 trigger, uint256 target) external {
        require(mode <= 2, "mode");
        if (mode == 2) require(trigger > WAD && target >= trigger + 0.05e18 && target <= 5e18, "levels");
        rules[msg.sender][collateral] = Rule(mode, trigger, target);
        emit RuleSet(msg.sender, collateral, mode, trigger, target);
    }

    // ---------------------------------------------------------------- guardian + liquidation

    /// @notice Guardian auto-protect. Callable by anyone, but only acts within the borrower's own rule:
    ///         when HF < trigger, sells just enough collateral to the vault (0.5% below the Oracle price)
    ///         to repay debt and restore HF to the target. Solves
    ///         k = (P*u*L - T*D) / (P*(L - T*(1 - s))).
    function protect(address user, address collateral) external nonReentrant returns (uint256 sold, uint256 repaid) {
        Rule memory r = rules[user][collateral];
        require(r.mode == 2, "not opted in");
        Position storage p = positions[user][collateral];
        uint256 hfBefore = healthFactor(user, collateral);
        require(hfBefore < r.trigger, "healthy");
        require(hfBefore >= WAD, "liquidatable");

        (uint256 price, ) = _price(collateral);
        uint256 lltv = markets[collateral].lltv;
        uint256 sellPrice = (price * (WAD - SLIPPAGE_WAD)) / WAD;
        // G4 (formal/Nightshift/Guardian.lean): if the collateral, sold at the slippage price, can't cover
        // the debt, every sale lowers health further. The Guardian must alert, not sell.
        require((p.collateral * sellPrice) / WAD > p.debt, "insolvent: alert only");
        // all quantities in WAD
        uint256 numer = (((price * p.collateral) / WAD) * lltv) / WAD; // P*u*L
        uint256 tD = (r.target * p.debt) / WAD; // T*D
        uint256 denomFactor = (r.target * (WAD - SLIPPAGE_WAD)) / WAD; // T*(1-s)
        require(denomFactor > lltv, "target");
        // numer < tD whenever HF < target, so k = (tD - numer) / (P*(T(1-s) - L))
        uint256 k = ((tD - numer) * WAD) / ((price * (denomFactor - lltv)) / WAD);
        if (k > p.collateral) k = p.collateral;
        repaid = (k * sellPrice) / WAD;
        if (repaid > p.debt) {
            repaid = p.debt;
            k = (repaid * WAD) / sellPrice;
        }
        p.collateral -= k;
        p.debt -= repaid;
        sold = k;
        emit Protected(user, collateral, sold, repaid, hfBefore, healthFactor(user, collateral));
    }

    /// @notice Morpho-style liquidation of an unhealthy position (HF < 1).
    function liquidate(address user, address collateral, uint256 repayAmount) external nonReentrant returns (uint256 seized) {
        require(healthFactor(user, collateral) < WAD, "healthy");
        Position storage p = positions[user][collateral];
        if (repayAmount > p.debt) repayAmount = p.debt;
        (uint256 price, ) = _price(collateral);
        seized = (repayAmount * lif(markets[collateral].lltv)) / price;
        if (seized > p.collateral) seized = p.collateral;
        p.debt -= repayAmount;
        p.collateral -= seized;
        require(loanToken.transferFrom(msg.sender, address(this), repayAmount), "transfer");
        require(IERC20(collateral).transfer(msg.sender, seized), "transfer");
        emit Liquidated(user, collateral, msg.sender, repayAmount, seized);
    }
}
