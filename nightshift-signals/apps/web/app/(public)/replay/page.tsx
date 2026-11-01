import { addDays, etParts, isTradingDay } from "@nightshift-signals/core/market";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Latest night that has reached its 9:30 ET open. */
export default function ReplayIndex() {
  const p = etParts(new Date());
  let date = isTradingDay(p.date) && p.minutes >= 9 * 60 + 30 ? p.date : addDays(p.date, -1);
  while (!isTradingDay(date)) date = addDays(date, -1);
  redirect(`/replay/${date}`);
}
