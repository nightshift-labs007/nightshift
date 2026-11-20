import { ImageResponse } from "next/og";
import { readShare } from "@/lib/play/share";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Nightshift game result";

const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const MARK: Record<string, string> = { win: "✓", loss: "✗", push: "=", pending: "…", void: "–" };
const COLOR: Record<string, string> = { win: "#c4ecd9", loss: "#f29a9a", push: "#93a09b", pending: "#93a09b", void: "#67726e" };

/** The card image for a shared result. Only signed cards render; anything else gets a plain Nightshift card. */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const card = readShare((await params).token);
  const right = card ? card.p.filter((x) => x[2] === "win").length : 0;
  const decided = card ? card.p.filter((x) => x[2] === "win" || x[2] === "loss").length : 0;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#070909", color: "#e8f0ec", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#93a09b" }}>
          NIGHTSHIFT · {card?.m === "ai" ? "BEAT THE AI" : "UP OR DOWN AT THE OPEN"}
        </div>
        {card ? (
          <>
            <div style={{ display: "flex", fontSize: 56, fontWeight: 700, marginTop: 28 }}>
              {card.n ?? "A Nightshift player"} {decided ? `called ${right} of ${decided}` : "made their calls"}
            </div>
            <div style={{ display: "flex", fontSize: 28, color: "#c3cec9", marginTop: 12 }}>
              {card.m === "ai" ? `vs Nightshift's call · ${day(card.s)} open` : `${day(card.d)} close → ${day(card.s)} open`}
              {card.st >= 2 ? ` · ${card.st}-round streak` : ""}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 44 }}>
              {card.p.map(([t, side, res]) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, border: "2px solid #1f2826", borderRadius: 16, padding: "16px 22px", fontSize: 34 }}>
                  <span style={{ fontWeight: 700 }}>{t}</span>
                  <span style={{ color: side === "up" ? "#c4ecd9" : "#f29a9a" }}>{side === "up" ? "▲" : "▼"}</span>
                  <span style={{ color: COLOR[res] }}>{MARK[res]}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, marginTop: 28 }}>Up or down at the open?</div>
        )}
        <div style={{ display: "flex", marginTop: "auto", fontSize: 26, color: "#93a09b" }}>Free to play · points only, no money · nightshift.buzz</div>
      </div>
    ),
    size,
  );
}
