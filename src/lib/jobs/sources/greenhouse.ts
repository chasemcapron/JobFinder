import { z } from "zod";
import { decodeHtmlEntities, htmlToText } from "@/lib/text";
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
});

const Envelope = z.object({ jobs: z.array(z.unknown()) });

export function normalizeGreenhouseJob(raw: z.infer<typeof GreenhouseJob>, slug: string): NormalizedJob {
  return finalizeJob({
    source: "greenhouse",
    externalId: `${slug}:${raw.id}`,
    title: raw.title,
    company: raw.company_name?.trim() || slug,
    locationRaw: raw.location?.name ?? null,
    // `content` is HTML that has itself been entity-escaped once.
    description: raw.content ? htmlToText(decodeHtmlEntities(raw.content)) : "",
    applyUrl: raw.absolute_url,
    postedAt: parseDate(raw.first_published ?? raw.updated_at),
  });
}

export async function fetchGreenhouse(slug: string, signal: AbortSignal): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
  const data = await fetchJson(url, Envelope, { signal, notFoundMessage: `No Greenhouse board named "${slug}"` });
  return parseItems(data.jobs, GreenhouseJob).map((j) => normalizeGreenhouseJob(j, slug));
}
