"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createPublicClient, formatEther, http } from "viem";
import { baseSepolia } from "viem/chains";
import { DEPLOYMENT, chainOf, chainTransport, isDeployed, isMainnet } from "@/lib/chain";
import { useWallet, type WalletInfo } from "@/lib/wallet";
import { toast } from "./Toast";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorer = isDeployed && DEPLOYMENT.explorer ? DEPLOYMENT.explorer : "https://sepolia.basescan.org";

function WalletIcon({ w }: { w: WalletInfo }) {
  if (w.icon) return <img src={w.icon} alt="" width={28} height={28} />;
  return (
    <span className="wl-fallback" aria-hidden="true">
      {w.kind === "walletconnect" ? "WC" : w.name.slice(0, 1)}
    </span>
  );
}

/** Nav button: connect a wallet, then show address, network and test-ETH balance. */
export function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [eth, setEth] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // balance on the network the Vault runs on
  useEffect(() => {
    if (!w.account) return setEth(null);
    const chain = isDeployed ? chainOf() : baseSepolia;
    const pub = createPublicClient({ chain, transport: isDeployed ? chainTransport() : http("https://sepolia.base.org") });
    let alive = true;
    const load = () => pub.getBalance({ address: w.account! }).then((b) => alive && setEth(Number(formatEther(b)))).catch(() => {});
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [w.account]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  async function pick(x: WalletInfo) {
    try {
      await w.connect(x);
      setOpen(false);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      toast(/reject|denied|closed/i.test(msg) ? "Connection cancelled in the wallet." : `Couldn't connect: ${msg.slice(0, 120)}`, "warn");
    }
  }

  if (w.account) {
    return (
      <div className="wl" ref={menuRef}>
        <button className={`wl-pill ${w.onTargetChain ? "" : "warn"}`} onClick={() => setMenu(!menu)} aria-expanded={menu}>
          <i aria-hidden="true" />
          {short(w.account)}
          {!w.onTargetChain && <span className="wl-net">wrong network</span>}
        </button>
        {menu && (
          <div className="wl-menu card" role="menu">
            <div className="wl-row">
              <span className="unit">{w.walletName}</span>
              <b className="mono">{short(w.account)}</b>
            </div>
            <div className="wl-row">
              <span className="unit">Network</span>
              <b>{w.onTargetChain ? w.targetChain.name : `Chain ${w.chainId}`}</b>
            </div>
            <div className="wl-row">
              <span className="unit">{w.targetChain.name} balance</span>
              <b className="mono">{eth === null ? "—" : `${eth.toFixed(4)} ETH`}</b>
            </div>
            {!w.onTargetChain && (
              <button className="btn small" onClick={() => w.switchToTarget().catch((e) => toast(String(e?.message ?? e).slice(0, 120), "warn"))}>
                Switch to {w.targetChain.name}
              </button>
            )}
            <button
              className="tab"
              onClick={() => {
                navigator.clipboard?.writeText(w.account!);
                toast("Address copied.");
              }}
            >
              Copy address
            </button>
            <a className="tab" href={`${explorer}/address/${w.account}`} target="_blank" rel="noopener noreferrer">
              View on explorer ↗
            </a>
            <button
              className="tab danger"
              onClick={() => {
                w.disconnect();
                setMenu(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button className="btn secondary small wl-connect" onClick={() => setOpen(true)} disabled={w.connecting}>
        {w.connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {open &&
        createPortal(
        <div className="wl-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="wl-modal card" role="dialog" aria-modal="true" aria-label="Connect a wallet">
            <div className="wl-head">
              <h3>Connect a wallet</h3>
              <button className="wl-x" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="wl-list">
              {w.wallets.map((x) => (
                <button key={x.id} className="wl-item" onClick={() => pick(x)} disabled={w.connecting}>
                  <WalletIcon w={x} />
                  <span>
                    <b>{x.name}</b>
                    <small>{x.kind === "walletconnect" ? "Scan with a phone wallet" : "Browser extension"}</small>
                  </span>
                </button>
              ))}
              {w.wallets.length === 0 && (
                <p className="wl-empty">
                  No wallet found in this browser. Install{" "}
                  <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
                    MetaMask
                  </a>{" "}
                  or{" "}
                  <a href="https://rabby.io/" target="_blank" rel="noopener noreferrer">
                    Rabby
                  </a>
                  , then reload.
                </p>
              )}
            </div>
            <p className="wl-note">
              Nightshift runs on {w.targetChain.name}{isMainnet ? " with demo assets that have no value; you pay a few cents of real ETH for gas." : " (a test network: no real money)."} Your keys stay in your wallet; every action asks for your
              approval.
            </p>
          </div>
        </div>,
          // rendered at <body> level: the sticky nav's backdrop blur would otherwise trap a fixed overlay
          document.body,
        )}
    </>
  );
}
