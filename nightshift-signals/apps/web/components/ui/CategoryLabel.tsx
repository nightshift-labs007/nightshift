import { useTranslations } from "next-intl";

export function useCategory() {
  const t = useTranslations("categories");
  return (c: string | null) => t(c ?? "none");
}
