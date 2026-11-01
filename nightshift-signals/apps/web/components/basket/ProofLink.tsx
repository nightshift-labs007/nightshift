import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";
import { shortHash } from "@/lib/format";
import type { Commit } from "@/lib/types";

/** The receipt: the hash committed onchain before anyone saw this basket. */
export function ProofLink({ basketId, commit }: { basketId: string; commit: Commit | null }) {
  const t = useTranslations("proof");
  if (!commit) return null;
  const explorer = process.env.NEXT_PUBLIC_EXPLORER_URL;
  return (
    <div className="min-w-0 rounded-lg border border-line p-3 text-xs">
      <p className="eyebrow font-mono text-[11px] uppercase tracking-widest text-cool">{t("title")}</p>
      {commit.simulated ? (
        <p className="mt-1 text-hot">{t("simulated")}</p>
      ) : (
        <p className="mt-1 text-muted">
          {t("committed", { time: commit.block_time ? new Date(commit.block_time).toUTCString() : t("pending"), chain: commit.chain_id })}
          {commit.status === "pending" && ` · ${t("congested")}`}
        </p>
      )}
      <dl className="num mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono">
        <dt className="text-muted">hash</dt>
        <dd className="truncate">{commit.hash}</dd>
        <dt className="text-muted">tx</dt>
        <dd className="truncate">
          {explorer && commit.tx_hash && !commit.simulated ? (
            <a className="text-cool underline" href={`${explorer}/tx/${commit.tx_hash}`} target="_blank" rel="noreferrer">{shortHash(commit.tx_hash)}</a>
          ) : (
            shortHash(commit.tx_hash)
          )}
        </dd>
      </dl>
      <p className="mt-2 text-muted">
        {t("verify")}{" "}
        <a className="text-cool underline" href={`${API_URL}/v1/baskets/${basketId}/canonical`} target="_blank" rel="noreferrer">{t("canonical")}</a>
      </p>
    </div>
  );
}
