import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · Nightshift", description: "What Nightshift collects, why, who processes it, and how to delete it." };

/**
 * DRAFT for legal review. Written to match what the code does on 2026-11-21; update it whenever data handling
 * changes (search the repo for "track(" and the services listed below).
 */
export default function Privacy() {
  return (
    <main className="wrap legal">
      <p className="mono xs muted">NIGHTSHIFT · PRIVACY</p>
      <h1>Privacy policy</h1>
      <p className="draft">
        <b>Draft, pending legal review.</b> This page describes what the site does today in plain language. It has not yet been reviewed by a lawyer and
        may change before launch.
      </p>
      <p className="muted small">Last updated 21 November 2026.</p>

      <h2>The short version</h2>
      <ul>
        <li>You can play the points game without giving us anything: no account, no wallet, no email.</li>
        <li>If you choose to save your progress, we keep your email and a nickname. We use the email only to sign you in and, if you switch them on, to send reminders.</li>
        <li>We don&apos;t sell your data, show ads, or use advertising trackers.</li>
        <li>You can delete your game account at any time from the game page.</li>
      </ul>

      <h2>What we collect, and why</h2>
      <ul>
        <li>
          <b>A random player id in a cookie</b> (<code>ns_play</code>), set when you make your first pick. It links your picks and points to your browser. It
          isn&apos;t shared with anyone.
        </li>
        <li>
          <b>Your picks</b> (which asset, up or down, which round) and the points they earned.
        </li>
        <li>
          <b>If you save your progress:</b> your email address and the nickname you choose. The nickname is shown on the public leaderboard; your email
          never is.
        </li>
        <li>
          <b>Reminder settings:</b> which reminder emails you switched on. Clicks on links in those emails are counted (not who opened them).
        </li>
        <li>
          <b>Usage counts:</b> daily totals of visits, picks, sign-ups and shares, and which days a player id was active (to measure whether people come
          back). These use the random player id only, not your email, name or IP address.
        </li>
        <li>
          <b>Your IP address</b>, briefly, to limit how many requests or codes one connection can make. These counters expire within a day.
        </li>
        <li>
          <b>Error reports:</b> if the page crashes, a short error message and the page path are sent to us, with emails, ids and keys removed.
        </li>
        <li>
          <b>Shared result cards</b> contain your nickname (or &ldquo;A Nightshift player&rdquo;) and that round&apos;s picks. Anyone with the link can see them.
        </li>
      </ul>

      <h2>Other parts of the site</h2>
      <ul>
        <li>
          <b>Wallets and profiles:</b> if you connect a wallet or create a Nightshift profile, we store your wallet address, username, email (verified with
          a code) and anything you add to your profile, such as a photo or social handles.
        </li>
        <li>
          <b>Public records on Base:</b> some actions (for example a sign-up, or a prediction call) are written to the Base blockchain. Anything on a public
          blockchain is permanent and visible to everyone; we can&apos;t delete it.
        </li>
        <li>
          <b>Nyx, the voice assistant:</b> if you use voice, your recording is sent to a speech-to-text service to be transcribed.
        </li>
      </ul>

      <h2>Who processes data for us</h2>
      <ul>
        <li><b>Hosting</b> (Vercel): runs the site and sees standard request logs.</li>
        <li><b>Upstash</b> (Redis database): stores the game data described above.</li>
        <li><b>Resend</b>: sends sign-in codes and reminder emails.</li>
        <li>
          <b>Privy</b>: email login that creates a wallet, for wallet features. Privy&apos;s code loads on every page and sends Privy basic usage events,
          even if you never log in, under Privy&apos;s own policy.
        </li>
        <li><b>Cloudflare Turnstile</b>: a bot check on some forms, when switched on.</li>
        <li><b>Groq</b>: transcribes voice questions to Nyx, if you use voice.</li>
        <li>
          Market prices come from public sources such as Yahoo Finance. No personal data is sent to them.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Sign-in codes: 10 minutes. Rate-limit counters: up to a day.</li>
        <li>Game accounts, picks and points: until you delete the account.</li>
        <li>Picks made without an account: for as long as the site keeps game history; they can&apos;t be linked to you except through your browser&apos;s cookie.</li>
        <li>Error reports: the most recent 50 only.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Play without an account, and clear the <code>ns_play</code> cookie at any time to start fresh.</li>
        <li>Turn reminders off in the game, or with the link at the bottom of any reminder email.</li>
        <li>
          Delete your game account from the game page (&ldquo;Delete my account&rdquo;). This removes your email, nickname, picks and points. Daily totals
          that contain no personal data stay.
        </li>
        <li>For anything else, including profile data, contact us: <b>[contact address to be added before launch]</b>.</li>
      </ul>

      <h2>Age</h2>
      <p>Nightshift is for adults (18+). Don&apos;t use it if you are under 18.</p>

      <p style={{ marginTop: 32 }}>
        <Link href="/terms">Terms of use</Link> · <Link href="/app#predict">Back to the game</Link>
      </p>
    </main>
  );
}
