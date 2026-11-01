import { getLocale, getTranslations } from "next-intl/server";
import { BriefPlayer } from "@/components/ui/BriefPlayer";
import { Empty, Eyebrow, Panel } from "@/components/ui/Panel";
import { api, API_URL, ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

interface Brief {
  date: string;
  lang: string;
  script: string;
  source: "model" | "template";
  audio_url: string | null;
}

export default async function BriefPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const [t, locale] = [await getTranslations("brief"), await getLocale()];
  let brief: Brief | null = null;
  try {
    brief = await api<Brief>(`/brief/${date}?lang=${locale}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  return (
    <main className="space-y-4 pt-6">
      <div>
        <Eyebrow tone="cool">{t("eyebrow")}</Eyebrow>
        <h1 className="mt-1 font-display text-2xl font-semibold">{t("title", { date })}</h1>
      </div>
      {brief ? (
        <Panel accent="cool">
          <BriefPlayer script={brief.script} lang={brief.lang} audioUrl={brief.audio_url ? `${API_URL}${brief.audio_url}` : null} labels={{ play: t("play"), stop: t("stop") }} />
          <p className="mt-4 text-base leading-relaxed">{brief.script}</p>
          <p className="mt-3 text-xs text-muted">
            {brief.source === "model" ? t("model") : t("template")} {!brief.audio_url && t("device")}
          </p>
        </Panel>
      ) : (
        <Empty>{t("none")}</Empty>
      )}
    </main>
  );
}
