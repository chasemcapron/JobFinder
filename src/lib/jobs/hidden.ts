import type { DismissReason } from "@/db/schema";
import { normalizeForKey } from "@/lib/text";
import { roleKey } from "./normalize";

/** "Not interested", the parts safe for the browser: labels and matching. Saving is in dismissals.ts. */

/** Why a job is hidden: its role was dismissed, or its company is hidden. */
export type HiddenState = { by: "role"; reason: DismissReason } | { by: "company" };

export type HiddenSet = { roles: Map<string, DismissReason>; companies: Set<string> };

export const DISMISS_LABELS: Record<DismissReason | "company", string> = {
  not_relevant: "Not my field",
  too_senior: "Wrong level",
  location: "Wrong location",
  other: "Something else",
  company: "Not this company",
};

export function companyKey(company: string): string {
  return normalizeForKey(company);
}

export function hiddenState(job: { company: string; title: string }, hidden: HiddenSet): HiddenState | null {
  if (hidden.companies.has(companyKey(job.company))) return { by: "company" };
  const reason = hidden.roles.get(roleKey(job));
  return reason ? { by: "role", reason } : null;
}
