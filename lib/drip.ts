/** The exact message a visitor's wallet signs to claim test funds (shared by the faucet route and the client). */
export const dripMessage = (address: string, issuedAt: string) => `Nightshift demo-token faucet\nAddress: ${address.toLowerCase()}\nIssued: ${issuedAt}`;
/** Signed when a wallet has no profile session yet and asks Nightshift to pay its test gas. */
export const gasMessage = (address: string, issuedAt: string) => `Nightshift gas top-up\nAddress: ${address.toLowerCase()}\nIssued: ${issuedAt}`;
