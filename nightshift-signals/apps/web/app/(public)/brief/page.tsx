import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Empty } from "@/components/ui/Panel";
import { api, ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function BriefIndex() {
  const locale = await getLocale();
  let date: string | null = null;
  try {
    date = (await api<{ date: string }>(`/brief/latest?lang=${locale}`)).date;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  if (date) redirect(`/brief/${date}`);
  const t = await getTranslations("brief");
  return (
    <main className="pt-10">
      <Empty>{t("none")}</Empty>
    </main>
  );
}
