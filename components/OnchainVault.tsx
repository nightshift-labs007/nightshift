"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, http, maxUint256, parseEther, type Address, type EIP1193Provider } from "viem";
import { ABI, DEPLOYMENT, addrUrl, chainOf, isDeployed, txUrl } from "@/lib/chain";
import { toast } from "./Toast";
import { usd } from "./useApi";

type Pos = { token: string; collateral: number; debt: number; hf: number; limit: number; rule: { mode: number; trigger: number; target: number } };
type Tx = { label: string; hash: string; at: number };

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const fmt = (x: number, d = 2) => x.toLocaleString("en-US", { maximumFractionDigits: d });
const MAX_HF = 1e30;

export function OnchainVault() {
  const chain = useMemo(() => (isDeployed ? chainOf() : null), []);
  const pub = useMemo(() => (chain ? createPublicClient({ chain, transport: http(DEPLOYMENT.rpcUrl) }) : null), [chain]);
  const [account, setAccount] = useState<Address | null>(null);
  const [wrongChain, setWrongChain] = useState(false);
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
      ps.push({ token: sym, collateral: Number(formatEther(c)), debt: Number(formatEther(d)), hf, limit, rule: { mode, trigger: Number(formatEther(trig)), target: Number(formatEther(targ)) } });
    }
    setBal(b);
    setPositions(ps);
  }, [pub, account, tokens]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const checkChain = useCallback(async () => {
    if (!window.ethereum || !chain) return;
    const id = (await window.ethereum.request({ method: "eth_chainId" })) as string;
    setWrongChain(parseInt(id, 16) !== chain.id);
  }, [chain]);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onAcc = (a: unknown) => setAccount(((a as string[])[0] as Address) ?? null);
    const onChain = () => checkChain();
    eth.on?.("accountsChanged", onAcc as never);
    eth.on?.("chainChanged", onChain as never);
    eth.request({ method: "eth_accounts" }).then((a) => {
      if ((a as string[])[0]) setAccount((a as string[])[0] as Address);
    });
    checkChain();
    return () => {
      eth.removeListener?.("accountsChanged", onAcc as never);
      eth.removeListener?.("chainChanged", onChain as never);
    };
  }, [checkChain]);

  async function connect() {
    if (!window.ethereum) return toast("No wallet found. Install MetaMask or Coinbase Wallet to use the testnet vault.", "warn");
    const a = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(a[0] as Address);
    await switchChain();
  }

  async function switchChain() {
    if (!window.ethereum || !chain) return;
    const hex = `0x${chain.id.toString(16)}`;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [DEPLOYMENT.rpcUrl], blockExplorerUrls: DEPLOYMENT.explorer ? [DEPLOYMENT.explorer] : [] }],
        });
      } else throw e;
    }
    await checkChain();
  }

  async function write(label: string, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) {
    if (!window.ethereum || !chain || !account || !pub) throw new Error("wallet");
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum), account });
    const hash = await wallet.writeContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, chain } as never);
    setTxs((t) => [{ label, hash, at: Date.now() }, ...t].slice(0, 8));
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted`);
    return hash;
  }

  async function ensureAllowance(tokenAddr: Address, needed: bigint, label: string) {
    if (!pub || !account) return;
    const allowance = (await pub.readContract({ address: tokenAddr, abi: ABI.token as never, functionName: "allowance" as never, args: [account, DEPLOYMENT.contracts.vault] as never })) as bigint;
    if (allowance < needed) await write(`Approve ${label}`, tokenAddr, ABI.token, "approve", [DEPLOYMENT.contracts.vault, maxUint256]);
  }

  async function run(kind: "deposit" | "borrow" | "repay" | "withdraw" | "rule" | "drip") {
    if (!account) return connect();
    if (wrongChain) return switchChain();
    setBusy(kind);
    try {
      const t = DEPLOYMENT.tokens[token]?.address;
      const amt = amount ? parseEther(amount) : 0n;
      if (kind !== "rule" && kind !== "drip" && amt <= 0n) throw new Error("Enter an amount.");
      if (kind === "drip") {
        const res = await fetch("/api/drip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Faucet failed");
        toast(j.sent.length ? `Sent ${j.sent.map((s: { what: string }) => s.what).join(", ")}` : "You already have test funds.", "ok");
        j.sent.forEach((s: { what: string; tx: string }) => setTxs((x) => [{ label: `Faucet: ${s.what}`, hash: s.tx, at: Date.now() }, ...x].slice(0, 8)));
      } else if (kind === "deposit") {
        await ensureAllowance(t, amt, `t${token}`);
        await write(`Deposit ${amount} t${token}`, DEPLOYMENT.contracts.vault, ABI.vault, "deposit", [t, amt]);
        toast(`Deposited ${amount} t${token}`, "ok");
      } else if (kind === "borrow") {
        await write(`Borrow ${amount} tUSDG`, DEPLOYMENT.contracts.vault, ABI.vault, "borrow", [t, amt]);
        toast(`Borrowed ${amount} tUSDG`, "ok");
      } else if (kind === "repay") {
        await ensureAllowance(DEPLOYMENT.contracts.usdg, amt, "tUSDG");
        await write(`Repay ${amount} tUSDG`, DEPLOYMENT.contracts.vault, ABI.vault, "repay", [t, amt]);
        toast(`Repaid ${amount} tUSDG`, "ok");
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
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e);
      toast(msg.includes("User rejected") ? "Transaction cancelled in the wallet." : msg.slice(0, 180), "error");
    } finally {
      setBusy("");
    }
  }

  if (!isDeployed) {
    return (
      <div className="panel">
        <div className="unit">Testnet vault · deployment pending</div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          The smart contracts (vault, on-chain oracle, Morpho adapter, ZK verifier) are built and tested, and go live on Base Sepolia
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
              tUSDG
            </a>
          </p>
        </div>
        <div className="row-actions" style={{ marginTop: 0 }}>
          {!account ? (
            <button className="btn" onClick={connect}>
              Connect wallet
            </button>
          ) : wrongChain ? (
            <button className="btn" onClick={switchChain}>
              Switch to {DEPLOYMENT.chainName}
            </button>
          ) : (
            <>
              <span className="mono xs muted">
                {account.slice(0, 6)}…{account.slice(-4)}
              </span>
              <button className="btn secondary small" onClick={() => run("drip")} disabled={!!busy}>
                {busy === "drip" ? "Sending…" : "Get test funds"}
              </button>
            </>
          )}
        </div>
      </div>

      {account && !wrongChain && (
        <div className="vault-top">
          <div className="panel">
            <div className="unit">Wallet</div>
            <ul className="balances">
              {["ETH", "USDG", ...tokens].map((k) => (
                <li key={k}>
                  <span className="tok">{k === "ETH" ? "ETH" : `t${k}`}</span>
                  <span className="mono">{fmt(bal[k] ?? 0, k === "ETH" ? 5 : 2)}</span>
                  <span className="muted mono">{k === "ETH" ? "gas" : k === "USDG" ? "borrowed" : "collateral"}</span>
                </li>
              ))}
            </ul>
            <p className="xs muted">New here? Click “Get test funds”: you receive a little test ETH for gas and test ETF tokens.</p>
          </div>

          <div className="panel">
            <div className="unit">Manage position</div>
            <div className="tabs" style={{ margin: "12px 0 0" }}>
              {tokens.map((s) => (
                <button key={s} className={`tab ${s === token ? "on" : ""}`} onClick={() => setToken(s)}>
                  t{s}
                </button>
              ))}
            </div>
            {pos && (
              <div className="readout" style={{ margin: "12px 0" }}>
                <div className="kv">
                  <span className="muted">Collateral · debt</span>
                  <span className="mono">
                    {fmt(pos.collateral, 4)} t{token} · {usd(pos.debt)}
                  </span>
                </div>
                <div className="kv">
                  <span className="muted">Health factor · borrow limit</span>
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
            <input id="oc-amount" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5 (tokens) or 1000 (tUSDG)" />
            <div className="pos-actions" style={{ marginTop: 10 }}>
              <button className="tab" disabled={!!busy} onClick={() => run("deposit")}>
                {busy === "deposit" ? "…" : `Deposit t${token}`}
              </button>
              <button className="tab" disabled={!!busy} onClick={() => run("borrow")}>
                {busy === "borrow" ? "…" : "Borrow tUSDG"}
              </button>
              <button className="tab" disabled={!!busy} onClick={() => run("repay")}>
                {busy === "repay" ? "…" : "Repay tUSDG"}
              </button>
              <button className="tab" disabled={!!busy} onClick={() => run("withdraw")}>
                {busy === "withdraw" ? "…" : `Withdraw t${token}`}
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
