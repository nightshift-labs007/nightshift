"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, maxUint256, parseEther, type Address } from "viem";
import { ABI, DEPLOYMENT, NETWORK, addrUrl, chainOf, chainTransport, isDeployed, isMainnet, sym, txUrl } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";
import { toast } from "./Toast";
import { WalletButton } from "./WalletButton";
import { Turnstile, turnstileEnabled } from "./Turnstile";
import { getDemoFunds } from "./demoFunds";
import { InfoTip } from "./InfoTip";

/** Contract and wallet errors in plain English. */
function friendly(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  const msg = err.shortMessage ?? err.message ?? String(e);
  if (err.code === 4001 || err.cause?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(msg)) return "Cancelled in your wallet.";
  if (/insufficient funds|exceeds balance|gas required exceeds/i.test(msg)) return isMainnet ? `Not enough ETH on ${NETWORK} for gas (a few cents is enough).` : "Not enough test ETH for gas. Click Get test funds.";
  const reasons: [RegExp, string][] = [
    [/over limit/, "That's more than your borrow limit at the current Oracle price."],
    [/low confidence/, "New borrowing is paused while the Oracle's confidence is below 40 (markets have been closed a long time). Try again later."],
    [/"health"|reverted.*health|: health/, "That would leave your loan below the 1.10 health factor needed to withdraw."],
    [/stale price/, "The on-chain price is out of date; it refreshes within minutes."],
    [/insolvent: alert only/, "Using collateral to repay can't restore this loan, so the Guardian only alerts. Repay or add collateral."],
    [/levels/, "Guardian levels: trigger must be above 1.00, and target at least 0.05 above the trigger (max 5)."],
    [/allowance|"balance"|: balance/, "Not enough tokens for that amount."],
    [/"market"|: market/, "That market isn't enabled."],
  ];
  for (const [re, text] of reasons) if (re.test(msg)) return text;
  return msg.slice(0, 180);
}
import { usd } from "./useApi";

type Pos = { token: string; collateral: number; debt: number; hf: number; limit: number; price: number; rule: { mode: number; trigger: number; target: number } };

const SLIPPAGE = 0.005; // NightshiftVault.SLIPPAGE_WAD

/**
 * What the Guardian means for this loan right now, mirroring NightshiftVault.protect: it acts only when
 * 1 ≤ health < trigger, and refuses when the collateral at the slippage price can't cover the debt (G4).
 * Alerts are delivered here in the app (and as browser notifications when allowed).
 */
function guardianAlert(p: Pos): { level: "warn" | "danger"; text: string } | null {
  if (p.debt <= 0 || p.hf >= MAX_HF) return null;
  const name = sym(p.token);
  if (p.hf < 1) return { level: "danger", text: `${name} loan can be liquidated now (health ${p.hf.toFixed(2)} < 1.00). Repay or add collateral.` };
  if (p.rule.mode === 0) return p.hf < 1.1 ? { level: "warn", text: `${name} loan health is ${p.hf.toFixed(2)} and the Guardian is off.` } : null;
  if (p.hf >= p.rule.trigger) return null;
  if (p.collateral * p.price * (1 - SLIPPAGE) <= p.debt)
    return { level: "danger", text: `Guardian alert: using your ${name} to repay can't restore this loan, so the Guardian won't touch it. Repay or add collateral.` };
  if (p.rule.mode === 1) return { level: "warn", text: `Guardian alert: ${name} loan health ${p.hf.toFixed(2)} is below your trigger ${p.rule.trigger.toFixed(2)}. Repay or add collateral.` };
  return { level: "warn", text: `${name} loan health ${p.hf.toFixed(2)} is below your trigger ${p.rule.trigger.toFixed(2)}. The Guardian will rebalance it to ${p.rule.target.toFixed(2)} on the keeper's next run, or repay now.` };
}
type Tx = { label: string; hash: string; at: number };


const fmt = (x: number, d = 2) => x.toLocaleString("en-US", { maximumFractionDigits: d });
const MAX_HF = 1e30;

