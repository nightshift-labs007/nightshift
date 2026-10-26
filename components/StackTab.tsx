"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, parseEther, type Address } from "viem";
import { ABI, DEPLOYMENT, NETWORK, addrUrl, chainOf, chainTransport, isDeployed, sym, txUrl } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";
import { toast } from "./Toast";
import { WalletButton } from "./WalletButton";

/** Contract and wallet errors in plain English. */
function friendly(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  const msg = err.shortMessage ?? err.message ?? String(e);
  if (err.code === 4001 || err.cause?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(msg)) return "Cancelled in your wallet.";
  if (/insufficient funds|gas required exceeds/i.test(msg)) return `Not enough ETH on ${NETWORK} for gas (a few cents is enough).`;
  const reasons: [RegExp, string][] = [
    [/faucet cooldown/, "You can claim demo dUSDG once an hour. Try again a little later."],
    [/"amount"|: amount/, "That's more than one buy is allowed to be."],
    [/"interval"|: interval/, "That's more often than Stack allows."],
    [/"asset"|: asset/, "That metal isn't available in Stack yet."],
    [/"balance"|: balance|allowance/, "Not enough dUSDG for that. Tap “Get demo dUSDG” first."],
    [/not your plan/, "That plan belongs to another wallet."],
  ];
  for (const [re, text] of reasons) if (re.test(msg)) return text;
  return msg.slice(0, 180);
}

type Metal = "GLD" | "SLV" | "BOTH";
const METALS: { key: Metal; label: string; blurb: string }[] = [
  { key: "GLD", label: "Gold", blurb: "steady" },
  { key: "SLV", label: "Silver", blurb: "swingier" },
  { key: "BOTH", label: "Both", blurb: "half each" },
];
const NAME: Record<string, string> = { GLD: "gold", SLV: "silver" };
const FREQS = [
  { key: "weekly", label: "Weekly", seconds: 7 * 86400, every: "week" },
  { key: "daily", label: "Daily", seconds: 86400, every: "day" },
  { key: "monthly", label: "Monthly", seconds: 30 * 86400, every: "month" },
  { key: "hourly", label: "Hourly (demo)", seconds: 3600, every: "hour" },
] as const;
const CHIPS = ["10", "20", "50", "100"];
const FALLBACK_CAP: Record<string, number> = { GLD: 50, SLV: 75 }; // basis points over fair value; read from the contract when possible

type PlanView = {
  id: number;
  asset: string; // GLD | SLV
  amount: number;
  budget: number;
  spent: number;
  nextRun: number;
  expiry: number;
  interval: number;
  window: number;
  runs: number;
  maxPremiumBps: number;
  status: 0 | 1 | 2;
};
type Tx = { label: string; hash: string };

