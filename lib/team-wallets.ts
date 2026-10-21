/** Wallets the Nightshift team runs to exercise the live contracts (scripts/demo-activity.mjs). They are labelled wherever they appear. */
export const TEAM_WALLETS = [
  "0xf86fc0d9346cfac2ce7ea9c72150dd656700a205",
  "0x00d1fc81629c9309f10f76827ce02bee758fb700",
  "0x191a0a09d4185d13044e2989c62764612368b351",
  "0x88799e8fd1c139b7b60540e10ec63dfe34f92415",
];

/** The team's Ethereum wallet that holds a small position in the Sentora vault shown on Earn (scripts/earn-deposit.mjs). Real PYUSD, funded by the team. */
export const EARN_WALLET = "0xF86fC0d9346CFac2ce7ea9C72150dD656700A205";
export const EARN_TXS = [
  { id: "0xfce2fac87262bf9798a50026d252a116ef68b3e160052a5ff5932b83b3e684f8", at: 1792607951, title: "Approve PYUSD", detail: "9 PYUSD for the Sentora vault" },
  { id: "0x8827492e9b367e5d5f2da61804a9b24fd282cc8d0b0bbadf6bf7883249a66a92", at: 1792608047, title: "Earn deposit", detail: "9 PYUSD into Sentora Protected RWA" },
];
export const isTeamWallet = (a: string | null | undefined) => !!a && TEAM_WALLETS.includes(a.toLowerCase());
