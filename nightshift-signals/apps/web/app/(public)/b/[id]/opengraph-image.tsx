import { ImageResponse } from "next/og";
import { apiOrNull } from "@/lib/api";
import { pct, shortHash, weight } from "@/lib/format";
import type { BasketDetail } from "@/lib/types";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Nightshift Signals basket receipt";

/** Receipt card: headline, legs, result at the open, proof hash. Misses get a card too. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const d = await apiOrNull<BasketDetail>(`/baskets/${(await params).id}`);
  const g = d?.grade;
  const result = !d ? "" : g ? `${g.hit ? "▲ Beat SPY" : "▼ Missed"} ${pct(g.vs_spy_pct)}` : d.basket.status === "void" ? "Void" : "Grades at 9:45 ET";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0d111a", color: "#f3efe6", padding: 64, fontSize: 32 }}>
        <div style={{ display: "flex", color: "#ff8a3d", fontSize: 24, letterSpacing: 4 }}>NIGHTSHIFT SIGNALS · BASKET RECEIPT</div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 52, fontWeight: 700, lineHeight: 1.15 }}>{d?.event?.title ?? "Basket not found"}</div>
        <div style={{ display: "flex", marginTop: 24, color: "#9aa1b5" }}>{d?.basket.thesis ?? ""}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 32 }}>
          {d?.basket.legs.map((l) => (
            <div key={l.token_symbol} style={{ display: "flex", border: "2px solid #2a3046", borderRadius: 12, padding: "8px 16px" }}>
              {l.underlying_ticker} {weight(l.weight)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: g ? (g.hit ? "#4f93e6" : "#dc6a24") : "#6aaeff" }}>{result}</div>
          <div style={{ display: "flex", fontSize: 22, color: "#9aa1b5" }}>
            {d?.commit?.simulated ? "simulated commit" : `hash ${shortHash(d?.basket.canonical_hash)}`}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
