import { ImageResponse } from "next/og";
import { readShare } from "@/lib/play/share";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Nightshift game result";

const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const WORD: Record<string, string> = { win: "right", loss: "wrong", push: "flat", pending: "waiting", void: "void" };
const COLOR: Record<string, string> = { win: "#c4ecd9", loss: "#f29a9a", push: "#93a09b", pending: "#93a09b", void: "#67726e" };

/** The card image for a shared result. Only signed cards render; anything else gets a plain Nightshift card. */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const card = readShare((await params).token);
  const right = card ? card.p.filter((x) => x[2] === "win").length : 0;
  const decided = card ? card.p.filter((x) => x[2] === "win" || x[2] === "loss").length : 0;
  const head = card ? `${card.n ?? "A Nightshift player"} ${decided ? `called ${right} of ${decided}` : "made their calls"}` : "Up or down at the open?";
  const sub = card
    ? `${card.m === "ai" ? `vs Nightshift's call · ${day(card.s)} open` : `${day(card.d)} close to ${day(card.s)} open`}${card.st >= 2 ? ` · ${card.st}-round streak` : ""}`
    : "Free to play: will Nvidia, Apple, Tesla, the S&P 500 and gold open up or down?";
  // the default font has no arrows or tick marks, so the card uses words; every element with several children is a flex box
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#070909", color: "#e8f0ec", padding: 64 }}>
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#93a09b" }}>{`NIGHTSHIFT · ${card?.m === "ai" ? "BEAT THE AI" : "UP OR DOWN AT THE OPEN"}`}</div>
        <div style={{ display: "flex", fontSize: 58, fontWeight: 700, marginTop: 28 }}>{head}</div>
        <div style={{ display: "flex", fontSize: 28, color: "#c3cec9", marginTop: 12 }}>{sub}</div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 44 }}>
          {(card?.p ?? []).map(([t, side, res]) => (
            <div key={t} style={{ display: "flex", flexDirection: "column", border: "2px solid #1f2826", borderRadius: 16, padding: "14px 22px", marginRight: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{t}</div>
              <div style={{ display: "flex", fontSize: 24, color: side === "up" ? "#c4ecd9" : "#f29a9a" }}>{side === "up" ? "Up" : "Down"}</div>
              <div style={{ display: "flex", fontSize: 24, color: COLOR[res] }}>{WORD[res]}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 26, color: "#93a09b" }}>Free to play · points only, no money · www.nightshift.buzz</div>
      </div>
    ),
    size,
  );
}
