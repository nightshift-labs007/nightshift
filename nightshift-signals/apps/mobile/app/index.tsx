import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { colors, result } from "../lib/format";
import type { FeedItem } from "../lib/types";

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await api<{ items: FeedItem[] }>("/feed?severity=3");
      setItems(items.filter((i) => i.basket));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.event.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.muted} />}
      contentContainerStyle={s.list}
      ListHeaderComponent={<Text style={s.note}>Information, not advice. Every basket is graded in public at 9:45 ET.</Text>}
      ListEmptyComponent={<Text style={s.note}>{error ?? (loading ? "Loading…" : "No baskets yet tonight.")}</Text>}
      renderItem={({ item }) => {
        const b = item.basket!;
        return (
          <Link href={`/b/${b.id}`} asChild>
            <Pressable style={s.card}>
              <Text style={s.meta}>
                {item.event.category ?? "—"} · sev {item.event.severity ?? "—"}
                {b.simulated ? " · simulated" : ""}
              </Text>
              <Text style={s.title}>{item.event.title}</Text>
              <Text style={s.thesis}>{b.thesis}</Text>
              <View style={s.row}>
                <Text style={s.legs}>{b.legs.map((l) => `${l.ticker} ${Math.round(l.weight * 100)}%`).join(" · ")}</Text>
                <Text style={[s.result, b.grade && { color: b.grade.hit ? colors.beat : colors.miss }]}>{b.status === "void" ? "Void" : result(b.grade)}</Text>
              </View>
            </Pressable>
          </Link>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  note: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  card: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  meta: { color: colors.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  title: { color: colors.paper, fontSize: 16, fontWeight: "600" },
  thesis: { color: colors.paper, opacity: 0.8, fontSize: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  legs: { color: colors.cool, fontSize: 12, fontVariant: ["tabular-nums"], flexShrink: 1 },
  result: { color: colors.muted, fontSize: 12, fontWeight: "600" },
});
