"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, parseEther, type Address } from "viem";
import { ABI, DEPLOYMENT, NETWORK, chainOf, chainTransport, isDeployed, sym, txUrl } from "@/lib/chain";
import type { OracleSnapshot } from "@/lib/oracle";
import { SIDE, algoTxUrl, payoutMultiple, weightAt, type PredictRound, type PredictState } from "@/lib/predictions-shared";
import { useWallet } from "@/lib/wallet";
import { useRegistered } from "./Member";
import { toast } from "./Toast";
import { signed, usd, useApi } from "./useApi";
import { WalletButton } from "./WalletButton";

type Me = {
  enabled: boolean;
  member: boolean;
  balance: number;
  allowance: number;
  positions: { id: number; side: "None" | "Higher" | "Lower"; claimed: boolean; stake: number; shares: number; owed: number }[];
};

/** Contract and wallet errors in plain English. */
function friendly(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  const msg = err.shortMessage ?? err.message ?? String(e);
  if (err.code === 4001 || err.cause?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(msg)) return "Cancelled in your wallet.";
  if (/insufficient funds|gas required exceeds/i.test(msg)) return `Not enough ETH on ${NETWORK} for gas (a few cents is enough).`;
  const reasons: [RegExp, string][] = [
    [/not registered/, "Your sign-up is still being added on-chain. Try again in a few minutes."],
    [/closed/, "Betting on this round has closed."],
    [/other side/, "You've already backed the other side of this round."],
    [/wallet cap/, "That's more than one wallet can stake on a round."],
    [/"amount"|: amount/, "That amount isn't allowed. Check the limits under the card."],
    [/paused/, "Betting is paused for a moment."],
    [/nothing to claim/, "Nothing to claim yet."],
    [/faucet cooldown/, `You can claim test ${sym("USDG")} once an hour. Try again a little later.`],
    [/allowance|balance/, `Not enough ${sym("USDG")}. Tap “Get test ${sym("USDG")}” first.`],
  ];
  for (const [re, text] of reasons) if (re.test(msg)) return text;
  return msg.slice(0, 180);
}

