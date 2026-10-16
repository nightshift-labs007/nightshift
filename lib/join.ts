/** The exact message a wallet signs to join the public leaderboard (shared by the join route and the client). */
export const joinMessage = (address: string, issuedAt: string) =>
  `Join the Nightshift leaderboard\nAddress: ${address.toLowerCase()}\nThis adds the address to a public list recorded on Algorand. Free, no transaction.\nIssued: ${issuedAt}`;
