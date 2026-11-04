/** The setup guide on the Jobs page: what a new user still has to do, worked out from their data. */

export type SetupStep = { id: string; label: string; hint: string; href: string; done: boolean; optional?: boolean };

export type SetupInput = {
  resumeText: string | null;
  titles: string[];
  preferredLocations: string[];
  experienceLevels: string[];
  remotePreference: string;
  enabledCompanies: number;
  sheetId: string | null;
  searched: boolean;
};

export function setupSteps(p: SetupInput): SetupStep[] {
  return [
    { id: "resume", label: "Upload your resume", hint: "Jobs are ranked against it.", href: "/resume", done: Boolean(p.resumeText?.trim()) },
    { id: "titles", label: "Check your target titles", hint: "The roles you want; searches use them.", href: "/resume", done: p.titles.length > 0 },
    {
      id: "preferences",
      label: "Set your locations and level",
      hint: "Where you'll work, remote or not, and how senior.",
      href: "/settings#preferences",
      done: p.preferredLocations.length > 0 || p.experienceLevels.length > 0 || p.remotePreference !== "any",
    },
    {
      id: "companies",
      label: "Add employers to search",
      hint: "Pick from the Workday list or let the AI suggest some.",
      href: "/settings#companies",
      done: p.enabledCompanies > 0,
    },
    { id: "sheet", label: "Connect a Google Sheet", hint: "Optional: applications are added to it.", href: "/settings#sheet", done: Boolean(p.sheetId), optional: true },
    { id: "search", label: "Run your first search", hint: "Click Refresh jobs above; after that it runs every morning.", href: "/jobs", done: p.searched },
  ];
}

/** Every required step is done (the sheet is optional). */
export function setupComplete(steps: SetupStep[]): boolean {
  return steps.every((s) => s.done || s.optional);
}
