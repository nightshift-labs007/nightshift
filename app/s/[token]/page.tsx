import type { Metadata } from "next";
import Link from "next/link";
import { readShare } from "@/lib/play/share";

const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const WORD: Record<string, string> = { win: "right", loss: "wrong", push: "flat, no points", pending: "waiting for the open", void: "void" };

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const card = readShare((await params).token);
  const title = card ? `${card.n ?? "A Nightshift player"}'s calls · Nightshift` : "Nightshift: up or down at the open?";
  const description = "Free to play: will Nvidia, Apple, Tesla, the S&P 500 and gold open up or down? Points only, no money.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description }, robots: { index: false } };
}

/** A shared result (signed on the server, so its numbers are the player's real ones), with a way into the game. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const card = readShare((await params).token);
  return (
    <main className="wrap" style={{ maxWidth: 640, padding: "96px 16px 64px" }}>
      <p className="mono xs muted">NIGHTSHIFT · {card?.m === "ai" ? "BEAT THE AI" : "UP OR DOWN AT THE OPEN"}</p>
      {card ? (
        <>
          <h1 style={{ margin: "8px 0" }}>{card.n ?? "A Nightshift player"}&apos;s calls</h1>
          <p className="muted">{card.m === "ai" ? `Above or below Nightshift's call, ${day(card.s)} open` : `${day(card.d)} close → ${day(card.s)} open`}</p>
          <div className="panel" style={{ display: "grid", gap: 8, padding: 18, marginTop: 16 }}>
            {card.p.map(([t, side, res]) => (
              <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                <b className="mono">{t}</b>
                <span>
                  {side === "up" ? "▲ Up" : "▼ Down"} · <span className={res === "win" ? "mint" : res === "loss" ? "down" : "muted"}>{WORD[res]}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <h1 style={{ margin: "8px 0" }}>This link isn&apos;t valid.</h1>
      )}
      <p style={{ marginTop: 24 }}>Will they open up or down? Free to play, points only, no wallet needed.</p>
      <Link className="btn primary" href="/app#predict">
        Make your calls
      </Link>
    </main>
  );
}
