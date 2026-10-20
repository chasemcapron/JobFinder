import type { z } from "zod";
import { env } from "@/lib/env";
import { claudeJson } from "./claude";
import { geminiJson, type GeminiTier } from "./gemini";

export type AiProvider = "gemini" | "claude";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { gemini: "Gemini", claude: "Claude" };

/** Gemini (free tier) wins when both keys are set; null means the app runs on keyword matching only. */
export function aiProvider(): AiProvider | null {
  if (env.geminiApiKey) return "gemini";
  if (env.anthropicApiKey) return "claude";
  return null;
}

export function aiLabel(): string | null {
  const p = aiProvider();
  return p ? AI_PROVIDER_LABELS[p] : null;
}

/**
 * One structured-output call to whichever provider is configured. Throws when none is;
 * callers check `aiProvider()` first and keep their non-AI fallback.
 */
export async function aiJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  tier?: GeminiTier;
  maxTokens?: number;
  timeoutMs?: number;
  deadline?: number;
}): Promise<{ data: z.infer<S>; provider: AiProvider; model: string }> {
  const provider = aiProvider();
  if (provider === "gemini") {
    const { data, model } = await geminiJson({
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
      tier: opts.tier,
      timeoutMs: opts.timeoutMs,
      deadline: opts.deadline,
      maxOutputTokens: opts.maxTokens,
    });
    return { data, provider, model };
  }
  if (provider === "claude") {
    const data = await claudeJson({ schema: opts.schema, system: opts.system, prompt: opts.prompt, maxTokens: opts.maxTokens });
    return { data, provider, model: env.anthropicModel };
  }
  throw new Error("No AI provider is configured (set GEMINI_API_KEY).");
}
