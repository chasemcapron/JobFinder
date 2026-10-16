import { z } from "zod";
import { htmlToText } from "@/lib/text";
import { annualize } from "../salary";
import { companyFromSlug, finalizeJob, parseDate } from "../normalize";
import type { NormalizedJob } from "../types";
import { fetchJson, parseItems } from "./http";

/**
 * GET https://api.lever.co/v0/postings/{site}?mode=json
 * Shape verified against a live response (spotify) on 2026-10-15: a top-level array of
 * { id, text (title), categories: { location, allLocations, commitment, team, department },
 *   country (ISO-2), workplaceType ("remote"|"hybrid"|"onsite"), createdAt (epoch ms),
 *   descriptionPlain, lists: [{ text, content (HTML) }], additionalPlain, hostedUrl, applyUrl }.
 * No company name is returned. `salaryRange` ({ min, max, currency, interval }) is documented by
 * Lever but absent from that board, so it's optional here.
 */
const LeverJob = z.object({
  id: z.string(),
  text: z.string(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      commitment: z.string().nullish(),
    })
    .nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  createdAt: z.number().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additionalPlain: z.string().nullish(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
});

export function normalizeLeverJob(raw: z.infer<typeof LeverJob>, slug: string): NormalizedJob {
  const sections = (raw.lists ?? [])
    .map((l) => [l.text, l.content ? htmlToText(l.content) : ""].filter(Boolean).join("\n"))
    .filter(Boolean);
  const description = [raw.descriptionPlain, ...sections, raw.additionalPlain].filter(Boolean).join("\n\n");
  const workplace = raw.workplaceType?.toLowerCase();
  const salary = raw.salaryRange;
  return finalizeJob({
    source: "lever",
    externalId: `${slug}:${raw.id}`,
    title: raw.text,
    company: companyFromSlug(slug),
    locationRaw: raw.categories?.allLocations?.join(" • ") || raw.categories?.location || null,
    countryHint: raw.country,
    remote: workplace === "remote" ? true : workplace === "onsite" || workplace === "hybrid" ? false : undefined,
    experienceLevel: /intern/i.test(raw.categories?.commitment ?? "") ? "internship" : undefined,
    description,
    applyUrl: raw.hostedUrl,
    postedAt: parseDate(raw.createdAt),
    salaryMin: annualize(salary?.min, salary?.interval),
    salaryMax: annualize(salary?.max, salary?.interval),
    salaryCurrency: salary?.min != null || salary?.max != null ? (salary?.currency ?? null) : undefined,
  });
}

export async function fetchLever(slug: string, signal: AbortSignal): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const data = await fetchJson(url, z.array(z.unknown()), { signal, notFoundMessage: `No Lever board named "${slug}"` });
  return parseItems(data, LeverJob).map((j) => normalizeLeverJob(j, slug));
}