export function OnchainVault() {
  const chain = useMemo(() => (isDeployed ? chainOf() : null), []);
  const pub = useMemo(() => (chain ? createPublicClient({ chain, transport: chainTransport() }) : null), [chain]);
  // one shared wallet connection for the whole site (lib/wallet.tsx)
  const wallet = useWallet();
  const account = wallet.account as Address | null;
  const wrongChain = !!account && !wallet.onTargetChain;
  const [bal, setBal] = useState<Record<string, number>>({});
  const [positions, setPositions] = useState<Pos[]>([]);
  const [busy, setBusy] = useState("");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [token, setToken] = useState("SPY");
  const [amount, setAmount] = useState("");
  const [rule, setRule] = useState({ mode: 2, trigger: "1.15", target: "1.40" });

  const tokens = Object.keys(DEPLOYMENT.tokens ?? {});

  const refresh = useCallback(async () => {
    if (!pub || !account) return;
    const b: Record<string, number> = { ETH: Number(formatEther(await pub.getBalance({ address: account }))) };
    const read = (address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) =>
      pub.readContract({ address, abi: abi as never, functionName: functionName as never, args: args as never }) as Promise<unknown>;
    b.USDG = Number(formatEther((await read(DEPLOYMENT.contracts.usdg, ABI.token, "balanceOf", [account])) as bigint));
    const ps: Pos[] = [];
    for (const sym of tokens) {
      const t = DEPLOYMENT.tokens[sym].address;
      b[sym] = Number(formatEther((await read(t, ABI.token, "balanceOf", [account])) as bigint));
      const [c, d] = (await read(DEPLOYMENT.contracts.vault, ABI.vault, "positions", [account, t])) as [bigint, bigint];
      if (c === 0n && d === 0n) continue;
      let hf = MAX_HF;
      let limit = 0;
      try {
        hf = Number(formatEther((await read(DEPLOYMENT.contracts.vault, ABI.vault, "healthFactor", [account, t])) as bigint));
        limit = Number(formatEther((await read(DEPLOYMENT.contracts.vault, ABI.vault, "borrowLimit", [account, t])) as bigint));
      } catch {
        /* stale price: leave defaults */
      }
      const [mode, trig, targ] = (await read(DEPLOYMENT.contracts.vault, ABI.vault, "rules", [account, t])) as [number, bigint, bigint];
      const [price] = (await read(DEPLOYMENT.contracts.oracle, ABI.oracle, "getPrice", [t])) as [bigint, number, bigint];
      ps.push({ token: sym, collateral: Number(formatEther(c)), debt: Number(formatEther(d)), hf, limit, price: Number(formatEther(price)), rule: { mode, trigger: Number(formatEther(trig)), target: Number(formatEther(targ)) } });
    }
    setBal(b);
    setPositions(ps);
  }, [pub, account, tokens]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Guardian alerts: a toast (and a browser notification when allowed) whenever a loan enters an alert state
  const alerts = positions.map((p) => ({ p, a: guardianAlert(p) })).filter((x): x is { p: Pos; a: NonNullable<ReturnType<typeof guardianAlert>> } => !!x.a);
  const seenAlerts = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(alerts.map(({ p, a }) => `${p.token}:${a.level}:${a.text.slice(0, 40)}`));
    for (const { p, a } of alerts) {
      const key = `${p.token}:${a.level}:${a.text.slice(0, 40)}`;
      if (seenAlerts.current.has(key)) continue;
      toast(a.text, "warn");
      if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Nightshift Guardian", { body: a.text });
    }
    seenAlerts.current = now;
  }, [alerts.map(({ p, a }) => `${p.token}:${a.level}:${a.text.slice(0, 40)}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [notify, setNotify] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));

  const switchChain = () => wallet.switchToTarget().catch((e) => toast(friendly(e), "warn"));
  const autoSwitched = useRef<string | null>(null);
  useEffect(() => {
    if (!isDeployed || !account || wallet.onTargetChain || autoSwitched.current === account) return;
    autoSwitched.current = account;
    switchChain();
  }, [account, wallet.onTargetChain]); // eslint-disable-line react-hooks/exhaustive-deps
  const [captcha, setCaptcha] = useState<string | null>(null);
  const onCaptcha = useCallback((t: string | null) => setCaptcha(t), []);

  async function write(label: string, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) {
    if (!wallet.provider || !chain || !account || !pub) throw new Error("wallet");
    if ((await pub.getBalance({ address: account })) < 20_000_000_000_000n) throw new Error("insufficient funds for gas");
    // dry-run first: a revert is caught here with the contract's reason, before the wallet asks to sign
    await pub.simulateContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, account } as never);
    const client = createWalletClient({ chain, transport: custom(wallet.provider), account });
    const hash = await client.writeContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, chain } as never);
    setTxs((t) => [{ label, hash, at: Date.now() }, ...t].slice(0, 8));
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted`);
    return hash;
  }

  async function ensureAllowance(tokenAddr: Address, needed: bigint, label: string) {
    if (!pub || !account) return;
    const allowance = (await pub.readContract({ address: tokenAddr, abi: ABI.token as never, functionName: "allowance" as never, args: [account, DEPLOYMENT.contracts.vault] as never })) as bigint;
    if (allowance < needed) {
      toast(`Step 1 of 2: approve ${label} in your wallet so the Vault can move it.`);
      await write(`Approve ${label}`, tokenAddr, ABI.token, "approve", [DEPLOYMENT.contracts.vault, maxUint256]);
      toast("Step 2 of 2: confirm the transaction in your wallet.");
    }
  }

  async function run(kind: "deposit" | "borrow" | "repay" | "withdraw" | "rule" | "drip") {
    if (!account) return toast("Connect your wallet with the button above first.", "warn");
    if (wrongChain) return switchChain();
    setBusy(kind);
    try {
      const t = DEPLOYMENT.tokens[token]?.address;
      const amt = amount ? parseEther(amount) : 0n;
      if (kind !== "rule" && kind !== "drip" && amt <= 0n) throw new Error("Enter an amount.");
      if (kind === "drip") {
        if (turnstileEnabled && !captcha) throw new Error("Please complete the captcha first.");
        toast("Sign the message in your wallet to prove this address is yours (free, no transaction).");
        const sent = await getDemoFunds(wallet.provider!, account, captcha);
        toast(sent.length ? `Sent ${sent.map((s) => s.what).join(", ")}` : "You already have demo funds.", "ok");
        sent.forEach((s) => setTxs((x) => [{ label: `Demo funds: ${s.what}`, hash: s.tx, at: Date.now() }, ...x].slice(0, 8)));
      } else if (kind === "deposit") {
        await ensureAllowance(t, amt, sym(token));
        await write(`Deposit ${amount} t${token}`, DEPLOYMENT.contracts.vault, ABI.vault, "deposit", [t, amt]);
        toast(`Deposited ${amount} t${token}`, "ok");
      } else if (kind === "borrow") {
        await write(`Borrow ${amount} ${sym("USDG")}`, DEPLOYMENT.contracts.vault, ABI.vault, "borrow", [t, amt]);
        toast(`Borrowed ${amount} ${sym("USDG")}`, "ok");
      } else if (kind === "repay") {
        await ensureAllowance(DEPLOYMENT.contracts.usdg, amt, sym("USDG"));
        await write(`Repay ${amount} ${sym("USDG")}`, DEPLOYMENT.contracts.vault, ABI.vault, "repay", [t, amt]);
        toast(`Repaid ${amount} ${sym("USDG")}`, "ok");
      } else if (kind === "withdraw") {
        await write(`Withdraw ${amount} t${token}`, DEPLOYMENT.contracts.vault, ABI.vault, "withdraw", [t, amt]);
        toast(`Withdrew ${amount} t${token}`, "ok");
      } else {
        await write(`Guardian rule (${["off", "alert", "auto"][rule.mode]})`, DEPLOYMENT.contracts.vault, ABI.vault, "setRule", [t, rule.mode, parseEther(rule.trigger), parseEther(rule.target)]);
        toast("Guardian rule saved on-chain", "ok");
      }
      setAmount("");
      await refresh();
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy("");
    }
  }

  if (!isDeployed) {
    return (
      <div className="panel">
        <div className="unit">Testnet vault · deployment pending</div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          The smart contracts (vault, on-chain oracle, Morpho adapter, ZK verifier) are built and tested, and go live on Base
          as soon as the deployer wallet is funded with free test ETH. Until then, use the paper vault above.
        </p>
      </div>
    );
  }

  const pos = positions.find((p) => p.token === token);

  return (
    <div className="onchain">
      <div className="onchain-head panel">
        <div>
          <div className="unit">
            Testnet vault · {DEPLOYMENT.chainName} · real transactions with test assets
          </div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            Contracts:{" "}
            <a href={addrUrl(DEPLOYMENT.contracts.vault)} target="_blank" rel="noreferrer">
              vault
            </a>{" "}
            ·{" "}
            <a href={addrUrl(DEPLOYMENT.contracts.oracle)} target="_blank" rel="noreferrer">
              oracle
            </a>{" "}
            ·{" "}
            <a href={addrUrl(DEPLOYMENT.contracts.verifier)} target="_blank" rel="noreferrer">
              ZK verifier
            </a>{" "}
            ·{" "}
            <a href={addrUrl(DEPLOYMENT.contracts.usdg)} target="_blank" rel="noreferrer">
              {sym("USDG")}
            </a>
          </p>
        </div>
        <div className="row-actions" style={{ marginTop: 0 }}>
          {!account ? (
            <WalletButton />
          ) : wrongChain ? (
            <button className="btn" onClick={switchChain}>
              Switch to {DEPLOYMENT.chainName}
            </button>
          ) : (
            <>
              <span className="mono xs muted">
                {account.slice(0, 6)}…{account.slice(-4)}
              </span>
              <Turnstile onToken={onCaptcha} />
              <button className="btn secondary small" onClick={() => run("drip")} disabled={!!busy}>
                {busy === "drip" ? "Sending…" : isMainnet ? "Get demo funds" : "Get test funds"}
              </button>
            </>
          )}
        </div>
      </div>

      {account && !wrongChain && (
        <div className="guardian-alerts" role="status" aria-live="polite">
          {alerts.map(({ p, a }) => (
            <div key={p.token} className={`guardian-alert ${a.level}`}>
              {a.text}
            </div>
          ))}
          {positions.some((p) => p.debt > 0) && typeof Notification !== "undefined" && notify !== "granted" && (
            <button
              className="tab"
              onClick={() => Notification.requestPermission().then((r) => { setNotify(r); toast(r === "granted" ? "Browser alerts on: you'll be notified while this page is open." : "Browser alerts blocked.", r === "granted" ? "ok" : "warn"); })}
            >
              Get Guardian alerts as browser notifications
            </button>
          )}
        </div>
      )}

      {account && !wrongChain && positions.length === 0 && (
        <div className="empty panel">
          <b>No loans yet.</b>
          {tokens.some((t) => (bal[t] ?? 0) > 0) ? (
            <span>You have demo tokens: pick one under Manage position, enter an amount, then Deposit and Borrow. About two minutes.</span>
          ) : (
            <span>
              Start with free demo funds, then deposit a token and borrow against it. About two minutes.{" "}
              <button className="link-btn" onClick={() => run("drip")} disabled={!!busy}>{busy === "drip" ? "Sending…" : "Get demo funds"}</button>
            </span>
          )}
        </div>
      )}

      {account && !wrongChain && (
        <div className="vault-top">
          <div className="panel">
            <div className="unit">Wallet</div>
            <ul className="balances">
              {["ETH", "USDG", ...tokens].map((k) => (
                <li key={k}>
                  <span className="tok">{k === "ETH" ? "ETH" : sym(k)}</span>
                  <span className="mono">{fmt(bal[k] ?? 0, k === "ETH" ? 5 : 2)}</span>
                  <span className="muted mono">{k === "ETH" ? "gas" : k === "USDG" ? "borrowed" : "collateral"}</span>
                </li>
              ))}
            </ul>
            <p className="xs muted">
              {isMainnet
                ? "New here? Click “Get demo funds” for demo ETF tokens and dUSDG (no value). You need a few cents of ETH on Base for gas."
                : "New here? Click “Get test funds”: you receive a little test ETH for gas and test ETF tokens."}
            </p>
          </div>

          <div className="panel">
            <div className="unit">Manage position</div>
            <div className="tabs" style={{ margin: "12px 0 0" }}>
              {tokens.map((s) => (
                <button key={s} className={`tab ${s === token ? "on" : ""}`} onClick={() => setToken(s)}>
                  {sym(s)}
                </button>
              ))}
            </div>
            {pos && (
              <div className="readout" style={{ margin: "12px 0" }}>
                <div className="kv">
                  <span className="muted">Collateral · debt</span>
                  <span className="mono">
                    {fmt(pos.collateral, 4)} {sym(token)} · {usd(pos.debt)}
                  </span>
                </div>
                <div className="kv">
                  <span className="muted">Health factor <InfoTip k="health" label="health factor" /> · borrow limit <InfoTip k="borrowLimit" label="borrow limit" /></span>
                  <span className="mono">
                    <b className={pos.hf < 1.1 ? "down" : pos.hf < 1.3 ? "amber" : "up"}>{pos.hf >= MAX_HF ? "∞" : pos.hf.toFixed(3)}</b> · {usd(pos.limit)}
                  </span>
                </div>
                <div className="kv">
                  <span className="muted">Guardian rule (on-chain)</span>
                  <span className="mono">{pos.rule.mode === 2 ? `auto · ${pos.rule.trigger.toFixed(2)} → ${pos.rule.target.toFixed(2)}` : pos.rule.mode === 1 ? `alert · ${pos.rule.trigger.toFixed(2)}` : "off"}</span>
                </div>
              </div>
            )}
            <label className="field" htmlFor="oc-amount">
              Amount
            </label>
            <input id="oc-amount" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`e.g. 5 (tokens) or 1000 (${sym("USDG")})`} />
            <div className="pos-actions" style={{ marginTop: 10 }}>
              <button className="tab" disabled={!!busy} onClick={() => run("deposit")}>
                {busy === "deposit" ? "…" : `Deposit ${sym(token)}`}
              </button>
              <button className="tab" disabled={!!busy} onClick={() => run("borrow")}>
                {busy === "borrow" ? "…" : `Borrow ${sym("USDG")}`}
              </button>
              <button className="tab" disabled={!!busy} onClick={() => run("repay")}>
                {busy === "repay" ? "…" : `Repay ${sym("USDG")}`}
              </button>
              <button className="tab" disabled={!!busy} onClick={() => run("withdraw")}>
                {busy === "withdraw" ? "…" : `Withdraw ${sym(token)}`}
              </button>
            </div>
            <div className="guardian-row">
              <span className="unit">Guardian</span>
              <div className="seg small">
                {["Off", "Alert", "Auto-protect"].map((l, i) => (
                  <button key={l} className={rule.mode === i ? "on" : ""} onClick={() => setRule({ ...rule, mode: i })}>
                    {l}
                  </button>
                ))}
              </div>
              <label className="mini">
                Trigger <b>{rule.trigger}</b>
                <input type="range" min={1.02} max={1.6} step={0.01} value={rule.trigger} onChange={(e) => setRule({ ...rule, trigger: Number(e.target.value).toFixed(2), target: Math.max(Number(rule.target), Number(e.target.value) + 0.05).toFixed(2) })} />
              </label>
              <label className="mini">
                Restore to <b>{rule.target}</b>
                <input type="range" min={Number(rule.trigger) + 0.05} max={2.5} step={0.05} value={rule.target} onChange={(e) => setRule({ ...rule, target: Number(e.target.value).toFixed(2) })} />
              </label>
              <button className="tab" disabled={!!busy} onClick={() => run("rule")}>
                {busy === "rule" ? "…" : "Save rule on-chain"}
              </button>
            </div>
          </div>
        </div>
      )}

      {txs.length > 0 && (
        <ol className="log">
          {txs.map((t) => (
            <li key={t.hash}>
              <span className="muted">[{new Date(t.at).toLocaleTimeString()}]</span> {t.label} ·{" "}
              <a href={txUrl(t.hash)} target="_blank" rel="noreferrer">
                {t.hash.slice(0, 12)}… ↗
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
