// Real-stakes flag and the fail-closed sign-up gate (lib/gates.ts). Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { isRegisteredWallet, mayJoinPredictions, realStakesOn } from "../lib/gates.ts";

test("real stakes are off unless REAL_STAKES=on", () => {
  assert.equal(realStakesOn({}), false, "unset: off");
  assert.equal(realStakesOn({ REAL_STAKES: "" }), false);
  assert.equal(realStakesOn({ REAL_STAKES: "1" }), false, "only the word on turns it on");
  assert.equal(realStakesOn({ REAL_STAKES: "true" }), false);
  assert.equal(realStakesOn({ REAL_STAKES: "off" }), false);
  assert.equal(realStakesOn({ REAL_STAKES: " ON " }), true);
});

test("the sign-up gate fails closed", () => {
  assert.equal(isRegisteredWallet({ gateReady: false, registered: true }), false, "email/store not configured: nobody is registered");
  assert.equal(isRegisteredWallet({ gateReady: false, registered: undefined }), false);
  assert.equal(isRegisteredWallet({ gateReady: true, registered: null }), false, "store error / unknown: not registered");
  assert.equal(isRegisteredWallet({ gateReady: true, registered: false }), false);
  assert.equal(isRegisteredWallet({ gateReady: true, registered: true }), true, "only a finished sign-up with a working gate");
});

test("joining the predictions allow-list needs real stakes on AND a registered wallet", () => {
  assert.equal(mayJoinPredictions({ realStakes: false, gateReady: true, registered: true }), false, "flag off: denied even for members");
  assert.equal(mayJoinPredictions({ realStakes: true, gateReady: false, registered: true }), false, "gate not configured: denied");
  assert.equal(mayJoinPredictions({ realStakes: true, gateReady: true, registered: false }), false);
  assert.equal(mayJoinPredictions({ realStakes: true, gateReady: true, registered: true }), true);
});
