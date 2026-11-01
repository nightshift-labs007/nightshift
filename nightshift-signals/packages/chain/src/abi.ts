// Must match contracts/NightshiftSignalsLedger.sol; chain.test.ts compiles the contract and checks.
export const LEDGER_ABI = [
  { type: "constructor", inputs: [{ name: "committer_", type: "address", internalType: "address" }], stateMutability: "nonpayable" },
  {
    type: "function",
    name: "commit",
    inputs: [
      { name: "basketId", type: "bytes32", internalType: "bytes32" },
      { name: "hash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "commitBatch",
    inputs: [
      { name: "basketIds", type: "bytes32[]", internalType: "bytes32[]" },
      { name: "hashes", type: "bytes32[]", internalType: "bytes32[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "committer",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "BasketCommitted",
    inputs: [
      { name: "basketId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "hash", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "ts", type: "uint64", indexed: false, internalType: "uint64" },
    ],
    anonymous: false,
  },
  { type: "error", name: "LengthMismatch", inputs: [] },
  { type: "error", name: "NotCommitter", inputs: [] },
] as const;
