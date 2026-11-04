import { workdayApi } from "./sources/workday";

/**
 * Is a posting still open? Adapted from career-ops' liveness check (github.com/career-ops-hq/career-ops,
 * MIT), whose rule is that a false "closed" is worse than not knowing: anything ambiguous is
 * "uncertain", and only uncertain-free answers close a job.
 *
 * Workday: the posting's own JSON endpoint (the one the career site uses) answers 200 while it's
 * open and 404 once it's gone; a 403 whose body carries errorCode "S22" also means withdrawn. Any
 * other answer (a Cloudflare page, 429, 5xx, a timeout) is uncertain.
 */
export type Liveness = "live" | "closed" | "uncertain";

/** "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin-TX/Analyst_R123" -> the posting's API URL. */
export function workdayPostingApi(applyUrl: string): string | null {
  const m = applyUrl.match(/^https:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)(\/job\/[^?#]+)/i);
  if (!m) return null;
  return `${workdayApi({ tenant: m[1].toLowerCase(), dataCenter: m[2].toLowerCase(), site: m[3] })}${m[4]}`;
}

export async function checkWorkdayLiveness(applyUrl: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Liveness> {
  const url = workdayPostingApi(applyUrl);
  if (!url) return "uncertain";
  const signals = [AbortSignal.timeout(opts.timeoutMs ?? 4_000), ...(opts.signal ? [opts.signal] : [])];
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.any(signals), redirect: "manual", cache: "no-store" });
  } catch {
    return "uncertain";
  }
  if (res.status === 404 || res.status === 410) return "closed";
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { errorCode?: string } | null;
    return body?.errorCode === "S22" ? "closed" : "uncertain";
  }
  if (res.status !== 200) return "uncertain";
  const body = (await res.json().catch(() => null)) as { jobPostingInfo?: unknown } | null;
  return body?.jobPostingInfo ? "live" : "uncertain";
}

/**
 * Checks postings with a small worker pool inside a time budget; ones not reached stay unknown
 * (absent from the result). Only Workday postings are checked: the hosted boards are checked by
 * their full fetch instead (see closeMissingPostings in search.ts).
 */
export async function checkLiveness<J extends { id: string; source: string; applyUrl: string }>(
  postings: J[],
  opts: { budgetMs?: number; concurrency?: number; timeoutMs?: number } = {},
): Promise<Map<string, Liveness>> {
  const out = new Map<string, Liveness>();
  const queue = postings.filter((p) => p.source === "workday");
  const stop = AbortSignal.timeout(opts.budgetMs ?? 8_000);
  let next = 0;
  const worker = async () => {
    while (next < queue.length && !stop.aborted) {
      const p = queue[next++];
      out.set(p.id, await checkWorkdayLiveness(p.applyUrl, { timeoutMs: opts.timeoutMs, signal: stop }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, queue.length) }, worker));
  return out;
}
