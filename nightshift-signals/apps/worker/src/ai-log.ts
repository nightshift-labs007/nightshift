import type { AiCallLog } from "@nightshift-signals/ai";
import { aiCalls } from "@nightshift-signals/db";
import type { Deps } from "./deps";

export function aiCallLogger(deps: Deps, eventId: string): AiCallLog {
  return async ({ kind, promptVersion, request, response, error }) => {
    await deps.db.insert(aiCalls).values({
      kind,
      model: response?.model ?? request.model,
      promptVersion,
      eventId,
      userPrompt: request.user,
      output: response?.output ?? null,
      stopReason: response?.stopReason ?? null,
      error,
      latencyMs: response?.latencyMs ?? null,
      usage: response?.usage ?? null,
    });
  };
}
