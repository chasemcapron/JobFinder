import { z } from "zod";
import { env } from "@/lib/env";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Fast, cheap and usually available; bulk scoring starts here. */
export const GEMINI_LITE_MODEL = "gemini-3.5-flash-lite";

/** An older Flash-Lite with its own capacity: often still quick when the newer models are overloaded. */
export const GEMINI_BACKUP_MODEL = "gemini-3.1-flash-lite";

/** "quality" tries GEMINI_MODEL first (resume reading, fit checks); "fast" tries Flash-Lite first (bulk scoring). */
export type GeminiTier = "quality" | "fast";

/** Used when a caller passes no deadline. */
const DEFAULT_BUDGET_MS = 45_000;
/** No new attempt starts with less time than this left before the deadline. */
const MIN_ATTEMPT_MS = 2_000;

export function geminiConfigured(): boolean {
  return Boolean(env.geminiApiKey);
}

/**
 * Models to try, in order. Free-tier models regularly answer 503 "high demand" or 429 for a
 * while, and each model has its own capacity, so every call can fall back to the others.
 */
export function geminiModels(tier: GeminiTier): string[] {
  const chain =
    tier === "fast"
      ? [GEMINI_LITE_MODEL, GEMINI_BACKUP_MODEL, env.geminiModel]
      : [env.geminiModel, GEMINI_LITE_MODEL, GEMINI_BACKUP_MODEL];
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

type AttemptOutcome<T> =
  | { kind: "ok"; data: T; model: string }
  | { kind: "failed"; attempt: GeminiAttempt }
  | { kind: "fatal"; error: AiRequestError };

/** One request to one model. Never rejects: aborts and bad output come back as a failed attempt. */
async function attemptModel<S extends z.ZodType>(
  model: string,
  key: string,
  responseJsonSchema: Record<string, unknown>,
  opts: { schema: S; system: string; prompt: string; maxOutputTokens?: number },
  signal: AbortSignal,
  started: number,
): Promise<AttemptOutcome<z.infer<S>>> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseJsonSchema,
    temperature: 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? 8_192,
  };
  // Flash models think by default; "low" is their cheapest level and plenty for scoring and extraction.
  if (!model.includes("lite")) generationConfig.thinkingConfig = { thinkingLevel: "low" };

  const failed = (status: number | null, message: string): AttemptOutcome<never> => ({
    kind: "failed",
    attempt: { model, status, message },
  });
  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig,
      }),
      signal,
    });
    const body = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      const message = body.error?.message ?? `HTTP ${res.status}`;
      // A bad or restricted key fails the same way on every model.
      if (res.status === 401 || /API key not valid|API_KEY_INVALID/i.test(message)) {
        return { kind: "fatal", error: new AiRequestError("The Gemini API key was rejected. Check GEMINI_API_KEY.") };
      }
      return failed(res.status, message.slice(0, 200));
    }
    if (body.promptFeedback?.blockReason) {
      return { kind: "fatal", error: new AiRequestError(`Gemini declined this request (${body.promptFeedback.blockReason}).`) };
    }
    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return failed(res.status, `stopped early (${candidate.finishReason})`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return failed(res.status, "returned text that isn't JSON");
    }
    const result = opts.schema.safeParse(parsed);
    if (!result.success) return failed(res.status, "returned JSON that didn't match the expected shape");
    return { kind: "ok", data: result.data as z.infer<S>, model };
  } catch (err) {
    if (signal.aborted) return failed(null, `no answer after ${Math.round((Date.now() - started) / 1000)}s`);
    return failed(null, err instanceof Error ? err.message : String(err));
  }
}

/**
 * One structured-output call. The response is parsed and validated against `schema`.
 *
 * Starts with the tier's first model. A model that fails (busy, rate limited, bad output) is
 * replaced by the next one right away. A model that is merely slow keeps running: after
 * `hedgeAfterMs` the next model is asked as well, and the first valid answer wins. Nothing
 * runs past `deadline`.
 */
export async function geminiJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  tier?: GeminiTier;
  /** How long to wait for one model before also asking the next; null asks the next one only after a failure. */
  hedgeAfterMs?: number | null;
  /** Epoch ms when every attempt is abandoned (keeps callers inside Vercel's 60 s limit). */
  deadline?: number;
  maxOutputTokens?: number;
}): Promise<{ data: z.infer<S>; model: string }> {
  const key = env.geminiApiKey;
  if (!key) throw new AiRequestError("GEMINI_API_KEY is not configured");
  const responseJsonSchema = toGeminiSchema(opts.schema);
  const models = geminiModels(opts.tier ?? "quality");
  const deadline = opts.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const hedgeAfterMs = opts.hedgeAfterMs === undefined ? 20_000 : opts.hedgeAfterMs;
  const attempts: GeminiAttempt[] = [];

  const stop = new AbortController();
  const deadlineTimer = setTimeout(() => stop.abort(), Math.max(0, deadline - Date.now()));
  type Settled = { index: number; outcome: AttemptOutcome<z.infer<S>> };
  const running = new Map<number, Promise<Settled>>();
  let next = 0;
  let lastStart = 0;

  const canStart = () => next < models.length && deadline - Date.now() >= MIN_ATTEMPT_MS;
  const start = () => {
    const index = next++;
    lastStart = Date.now();
    const outcome = attemptModel(models[index], key, responseJsonSchema, opts, stop.signal, lastStart);
    running.set(index, outcome.then((o) => ({ index, outcome: o })));
  };

  try {
    if (canStart()) start();
    while (running.size > 0) {
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      const contenders: Promise<Settled | "hedge">[] = [...running.values()];
      if (hedgeAfterMs !== null && canStart()) {
        contenders.push(
          new Promise((resolve) => {
            hedgeTimer = setTimeout(() => resolve("hedge"), Math.max(0, lastStart + hedgeAfterMs - Date.now()));
          }),
        );
      }
      const settled = await Promise.race(contenders);
      clearTimeout(hedgeTimer);

      if (settled === "hedge") {
        if (canStart()) start();
        continue;
      }
      running.delete(settled.index);
      const { outcome } = settled;
      if (outcome.kind === "ok") return { data: outcome.data, model: outcome.model };
      if (outcome.kind === "fatal") throw outcome.error;
      attempts.push(outcome.attempt);
      if (canStart()) start();
    }
  } finally {
    clearTimeout(deadlineTimer);
    stop.abort(); // drop any attempt still running
  }

  throw new AiUnavailableError(describeAttempts(attempts), attempts);
}
