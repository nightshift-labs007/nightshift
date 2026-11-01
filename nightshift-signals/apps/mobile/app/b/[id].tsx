import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../lib/api";
import { colors, pct, pctPoints, result } from "../../lib/format";
import type { LiveState } from "../../lib/live-state";
import { useSession } from "../../lib/session";
import { startTracking } from "../../lib/track";
import type { BasketDetail } from "../../lib/types";

interface TradeLink {
  token_symbol: string;
  usdg: string;
  url: string | null;
}

export default function Basket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const [d, setD] = useState<BasketDetail | null>(null);
  const [links, setLinks] = useState<TradeLink[] | null>(null);
  const [linksNote, setLinksNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api<BasketDetail>(`/baskets/${id}`).then(setD, (e) => setNote(String(e.message ?? e)));
    // The API applies the geofence; a 451 means no trade links render here.
    api<{ simulated: boolean; links: TradeLink[] }>(`/baskets/${id}/links`).then(
      (r) => setLinks(r.links),
      (e) => setLinksNote(e instanceof ApiError && e.status === 451 ? "Trade links are not available in your region." : null),
    );
  }, [id]);

  if (!d) return <Text style={s.note}>{note ?? "Loading…"}</Text>;
  const b = d.basket;

  async function track() {
    if (!token) return router.push("/sign-in");
    const initial: LiveState = {
      status: "tracking",
      retPct: 0,
      vsSpyPct: null,
      legs: d!.live.map((l) => ({ ticker: l.underlying_ticker, chgPct: l.move_since_entry_pct ?? 0 })),
      updatedAt: Math.floor(Date.now() / 1000),
    };
    try {
      await startTracking(token, { basketId: b.id, headline: d!.event?.title ?? b.thesis, initial });
      setNote("Tracking on your lock screen until 9:45 ET.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>{d.event?.title}</Text>
      <Text style={s.thesis}>{b.thesis}</Text>

      {b.why_chain.length > 0 && (
        <View style={s.chain}>
          {b.why_chain.map((step, i) => (
            <Text key={i} style={s.step}>
              {i > 0 ? "↓ " : ""}
              {step}
            </Text>
          ))}
        </View>
      )}

      <View style={s.panel}>
        {b.legs.map((l) => {
          const live = d.live.find((x) => x.token_symbol === l.token_symbol);
          return (
            <View key={l.token_symbol} style={s.leg}>
              <Text style={s.ticker}>{l.underlying_ticker}</Text>
              <Text style={s.cell}>{Math.round(l.weight * 100)}%</Text>
              <Text style={s.cell}>{pctPoints(live?.move_since_entry_pct)}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[s.result, d.grade && { color: d.grade.hit ? colors.beat : colors.miss }]}>
        {b.status === "void" ? "Void" : result(d.grade)}
        {d.grade ? ` · basket ${pct(d.grade.ret_pct)}` : ""}
      </Text>
      <Text style={s.note}>Confidence {Math.round(b.confidence * 100)}% · {d.commit ? `hash ${d.commit.hash.slice(0, 10)}…${d.commit.simulated ? " (simulated)" : ""}` : "commit pending"}</Text>

      {b.status === "published" && (
        <Pressable style={s.btn} onPress={track}>
          <Text style={s.btnText}>Track until the open</Text>
        </Pressable>
      )}

      {links?.map((l) =>
        l.url ? (
          <Pressable key={l.token_symbol} style={s.link} onPress={() => Linking.openURL(l.url!)}>
            <Text style={s.linkText}>
              Buy {l.token_symbol} · {l.usdg} USDG ↗
            </Text>
          </Pressable>
        ) : null,
      )}
      {linksNote && <Text style={s.note}>{linksNote}</Text>}
      {note && <Text style={s.note}>{note}</Text>}
      <Text style={s.note}>Information, not advice. Trades happen in your own wallet; Nightshift Signals never holds funds.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  title: { color: colors.paper, fontSize: 20, fontWeight: "700" },
  thesis: { color: colors.paper, opacity: 0.85, fontSize: 15 },
  chain: { borderLeftColor: colors.hot, borderLeftWidth: 2, paddingLeft: 10, gap: 4 },
  step: { color: colors.paper, fontSize: 13 },
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  leg: { flexDirection: "row", justifyContent: "space-between" },
  ticker: { color: colors.cool, fontWeight: "700", flex: 1 },
  cell: { color: colors.paper, width: 80, textAlign: "right", fontVariant: ["tabular-nums"] },
  result: { color: colors.muted, fontSize: 16, fontWeight: "700" },
  note: { color: colors.muted, fontSize: 12, padding: 2 },
  btn: { backgroundColor: colors.hot, borderRadius: 10, padding: 14, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "700", fontSize: 16 },
  link: { borderColor: colors.line, borderWidth: 1, borderRadius: 10, padding: 12 },
  linkText: { color: colors.paper },
});
