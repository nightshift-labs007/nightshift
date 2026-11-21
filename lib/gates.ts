// Who may do what with real money. Pure (no imports) so it can be unit-tested; the routes pass in what they know.
//
// Real stakes ("Call the Open" with real USDC on Base) are OFF unless REAL_STAKES=on. Off means: /api/predict says
// enabled:false, the UI shows nothing, nobody is added to the contract's allow-list, and no new rounds are opened.
// Rounds that already exist still settle and finalize, so funds already in them are never stuck.
//
// The sign-up gate fails CLOSED: a wallet counts as registered only when the gate can actually work (member store and
// email both configured) AND that wallet finished sign-up. Anything missing, unknown or failing means "not registered".

type Env = Record<string, string | undefined>;

export const realStakesOn = (env: Env): boolean => (env.REAL_STAKES ?? "").trim().toLowerCase() === "on";

/** `gateReady`: store + email configured (signupRequired()). `registered`: the store's answer for this wallet, if known. */
export const isRegisteredWallet = (p: { gateReady: boolean; registered: boolean | null | undefined }): boolean =>
  p.gateReady === true && p.registered === true;

/** Joining the prediction allow-list (and so staking): real stakes on, and a registered wallet. */
export const mayJoinPredictions = (p: { realStakes: boolean; gateReady: boolean; registered: boolean | null | undefined }): boolean =>
  p.realStakes === true && isRegisteredWallet(p);
