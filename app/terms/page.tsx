import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms · Nightshift", description: "The rules for using Nightshift and its free points game." };

/** DRAFT for legal review. Plain-language terms matching how the product works on 2026-11-21. */
export default function Terms() {
  return (
    <main className="wrap legal">
      <p className="mono xs muted">NIGHTSHIFT · TERMS</p>
      <h1>Terms of use</h1>
      <p className="draft">
        <b>Draft, pending legal review.</b> These terms are written in plain language and have not yet been reviewed by a lawyer. They may change before
        launch.
      </p>
      <p className="muted small">Last updated 21 November 2026.</p>

      <h2>Not financial advice</h2>
      <p>
        Nothing on Nightshift is financial, investment, tax or legal advice. Prices, fair values, &ldquo;calls&rdquo; and predictions are estimates from
        public data and models. They can be wrong, late or simulated where marked. Don&apos;t make financial decisions based on them.
      </p>

      <h2>The points game</h2>
      <ul>
        <li>The points game is free. <b>Points mode uses no real money.</b> Points have no cash value, can&apos;t be bought, sold, transferred or exchanged, and win no prizes.</li>
        <li>
          Results are decided by the official close and open as reported by our price source, using the rules shown in the game (&ldquo;How it works&rdquo;).
          If prices can&apos;t be confirmed, a round may be voided.
        </li>
        <li>We may correct results that were settled from wrong data, and remove points earned by cheating, automation or multiple accounts.</li>
        <li>We may change the game, its rules or its points, or end it, at any time.</li>
        <li>Your nickname must not impersonate anyone or be offensive; we may change or remove it.</li>
      </ul>

      <h2>Other features</h2>
      <ul>
        <li>
          <b>Real-stakes predictions</b> (where offered) are a separate, unaudited beta that uses real USDC. You can lose what you stake. They are not part
          of the points game, and may not be legal where you live; it&apos;s your responsibility to check.
        </li>
        <li>Lending, Stack and the Vault use demo tokens with no value. Never send real tokens to them.</li>
        <li>Stock Tokens are not available to US persons. Nightshift doesn&apos;t sell tokens.</li>
        <li>Smart contracts are unaudited and may contain bugs. Blockchain transactions can&apos;t be reversed.</li>
      </ul>

      <h2>Using the site fairly</h2>
      <ul>
        <li>Don&apos;t try to break, overload or scrape the site, get around rate limits, or create accounts in bulk.</li>
        <li>You must be 18 or older.</li>
      </ul>

      <h2>No guarantees</h2>
      <p>
        Nightshift is provided &ldquo;as is&rdquo;, as a beta. It may be unavailable, slow or wrong. To the extent the law allows, we aren&apos;t liable for
        losses that come from using it. <i>(The exact limitation of liability and governing law are to be set during legal review.)</i>
      </p>

      <h2>Contact</h2>
      <p>
        <b>[contact address to be added before launch]</b>
      </p>

      <p style={{ marginTop: 32 }}>
        <Link href="/privacy">Privacy policy</Link> · <Link href="/app#predict">Back to the game</Link>
      </p>
    </main>
  );
}
