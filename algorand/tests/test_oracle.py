"""NightshiftOracle (Algorand) unit tests, run offline with algorand-python-testing: `uv run pytest`."""

from collections.abc import Iterator

import pytest
from algopy import Account, UInt64, arc4
from algopy_testing import AlgopyTestContext, algopy_testing_context

from contracts.oracle import NightshiftOracle

SPY = 755_840_000  # $755.84 in micro-USD


@pytest.fixture()
def ctx() -> Iterator[AlgopyTestContext]:
    with algopy_testing_context() as c:
        c.ledger.patch_global_fields(latest_timestamp=1_793_000_000)
        yield c


def arrays(symbols: list[str], prices: list[int], confs: list[int]):
    return (
        arc4.DynamicArray[arc4.String](*[arc4.String(s) for s in symbols]),
        arc4.DynamicArray[arc4.UInt64](*[arc4.UInt64(p) for p in prices]),
        arc4.DynamicArray[arc4.UInt8](*[arc4.UInt8(c) for c in confs]),
    )


def push(ctx: AlgopyTestContext, oracle: NightshiftOracle, sender: Account, symbols, prices, confs, force=False) -> int:
    with ctx.txn.create_group(active_txn_overrides={"sender": sender}):
        method = oracle.force_set_prices if force else oracle.set_prices
        return int(method(*arrays(symbols, prices, confs)))


def price(oracle: NightshiftOracle, symbol: str) -> tuple[int, int, int]:
    f = oracle.get_price(arc4.String(symbol))
    return int(f.price.as_uint64()), int(f.confidence.as_uint64()), int(f.updated_at.as_uint64())


def test_creator_is_owner_and_updater(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    assert oracle.owner == ctx.default_sender
    assert oracle.updater == ctx.default_sender
    assert oracle.max_move_bps == 1500


def test_first_push_writes_price_confidence_and_time(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    assert push(ctx, oracle, ctx.default_sender, ["SPY", "GLD"], [SPY, 356_280_000], [84, 82]) == 2
    assert price(oracle, "SPY") == (SPY, 84, 1_793_000_000)
    assert price(oracle, "GLD")[0] == 356_280_000


def test_unknown_symbol_reads_as_zero(ctx: AlgopyTestContext) -> None:
    assert price(NightshiftOracle(), "QQQ") == (0, 0, 0)


def test_move_above_limit_is_skipped(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    push(ctx, oracle, ctx.default_sender, ["SPY"], [SPY], [84])
    too_far = SPY * 116 // 100  # +16% > 15%
    assert push(ctx, oracle, ctx.default_sender, ["SPY"], [too_far], [80]) == 0
    assert price(oracle, "SPY")[0] == SPY


def test_move_exactly_at_limit_is_written(ctx: AlgopyTestContext) -> None:
    # the Solidity rule skips only when diff * 10_000 > prev * maxMoveBps, so exactly 15% passes
    oracle = NightshiftOracle()
    push(ctx, oracle, ctx.default_sender, ["SPY"], [1_000_000_000], [84])
    assert push(ctx, oracle, ctx.default_sender, ["SPY"], [850_000_000], [70]) == 1
    assert price(oracle, "SPY")[:2] == (850_000_000, 70)


def test_skip_is_per_symbol(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    push(ctx, oracle, ctx.default_sender, ["SPY", "GLD"], [SPY, 356_280_000], [84, 82])
    assert push(ctx, oracle, ctx.default_sender, ["SPY", "GLD"], [SPY * 2, 357_000_000], [84, 82]) == 1
    assert price(oracle, "SPY")[0] == SPY
    assert price(oracle, "GLD")[0] == 357_000_000


def test_owner_can_force_a_large_move(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    push(ctx, oracle, ctx.default_sender, ["SPY"], [SPY], [84])
    assert push(ctx, oracle, ctx.default_sender, ["SPY"], [SPY // 2], [40], force=True) == 1
    assert price(oracle, "SPY")[0] == SPY // 2


def test_only_the_updater_can_push(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    stranger = ctx.any.account()
    with pytest.raises(AssertionError, match="updater"):
        push(ctx, oracle, stranger, ["SPY"], [SPY], [84])


def test_only_the_owner_can_force(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    keeper = ctx.any.account()
    with ctx.txn.create_group(active_txn_overrides={"sender": ctx.default_sender}):
        oracle.set_updater(keeper)
    assert push(ctx, oracle, keeper, ["SPY"], [SPY], [84]) == 1  # the new updater can push
    with pytest.raises(AssertionError, match="owner"):
        push(ctx, oracle, keeper, ["SPY"], [SPY // 2], [40], force=True)
    with pytest.raises(AssertionError, match="updater"):
        push(ctx, oracle, ctx.default_sender, ["SPY"], [SPY], [84])  # the owner is no longer the updater


@pytest.mark.parametrize(
    ("symbols", "prices", "confs", "message"),
    [
        (["SPY"], [0], [84], "value"),
        (["SPY"], [SPY], [101], "value"),
        (["SPY", "GLD"], [SPY], [84], "length"),
        (["THIRTEENCHARS"], [SPY], [84], "symbol"),
        ([""], [SPY], [84], "symbol"),
    ],
)
def test_bad_input_is_rejected(ctx: AlgopyTestContext, symbols, prices, confs, message) -> None:
    oracle = NightshiftOracle()
    with pytest.raises(AssertionError, match=message):
        push(ctx, oracle, ctx.default_sender, symbols, prices, confs)


def test_max_move_bounds_and_owner_only(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    for bad in (99, 10_001):
        with ctx.txn.create_group(active_txn_overrides={"sender": ctx.default_sender}), pytest.raises(AssertionError, match="bps"):
            oracle.set_max_move_bps(UInt64(bad))
    with ctx.txn.create_group(active_txn_overrides={"sender": ctx.any.account()}), pytest.raises(AssertionError, match="owner"):
        oracle.set_max_move_bps(UInt64(500))
    with ctx.txn.create_group(active_txn_overrides={"sender": ctx.default_sender}):
        oracle.set_max_move_bps(UInt64(500))
    assert oracle.max_move_bps == 500


def test_ownership_transfer(ctx: AlgopyTestContext) -> None:
    oracle = NightshiftOracle()
    team = ctx.any.account()
    with ctx.txn.create_group(active_txn_overrides={"sender": ctx.default_sender}):
        oracle.transfer_ownership(team)
    assert oracle.owner == team
    with ctx.txn.create_group(active_txn_overrides={"sender": ctx.default_sender}), pytest.raises(AssertionError, match="owner"):
        oracle.transfer_ownership(ctx.default_sender)
