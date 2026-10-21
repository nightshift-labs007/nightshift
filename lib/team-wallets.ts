/** Wallets the Nightshift team runs to exercise the live contracts (scripts/demo-activity.mjs). They are labelled wherever they appear. */
export const TEAM_WALLETS = [
  "0x00d1fc81629c9309f10f76827ce02bee758fb700",
  "0x191a0a09d4185d13044e2989c62764612368b351",
  "0x88799e8fd1c139b7b60540e10ec63dfe34f92415",
];
export const isTeamWallet = (a: string | null | undefined) => !!a && TEAM_WALLETS.includes(a.toLowerCase());