const fmt = (x: number, d = 2) => x.toLocaleString("en-US", { maximumFractionDigits: d });
const everyOf = (seconds: number) => FREQS.find((f) => f.seconds === seconds)?.every ?? (seconds % 86400 === 0 ? `${seconds / 86400} days` : `${seconds / 3600} hours`);
const when = (unix: number) => new Date(unix * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function statusOf(p: PlanView, now: number): { text: string; tone: "ok" | "wait" | "off" } {
  if (p.status === 2) return { text: "Cancelled", tone: "off" };
  if (p.status === 1) return { text: "Paused", tone: "off" };
  if (now > p.expiry || p.spent + p.amount > p.budget) return { text: "Finished", tone: "off" };
  if (now < p.nextRun) return { text: `Next buy ${when(p.nextRun)}`, tone: "ok" };
  if (now <= p.nextRun + p.window) return { text: "Buying when the price is fair", tone: "wait" };
  return { text: "Missed this time, moving to the next buy", tone: "wait" };
}

export function StackTab() {
  const wallet = useWallet();
  const account = wallet.account as Address | null;
  const chain = useMemo(() => (isDeployed ? chainOf() : null), []);
  const pub = useMemo(() => (chain ? createPublicClient({ chain, transport: chainTransport() }) : null), [chain]);
  const stack = DEPLOYMENT.stack;
  const wrongChain = !!account && !wallet.onTargetChain;

  const [metal, setMetal] = useState<Metal>("GLD");
  const [amount, setAmount] = useState("20");
  const [freq, setFreq] = useState<(typeof FREQS)[number]["key"]>("weekly");
  const [stopAfter, setStopAfter] = useState("12");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [bal, setBal] = useState<{ usdg: number; eth: number } | null>(null);
  const [caps, setCaps] = useState<Record<string, number>>(FALLBACK_CAP);
  const [perRunCap, setPerRunCap] = useState(1000);
  const [lastBuy, setLastBuy] = useState<Record<string, string>>({});
  const [txs, setTxs] = useState<Tx[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const read = useCallback(
    (address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
      pub!.readContract({ address, abi: abi as never, functionName: functionName as never, args: args as never }) as Promise<unknown>,
    [pub],
  );

  // what the contract allows (premium caps, the per-buy limit)
  useEffect(() => {
    if (!pub || !stack) return;
    (async () => {
      try {
        const next: Record<string, number> = { ...FALLBACK_CAP };
        for (const s of ["GLD", "SLV"]) {
          const t = DEPLOYMENT.tokens[s]?.address;
          if (t) next[s] = Number(((await read(stack.plan, ABI.stackPlan, "assets", [t])) as [boolean, number])[1]);
        }
        setCaps(next);
        setPerRunCap(Number(formatEther((await read(stack.plan, ABI.stackPlan, "maxPerRun")) as bigint)));
      } catch {
        /* the defaults are right unless the owner changed them */
      }
    })();
  }, [pub, stack, read]);

  const refresh = useCallback(async () => {
    setNow(Math.floor(Date.now() / 1000));
    if (!pub || !stack || !account) return;
    try {
      const [usdg, eth] = await Promise.all([read(DEPLOYMENT.contracts.usdg, ABI.token, "balanceOf", [account]), pub.getBalance({ address: account })]);
      setBal({ usdg: Number(formatEther(usdg as bigint)), eth: Number(formatEther(eth)) });
      const ids = (await read(stack.plan, ABI.stackPlan, "plansOf", [account])) as bigint[];
      const symOf = new Map(Object.entries(DEPLOYMENT.tokens).map(([s, t]) => [t.address.toLowerCase(), s]));
      const rows: PlanView[] = [];
      for (const id of ids) {
        const p = (await read(stack.plan, ABI.stackPlan, "getPlan", [id])) as Record<string, unknown>;
        rows.push({
          id: Number(id),
          asset: symOf.get(String(p.asset).toLowerCase()) ?? "?",
          amount: Number(formatEther(p.amountPerRun as bigint)),
          budget: Number(formatEther(p.budget as bigint)),
          spent: Number(formatEther(p.spent as bigint)),
          nextRun: Number(p.nextRun),
          expiry: Number(p.expiry),
          interval: Number(p.interval),
          window: Number(p.window),
          runs: Number(p.runs),
          maxPremiumBps: Number(p.maxPremiumBps),
          status: Number(p.status) as 0 | 1 | 2,
        });
      }
      setPlans(rows.reverse());
    } catch {
      /* a flaky RPC: keep what we have, the next refresh retries */
    }
    // the latest buy per metal, from the public record (best effort)
    try {
      const j = await fetch("/api/transactions", { cache: "no-store" }).then((r) => r.json());
      const mine = (j.rows ?? []).filter((r: { kind: string; title: string; actor: string | null }) => r.kind === "stack" && r.title === "Stack buy" && r.actor?.toLowerCase() === account.toLowerCase());
      const out: Record<string, string> = {};
      for (const s of ["GLD", "SLV"]) {
        const r = mine.find((x: { detail: string }) => x.detail.includes(` ${s},`));
        if (r) out[s] = `${r.detail} · ${new Date(r.at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      }
      setLastBuy(out);
    } catch {
      /* not critical */
    }
  }, [pub, stack, account, read]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function write(label: string, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) {
    if (!wallet.provider || !chain || !account || !pub) throw new Error("wallet");
    if ((await pub.getBalance({ address: account })) < 20_000_000_000_000n) throw new Error("insufficient funds for gas");
    // dry-run first: a revert is caught here with the contract's reason, before the wallet asks to sign
    await pub.simulateContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, account } as never);
    const client = createWalletClient({ chain, transport: custom(wallet.provider), account });
    const hash = await client.writeContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, chain } as never);
    setTxs((t) => [{ label, hash }, ...t].slice(0, 6));
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} failed`);
    return hash;
  }

  const metals = metal === "BOTH" ? ["GLD", "SLV"] : [metal];
  const total = Number(amount) || 0;
  const each = metals.length ? total / metals.length : 0;
  const stops = Math.max(1, Math.floor(Number(stopAfter) || 0));
  const f = FREQS.find((x) => x.key === freq)!;
  const premiumPct = Math.max(...metals.map((m) => caps[m] ?? 50)) / 100;
  const needed = total * stops;
  const invalid = !(total >= 1) || each > perRunCap || stops < 1 || stops > 120;

  async function start() {
    if (!account || !stack || !chain) return;
    if (wrongChain) return wallet.switchToTarget().catch((e) => toast(friendly(e), "warn"));
    if (invalid) return toast(each > perRunCap ? `One buy can be at most ${fmt(perRunCap, 0)} ${sym("USDG")} per metal.` : "Enter an amount of at least 1.", "warn");
    setBusy("start");
    try {
      const perPlan = parseEther(each.toFixed(6));
      const budgetEach = perPlan * BigInt(stops);
      const budgetAll = budgetEach * BigInt(metals.length);
      const allowance = (await read(DEPLOYMENT.contracts.usdg, ABI.token, "allowance", [account, stack.plan])) as bigint;
      const steps = metals.length + (allowance < budgetAll ? 1 : 0);
      let step = 1;
      if (allowance < budgetAll) {
        toast(`Step ${step++} of ${steps}: allow Stack to spend up to ${fmt(needed, 0)} ${sym("USDG")} in total. It can never take more.`);
        await write("Allow Stack to spend", DEPLOYMENT.contracts.usdg, ABI.token, "approve", [stack.plan, allowance + budgetAll]);
      }
      const start = Math.floor(Date.now() / 1000) + 120; // the first buy opens in about two minutes
      for (const m of metals) {
        toast(`Step ${step++} of ${steps}: confirm your ${NAME[m]} plan in your wallet.`);
        const window = Math.min(f.seconds, 48 * 3600);
        await write(`Start ${NAME[m]} plan`, stack.plan, ABI.stackPlan, "createPlan", [
          DEPLOYMENT.tokens[m].address, perPlan, f.seconds, start, window, caps[m] ?? 50, 75, budgetEach, start + stops * f.seconds + window,
        ]);
      }
      toast("Your Stack is on. The first buy happens within a few minutes, if the price is fair.", "ok");
      await new Promise((r) => setTimeout(r, 3500)); // public nodes are load-balanced: let the new plan become visible
      await refresh();
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy("");
    }
  }

  async function control(p: PlanView, what: "pause" | "resume" | "cancel") {
    if (!stack || !account) return;
    if (what === "cancel" && !window.confirm(`Cancel this ${NAME[p.asset] ?? p.asset} plan? It can't be restarted.`)) return;
    setBusy(`${what}${p.id}`);
    try {
      await write(`${what[0].toUpperCase()}${what.slice(1)} ${NAME[p.asset] ?? p.asset} plan`, stack.plan, ABI.stackPlan, what, [BigInt(p.id)]);
      if (what === "cancel" && !plans.some((x) => x.id !== p.id && x.status !== 2)) {
        // nothing left running: take Stack's permission to spend away too
        await new Promise((r) => setTimeout(r, 3500));
        await write("Remove Stack's permission to spend", DEPLOYMENT.contracts.usdg, ABI.token, "approve", [stack.plan, 0n]);
      }
      toast(what === "cancel" ? "Plan cancelled." : what === "pause" ? "Plan paused." : "Plan resumed.", "ok");
      await new Promise((r) => setTimeout(r, 3500));
      await refresh();
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy("");
    }
  }

  async function getDemoUsdg() {
    setBusy("faucet");
    try {
      await write("Get demo dUSDG", DEPLOYMENT.contracts.usdg, ABI.token, "faucet", []);
      toast(`Added 1,000 demo ${sym("USDG")} to your wallet.`, "ok");
      await new Promise((r) => setTimeout(r, 3500));
      await refresh();
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy("");
    }
  }

  if (!isDeployed || !stack) {
    return (
      <div className="panel">
        <div className="unit">Stack · coming soon</div>
        <p className="small muted" style={{ marginBottom: 0 }}>Automatic buying of gold and silver is being set up. Check back shortly.</p>
      </div>
    );
  }

  const lowUsdg = !!bal && bal.usdg < each;
  const active = plans.filter((p) => p.status !== 2);

  return (
    <div className="stack">
      <div className="panel stack-card">
        <div className="unit">Stack · automatic buying</div>
        <p className="muted stack-lead">
          Choose what to buy, how much and how often. Stack only buys when the price is fair, and your tokens go straight to your wallet. Cancel any time.
        </p>

        <div className="stack-step">
          <label className="field">What do you want to stack?</label>
          <div className="stack-metals" role="radiogroup" aria-label="Metal">
            {METALS.map((m) => (
              <button key={m.key} role="radio" aria-checked={metal === m.key} className={`stack-metal ${metal === m.key ? "on" : ""}`} onClick={() => setMetal(m.key)}>
                <b>{m.label}</b>
                <span>{m.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="stack-step">
          <label className="field" htmlFor="stack-amount">How much each time?</label>
          <div className="stack-amount">
            <input id="stack-amount" type="number" min={1} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="mono muted">{sym("USDG")}</span>
            <div className="stack-chips">
              {CHIPS.map((c) => (
                <button key={c} className={`chip ${amount === c ? "on" : ""}`} onClick={() => setAmount(c)}>{c}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="stack-step">
          <label className="field">How often?</label>
          <div className="seg stack-freq" role="radiogroup" aria-label="Frequency">
            {FREQS.map((x) => (
              <button key={x.key} role="radio" aria-checked={freq === x.key} className={freq === x.key ? "on" : ""} onClick={() => setFreq(x.key)}>{x.label}</button>
            ))}
          </div>
        </div>

        <p className="stack-summary">
          Every {f.every} we&apos;ll buy <b>{fmt(total || 0, 2)} {sym("USDG")}</b> of <b>{metal === "BOTH" ? "gold and silver" : NAME[metal]}</b>
          {metal === "BOTH" ? ` (${fmt(each, 2)} each)` : ""}, only when the price is fair.
        </p>

        <button className="stack-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide details" : "More options"}
        </button>
        {open && (
          <div className="stack-advanced">
            <label className="field" htmlFor="stack-stop">Stop after</label>
            <div className="stack-amount">
              <input id="stack-stop" type="number" min={1} max={120} step={1} value={stopAfter} onChange={(e) => setStopAfter(e.target.value)} />
              <span className="muted">buys (you&apos;ll spend at most {fmt(needed, 0)} {sym("USDG")} in total)</span>
            </div>
            <p className="small muted">
              <b>Fair price:</b> Stack won&apos;t pay more than {premiumPct}% above Nightshift&apos;s fair value, and skips a buy if the price data is old or unsure.
              If a buy can&apos;t happen in time, it&apos;s skipped and your money stays in your wallet.
            </p>
          </div>
        )}

        <div className="stack-go">
          {!account ? (
            <WalletButton />
          ) : wrongChain ? (
            <button className="btn" onClick={() => wallet.switchToTarget().catch((e) => toast(friendly(e), "warn"))}>Switch to {NETWORK}</button>
          ) : (
            <>
              <button className="btn primary" onClick={start} disabled={!!busy || invalid || lowUsdg}>
                {busy === "start" ? "Starting…" : "Start Stack"}
              </button>
              {lowUsdg && (
                <button className="btn secondary small" onClick={getDemoUsdg} disabled={!!busy}>
                  {busy === "faucet" ? "Adding…" : `Get demo ${sym("USDG")}`}
                </button>
              )}
            </>
          )}
        </div>
        {account && bal && !wrongChain && (
          <p className="small muted stack-bal">
            You have {fmt(bal.usdg, 2)} {sym("USDG")}.{lowUsdg ? ` You need at least ${fmt(each, 2)} for the first buy.` : ""}{" "}
            Demo assets on {NETWORK}: no real value, unaudited.
          </p>
        )}
        {!account && <p className="small muted stack-bal">Connect a wallet to start. Demo assets on {NETWORK}: no real value, unaudited.</p>}
      </div>

      {account && !wrongChain && (
        <div className="stack-plans">
          <div className="unit">Your Stack</div>
          {plans.length === 0 ? (
            <p className="muted small">No plans yet. Start one above and it will show up here.</p>
          ) : (
            plans.map((p) => {
              const st = statusOf(p, now);
              const live = p.status !== 2 && st.text !== "Finished";
              return (
                <div key={p.id} className={`panel stack-plan ${p.status === 2 ? "done" : ""}`}>
                  <div className="stack-plan-top">
                    <div>
                      <b>{fmt(p.amount, 2)} {sym("USDG")} of {NAME[p.asset] ?? p.asset} every {everyOf(p.interval)}</b>
                      <div className={`stack-status ${st.tone}`}>{st.text}</div>
                    </div>
                    {live && (
                      <div className="stack-ctl">
                        {p.status === 0 ? (
                          <button className="btn secondary small" disabled={!!busy} onClick={() => control(p, "pause")}>{busy === `pause${p.id}` ? "…" : "Pause"}</button>
                        ) : (
                          <button className="btn secondary small" disabled={!!busy} onClick={() => control(p, "resume")}>{busy === `resume${p.id}` ? "…" : "Resume"}</button>
                        )}
                        <button className="btn secondary small" disabled={!!busy} onClick={() => control(p, "cancel")}>{busy === `cancel${p.id}` ? "…" : "Cancel"}</button>
                      </div>
                    )}
                  </div>
                  <div className="stack-plan-stats">
                    <span><i>Bought so far</i><b>{p.runs} time{p.runs === 1 ? "" : "s"}</b></span>
                    <span><i>Spent</i><b>{fmt(p.spent, 2)} {sym("USDG")}</b></span>
                    <span><i>Will spend at most</i><b>{fmt(p.budget, 0)} {sym("USDG")}</b></span>
                  </div>
                  {lastBuy[p.asset] && <p className="small muted stack-last">Latest buy: {lastBuy[p.asset]}</p>}
                </div>
              );
            })
          )}
          {active.length > 0 && <p className="small muted">Stack runs on its own: you can close this page. Every buy is recorded on the <a href="/transactions">Transactions</a> page.</p>}
        </div>
      )}

      <div className="stack-how">
        <div className="unit">How it works</div>
        <ol>
          <li><b>You choose.</b> Metal, amount and how often. One approval, capped at your total.</li>
          <li><b>We watch the price.</b> Nightshift&apos;s fair value is the yardstick. If the market price is too high or the data is unsure, the buy waits.</li>
          <li><b>You keep your tokens.</b> Each buy goes straight to your wallet. Stack never holds your money.</li>
        </ol>
        <p className="small muted">
          <a href={addrUrl(stack.plan)} target="_blank" rel="noopener noreferrer">Stack contract ↗</a>
          {txs[0] && <> · latest: <a href={txUrl(txs[0].hash)} target="_blank" rel="noopener noreferrer">{txs[0].label} ↗</a></>}
        </p>
      </div>
    </div>
  );
}
