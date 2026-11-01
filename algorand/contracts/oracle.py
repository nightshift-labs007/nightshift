"""NightshiftOracle for Algorand: the on-chain store of Nightshift's off-chain fair values.

Port of contracts/NightshiftOracle.sol. An authorised updater (the keeper) pushes a fair value and a confidence per
symbol. A single update may move a price by at most `max_move_bps`; larger moves are skipped and must be confirmed by
the owner with `force_set_prices`, so one bad push cannot trigger mass liquidations.

Feeds live in global state (key b"p:" + symbol) rather than boxes, so other apps (the Vault) can read them for free
with app_global_get_ex. Prices are USD with 6 decimals (micro-USD), so 755.84 is stored as 755_840_000.
"""

from algopy import ARC4Contract, Account, Bytes, Global, StateTotals, Txn, UInt64, arc4, op, subroutine, urange

MAX_FEEDS = 24  # global state is fixed at creation; each slot locks 0.05 ALGO, and 24 leaves room for new markets
FEED_PREFIX = b"p:"


class Feed(arc4.Struct, frozen=True):
    price: arc4.UInt64  # micro-USD per token
    confidence: arc4.UInt8  # 0-100
    updated_at: arc4.UInt64  # unix seconds, the block's timestamp


class PriceUpdated(arc4.Struct):
    symbol: arc4.String
    price: arc4.UInt64
    confidence: arc4.UInt8
    updated_at: arc4.UInt64


class PriceSkipped(arc4.Struct):
    symbol: arc4.String
    previous: arc4.UInt64
    proposed: arc4.UInt64


class NightshiftOracle(ARC4Contract, state_totals=StateTotals(global_bytes=MAX_FEEDS + 2, global_uints=1)):
    def __init__(self) -> None:
        self.owner = Txn.sender
        self.updater = Txn.sender
        self.max_move_bps = UInt64(1500)

    @arc4.abimethod
    def transfer_ownership(self, new_owner: Account) -> None:
        """Hands every owner power (price override, roles, limits) to a new account."""
        assert Txn.sender == self.owner, "owner"
        assert new_owner != Global.zero_address, "zero"
        self.owner = new_owner

    @arc4.abimethod
    def set_updater(self, updater: Account) -> None:
        assert Txn.sender == self.owner, "owner"
        assert updater != Global.zero_address, "zero"
        self.updater = updater

    @arc4.abimethod
    def set_max_move_bps(self, bps: UInt64) -> None:
        assert Txn.sender == self.owner, "owner"
        assert bps >= 100 and bps <= 10_000, "bps"
        self.max_move_bps = bps

    @arc4.abimethod
    def set_prices(
        self,
        symbols: arc4.DynamicArray[arc4.String],
        prices: arc4.DynamicArray[arc4.UInt64],
        confidences: arc4.DynamicArray[arc4.UInt8],
    ) -> UInt64:
        """Updater push, bounded by max_move_bps. Returns how many prices were written (the rest were skipped)."""
        assert Txn.sender == self.updater, "updater"
        return self._set(symbols, prices, confidences, bounded=True)

    @arc4.abimethod
    def force_set_prices(
        self,
        symbols: arc4.DynamicArray[arc4.String],
        prices: arc4.DynamicArray[arc4.UInt64],
        confidences: arc4.DynamicArray[arc4.UInt8],
    ) -> UInt64:
        """Owner override for a genuine move larger than max_move_bps (e.g. a real crash)."""
        assert Txn.sender == self.owner, "owner"
        return self._set(symbols, prices, confidences, bounded=False)

    @arc4.abimethod(readonly=True)
    def get_price(self, symbol: arc4.String) -> Feed:
        """The latest feed for a symbol; price 0 means no price has ever been set."""
        raw, exists = op.AppGlobal.get_ex_bytes(Global.current_application_id, feed_key(symbol))
        if exists:
            return Feed.from_bytes(raw)
        return Feed(arc4.UInt64(0), arc4.UInt8(0), arc4.UInt64(0))

    @subroutine
    def _set(
        self,
        symbols: arc4.DynamicArray[arc4.String],
        prices: arc4.DynamicArray[arc4.UInt64],
        confidences: arc4.DynamicArray[arc4.UInt8],
        bounded: bool,
    ) -> UInt64:
        assert symbols.length == prices.length and prices.length == confidences.length, "length"
        written = UInt64(0)
        for i in urange(symbols.length):
            price = prices[i].as_uint64()
            confidence = confidences[i].as_uint64()
            assert price > 0 and confidence <= 100, "value"
            key = feed_key(symbols[i])
            raw, exists = op.AppGlobal.get_ex_bytes(Global.current_application_id, key)
            if bounded and exists:
                prev = Feed.from_bytes(raw).price.as_uint64()
                diff = price - prev if price > prev else prev - price
                if diff * 10_000 > prev * self.max_move_bps:
                    arc4.emit(PriceSkipped(symbols[i], arc4.UInt64(prev), prices[i]))
                    continue
            now = arc4.UInt64(Global.latest_timestamp)
            op.AppGlobal.put(key, Feed(prices[i], confidences[i], now).bytes)
            arc4.emit(PriceUpdated(symbols[i], prices[i], confidences[i], now))
            written += 1
        return written


@subroutine
def feed_key(symbol: arc4.String) -> Bytes:
    name = symbol.native.bytes
    assert name.length >= 1 and name.length <= 12, "symbol"
    return Bytes(FEED_PREFIX) + name
