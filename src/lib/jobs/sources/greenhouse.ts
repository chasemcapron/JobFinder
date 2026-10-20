import { z } from "zod";
import { decodeHtmlEntities, htmlToText } from "@/lib/text";
import { parseLocation } from "../location";
import { finalizeJob, parseDate } from "../normalize";
import type { NormalizedJob } from "../types";
import { fetchJson, parseItems } from "./http";

/**
 * GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 * Shape verified against live responses (figma, stripe) on 2026-10-15:
 * { jobs: [{ id, title, company_name, location: { name }, absolute_url,
 *   first_published, updated_at, content (entity-escaped HTML), departments, offices, metadata }], meta: { total } }
 */
const GreenhouseJob = z.object({
  id: z.number(),
  title: z.string(),
  company_name: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  absolute_url: z.string(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  content: z.string().nullish(),
  offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
  metadata: z.array(z.object({ name: z.string().nullish(), value: z.unknown() })).nullish(),
});

const Envelope = z.object({ jobs: z.array(z.unknown()) });

// Work-arrangement words that say nothing about where the job is.
const VAGUE_LOCATION = /^\s*(?:hybrid|in[- ]?office|on[- ]?site|remote|flexible|multiple locations?|various)(?:\s*[;,/|]\s*(?:hybrid|in[- ]?office|on[- ]?site|remote))*\s*$/i;

/**
 * Many boards (Cloudflare: ~85% of postings) put only "Hybrid" or "In-Office" in `location`
 * and the real cities in a "Job Posting Location" custom field or in `offices`. Uses those
 * when the location is vague, US cities first, because the location parser reads the first
 * one and the app is US-only.
 */
export function greenhouseLocation(raw: Pick<z.infer<typeof GreenhouseJob>, "location" | "offices" | "metadata">): string | null {
  const name = raw.location?.name?.trim() ?? "";
  if (name && !VAGUE_LOCATION.test(name)) return name;
  const fromMetadata = (raw.metadata ?? [])
    .filter((m) => /location/i.test(m.name ?? ""))
    .flatMap((m) => (Array.isArray(m.value) ? m.value : [m.value]))
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  const fromOffices = (raw.offices ?? []).map((o) => o.location?.trim() || o.name?.trim() || "").filter(Boolean);
  const places = [...new Set(fromMetadata.length ? fromMetadata : fromOffices)];
  if (places.length === 0) return name || null;
  const usFirst = [...places].sort((a, b) => Number(parseLocation(b).country === "US") - Number(parseLocation(a).country === "US"));
  return `${/remote/i.test(name) ? "Remote; " : ""}${usFirst.join("; ")}`;
}

export function normalizeGreenhouseJob(raw: z.infer<typeof GreenhouseJob>, slug: string): NormalizedJob {
  return finalizeJob({
    source: "greenhouse",
    externalId: `${slug}:${raw.id}`,
    title: raw.title,
    company: raw.company_name?.trim() || slug,
    locationRaw: greenhouseLocation(raw),
    // `content` is HTML that has itself been entity-escaped once.
    description: raw.content ? htmlToText(decodeHtmlEntities(raw.content)) : "",
    applyUrl: raw.absolute_url,
    postedAt: parseDate(raw.first_published ?? raw.updated_at),
  });
}

/** `content: false` skips descriptions (a fraction of the size); used to size up a board quickly. */
export async function fetchGreenhouse(slug: string, signal: AbortSignal, opts: { content?: boolean } = {}): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=${opts.content === false ? "false" : "true"}`;
  const data = await fetchJson(url, Envelope, { signal, notFoundMessage: `No Greenhouse board named "${slug}"` });
  return parseItems(data.jobs, GreenhouseJob).map((j) => normalizeGreenhouseJob(j, slug));
}
