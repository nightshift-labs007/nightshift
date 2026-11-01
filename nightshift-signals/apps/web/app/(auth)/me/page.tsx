"use client";
import type { TriggerRule } from "@nightshift-signals/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { useCategory } from "@/components/ui/CategoryLabel";
import { Empty, Eyebrow, Panel } from "@/components/ui/Panel";
import { PushSettings } from "@/components/ui/PushSettings";
import { api, ApiError } from "@/lib/api";
import { pctPoints } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useChannel } from "@/lib/ws";

interface TriggerView {
  id: string;
  nl_text: string;
  compiled_rule: TriggerRule;
  channels: string[];
  active: boolean;
}
interface PositionView {
  id: string;
  basket_id: string;
  size_usdg: string;
  created_at: string;
  pnl_pct: number | null;
  legs: { token_symbol: string; quote_price: string; mid: string | null; pnl_pct: number | null }[];
}

export default function MePage() {
  const t = useTranslations("me");
  const tf = useTranslations("feed");
  const tp = useTranslations("push");
  const tn = useTranslations("nav");
  const category = useCategory();
  const describe = (r: TriggerRule) => {
    const cats = r.categories.length ? r.categories.map(category).join(", ") : tf("allSectors");
    const extra = [...r.entities, ...r.regions];
    return `${cats} · ${tf("severity", { n: r.min_severity })}${extra.length ? ` · ${extra.join(", ")}` : ""}`;
  };
  const session = useSession();
  const [handle, setHandle] = useState("");
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<TriggerRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<{ nl_text: string; title: string; at: string }[]>([]);

  const triggers = useQuery({
    queryKey: ["triggers", session.token],
    queryFn: () => api<{ items: TriggerView[] }>("/me/triggers", { token: session.token }),
    enabled: !!session.token,
  });
  const positions = useQuery({
    queryKey: ["positions", session.token],
    queryFn: () => api<{ items: PositionView[] }>("/me/positions", { token: session.token }),
    enabled: !!session.token,
    refetchInterval: 30_000,
  });

  useChannel<{ nl_text: string; event: { title: string } | null }>(
    session.userId ? `user:${session.userId}` : null,
    (m) => {
      if (m.type === "delta" && m.data) setAlerts((a) => [{ nl_text: m.data!.nl_text, title: m.data!.event?.title ?? "", at: new Date().toISOString() }, ...a].slice(0, 20));
    },
    { token: session.token ?? undefined },
  );

  async function signIn() {
    setError(null);
    try {
      const r = await api<{ token: string }>("/auth/local", { method: "POST", body: JSON.stringify({ email }) });
      session.signIn(r.token);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? t("localOnly") : String((e as Error).message));
    }
  }

  async function compile(confirm: boolean) {
    setError(null);
    try {
      const r = await api<{ rule: TriggerRule }>("/me/triggers", {
        method: "POST",
        token: session.token,
        body: JSON.stringify({ text, channels: ["ws"], confirm, rule: confirm ? preview : undefined }),
      });
      if (confirm) {
        setPreview(null);
        setText("");
        void qc.invalidateQueries({ queryKey: ["triggers"] });
      } else setPreview(r.rule);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!session.token) {
    return (
      <main className="space-y-4 pt-6">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="font-display text-2xl font-semibold">{t("signInTitle")}</h1>
        <p className="text-sm text-muted">{t("signInNote")}</p>
        <div className="flex gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" className="flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm" />
          <button onClick={() => void signIn()} className="rounded-md bg-hot px-3 py-2 text-sm font-medium text-ink">{t("signIn")}</button>
        </div>
        {error && <p className="text-sm text-hot">{error}</p>}
        <Panel>
          <h2 className="mb-2 font-display font-semibold">{tp("title")}</h2>
          <PushSettings token={null} />
        </Panel>
      </main>
    );
  }

  return (
    <main className="space-y-4 pt-6">
      <div className="flex items-center">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <button onClick={session.signOut} className="ml-auto text-xs text-muted underline">{t("signOut")}</button>
      </div>

      <Panel>
        <h2 className="mb-2 font-display font-semibold">{tp("title")}</h2>
        <PushSettings token={session.token} />
      </Panel>

      <Panel>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("handle")} ({tn("league")})
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="night_trader" className="rounded-md border border-line bg-panel-2 px-2 py-1 text-sm" />
          <button
            onClick={() => void api("/me", { method: "PUT", token: session.token, body: JSON.stringify({ handle }) }).then(() => setError(null)).catch((e: Error) => setError(e.message))}
            className="rounded-md border border-line px-2 py-1 text-xs"
          >
            {t("saveHandle")}
          </button>
        </label>
      </Panel>

      <Panel accent="hot">
        <h2 className="font-display font-semibold">{t("newTrigger")}</h2>
        <p className="text-xs text-muted">{t("triggerHelp")}</p>
        <div className="mt-2 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className="flex-1 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm" placeholder={t("triggerPlaceholder")} />
          <button disabled={text.length < 3} onClick={() => void compile(false)} className="rounded-md border border-line px-3 text-sm disabled:opacity-50">{t("compile")}</button>
        </div>
        {preview && (
          <div className="mt-3 rounded-lg bg-panel-2 p-3 text-sm">
            <p>{t("alertOn")} <strong>{describe(preview)}</strong></p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => void compile(true)} className="rounded-md bg-hot px-3 py-1 text-xs font-medium text-ink">{t("save")}</button>
              <button onClick={() => setPreview(null)} className="text-xs text-muted underline">{t("edit")}</button>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-hot">{error}</p>}
      </Panel>

      <Panel>
        <h2 className="font-display font-semibold">{t("yourTriggers")}</h2>
        {triggers.data?.items.length ? (
          <ul className="mt-2 space-y-2 text-sm">
            {triggers.data.items.map((trg) => (
              <li key={trg.id} className="flex items-start gap-2">
                <div className="flex-1">
                  <p>{trg.nl_text}</p>
                  <p className="text-xs text-muted">{describe(trg.compiled_rule)}</p>
                </div>
                <button
                  className="text-xs text-muted underline"
                  onClick={() => void api(`/me/triggers/${trg.id}`, { method: "DELETE", token: session.token }).then(() => qc.invalidateQueries({ queryKey: ["triggers"] }))}
                >
                  {t("delete")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("none")}</p>
        )}
      </Panel>

      <Panel>
        <h2 className="font-display font-semibold">{t("liveAlerts")}</h2>
        {alerts.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.map((a, i) => (
              <li key={i} className="arrive">
                <span className="text-hot">⚡</span> {a.title} <span className="text-xs text-muted">· {t("matched", { text: a.nl_text })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("liveEmpty")}</p>
        )}
      </Panel>

      <Panel>
        <h2 className="font-display font-semibold">{t("positions")}</h2>
        <p className="text-xs text-muted">{t("positionsNote")}</p>
        {positions.data?.items.length ? (
          <ul className="mt-2 space-y-2 text-sm">
            {positions.data.items.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <Link href={`/b/${p.basket_id}`} className="font-mono text-xs underline">{p.basket_id}</Link>
                <span className="text-xs text-muted">{p.legs.map((l) => l.token_symbol).join(" · ")}</span>
                <span className="num ml-auto">{pctPoints(p.pnl_pct)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <Empty>{t("noPositions")}</Empty>
          </div>
        )}
      </Panel>
    </main>
  );
}
