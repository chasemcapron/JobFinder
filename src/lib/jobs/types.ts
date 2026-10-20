import type { ClearanceRequirement, ExperienceLevel, JobSource, Profile } from "@/db/schema";

/** The one normalized shape every source adapter returns. */
export type NormalizedJob = {
  source: JobSource;
  externalId: string;
  title: string;
  company: string;
  locationRaw: string | null;
  city: string | null;
  state: string | null;
  /** ISO 3166-1 alpha-2 */
  country: string | null;
  remote: boolean;
  experienceLevel: ExperienceLevel | null;
  /** Smallest "N+ years of experience" the description asks for. */
  minYears: number | null;
  /** Whether the posting needs a security clearance held already ("active") or sponsored ("obtain"). */
  clearance: ClearanceRequirement | null;
  /** Plain text */
  description: string;
  applyUrl: string;
  postedAt: Date | null;
  /** Annual amounts */
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
};

export type SearchQuery = {
  /** e.g. a target title like "Backend Engineer" */
  what: string;
  /** e.g. "Chicago, IL"; empty for anywhere */
  where: string | null;
  remoteOnly: boolean;
};

export type FetchContext = {
  signal: AbortSignal;
  profile: Pick<Profile, "adzunaCountry" | "remotePreference">;
};

/** One unit of fetching work, e.g. "greenhouse:stripe" or "adzuna: backend engineer". */
export type SourceTask = {
  label: string;
  source: JobSource;
  run: (ctx: FetchContext) => Promise<NormalizedJob[]>;
};

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
