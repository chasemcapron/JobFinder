import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, inputClass, Label, PageHeader } from "@/components/ui";
import { EXPERIENCE_LEVELS } from "@/db/schema";
import { featureStatus } from "@/lib/env";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { ADZUNA_COUNTRIES } from "@/lib/jobs/sources/adzuna-countries";
import { listTargetCompanies } from "@/lib/profile";
import { requireUser } from "@/lib/session";
import { addTargetCompany, savePreferences, saveSheetSettings } from "./actions";
import { TargetCompanyRow } from "./target-company-row";

export const metadata: Metadata = { title: "Settings · Job Finder" };

export default async function SettingsPage() {
  const { profile } = await requireUser();
  const companies = await listTargetCompanies(profile.userId);
  const features = featureStatus();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Search preferences, target companies, Google Sheet, and email." />

      <Card>
        <CardHeader title="Search preferences" description="Used to build search queries and to rank matches." />
        <ActionForm action={savePreferences}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="searchKeywords" hint="(comma or newline separated)">
                Keywords
              </Label>
              <textarea
                id="searchKeywords"
                name="searchKeywords"
                rows={3}
                className={inputClass}
                defaultValue={profile.searchKeywords.join(", ")}
                placeholder="e.g. TypeScript, React, data pipelines"
              />
              <p className="mt-1 text-xs text-muted">Added on top of the keywords extracted from your resume.</p>
            </div>
            <div>
              <Label htmlFor="preferredLocations" hint="(comma or newline separated)">
                Preferred locations
              </Label>
              <textarea
                id="preferredLocations"
                name="preferredLocations"
                rows={3}
                className={inputClass}
                defaultValue={profile.preferredLocations.join("\n")}
                placeholder={"e.g. Chicago, IL\nAustin, TX"}
              />
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Experience levels</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {EXPERIENCE_LEVELS.map((level) => (
                <label key={level} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="experienceLevels"
                    value={level}
                    defaultChecked={profile.experienceLevels.includes(level)}
                    className="size-4 accent-accent"
                  />
                  {EXPERIENCE_LABELS[level]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Leave all unchecked to consider every level.</p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="remotePreference">Remote</Label>
              <select id="remotePreference" name="remotePreference" defaultValue={profile.remotePreference} className={inputClass}>
                <option value="any">Remote or on-site</option>
                <option value="remote_only">Remote only</option>
                <option value="onsite_only">On-site / hybrid only</option>
              </select>
            </div>
            <div>
              <Label htmlFor="adzunaCountry">Adzuna search country</Label>
              <select id="adzunaCountry" name="adzunaCountry" defaultValue={profile.adzunaCountry} className={inputClass}>
                {ADZUNA_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="emailEnabled" defaultChecked={profile.emailEnabled} className="size-4 accent-accent" />
            Email me the top new matches every morning (7:00 AM Central)
          </label>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader
          title="Target companies"
          description={
            <>
              Greenhouse, Lever, and Ashby are searched per company. Add <code>ats:slug</code> (e.g.{" "}
              <code>greenhouse:stripe</code>) or paste a job board URL.
            </>
          }
        />
        {companies.length === 0 ? (
          <p className="mb-4 text-sm text-muted">No target companies yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-border rounded-md border border-border">
            {companies.map((c) => (
              <TargetCompanyRow key={c.id} id={c.id} ats={c.ats} slug={c.slug} enabled={c.enabled} />
            ))}
          </ul>
        )}
        <ActionForm action={addTargetCompany} submitLabel="Add" resetOnSuccess>
          <div>
            <Label htmlFor="company">Add companies</Label>
            <input
              id="company"
              name="company"
              className={inputClass}
              placeholder="lever:spotify, https://jobs.ashbyhq.com/linear"
              autoComplete="off"
            />
          </div>
        </ActionForm>
      </Card>

      <Card id="sheet">
        <CardHeader
          title="Google Sheet"
          description="When you mark a job as applied, a row is appended to this sheet. Paste the sheet URL or ID."
        />
        <ActionForm action={saveSheetSettings}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sheetId">Sheet URL or ID</Label>
              <input
                id="sheetId"
                name="sheetId"
                className={inputClass}
                defaultValue={profile.sheetId ?? ""}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="sheetTab" hint="(optional)">
                Tab name
              </Label>
              <input
                id="sheetTab"
                name="sheetTab"
                className={inputClass}
                defaultValue={profile.sheetTab ?? ""}
                placeholder="Defaults to the first tab"
                autoComplete="off"
              />
            </div>
          </div>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Integrations" description="What's live and what's running in mock mode on this deployment." />
        <ul className="divide-y divide-border">
          {features.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="flex items-center gap-2 text-muted">
                {f.note}
                <Badge tone={f.configured ? "green" : "amber"}>{f.configured ? "Live" : "Mock"}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
