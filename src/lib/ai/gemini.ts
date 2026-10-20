import { z } from "zod";
import { env } from "@/lib/env";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Fast, cheap and usually available; bulk scoring starts here. */
export const GEMINI_LITE_MODEL = "gemini-3.5-flash-lite";

/** "quality" tries GEMINI_MODEL first (resume reading, fit checks); "fast" tries Flash-Lite first (bulk scoring). */
export type GeminiTier = "quality" | "fast";

export function geminiConfigured(): boolean {
  return Boolean(env.geminiApiKey);
}

/**
 * Models to try, in order. Free-tier models regularly answer 503 "high demand" or 429 for a
 * while, so every call falls back to the other model instead of failing outright.
 */
export function geminiModels(tier: GeminiTier): string[] {
  const chain = tier === "fast" ? [GEMINI_LITE_MODEL, env.geminiModel] : [env.geminiModel, GEMINI_LITE_MODEL];
  return [...new Set(chain)];
}

export type GeminiAttempt = { model: string; status: number | null; message: string };

/** Every model was busy, rate limited, timed out or returned unusable output. Safe to fall back. */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    readonly attempts: GeminiAttempt[],
  ) {
    super(message);
  }
  get rateLimited() {
    return this.attempts.some((a) => a.status === 429);
  }
}

/** The request itself is wrong (bad key, blocked content). Retrying another model won't help. */
export class AiRequestError extends Error {}

/** Zod -> the JSON Schema subset Gemini accepts (it rejects the "$schema" keyword). */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

function describeAttempts(attempts: GeminiAttempt[]): string {
  if (attempts.length === 0) return "Gemini didn't respond in time.";
  if (attempts.every((a) => a.status === 429)) return "Gemini's free-tier limit is used up for now. Try again later.";
  if (attempts.some((a) => a.status === 503 || a.status === 429 || a.status === null)) {
    return "Gemini is busy right now. Try again in a minute.";
  }
  return `Gemini failed: ${attempts.map((a) => `${a.model}: ${a.message}`).join("; ")}`.slice(0, 400);
}

/**
 * One structured-output call. The response is parsed and validated against `schema`.
 * Tries each model in the tier's chain with a per-attempt timeout, and never runs past `deadline`.
 */
export async function geminiJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  tier?: GeminiTier;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Epoch ms after which no new attempt starts (keeps callers inside Vercel's 60 s limit). */
  deadline?: number;
  maxOutputTokens?: number;
}): Promise<{ data: z.infer<S>; model: string }> {
  const key = env.geminiApiKey;
  if (!key) throw new AiRequestError("GEMINI_API_KEY is not configured");
  const responseJsonSchema = toGeminiSchema(opts.schema);
  const attempts: GeminiAttempt[] = [];

  for (const model of geminiModels(opts.tier ?? "quality")) {
    const remaining = (opts.deadline ?? Infinity) - Date.now();
    if (remaining < 2_000) break;
    const timeoutMs = Math.min(opts.timeoutMs ?? 25_000, remaining);
    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json",
      responseJsonSchema,
      temperature: 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 8_192,
    };
    // Flash models think by default; "low" is their cheapest level and plenty for scoring and extraction.
    if (!model.includes("lite")) generationConfig.thinkingConfig = { thinkingLevel: "low" };

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      attempts.push({ model, status: null, message: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : String(err) });
      continue;
    }

    const body = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      const message = body.error?.message ?? `HTTP ${res.status}`;
      // A bad or restricted key fails the same way on every model.
      if (res.status === 401 || /API key not valid|API_KEY_INVALID/i.test(message)) {
        throw new AiRequestError("The Gemini API key was rejected. Check GEMINI_API_KEY.");
      }
      attempts.push({ model, status: res.status, message: message.slice(0, 200) });
      continue;
    }
    if (body.promptFeedback?.blockReason) {
      throw new AiRequestError(`Gemini declined this request (${body.promptFeedback.blockReason}).`);
    }
    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      attempts.push({ model, status: res.status, message: `stopped early (${candidate.finishReason})` });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      attempts.push({ model, status: res.status, message: "returned text that isn't JSON" });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      attempts.push({ model, status: res.status, message: "returned JSON that didn't match the expected shape" });
      continue;
    }
    return { data: result.data as z.infer<S>, model };
  }

  throw new AiUnavailableError(describeAttempts(attempts), attempts);
}
