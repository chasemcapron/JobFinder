import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "@/lib/env";

let client: Anthropic | null = null;

/** Null when ANTHROPIC_API_KEY isn't set; callers fall back to heuristics. */
export function getClaude(): Anthropic | null {
  if (!env.anthropicApiKey) return null;
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, timeout: 60_000, maxRetries: 2 });
  return client;
}

export class ClaudeRefusalError extends Error {}

/**
 * One structured-output call: returns the response parsed and validated against `schema`.
 * Opts into server-side refusal fallbacks so a classifier decline is retried on another model.
 */
export async function claudeJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  const claude = getClaude();
  if (!claude) throw new Error("ANTHROPIC_API_KEY is not configured");
  const response = await claude.beta.messages.parse({
    model: env.anthropicModel,
    max_tokens: opts.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
  });
  if (response.stop_reason === "refusal") {
    throw new ClaudeRefusalError("Claude declined this request.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Claude's response was cut off (max_tokens).");
  }
  if (response.parsed_output == null) {
    throw new Error("Claude returned output that didn't match the expected format.");
  }
  return response.parsed_output as z.infer<S>;
}
