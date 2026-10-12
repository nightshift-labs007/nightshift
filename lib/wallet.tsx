"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";
import { DEPLOYMENT, chainOf, isDeployed } from "@/lib/chain";

/**
 * One wallet connection for the whole site.
 * - Browser wallets (MetaMask, Rabby, Coinbase Wallet, Brave, ...) are discovered with EIP-6963; no API key needed.
 * - WalletConnect (phone wallets via QR) needs NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID from cloud.reown.com.
 * Nightshift never sees private keys: every action is signed in the user's own wallet.
 */

export type WalletInfo = { id: string; name: string; icon?: string; kind: "injected" | "walletconnect"; provider?: EIP1193Provider };

type WalletState = {
  wallets: WalletInfo[];
  walletConnectEnabled: boolean;
  provider: EIP1193Provider | null;
  walletName: string | null;
  account: `0x${string}` | null;
  chainId: number | null;
  targetChain: { id: number; name: string };
  onTargetChain: boolean;
  connecting: boolean;
  connect: (w: WalletInfo) => Promise<void>;
  disconnect: () => Promise<void>;
  switchToTarget: () => Promise<void>;
};

const Ctx = createContext<WalletState | null>(null);
const LAST = "ns.wallet.last";
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

type Announce = CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider }>;

