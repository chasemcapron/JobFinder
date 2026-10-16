import type { Profile } from "@/db/schema";
import type { SearchQuery } from "./types";

/**
 * Keyword search sources (Adzuna, USAJobs) need a query. Uses the top target titles,
 * falling back to search keywords, then skills. Each query pairs with the first preferred
 * location (if any) to keep the number of API calls small.
 */
export function buildSearchQueries(
  profile: Pick<Profile, "titles" | "searchKeywords" | "skills" | "preferredLocations" | "remotePreference">,
  max: number,
): SearchQuery[] {
  const terms = [...profile.titles, ...profile.searchKeywords];
  if (terms.length === 0 && profile.skills.length) terms.push(profile.skills.slice(0, 3).join(" "));
  const seen = new Set<string>();
  const queries: SearchQuery[] = [];
  const where = profile.remotePreference === "remote_only" ? null : (profile.preferredLocations[0] ?? null);
  for (const term of terms) {
    const what = term.trim();
    if (!what || seen.has(what.toLowerCase())) continue;
    seen.add(what.toLowerCase());
    queries.push({ what, where, remoteOnly: profile.remotePreference === "remote_only" });
    if (queries.length >= max) break;
  }
  return queries;
}
