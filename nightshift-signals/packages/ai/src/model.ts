import Anthropic from "@anthropic-ai/sdk";

export interface JsonRequest {
  model: string;
  /** Static, cached. Never put timestamps or per-request data here. */
  system: string;
  user: string;
  /** JSON Schema the response must match (structured outputs). */
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}

export interface JsonResponse {
  /** Parsed JSON, or null when the model refused or the output did not parse. */
  output: unknown;
  stopReason: string | null;
  model: string;
  latencyMs: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** The only surface the pipeline uses. Fakes implement it in tests and offline replay. */
export interface JsonModel {
  complete(req: JsonRequest): Promise<JsonResponse>;
}

/** Models that accept the server-side refusal fallback ("default" routing by refusal category). */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

/**
 * Claude via structured outputs. Forced tool_choice is not accepted on current models,
 * so the JSON shape is enforced with output_config.format instead of a forced tool call.
 */
export class AnthropicJsonModel implements JsonModel {
  constructor(private client = new Anthropic({ timeout: 20_000, maxRetries: 1 })) {}

  async complete(req: JsonRequest): Promise<JsonResponse> {
    const started = Date.now();
    const fallback = FALLBACK_MODELS.has(req.model);
    const res = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
      output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    let output: unknown = null;
    if (res.stop_reason !== "refusal") {
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      try {
        output = JSON.parse(text);
      } catch {
        output = null;
      }
    }
    return {
      output,
      stopReason: res.stop_reason,
      model: res.model,
      latencyMs: Date.now() - started,
      usage: {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
        cacheRead: res.usage.cache_read_input_tokens ?? 0,
        cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
