"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Votes {
  follow: number;
  fade: number;
  call: "follow" | "fade" | null;
  open: boolean;
  mine: "follow" | "fade" | null;
}

/** Vote before the open. Locked 30 minutes after publish; the crowd is graded exactly like the AI. */
export function FollowOrFade({ basketId }: { basketId: string }) {
  const t = useTranslations("vote");
  const session = useSession();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["votes", basketId, session.token],
    queryFn: () => api<Votes>(`/baskets/${basketId}/votes`, { token: session.token }),
    refetchInterval: 30_000,
  });
  const v = q.data;

  async function cast(vote: "follow" | "fade") {
    setError(null);
    try {
      await api(`/baskets/${basketId}/vote`, { method: "POST", token: session.token, body: JSON.stringify({ vote }) });
      void qc.invalidateQueries({ queryKey: ["votes", basketId] });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!v) return null;
  const total = v.follow + v.fade;
  const followPct = total ? Math.round((v.follow / total) * 100) : 50;
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">{t("title")}</h2>
        <span className="num text-xs text-muted">{t("tally", { follow: v.follow, fade: v.fade })}</span>
      </div>
      {total > 0 && (
        <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded" aria-hidden>
          <div className="bg-beat" style={{ width: `${followPct}%` }} />
          <div className="flex-1 bg-miss" />
        </div>
      )}
      {v.open && session.token ? (
        <div className="mt-3 flex gap-2">
          {(["follow", "fade"] as const).map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => void cast(x)}
              aria-pressed={v.mine === x}
              className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${v.mine === x ? "border-hot bg-hot text-ink" : "border-line"}`}
            >
              {x === "follow" ? `▲ ${t("follow")}` : `▼ ${t("fade")}`}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{v.open ? t("signIn") : t("closed")}</p>
      )}
      {v.mine && <p className="mt-2 text-xs text-muted">{t("yours", { vote: t(v.mine) })}</p>}
      <p className="mt-2 text-[11px] text-muted">{t("closes")}</p>
      {error && <p className="mt-1 text-xs text-hot">{error}</p>}
    </div>
  );
}
