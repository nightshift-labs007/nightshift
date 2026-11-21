// The canonical address (lib/site.ts). Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_ORIGIN, canonicalUrl, siteOrigin } from "../lib/site.ts";

test("www.nightshift.buzz is canonical", () => {
  assert.equal(CANONICAL_ORIGIN, "https://www.nightshift.buzz");
  assert.equal(canonicalUrl("/app"), "https://www.nightshift.buzz/app");
  assert.equal(canonicalUrl(""), "https://www.nightshift.buzz/");
  assert.equal(canonicalUrl("/stock/AAPL?x=1#y"), "https://www.nightshift.buzz/stock/AAPL", "query and hash dropped");
});

test("links in emails and share cards use the canonical origin in production", () => {
  assert.equal(siteOrigin({ NODE_ENV: "production" }), "https://www.nightshift.buzz");
  assert.equal(siteOrigin({ NIGHTSHIFT_ENV: "production" }), "https://www.nightshift.buzz");
  assert.equal(siteOrigin({ NODE_ENV: "production", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }), "https://www.nightshift.buzz", "not the Railway host");
  assert.equal(siteOrigin({ NODE_ENV: "production", SITE_URL: ' "https://staging.example/" ' }), "https://staging.example", "SITE_URL wins, quotes and slash trimmed");
  assert.equal(siteOrigin({ VERCEL_ENV: "preview", VERCEL_URL: "p.vercel.app", NODE_ENV: "production" }), "https://p.vercel.app");
  assert.equal(siteOrigin({}), "http://localhost:3000");
});