/** WalletConnect provider, created once per page and themed to Nightshift. */
let wcPromise: Promise<import("@walletconnect/ethereum-provider").default> | null = null;
function getWalletConnect(chainId: number) {
  if (!wcPromise) {
    wcPromise = import("@walletconnect/ethereum-provider").then(({ EthereumProvider }) =>
      EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [chainId],
        optionalChains: [1, 8453, 84532],
        showQrModal: true,
        qrModalOptions: {
          themeMode: "dark",
          themeVariables: {
            "--w3m-accent": "#c4ecd9",
            "--w3m-color-mix": "#070909",
            "--w3m-color-mix-strength": 20,
            "--w3m-border-radius-master": "2px",
            "--w3m-font-family": "\"Funnel Sans\", system-ui, sans-serif",
            "--w3m-z-index": 1000,
          },
        } as never,
        metadata: {
          name: "Nightshift",
          description: "Tokenized ETFs, priced after the bell.",
          url: typeof window !== "undefined" ? window.location.origin : "https://nightshift.buzz",
          icons: ["https://nightshift.buzz/brand/nightshift-n-128.png"],
        },
      }),
    );
  }
  return wcPromise;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const target = useMemo(() => (isDeployed ? chainOf() : baseSepolia), []);
  const [injected, setInjected] = useState<WalletInfo[]>([]);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const wcRef = useRef<{ disconnect: () => Promise<void> } | null>(null);

  // discover browser wallets (EIP-6963), with window.ethereum as a fallback for older wallets
  useEffect(() => {
    const found = new Map<string, WalletInfo>();
    const onAnnounce = (e: Event) => {
      const { info, provider: p } = (e as Announce).detail;
      found.set(info.rdns || info.uuid, { id: info.rdns || info.uuid, name: info.name, icon: info.icon, kind: "injected", provider: p });
      setInjected([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (eth && found.size === 0) {
        found.set("injected", { id: "injected", name: "Browser wallet", kind: "injected", provider: eth });
        setInjected([...found.values()]);
      }
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  const attach = useCallback(async (p: EIP1193Provider, name: string, request: boolean) => {
    const accounts = (await p.request({ method: request ? "eth_requestAccounts" : "eth_accounts" })) as string[];
    if (!accounts[0]) return false;
    setProvider(p);
    setWalletName(name);
    setAccount(accounts[0] as `0x${string}`);
    setChainId(parseInt((await p.request({ method: "eth_chainId" })) as string, 16));
    return true;
  }, []);

  // follow account / network changes in the connected wallet
  useEffect(() => {
    if (!provider) return;
    const onAcc = (a: unknown) => {
      const next = (a as string[])[0];
      if (next) setAccount(next as `0x${string}`);
      else {
        setAccount(null);
        setProvider(null);
        setWalletName(null);
      }
    };
    const onChain = (id: unknown) => setChainId(typeof id === "number" ? id : parseInt(id as string, 16));
    const onDisconnect = () => onAcc([]);
    provider.on?.("accountsChanged", onAcc as never);
    provider.on?.("chainChanged", onChain as never);
    provider.on?.("disconnect", onDisconnect as never);
    return () => {
      provider.removeListener?.("accountsChanged", onAcc as never);
      provider.removeListener?.("chainChanged", onChain as never);
      provider.removeListener?.("disconnect", onDisconnect as never);
    };
  }, [provider]);

  // restore a phone-wallet (WalletConnect) session after a reload, without a new QR scan
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST);
    } catch {
      /* storage unavailable */
    }
    if (last !== "walletconnect" || !WC_PROJECT_ID) return;
    getWalletConnect(target.id)
      .then(async (wc) => {
        if (!wc.session) return;
        wcRef.current = wc;
        await attach(wc as unknown as EIP1193Provider, "WalletConnect", false);
      })
      .catch(() => {});
  }, [attach, target.id]);

  // silently reconnect the last browser wallet (no popup)
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST);
    } catch {
      /* storage unavailable */
    }
    if (!last || account) return;
    const w = injected.find((x) => x.id === last);
    if (w?.provider) attach(w.provider, w.name, false).catch(() => {});
  }, [injected, account, attach]);

  const connect = useCallback(
    async (w: WalletInfo) => {
      setConnecting(true);
      try {
        if (w.kind === "walletconnect") {
          const wc = await getWalletConnect(target.id);
          if (!wc.session) await wc.connect();
          wcRef.current = wc;
          if (await attach(wc as unknown as EIP1193Provider, "WalletConnect", false)) {
            try {
              localStorage.setItem(LAST, "walletconnect");
            } catch {
              /* storage unavailable */
            }
          }
        } else if (w.provider) {
          const okConnect = await attach(w.provider, w.name, true);
          if (okConnect) {
            try {
              localStorage.setItem(LAST, w.id);
            } catch {
              /* storage unavailable */
            }
          }
        }
      } finally {
        setConnecting(false);
      }
    },
    [attach, target.id],
  );

  const disconnect = useCallback(async () => {
    try {
      await wcRef.current?.disconnect();
    } catch {
      /* already gone */
    }
    const wasWc = !!wcRef.current;
    wcRef.current = null;
    if (!wasWc) {
      try {
        // let browser wallets forget the site where they support it
        await provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never);
      } catch {
        /* not supported by every wallet */
      }
    }
    try {
      localStorage.removeItem(LAST);
    } catch {
      /* storage unavailable */
    }
    setProvider(null);
    setWalletName(null);
    setAccount(null);
    setChainId(null);
  }, [provider]);

  const switchToTarget = useCallback(async () => {
    if (!provider) return;
    const hex = `0x${target.id.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902 || /Unrecognized chain/i.test(String((e as Error).message))) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: target.name,
              nativeCurrency: target.nativeCurrency,
              rpcUrls: [isDeployed ? DEPLOYMENT.rpcUrl : "https://sepolia.base.org"],
              blockExplorerUrls: [isDeployed && DEPLOYMENT.explorer ? DEPLOYMENT.explorer : "https://sepolia.basescan.org"],
            },
          ],
        });
      } else throw e;
    }
    setChainId(parseInt((await provider.request({ method: "eth_chainId" })) as string, 16));
  }, [provider, target]);

  const wallets = useMemo<WalletInfo[]>(
    () => [...injected, ...(WC_PROJECT_ID ? [{ id: "walletconnect", name: "WalletConnect", kind: "walletconnect" as const }] : [])],
    [injected],
  );

  const value: WalletState = {
    wallets,
    walletConnectEnabled: !!WC_PROJECT_ID,
    provider,
    walletName,
    account,
    chainId,
    targetChain: { id: target.id, name: target.name },
    onTargetChain: chainId === target.id,
    connecting,
    connect,
    disconnect,
    switchToTarget,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}
