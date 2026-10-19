import { z } from "zod";
import { env } from "@/lib/env";
import { htmlToText } from "@/lib/text";
import { finalizeJob, parseDate } from "../normalize";
import type { NormalizedJob, SearchQuery } from "../types";
import { fetchJson, parseItems } from "./http";

/**
 * GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id&app_key&what&where&results_per_page
 * Shape taken from Adzuna's docs (developer.adzuna.com/docs/search), NOT yet verified live —
 * no API key was available while building. Fields used:
 * { results: [{ id, title, company: { display_name }, location: { display_name, area: string[] },
 *   description (snippet only), redirect_url, created, salary_min, salary_max, salary_is_predicted,
 *   contract_time, category: { label, tag } }] }
 * Kept deliberately lenient (numbers-or-strings, everything optional) until verified.
 *
 * Terms: every displayed Adzuna ad must carry an "Adzuna" link (see AdzunaAttribution).
 * Adzuna isn't free, so this source stays off unless keys are set; each run makes at most MAX_ADZUNA_QUERIES calls.
 */
export const MAX_ADZUNA_QUERIES = 2;

const numberish = z.union([z.number(), z.string()]).nullish();

const AdzunaJob = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  company: z.object({ display_name: z.string().nullish() }).nullish(),
  location: z.object({ display_name: z.string().nullish(), area: z.array(z.string()).nullish() }).nullish(),
  description: z.string().nullish(),
  redirect_url: z.string(),
  created: z.string().nullish(),
  salary_min: numberish,
  salary_max: numberish,
  salary_is_predicted: numberish.or(z.boolean()),
  contract_time: z.string().nullish(),
});

const Envelope = z.object({ results: z.array(z.unknown()) });

const CURRENCY: Record<string, string> = {
  us: "USD", gb: "GBP", ca: "CAD", au: "AUD", nz: "NZD", in: "INR", sg: "SGD", za: "ZAR", br: "BRL", mx: "MXN",
  pl: "PLN", ch: "CHF", at: "EUR", be: "EUR", de: "EUR", es: "EUR", fr: "EUR", it: "EUR", nl: "EUR",
};

/** Adzuna's local site for the attribution link the terms require. */
export function adzunaHomepage(country: string | null | undefined): string {
  const domains: Record<string, string> = {
    gb: "www.adzuna.co.uk", au: "www.adzuna.com.au", ca: "www.adzuna.ca", de: "www.adzuna.de", fr: "www.adzuna.fr",
    in: "www.adzuna.in", it: "www.adzuna.it", nl: "www.adzuna.nl", nz: "www.adzuna.co.nz", pl: "www.adzuna.pl",
    sg: "www.adzuna.sg", za: "www.adzuna.co.za", br: "www.adzuna.com.br", mx: "www.adzuna.com.mx",
    at: "www.adzuna.at", be: "www.adzuna.be", ch: "www.adzuna.ch", es: "www.adzuna.es",
  };
  return `https://${domains[(country ?? "").toLowerCase()] ?? "www.adzuna.com"}`;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function normalizeAdzunaJob(raw: z.infer<typeof AdzunaJob>, country: string): NormalizedJob {
  // area is general -> specific, e.g. ["US", "Illinois", "Cook County", "Chicago"]
  const area = raw.location?.area ?? [];
  const predicted = raw.salary_is_predicted === true || raw.salary_is_predicted === 1 || raw.salary_is_predicted === "1";
  const title = htmlToText(raw.title); // titles can contain <strong> highlight tags
  return finalizeJob({
    source: "adzuna",
    externalId: raw.id,
    title,
    company: raw.company?.display_name?.trim() || "Unknown company",
    locationRaw: raw.location?.display_name ?? (area.length ? [...area].reverse().join(", ") : null),
    countryHint: country,
    city: area.length >= 3 ? area[area.length - 1] : undefined,
    remote: /\bremote\b/i.test(title) || undefined,
    description: htmlToText(raw.description ?? ""),
    applyUrl: raw.redirect_url,
    postedAt: parseDate(raw.created),
    // Predicted salaries are Adzuna estimates, which carry extra attribution terms; skip them.
    salaryMin: predicted ? null : num(raw.salary_min),
    salaryMax: predicted ? null : num(raw.salary_max),
    salaryCurrency: predicted || (!num(raw.salary_min) && !num(raw.salary_max)) ? undefined : (CURRENCY[country] ?? null),
  });
}

export function adzunaConfigured() {
  return Boolean(env.adzunaAppId && env.adzunaAppKey);
}

export async function fetchAdzuna(query: SearchQuery, country: string, signal: AbortSignal): Promise<NormalizedJob[]> {
  const params = new URLSearchParams({
    app_id: env.adzunaAppId ?? "",
    app_key: env.adzunaAppKey ?? "",
    results_per_page: "50",
    what: query.remoteOnly ? `${query.what} remote` : query.what,
    max_days_old: "30",
    sort_by: "date",
    "content-type": "application/json",
  });
  if (query.where) params.set("where", query.where);
  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1?${params}`;
  const data = await fetchJson(url, Envelope, { signal });
  return parseItems(data.results, AdzunaJob).map((j) => normalizeAdzunaJob(j, country));
}
