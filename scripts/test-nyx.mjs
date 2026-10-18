// Unit tests for Nyx's intent parser: node scripts/test-nyx.mjs (Node 22.6+ runs the TypeScript module directly)
import { parse } from "../lib/nyx.ts";

const cases = [
  // prices
  ["What's SPY worth?", { kind: "price", token: "SPY" }],
  ["how much is gold right now", { kind: "price", token: "GLD" }],
  ["price of q q q", { kind: "price", token: "QQQ" }],
  ["Hey Nyx, what's bitcoin trading at", { kind: "price", token: "IBIT" }],
  ["what is the S&P 500 worth", { kind: "price", token: "SPY" }],
  ["show me all the prices", { kind: "price" }],
  // stocks on the board, and assets Nyx does not cover
  ["What was the last price for Apple and Tesla?", { kind: "stock" }],
  ["how much is nvidia worth", { kind: "stock" }],
  ["what is google trading at", { kind: "stock" }],
  ["price of ethereum", { kind: "unknown" }],
  ["how much is a tesla car", { kind: "stock" }],
  ["how are the markets", { kind: "price" }],
  // market + movers + confidence + accuracy
  ["is the market open", { kind: "market" }],
  ["is wall street closed right now", { kind: "market" }],
  ["which ETF moved the most tonight", { kind: "movers" }],
  ["how confident are you about gold", { kind: "confidence", token: "GLD" }],
  ["how accurate are you", { kind: "accuracy" }],
  ["what's your track record", { kind: "accuracy" }],
  // account
  ["how's my loan", { kind: "loan" }],
  ["am I safe", { kind: "loan" }],
  ["what's my health factor", { kind: "loan" }],
  ["how many points do I have", { kind: "points" }],
  ["what's my rank", { kind: "points" }],
  ["who's top of the leaderboard", { kind: "leaders" }],
  // navigation
  ["take me to the leaderboard", { kind: "go", page: "leaderboard" }],
  ["open my profile", { kind: "go", page: "profile" }],
  ["go to the app", { kind: "go", page: "app" }],
  ["show me the proofs", { kind: "go", page: "proof" }],
  ["take me to the guardian", { kind: "go", page: "guardian" }],
  ["go home", { kind: "go", page: "home" }],
  // explanations
  ["what is a health factor", { kind: "explain", topic: "health" }],
  ["what does the guardian do", { kind: "explain", topic: "guardian" }],
  ["explain the oracle", { kind: "explain", topic: "oracle" }],
  ["what is night shift", { kind: "explain", topic: "nightshift" }],
  ["how do points work", { kind: "explain", topic: "points" }],
  ["what is cloak", { kind: "explain", topic: "cloak" }],
  ["why should I trust your price", { kind: "explain", topic: "oracle" }],
  ["what's the ledger", { kind: "explain", topic: "ledger" }],
  ["tell me about morpho", { kind: "explain", topic: "morpho" }],
  ["what does liquidation mean", { kind: "explain", topic: "liquidation" }],
  // safety: no money moves by voice
  ["borrow 100 dollars", { kind: "money" }],
  ["repay my loan", { kind: "money" }],
  ["deposit 5 spy", { kind: "money" }],
  // investing questions: trend data and principles, never a pick
  ["Suggest me where should I invest my $1000?", { kind: "invest" }],
  ["what should I buy with 500 dollars", { kind: "invest" }],
  ["which stock is best to buy now", { kind: "invest" }],
  ["is tesla a good investment", { kind: "invest" }],
  ["what is trending right now", { kind: "invest" }],
  ["buy 5 spy", { kind: "money" }],
  // misc
  ["what can you do", { kind: "help" }],
  ["who are you", { kind: "who" }],
  ["thanks", { kind: "thanks" }],
  ["stop", { kind: "stop" }],
  ["turn on alerts", { kind: "alerts", on: true }],
  ["turn off alerts", { kind: "alerts", on: false }],
  ["connect my wallet", { kind: "wallet" }],
  ["give me a tour", { kind: "tour" }],
  ["hello", { kind: "greet" }],
  ["purple elephants dancing", { kind: "unknown" }],
];

let pass = 0, fail = 0;
for (const [text, want] of cases) {
  const got = parse(text);
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL  "${text}"\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
