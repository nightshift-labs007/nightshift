import type { JsonModel, JsonRequest, JsonResponse } from "./model";

type Responder = (req: JsonRequest) => unknown;

/** Scripted model for tests and offline replay. Returns `null` output to simulate a refusal. */
export class FakeJsonModel implements JsonModel {
  readonly calls: JsonRequest[] = [];
  constructor(private respond: Responder) {}

  async complete(req: JsonRequest): Promise<JsonResponse> {
    this.calls.push(req);
    const output = this.respond(req);
    return {
      output,
      stopReason: output === null ? "refusal" : "end_turn",
      model: req.model,
      latencyMs: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }
}
