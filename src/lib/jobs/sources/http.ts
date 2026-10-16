import type { z } from "zod";
import { SourceError } from "../types";

const USER_AGENT = "job-finder (personal job search app; +https://github.com)";

/** GET a JSON endpoint and validate the envelope. 404 becomes a readable "not found" error. */
export async function fetchJson<S extends z.ZodType>(
  url: string,
  schema: S,
  opts: { signal: AbortSignal; headers?: Record<string, string>; notFoundMessage?: string },
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...opts.headers },
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (opts.signal.aborted) throw new SourceError("Timed out");
    throw new SourceError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 404) throw new SourceError(opts.notFoundMessage ?? "Not found (404)", 404);
  if (res.status === 401 || res.status === 403) throw new SourceError(`Unauthorized (${res.status}); check the API key`, res.status);
  if (res.status === 429) throw new SourceError("Rate limited (429)", 429);
  if (!res.ok) throw new SourceError(`HTTP ${res.status}`, res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SourceError("Response was not valid JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new SourceError(`Unexpected response shape: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

/** Parses each item on its own so one malformed posting doesn't drop the whole board. */
export function parseItems<S extends z.ZodType>(items: unknown[], schema: S): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}
