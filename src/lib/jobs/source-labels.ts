import type { JobSource } from "@/db/schema";

/** Display names for job sources (client-safe: no server imports). */
export const SOURCE_LABELS: Record<JobSource, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  smartrecruiters: "SmartRecruiters",
  adzuna: "Adzuna",
  usajobs: "USAJobs",
  mock: "Sample data",
};
