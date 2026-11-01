import { useTranslations } from "next-intl";
import { Empty } from "@/components/ui/Panel";

export default function NotFound() {
  const t = useTranslations("basket");
  return (
    <main className="pt-10">
      <Empty>{t("notFound")}</Empty>
    </main>
  );
}
