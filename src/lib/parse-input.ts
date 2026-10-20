import { ATS_TYPES, type AtsType } from "@/db/schema";

/** Splits comma- or newline-separated user input into a trimmed, de-duplicated list. */
export function parseList(input: string | null | undefined, maxItems = 50): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\n,]/)) {
    const item = raw.trim().replace(/\s+/g, " ");
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Accepts a bare spreadsheet ID or a full Google Sheets URL and returns the ID.
 * Returns null for empty input and throws for something that isn't either.
 */
export function parseSheetId(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  const fromUrl = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  throw new Error("That doesn't look like a Google Sheet ID or URL.");
}

export type TargetCompanyInput = { ats: AtsType; slug: string };

const WORKDAY_EXAMPLE = "https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers";

/**
 * Workday sites are stored as "tenant.wdN/site" (site keeps its case; it names the company). From
 * https://{tenant}.wd{N}.myworkdayjobs.com/[en-US/]{site}/..., the newer
 * https://wd{N}.myworkdaysite.com/[en-US/]recruiting/{tenant}/{site}/... (same API), or "workday:tenant.wdN/site".
 */
function parseWorkdayTarget(value: string): TargetCompanyInput | null {
  const slug = (tenant: string, dataCenter: string, site: string): TargetCompanyInput => ({
    ats: "workday",
    slug: `${tenant.toLowerCase()}.${dataCenter.toLowerCase()}/${site}`,
  });
  const jobs = value.match(/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?(?:wday\/cxs\/[\w-]+\/)?([\w-]+)/i);
  if (jobs) return slug(jobs[1], jobs[2], jobs[3]);
  const site = value.match(/(wd\d+)\.myworkdaysite\.com\/(?:[a-z]{2}-[a-z]{2}\/)?(?:recruiting|wday\/cxs)\/([\w-]+)\/([\w-]+)/i);
  if (site) return slug(site[2], site[1], site[3]);
  const typed = value.match(/^workday\s*:\s*([a-z0-9-]+)\.(wd\d+)\/([\w-]+)$/i);
  if (typed) return slug(typed[1], typed[2], typed[3]);
  if (/^workday\s*:|myworkday(jobs|site)\.com/i.test(value)) {
    throw new Error(`Paste the Workday careers page URL, e.g. ${WORKDAY_EXAMPLE} (got "${value}").`);
  }
  return null;
}

/**
 * Parses "ats:slug" (e.g. "greenhouse:stripe"). Also accepts board URLs such as
 * https://boards.greenhouse.io/stripe, https://jobs.lever.co/spotify, https://jobs.ashbyhq.com/linear,
 * and Workday careers pages (see parseWorkdayTarget).
 */
export function parseTargetCompany(input: string): TargetCompanyInput {
  const value = input.trim();
  const workday = parseWorkdayTarget(value);
  if (workday) return workday;
  const urlPatterns: [AtsType, RegExp][] = [
    ["greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i],
    ["lever", /jobs\.(?:eu\.)?lever\.co\/([\w-]+)/i],
    ["ashby", /jobs\.ashbyhq\.com\/([\w.-]+)/i],
  ];
  for (const [ats, re] of urlPatterns) {
    const m = value.match(re);
    if (m) return { ats, slug: m[1].toLowerCase() };
  }
  const m = value.match(/^([a-z]+)\s*:\s*([\w.-]+)$/i);
  if (!m) throw new Error(`Use the form ats:slug, e.g. greenhouse:stripe (got "${value}").`);
  const ats = m[1].toLowerCase();
  if (!(ATS_TYPES as readonly string[]).includes(ats)) {
    throw new Error(`Unknown ATS "${m[1]}". Use one of: ${ATS_TYPES.join(", ")}.`);
  }
  return { ats: ats as AtsType, slug: m[2].toLowerCase() };
}

/** Validates a spreadsheet column letter (A..ZZZ). Returns uppercase or null for blank. */
export function parseColumnLetter(input: string | null | undefined): string | null {
  const value = input?.trim().toUpperCase();
  if (!value) return null;
  if (!/^[A-Z]{1,3}$/.test(value)) throw new Error(`"${input}" is not a column letter.`);
  return value;
}
