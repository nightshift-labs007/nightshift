/** The exact message a visitor's wallet signs to claim test funds (shared by the faucet route and the client). */
export const dripMessage = (address: string, issuedAt: string) => `Nightshift testnet faucet\nAddress: ${address.toLowerCase()}\nIssued: ${issuedAt}`;
