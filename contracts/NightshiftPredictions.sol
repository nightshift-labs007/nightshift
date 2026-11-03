// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPredictToken {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice The slice of Pyth's EVM interface used to settle a round from a signed price at the open.
interface IPythLike {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }
    struct PriceFeed {
        bytes32 id;
        Price price;
        Price emaPrice;
    }
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256);
    function parsePriceFeedUpdates(bytes[] calldata updateData, bytes32[] calldata priceIds, uint64 minPublishTime, uint64 maxPublishTime)
        external
        payable
        returns (PriceFeed[] memory);
}

/// @title NightshiftPredictions: "Call the Open". Bet whether an ETF opens Higher or Lower than Nightshift's call.
/// @notice Each round is one ETF and one New York trading session. The strike is Nightshift's call for that open, locked
///         on Algorand when the round is created. Registered wallets stake the test loan token on Higher or Lower until
///         `lockTime`. After the open the result settles from the opening price:
///           - Pyth path: anyone submits Pyth's signed price published in the open window (switched on per token).
///           - Optimistic path: an operator proposes the opening price; any registered wallet may dispute within the
///             challenge window; undisputed proposals finalize; the arbiter decides disputes.
///         Settlement is parimutuel. Winners get their stake back plus the losing pool (after the fee) split by
///         time-weighted shares: a stake placed when the round opens counts 1.00, falling linearly to `minWeightBps`
///         at lock, so late bets made with more information earn less. A tie, a one-sided round or a round nobody
///         settles within `cancelAfter` of the open is refunded in full. Nothing here moves user funds except bet()
///         (pull from the bettor) and claim() (pay the bettor); funds are never held for anyone else.
///
///         Testnet game: the stake token has no value. Properties P1 to P5 are mirrored in scripts/test-predictions.mjs:
///         P1 payouts never exceed what was staked in the round; P2 every winner gets at least their stake back;
///         P3 refunds return exact stakes; P4 a position is paid once; P5 only registered wallets can bet.
contract NightshiftPredictions {
    uint256 internal constant BPS = 10_000;

    enum Status {
        None,
        Open,
        Proposed,
        Settled,
        Cancelled
    }
    enum Side {
        None,
        Higher,
        Lower
    }
    enum Outcome {
        None,
        Higher,
        Lower,
        Refund
    }

    struct Round {
        bytes8 token; // "SPY"
        uint32 session; // target open, YYYYMMDD in New York
        uint64 strike; // Nightshift's call, 8 decimals
        uint64 openPrice; // the opening price, 8 decimals (set when proposed or settled)
        uint40 openTime; // betting opens
        uint40 lockTime; // betting closes
        uint40 marketOpen; // the open the round is about
        uint40 proposedAt;
        Status status;
        Outcome outcome;
        bool disputed;
        uint128 stakeHigher;
        uint128 stakeLower;
        uint128 sharesHigher;
        uint128 sharesLower;
        uint128 fee; // taken from the losing pool at settlement
        bytes32 algorandTx; // the Algorand stamp that carries the same strike
    }

    struct Position {
        Side side;
        bool claimed;
        uint128 stake;
        uint128 shares;
    }

    address public owner;
    address public arbiter; // decides disputed rounds (a multisig before any real-value use)
    address public treasury;
    IPredictToken public immutable stakeToken;
    IPythLike public pyth; // zero = Pyth path off
    mapping(bytes8 => bytes32) public pythFeed; // token → Pyth price id
    mapping(address => bool) public isOperator; // the keeper: creates rounds, proposes results, syncs members
    mapping(address => bool) public isMember; // registered Nightshift users (synced from sign-up)
    bool public paused;

    uint256 public maxBet; // per bet()
    uint256 public maxPerWallet; // per round
    uint256 public challengeWindow; // seconds a proposal can be disputed
    uint256 public cancelAfter; // after the open, anyone may cancel an unsettled round
    uint256 public pythWindow; // seconds after the open a Pyth price may be published and still count
    uint16 public minWeightBps; // share weight of a bet placed at lock
    uint16 public feeBps; // of the losing pool; capped at MAX_FEE_BPS
    uint16 public constant MAX_FEE_BPS = 300;

    Round[] internal rounds;
    mapping(bytes32 => uint256) internal roundIndex; // keccak(token, session) → id + 1
    mapping(uint256 => mapping(address => Position)) public positions;
    uint256 public feesOwed;

    uint256 private _lock = 1;

    event RoundCreated(uint256 indexed id, bytes8 indexed token, uint32 session, uint64 strike, uint40 openTime, uint40 lockTime, uint40 marketOpen, bytes32 algorandTx);
    event Bet(uint256 indexed id, address indexed user, Side side, uint256 amount, uint256 shares);
    event Proposed(uint256 indexed id, uint64 openPrice, address proposer);
    event Disputed(uint256 indexed id, address indexed by);
    event Settled(uint256 indexed id, Outcome outcome, uint64 openPrice, uint256 fee);
    event Cancelled(uint256 indexed id);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event MembersSet(address[] users, bool allowed);
    event OperatorSet(address indexed operator, bool allowed);
    event ArbiterSet(address indexed arbiter);
    event LimitsSet(uint256 maxBet, uint256 maxPerWallet, uint256 challengeWindow, uint256 cancelAfter, uint16 minWeightBps);
    event FeeSet(uint16 feeBps, address treasury);
    event PythSet(address pyth, uint256 pythWindow);
    event PythFeedSet(bytes8 indexed token, bytes32 feedId);
    event PausedSet(bool paused);
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
    modifier onlyOperator() {
        require(isOperator[msg.sender], "operator");
        _;
    }

    constructor(IPredictToken stakeToken_, address operator) {
        owner = msg.sender;
        arbiter = msg.sender;
        treasury = msg.sender;
        stakeToken = stakeToken_;
        isOperator[operator] = true;
        maxBet = 1_000e18;
        maxPerWallet = 5_000e18;
        challengeWindow = 2 hours;
        cancelAfter = 24 hours;
        pythWindow = 60;
        minWeightBps = 5_000;
        emit OperatorSet(operator, true);
    }

    // ---------------------------------------------------------------- admin

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        isOperator[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    function setArbiter(address arbiter_) external onlyOwner {
        require(arbiter_ != address(0), "zero");
        arbiter = arbiter_;
        emit ArbiterSet(arbiter_);
    }

    function setLimits(uint256 maxBet_, uint256 maxPerWallet_, uint256 challengeWindow_, uint256 cancelAfter_, uint16 minWeightBps_) external onlyOwner {
        require(maxBet_ > 0 && maxPerWallet_ >= maxBet_, "limits");
        require(challengeWindow_ <= 2 days && cancelAfter_ >= challengeWindow_ + 1 hours, "windows");
        require(minWeightBps_ > 0 && minWeightBps_ <= BPS, "weight");
        maxBet = maxBet_;
        maxPerWallet = maxPerWallet_;
        challengeWindow = challengeWindow_;
        cancelAfter = cancelAfter_;
        minWeightBps = minWeightBps_;
        emit LimitsSet(maxBet_, maxPerWallet_, challengeWindow_, cancelAfter_, minWeightBps_);
    }

    function setFee(uint16 feeBps_, address treasury_) external onlyOwner {
        require(feeBps_ <= MAX_FEE_BPS, "fee");
        require(treasury_ != address(0), "zero");
        feeBps = feeBps_;
        treasury = treasury_;
        emit FeeSet(feeBps_, treasury_);
    }

    function setPyth(IPythLike pyth_, uint256 pythWindow_) external onlyOwner {
        require(pythWindow_ > 0 && pythWindow_ <= 10 minutes, "window");
        pyth = pyth_;
        pythWindow = pythWindow_;
        emit PythSet(address(pyth_), pythWindow_);
    }

    function setPythFeed(bytes8 token, bytes32 feedId) external onlyOwner {
        pythFeed[token] = feedId;
        emit PythFeedSet(token, feedId);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function withdrawFees() external {
        uint256 amount = feesOwed;
        feesOwed = 0;
        require(stakeToken.transfer(treasury, amount), "transfer");
    }

    // ---------------------------------------------------------------- operator

    /// @notice Adds or removes registered wallets. Only registered wallets may bet or dispute.
    function setMembers(address[] calldata users, bool allowed) external onlyOperator {
        for (uint256 i; i < users.length; i++) isMember[users[i]] = allowed;
        emit MembersSet(users, allowed);
    }

    /// @notice Opens one round per token for a session. Reverts if any of them already exists.
    function createRounds(bytes8[] calldata tokens, uint64[] calldata strikes, uint32 session, uint40 openTime, uint40 lockTime, uint40 marketOpen, bytes32 algorandTx)
        external
        onlyOperator
        returns (uint256 firstId)
    {
        require(tokens.length == strikes.length && tokens.length > 0, "length");
        require(openTime < lockTime && lockTime <= marketOpen && lockTime > block.timestamp, "times");
        firstId = rounds.length;
        for (uint256 i; i < tokens.length; i++) {
            require(strikes[i] > 0, "strike");
            bytes32 key = keccak256(abi.encode(tokens[i], session));
            require(roundIndex[key] == 0, "exists");
            Round storage r = rounds.push();
            r.token = tokens[i];
            r.session = session;
            r.strike = strikes[i];
            r.openTime = openTime;
            r.lockTime = lockTime;
            r.marketOpen = marketOpen;
            r.status = Status.Open;
            r.algorandTx = algorandTx;
            roundIndex[key] = rounds.length;
            emit RoundCreated(rounds.length - 1, tokens[i], session, strikes[i], openTime, lockTime, marketOpen, algorandTx);
        }
    }

    /// @notice Proposes the opening price after the open. Final after `challengeWindow` unless disputed.
    function propose(uint256 id, uint64 openPrice) external onlyOperator {
        Round storage r = _round(id);
        require(r.status == Status.Open, "status");
        require(block.timestamp >= r.marketOpen, "too early");
        require(openPrice > 0, "price");
        r.openPrice = openPrice;
        r.proposedAt = uint40(block.timestamp);
        r.status = Status.Proposed;
        emit Proposed(id, openPrice, msg.sender);
    }

    // ---------------------------------------------------------------- users

    /// @notice Stakes `amount` on Higher or Lower. A wallet backs one side per round and may add to it until lock.
    function bet(uint256 id, Side side, uint256 amount) external nonReentrant {
        require(!paused, "paused");
        require(isMember[msg.sender], "not registered");
        require(side == Side.Higher || side == Side.Lower, "side");
        Round storage r = _round(id);
        require(r.status == Status.Open && block.timestamp >= r.openTime && block.timestamp < r.lockTime, "closed");
        require(amount > 0 && amount <= maxBet, "amount");
        Position storage p = positions[id][msg.sender];
        require(p.side == Side.None || p.side == side, "other side");
        require(uint256(p.stake) + amount <= maxPerWallet, "wallet cap");

        uint256 shares = (amount * weightAt(id, block.timestamp)) / BPS;
        require(shares > 0, "amount");
        p.side = side;
        p.stake += uint128(amount);
        p.shares += uint128(shares);
        if (side == Side.Higher) {
            r.stakeHigher += uint128(amount);
            r.sharesHigher += uint128(shares);
        } else {
            r.stakeLower += uint128(amount);
            r.sharesLower += uint128(shares);
        }
        require(stakeToken.transferFrom(msg.sender, address(this), amount), "transfer");
        emit Bet(id, msg.sender, side, amount, shares);
    }

    /// @notice A registered wallet flags a proposed price as wrong; the arbiter then decides.
    function dispute(uint256 id) external {
        require(isMember[msg.sender], "not registered");
        Round storage r = _round(id);
        require(r.status == Status.Proposed && block.timestamp < uint256(r.proposedAt) + challengeWindow, "not disputable");
        require(!r.disputed, "disputed");
        r.disputed = true;
        emit Disputed(id, msg.sender);
    }

    /// @notice Anyone settles an undisputed proposal once the challenge window has passed.
    function finalize(uint256 id) public {
        Round storage r = _round(id);
        require(r.status == Status.Proposed && !r.disputed, "status");
        require(block.timestamp >= uint256(r.proposedAt) + challengeWindow, "challenge open");
        _settle(id, r.openPrice);
    }

    function finalizeMany(uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; i++) finalize(ids[i]);
    }

    /// @notice Trustless path: settles from Pyth's signed price published within `pythWindow` seconds of the open.
    function resolveWithPyth(uint256 id, bytes[] calldata updateData) external payable nonReentrant {
        require(address(pyth) != address(0), "pyth off");
        Round storage r = _round(id);
        require(r.status == Status.Open || (r.status == Status.Proposed && !r.disputed), "status");
        bytes32 feed = pythFeed[r.token];
        require(feed != bytes32(0), "no feed");
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = feed;
        uint256 fee = pyth.getUpdateFee(updateData);
        require(msg.value >= fee, "pyth fee");
        IPythLike.PriceFeed[] memory feeds = pyth.parsePriceFeedUpdates{value: fee}(updateData, ids, uint64(r.marketOpen), uint64(r.marketOpen + pythWindow));
        require(feeds.length == 1 && feeds[0].id == feed, "feed");
        _settle(id, _to8Decimals(feeds[0].price.price, feeds[0].price.expo));
        if (msg.value > fee) {
            (bool ok, ) = msg.sender.call{value: msg.value - fee}("");
            require(ok, "refund");
        }
    }

    /// @notice The arbiter decides a round: an opening price, or cancel (full refunds).
    function arbitrate(uint256 id, uint64 openPrice, bool cancelRound) external {
        require(msg.sender == arbiter, "arbiter");
        Round storage r = _round(id);
        require(r.status == Status.Open || r.status == Status.Proposed, "status");
        if (cancelRound) return _cancel(id);
        require(block.timestamp >= r.marketOpen, "too early");
        require(openPrice > 0, "price");
        _settle(id, openPrice);
    }

    /// @notice Anyone may cancel a round nobody settled within `cancelAfter` of the open.
    function cancel(uint256 id) external {
        Round storage r = _round(id);
        require(r.status == Status.Open || r.status == Status.Proposed, "status");
        require(block.timestamp >= uint256(r.marketOpen) + cancelAfter, "too early");
        _cancel(id);
    }

    /// @notice Pays every settled or cancelled round in `ids` that this wallet hasn't been paid for yet.
    function claim(uint256[] calldata ids) external nonReentrant returns (uint256 total) {
        for (uint256 i; i < ids.length; i++) {
            if (ids[i] >= rounds.length) continue;
            Position storage p = positions[ids[i]][msg.sender];
            if (p.stake == 0 || p.claimed) continue;
            Status s = rounds[ids[i]].status;
            if (s != Status.Settled && s != Status.Cancelled) continue;
            uint256 amount = _payout(ids[i], msg.sender);
            p.claimed = true;
            if (amount > 0) emit Claimed(ids[i], msg.sender, amount);
            total += amount;
        }
        require(total > 0, "nothing to claim");
        require(stakeToken.transfer(msg.sender, total), "transfer");
    }

    // ---------------------------------------------------------------- views

    function roundCount() external view returns (uint256) {
        return rounds.length;
    }

    function getRound(uint256 id) external view returns (Round memory) {
        return _round(id);
    }

    /// @notice The round id for a token and session, or type(uint256).max when there is none.
    function roundOf(bytes8 token, uint32 session) external view returns (uint256) {
        uint256 i = roundIndex[keccak256(abi.encode(token, session))];
        return i == 0 ? type(uint256).max : i - 1;
    }

    /// @notice Share weight in bps for a bet placed at `t`: BPS at openTime, falling linearly to minWeightBps at lockTime.
    function weightAt(uint256 id, uint256 t) public view returns (uint256) {
        Round storage r = _round(id);
        if (t <= r.openTime) return BPS;
        if (t >= r.lockTime) return minWeightBps;
        uint256 span = uint256(r.lockTime) - r.openTime;
        return BPS - ((BPS - minWeightBps) * (t - r.openTime)) / span;
    }

    /// @notice What `user` would be paid for round `id` (0 if open, lost, or already claimed).
    function payoutOf(uint256 id, address user) external view returns (uint256) {
        if (positions[id][user].claimed) return 0;
        return _payout(id, user);
    }

    // ---------------------------------------------------------------- internal

    function _round(uint256 id) internal view returns (Round storage) {
        require(id < rounds.length, "no round");
        return rounds[id];
    }

    function _settle(uint256 id, uint64 openPrice) internal {
        Round storage r = rounds[id];
        Outcome o;
        if (r.stakeHigher == 0 || r.stakeLower == 0 || openPrice == r.strike) o = Outcome.Refund;
        else o = openPrice > r.strike ? Outcome.Higher : Outcome.Lower;
        uint256 fee;
        if (o == Outcome.Higher) fee = (uint256(r.stakeLower) * feeBps) / BPS;
        else if (o == Outcome.Lower) fee = (uint256(r.stakeHigher) * feeBps) / BPS;
        r.openPrice = openPrice;
        r.outcome = o;
        r.fee = uint128(fee);
        r.status = Status.Settled;
        feesOwed += fee;
        emit Settled(id, o, openPrice, fee);
    }

    function _cancel(uint256 id) internal {
        Round storage r = rounds[id];
        r.status = Status.Cancelled;
        r.outcome = Outcome.Refund;
        emit Cancelled(id);
    }

    function _payout(uint256 id, address user) internal view returns (uint256) {
        if (id >= rounds.length) return 0;
        Round storage r = rounds[id];
        Position storage p = positions[id][user];
        if (p.stake == 0) return 0;
        if (r.status == Status.Cancelled || (r.status == Status.Settled && r.outcome == Outcome.Refund)) return p.stake;
        if (r.status != Status.Settled) return 0;
        bool won = (r.outcome == Outcome.Higher && p.side == Side.Higher) || (r.outcome == Outcome.Lower && p.side == Side.Lower);
        if (!won) return 0;
        uint256 losing = r.outcome == Outcome.Higher ? r.stakeLower : r.stakeHigher;
        uint256 winShares = r.outcome == Outcome.Higher ? r.sharesHigher : r.sharesLower;
        // P2: the stake comes back in full; the losing pool (after the fee) is split by time-weighted shares
        return uint256(p.stake) + ((losing - r.fee) * p.shares) / winShares;
    }

    function _to8Decimals(int64 price, int32 expo) internal pure returns (uint64) {
        require(price > 0, "price");
        uint256 v = uint256(uint64(price));
        int32 e = expo + 8;
        if (e >= 0) v = v * (10 ** uint32(e));
        else v = v / (10 ** uint32(-e));
        require(v > 0 && v <= type(uint64).max, "price");
        return uint64(v);
    }
}

/// @notice Test stand-in for Pyth: returns a preset price if the publish time falls in the requested window.
contract MockPyth {
    struct Feed {
        int64 price;
        int32 expo;
        uint256 publishTime;
    }
    mapping(bytes32 => Feed) public feeds;
    uint256 public fee = 1;

    function set(bytes32 id, int64 price, int32 expo, uint256 publishTime) external {
        feeds[id] = Feed(price, expo, publishTime);
    }

    function getUpdateFee(bytes[] calldata) external view returns (uint256) {
        return fee;
    }

    function parsePriceFeedUpdates(bytes[] calldata, bytes32[] calldata priceIds, uint64 minPublishTime, uint64 maxPublishTime)
        external
        payable
        returns (IPythLike.PriceFeed[] memory out)
    {
        require(msg.value >= fee, "fee");
        out = new IPythLike.PriceFeed[](priceIds.length);
        for (uint256 i; i < priceIds.length; i++) {
            Feed memory f = feeds[priceIds[i]];
            require(f.publishTime >= minPublishTime && f.publishTime <= maxPublishTime, "PriceFeedNotFoundWithinRange");
            IPythLike.Price memory p = IPythLike.Price(f.price, 0, f.expo, f.publishTime);
            out[i] = IPythLike.PriceFeed(priceIds[i], p, p);
        }
    }
}
