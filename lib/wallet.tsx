"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";
import { DEPLOYMENT, PREDICT_STAKE, chainOf, isDeployed } from "@/lib/chain";

/**
 * One wallet connection for the whole site.
 * - Browser wallets (MetaMask, Rabby, Coinbase Wallet, Brave, ...) are discovered with EIP-6963; no API key needed.
 * - WalletConnect (phone wallets via QR) needs NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID from cloud.reown.com.
 * - Nightshift wallets: email login through Privy creates a wallet for the user; the site signs its transactions without
 *   a popup, but only to Nightshift's own contracts and USDC (guardEmbedded), and never signs token permits.
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
  /** the connected wallet is the user's Nightshift wallet (email login), not their own MetaMask etc. */
  embedded: boolean;
  /** log in with email (Privy): creates the Nightshift wallet on first login and connects it */
  loginWithEmail: () => void;
  /** the Privy access token, for the server to verify the email login */
  privyToken: () => Promise<string | null>;
  /** shows the Nightshift wallet's private key (Privy's own secure screen), so users can always take their funds elsewhere */
  exportKey: () => Promise<void>;
};

const NIGHTSHIFT_WALLET = "Nightshift wallet";

/**
 * The Nightshift wallet signs without a popup, so it may only send transactions to Nightshift's contracts and the stake
 * token (USDC), and may not sign typed data (token permits could hand spending rights to anyone). A withdrawal is a USDC
 * transfer, which the page confirms with the user first.
 */
function guardEmbedded(p: EIP1193Provider): EIP1193Provider {
  const d = DEPLOYMENT;
  const allowed = new Set(
    [
      ...Object.values(d.contracts ?? {}),
      ...Object.values(d.tokens ?? {}).map((t) => t.address),
      d.stack?.plan,
      d.stack?.pool,
      d.predictions?.address,
      PREDICT_STAKE.address,
    ]
      .filter(Boolean)
      .map((a) => String(a).toLowerCase()),
  );
  const request = (async (args: { method: string; params?: unknown }) => {
    if (args.method === "eth_sendTransaction") {
      const tx = (args.params as { to?: string; value?: string }[] | undefined)?.[0];
      if (!tx?.to || !allowed.has(tx.to.toLowerCase())) throw new Error("A Nightshift wallet only sends transactions to Nightshift's contracts and USDC.");
      if (tx.value && BigInt(tx.value) > 0n) throw new Error("A Nightshift wallet doesn't send ETH from the site.");
    }
    if (/^eth_signTypedData/.test(args.method) || args.method === "eth_sign" || args.method === "eth_signTransaction")
      throw new Error("A Nightshift wallet doesn't sign that kind of request.");
    return p.request(args as never);
  }) as EIP1193Provider["request"];
  return {
    request,
    on: (...a: unknown[]) => (p.on as (...x: unknown[]) => void)?.(...a),
    removeListener: (...a: unknown[]) => (p.removeListener as (...x: unknown[]) => void)?.(...a),
  } as unknown as EIP1193Provider;
}

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
  const privy = usePrivy();
  const { wallets: privyWallets } = useWallets();
  const embeddedWallet = privyWallets.find((w) => w.walletClientType === "privy");
  const wantEmbedded = useRef(false); // set when the user picks email login, so the Nightshift wallet connects once ready

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

  // connect the Nightshift wallet after an email login, or after a reload when it was the last wallet used
  useEffect(() => {
    if (!privy.ready || !privy.authenticated || !embeddedWallet) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST);
    } catch {
      /* storage unavailable */
    }
    if (!wantEmbedded.current && last !== "privy") return;
    if (walletName === NIGHTSHIFT_WALLET && account?.toLowerCase() === embeddedWallet.address.toLowerCase()) return;
    let alive = true;
    (async () => {
      try {
        await embeddedWallet.switchChain(target.id).catch(() => {});
        const p = guardEmbedded((await embeddedWallet.getEthereumProvider()) as unknown as EIP1193Provider);
        if (!alive) return;
        if (await attach(p, NIGHTSHIFT_WALLET, false)) {
          wantEmbedded.current = false;
          try {
            localStorage.setItem(LAST, "privy");
          } catch {
            /* storage unavailable */
          }
        }
      } catch {
        /* Privy not ready yet: the next render retries */
      }
    })();
    return () => {
      alive = false;
    };
  }, [privy.ready, privy.authenticated, embeddedWallet, account, walletName, attach, target.id]);

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
    if (!last || last === "privy" || account) return;
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
    if (walletName === NIGHTSHIFT_WALLET) await privy.logout().catch(() => {});
    try {
      await wcRef.current?.disconnect();
    } catch {
      /* already gone */
    }
    const wasWc = !!wcRef.current;
    wcRef.current = null;
    if (!wasWc && walletName !== NIGHTSHIFT_WALLET) {
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
  }, [provider, walletName, privy]);

  const loginWithEmail = useCallback(() => {
    wantEmbedded.current = true;
    if (!privy.authenticated) privy.login();
    else setAccount(null); // already logged in: the effect above connects the Nightshift wallet
  }, [privy]);

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
    embedded: walletName === NIGHTSHIFT_WALLET,
    loginWithEmail,
    privyToken: () => privy.getAccessToken(),
    exportKey: () => (embeddedWallet ? privy.exportWallet({ address: embeddedWallet.address }) : Promise.resolve()),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}