const ET = "America/New_York";
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ET });
const time = (unix: number) => new Date(unix * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ET }) + " ET";
function until(unix: number) {
  const m = Math.max(0, Math.round((unix * 1000 - Date.now()) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** The rounds that matter now: the newest session's rounds (betting, waiting for the open, or just settled). */
function currentRounds(rounds: PredictRound[]) {
  if (!rounds.length) return [];
  const latest = rounds.reduce((a, r) => (r.marketOpen > a ? r.marketOpen : a), 0);
  return rounds.filter((r) => r.marketOpen === latest).sort((a, b) => a.id - b.id);
}

export function PredictTab() {
  const wallet = useWallet();
  const account = wallet.account as Address | null;
  const registered = useRegistered(account);
  const chain = useMemo(() => (isDeployed ? chainOf() : null), []);
  const pub = useMemo(() => (chain ? createPublicClient({ chain, transport: chainTransport() }) : null), [chain]);
  const pm = DEPLOYMENT.predictions?.address as Address | undefined;
  const { data: state, error } = useApi<PredictState>("/api/predict", 20_000);
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const rounds = state?.rounds ?? [];
  const current = currentRounds(rounds);
  const ids = rounds.map((r) => r.id).join(",");
  const refreshMe = useCallback(async () => {
    if (!account || !ids) return setMe(null);
    const r = await fetch(`/api/predict/me?address=${account}&ids=${ids}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r && !r.error) setMe(r);
  }, [account, ids]);
  useEffect(() => {
    refreshMe();
    const id = setInterval(refreshMe, 20_000);
    return () => clearInterval(id);
  }, [refreshMe]);

  async function write(label: string, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) {
    if (!wallet.provider || !chain || !account || !pub) throw new Error("wallet");
    if ((await pub.getBalance({ address: account })) < 20_000_000_000_000n) throw new Error("insufficient funds for gas");
    await pub.simulateContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, account } as never);
    const client = createWalletClient({ chain, transport: custom(wallet.provider), account });
    const hash = await client.writeContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, chain } as never);
    setLastTx(hash);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} failed`);
    return hash;
  }

  async function placeBet(r: PredictRound, side: "Higher" | "Lower", amount: number) {
    if (!pm || !me) return;
    setBusy(`bet-${r.id}`);
    try {
      if (me.allowance < amount) {
        toast(`Step 1 of 2: allow the prediction contract to use your ${sym("USDG")} (up to ${fmt(state?.limits?.maxPerWallet ?? 5000, 0)}).`);
        await write("Allow", DEPLOYMENT.contracts.usdg, ABI.token, "approve", [pm, parseEther(String(Math.max(amount, state?.limits?.maxPerWallet ?? 5000)))]);
      }
      toast(`${me.allowance < amount ? "Step 2 of 2: " : ""}confirm your ${side} bet on ${r.token} in your wallet.`);
      await write("Bet", pm, ABI.predictions, "bet", [BigInt(r.id), SIDE[side], parseEther(String(amount))]);
      toast(`You're in: ${fmt(amount, 0)} ${sym("USDG")} on ${r.token} opening ${side.toLowerCase()} than our call.`, "ok");
      await refreshMe();
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy("");
    }
  }

  async function claimAll(list: number[]) {
    if (!pm) return;
    setBusy("claim");
    try {
      await write("Claim", pm, ABI.predictions, "claim", [list.map(BigInt)]);
      toast("Claimed. The tokens are in your wallet.", "ok");
      await refreshMe();
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy("");
    }
  }

  async function getFunds() {
    setBusy("faucet");
    try {
      await write(`Get test ${sym("USDG")}`, DEPLOYMENT.contracts.usdg, ABI.token, "faucet", []);
      toast(`Added test ${sym("USDG")} to your wallet.`, "ok");
      await refreshMe();
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy("");
    }
  }

  if (!pm) return <div className="panel">The prediction market isn&apos;t deployed on this network yet.</div>;
  if (!state) return <div className="skeleton">{error ? "Couldn't load the rounds. Retrying…" : "Loading rounds…"}</div>;

  const now = Date.now() / 1000;
  const lock = current[0]?.lockTime ?? 0;
  const betting = current.some((r) => r.status === "Open" && now < r.lockTime);
  const claimable = (me?.positions ?? []).filter((p) => p.owed > 0 && !p.claimed);
  const owedTotal = claimable.reduce((a, p) => a + p.owed, 0);
  const history = rounds.filter((r) => r.status === "Settled" || r.status === "Cancelled").slice(0, 15);
  const canBet = !!account && wallet.onTargetChain && registered === true && !!me?.member;

  return (
    <div className="pd">
      <div className={`panel pd-status ${betting ? "open" : ""}`}>
        <div>
          <p className="mono xs muted">CALL THE OPEN · TEST TOKENS, NO VALUE</p>
          <h2>{betting ? "Betting is open." : current.length ? "Betting is closed for this session." : "The first rounds open soon."}</h2>
          <p>
            Every evening at 20:00 ET, Nightshift locks its call for each ETF&apos;s next opening price on Algorand. Bet whether the real open comes
            in <b>higher</b> or <b>lower</b>. Winners split the pool; early bets count more.
          </p>
        </div>
        <div className="pd-status-side">
          {betting ? (
            <>
              <span className="xs muted">Closes</span>
              <b>{day(lock)} {time(lock)}</b>
              <span className="xs muted">in {until(lock)}</span>
            </>
          ) : current.length ? (
            <>
              <span className="xs muted">{current.every((r) => r.status === "Settled" || r.status === "Cancelled") ? "Settled" : "Settles after the open"}</span>
              <b>{day(current[0].marketOpen)} {time(current[0].marketOpen)}</b>
              <span className="xs muted">Next rounds open at 20:00 ET</span>
            </>
          ) : (
            <>
              <span className="xs muted">Next rounds</span>
              <b>20:00 ET</b>
            </>
          )}
        </div>
      </div>

      <AccountBar
        account={account}
        onTarget={wallet.onTargetChain}
        registered={registered}
        me={me}
        busy={busy}
        owedTotal={owedTotal}
        onSwitch={() => wallet.switchToTarget().catch((e) => toast(friendly(e), "warn"))}
        onFunds={getFunds}
        onClaim={() => claimAll(claimable.map((p) => p.id))}
      />

      {current.length ? (
        <div className="pd-grid">
          {current.map((r) => (
            <RoundCard
              key={r.id}
              r={r}
              state={state}
              quote={snap?.quotes.find((q) => q.token === r.token)}
              position={me?.positions.find((p) => p.id === r.id)}
              canBet={canBet}
              busy={busy === `bet-${r.id}`}
              onBet={(side, amount) => placeBet(r, side, amount)}
            />
          ))}
        </div>
      ) : (
        <div className="panel pd-empty">No rounds yet. The keeper opens the first ones after 20:00 ET on a trading day.</div>
      )}

      {lastTx && (
        <p className="small muted">
          Last transaction: <a href={txUrl(lastTx)} target="_blank" rel="noreferrer">{lastTx.slice(0, 10)}…</a>
        </p>
      )}

      {history.length > 0 && <History rounds={history} positions={me?.positions ?? []} />}
      <Rules state={state} />
    </div>
  );
}

function AccountBar(p: {
  account: Address | null;
  onTarget: boolean;
  registered: boolean | null;
  me: Me | null;
  busy: string;
  owedTotal: number;
  onSwitch: () => void;
  onFunds: () => void;
  onClaim: () => void;
}) {
  if (!p.account)
    return (
      <div className="panel pd-account">
        <span>Connect a wallet to play. Anyone can watch the rounds.</span>
        <WalletButton />
      </div>
    );
  if (!p.onTarget)
    return (
      <div className="panel pd-account">
        <span>Your wallet is on another network.</span>
        <button className="btn small" onClick={p.onSwitch}>Switch to {NETWORK}</button>
      </div>
    );
  if (p.registered === false)
    return (
      <div className="panel pd-account">
        <span>Only registered Nightshift users can bet: invite code, verified email and a username.</span>
        <Link className="btn primary small" href="/profile">Finish sign-up</Link>
      </div>
    );
  return (
    <div className="panel pd-account">
      <span>
        Balance <b className="mono">{p.me ? fmt(p.me.balance, 0) : "…"} {sym("USDG")}</b>
        {p.me && !p.me.member && p.registered && <span className="pd-note"> · adding your sign-up on-chain (up to 5 minutes)</span>}
      </span>
      <span className="pd-account-actions">
        {p.owedTotal > 0 && (
          <button className="btn primary small" disabled={p.busy === "claim"} onClick={p.onClaim}>
            {p.busy === "claim" ? "Claiming…" : `Claim ${fmt(p.owedTotal, 2)} ${sym("USDG")}`}
          </button>
        )}
        <button className="btn small" disabled={p.busy === "faucet"} onClick={p.onFunds}>
          {p.busy === "faucet" ? "Sending…" : `Get test ${sym("USDG")}`}
        </button>
      </span>
    </div>
  );
}

function RoundCard({
  r,
  state,
  quote,
  position,
  canBet,
  busy,
  onBet,
}: {
  r: PredictRound;
  state: PredictState;
  quote?: OracleSnapshot["quotes"][number];
  position?: Me["positions"][number];
  canBet: boolean;
  busy: boolean;
  onBet: (side: "Higher" | "Lower", amount: number) => void;
}) {
  const [side, setSide] = useState<"Higher" | "Lower" | null>(null);
  const [amount, setAmount] = useState("50");
  const now = Date.now() / 1000;
  const open = r.status === "Open" && now < r.lockTime && now >= r.openTime;
  const limits = state.limits ?? { maxBet: 1000, maxPerWallet: 5000, challengeWindow: 7200, minWeightBps: 5000, feeBps: 0 };
  const w = weightAt(r, limits.minWeightBps, now);
  const amt = Number(amount) || 0;
  const mult = (s: "Higher" | "Lower") => payoutMultiple(r, s, Math.max(amt, 1), w, limits.feeBps);
  const pool = r.stakeHigher + r.stakeLower;
  const pctHigher = pool ? (r.stakeHigher / pool) * 100 : 50;
  const lockedSide = position && position.side !== "None" ? position.side : null;
  const chosen = lockedSide ?? side;
  const vsCall = quote ? (quote.fairValue / r.strike - 1) * 100 : null;
  const settled = r.status === "Settled" || r.status === "Cancelled";

  return (
    <div className={`panel pd-card ${settled ? "done" : ""}`}>
      <div className="pd-card-top">
        <div>
          <span className="ticker">{r.token}</span>
          <div className="xs muted">for the {day(r.marketOpen)} open</div>
        </div>
        {r.algorandTx ? (
          <a className="xs" href={algoTxUrl(r.algorandTx)} target="_blank" rel="noreferrer" title="The call, locked on Algorand before betting opened">Algorand ↗</a>
        ) : (
          <span className="xs muted">Locked on Base</span>
        )}
      </div>
      <div className="pd-call">
        <span className="xs muted">Nightshift&apos;s call</span>
        <b>{usd(r.strike)}</b>
      </div>
      {!settled && quote && vsCall !== null && (
        <div className="pd-row">
          <span className="muted">{quote.marketOpen ? "Live price" : "Fair value now"}</span>
          <span className="mono">
            {usd(quote.fairValue)} <span className={vsCall >= 0 ? "up" : "down"}>({signed(vsCall)} vs call)</span>
          </span>
        </div>
      )}
      {settled && (
        <div className={`pd-result ${r.outcome.toLowerCase()}`}>
          {r.status === "Cancelled" ? (
            "Cancelled: every stake is refunded."
          ) : r.outcome === "Refund" ? (
            <>Opened at {usd(r.openPrice ?? 0)}. {r.stakeHigher && r.stakeLower ? "A tie" : "Only one side had bets"}: every stake is refunded.</>
          ) : (
            <>
              Opened at <b>{usd(r.openPrice ?? 0)}</b>: <b>{r.outcome}</b> wins. Our call was off by {fmt(Math.abs(((r.openPrice ?? 0) / r.strike - 1) * 100), 2)}%.
            </>
          )}
        </div>
      )}
      {r.status === "Proposed" && (
        <div className="pd-result pending">
          Proposed open {usd(r.openPrice ?? 0)} ({(r.openPrice ?? 0) > r.strike ? "Higher" : (r.openPrice ?? 0) < r.strike ? "Lower" : "tie"}).
          {r.disputed ? " Disputed: the arbiter decides." : ` Final at ${time((r.proposedAt ?? 0) + limits.challengeWindow)} unless disputed.`}
        </div>
      )}

      <div className="pd-pools">
        <div className="pd-pool-bar" aria-hidden="true">
          <i style={{ width: `${pctHigher}%` }} />
        </div>
        {(["Higher", "Lower"] as const).map((s) => (
          <div key={s} className="pd-pool-row">
            <b className={s === "Higher" ? "up" : "down"}>{s === "Higher" ? "▲ Higher" : "▼ Lower"}</b>
            <span className="mono">
              {fmt(s === "Higher" ? r.stakeHigher : r.stakeLower, 0)}
              {!settled && <span className="muted"> · pays {mult(s).toFixed(2)}×</span>}
            </span>
          </div>
        ))}
      </div>

      {position && position.stake > 0 && (
        <div className="pd-mine">
          Your bet: <b>{fmt(position.stake, 0)}</b> on <b>{position.side}</b>
          {position.claimed ? " · paid" : position.owed > 0 ? ` · claim ${fmt(position.owed, 2)}` : settled ? " · lost" : ""}
        </div>
      )}

      {open && (
        <div className="pd-bet">
          <div className="pd-sides">
            {(["Higher", "Lower"] as const).map((s) => (
              <button
                key={s}
                className={`pd-side ${s.toLowerCase()} ${chosen === s ? "on" : ""}`}
                disabled={!!lockedSide && lockedSide !== s}
                onClick={() => setSide(s)}
              >
                {s === "Higher" ? "▲ Higher" : "▼ Lower"}
              </button>
            ))}
          </div>
          <div className="pd-amount">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount" />
            <span className="muted">{sym("USDG")}</span>
          </div>
          <button
            className="btn primary"
            disabled={!canBet || !chosen || !(amt > 0) || amt > limits.maxBet || busy}
            onClick={() => chosen && onBet(chosen, amt)}
          >
            {busy ? "Confirming…" : chosen ? `Bet ${fmt(amt, 0)} on ${chosen}` : "Pick Higher or Lower"}
          </button>
          <p className="xs muted">
            Your bet counts {Math.round(w * 100)}% weight now (early bets count more).
            {chosen && amt > 0 ? ` If ${chosen} wins at today's pools: about ${fmt(amt * mult(chosen), 2)} back.` : ""}
          </p>
        </div>
      )}
      {!open && r.status === "Open" && <p className="xs muted">Betting closed at {time(r.lockTime)}. Settles after the 09:30 ET open.</p>}
    </div>
  );
}

function History({ rounds, positions }: { rounds: PredictRound[]; positions: Me["positions"] }) {
  return (
    <div className="pd-history">
      <h3 className="sub-title">Recent rounds</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Open</th>
              <th>ETF</th>
              <th className="num">Our call</th>
              <th className="num">Opened</th>
              <th>Result</th>
              <th className="num">Pool</th>
              <th>You</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => {
              const p = positions.find((x) => x.id === r.id);
              return (
                <tr key={r.id}>
                  <td>{day(r.marketOpen)}</td>
                  <td className="mono">{r.token}</td>
                  <td className="num">{usd(r.strike)}</td>
                  <td className="num">{r.openPrice ? usd(r.openPrice) : "—"}</td>
                  <td>{r.status === "Cancelled" ? "Refunded" : r.outcome === "Refund" ? "Refunded" : r.outcome}</td>
                  <td className="num">{fmt(r.stakeHigher + r.stakeLower, 0)}</td>
                  <td>{p ? `${p.side} ${fmt(p.stake, 0)}${p.owed > 0 && !p.claimed ? " · claim" : ""}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Rules({ state }: { state: PredictState }) {
  const l = state.limits;
  return (
    <details className="panel pd-rules">
      <summary>Rules and how a round settles</summary>
      <ul>
        <li><b>The call:</b> each evening at 20:00 ET, Nightshift&apos;s fair value for each ETF is locked on Algorand and becomes that round&apos;s strike on {NETWORK}.</li>
        <li><b>Betting:</b> open to registered users until 09:00 ET. One side per round; you can add to it. Up to {fmt(l?.maxBet ?? 1000, 0)} per bet and {fmt(l?.maxPerWallet ?? 5000, 0)} per round.</li>
        <li><b>Early bets count more:</b> a bet placed when the round opens counts 100%, falling to {Math.round((l?.minWeightBps ?? 5000) / 100)}% at close.</li>
        <li><b>The result:</b> the official NYSE opening price is proposed on-chain after 09:30 ET. Any registered user can dispute it within {Math.round((l?.challengeWindow ?? 7200) / 3600)} hours; undisputed, it&apos;s final. Above the call: Higher wins. Below: Lower wins.</li>
        <li><b>Payouts:</b> winners get their stake back plus the losing pool{l?.feeBps ? ` minus a ${l.feeBps / 100}% fee` : ""}, split by weighted shares. Ties, one-sided rounds and rounds not settled within a day are refunded in full.</li>
        <li><b>Test tokens only:</b> {sym("USDG")} has no value, can&apos;t be bought or cashed out. This is a game and a public test of Nightshift&apos;s calls, not gambling or investment advice.</li>
      </ul>
      {state.address && (
        <p className="xs muted">
          Contract: <a href={`${state.explorer}/address/${state.address}#code`} target="_blank" rel="noreferrer">{state.address}</a>
        </p>
      )}
    </details>
  );
}
