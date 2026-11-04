"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { chainOf, isDeployed } from "@/lib/chain";
import { baseSepolia } from "viem/chains";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmw2jfbf400020gi962dylmzx";

/**
 * Nightshift wallets: email login (Privy) that creates a wallet for each user, so nobody needs MetaMask. The site signs
 * that wallet's transactions without a popup (showWalletUIs: false); lib/wallet.tsx only lets it sign transactions to
 * Nightshift's own contracts and USDC, and the page asks before anything leaves the wallet (withdrawals).
 */
export function PrivyRoot({ children }: { children: React.ReactNode }) {
  const chain = isDeployed ? chainOf() : baseSepolia;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#c4ecd9", logo: "https://nightshift.buzz/brand/nightshift-n-128.png", landingHeader: "Sign in to Nightshift" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
