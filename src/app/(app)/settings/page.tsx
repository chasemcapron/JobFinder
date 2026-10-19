import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, CardHeader, FieldHint, Icon, inputClass, Label, linkClass, PageHeader, selectClass } from "@/components/ui";
import { EXPERIENCE_LEVELS, SHEET_FIELDS } from "@/db/schema";
import { env, featureStatus } from "@/lib/env";
import { DEFAULT_COLUMN_MAP, SHEET_FIELD_LABELS } from "@/lib/google/sheets";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { lastSearchRun } from "@/lib/jobs/results";
import { listTargetCompanies } from "@/lib/profile";
import { requireUser } from "@/lib/session";
import { addTargetCompany, savePreferences, saveSheetSettings } from "./actions";
import { SheetTest } from "./sheet-test";
import { TargetCompanyRow } from "./target-company-row";

export const metadata: Metadata = { title: "Settings · Job Finder" };
// "Test connection" calls the Google Sheets API.
export const maxDuration = 30;

export default async function SettingsPage() {
  const { profile } = await requireUser();
  const [companies, lastRun] = await Promise.all([listTargetCompanies(profile.userId), lastSearchRun(profile.userId)]);
  const lastResults = new Map((lastRun?.sourceResults ?? []).map((r) => [r.source, r]));
  const features = featureStatus();
  const columnMap = profile.sheetColumnMap ?? DEFAULT_COLUMN_MAP;
  const googleConfigured = env.googleConfigured;

  return (
    <>
      <PageHeader title="Settings" description="Search preferences, target companies, Google Sheet, and email." />
      <div className="flex flex-col gap-6">

      <Card>
        <CardHeader icon={<Icon name="search" />} title="Search preferences" description="Used to build search queries and to rank matches." />
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
              <FieldHint>Added on top of the keywords extracted from your resume.</FieldHint>
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
            <legend className="mb-2 text-[13px] font-medium">Experience levels</legend>
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
            <FieldHint>Leave all unchecked to consider every level.</FieldHint>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="remotePreference">Remote</Label>
              <select id="remotePreference" name="remotePreference" defaultValue={profile.remotePreference} className={selectClass}>
                <option value="any">Remote or on-site</option>
                <option value="remote_only">Remote only</option>
                <option value="onsite_only">On-site / hybrid only</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="emailEnabled" defaultChecked={profile.emailEnabled} className="size-4 accent-accent" />
            Email me the top new matches every morning (7:00 AM Central)
          </label>
          <p className="-mt-2 text-xs text-muted">
            Up to 10 matches scoring 50+ that haven&apos;t been emailed or applied to.{" "}
            <a href="/api/digest/preview" target="_blank" rel="noreferrer" className={linkClass}>
              Preview the email
            </a>
          </p>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader
          icon={<Icon name="building" />}
          title="Target companies"
          description={
            <>
              Greenhouse, Lever, and Ashby are searched per company. Add <code>ats:slug</code> (e.g.{" "}
              <code>greenhouse:stripe</code>) or paste a job board URL.
            </>
          }
        />
        {companies.length === 0 ? (
          <p className="mb-4 rounded-control border border-dashed border-border-strong px-3 py-4 text-center text-sm text-muted">
            No target companies yet.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-border rounded-control border border-border">
            {companies.map((c) => (
              <TargetCompanyRow
                key={c.id}
                id={c.id}
                ats={c.ats}
                slug={c.slug}
                enabled={c.enabled}
                lastResult={lastResults.get(`${c.ats}:${c.slug}`)}
              />
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
          icon={<Icon name="sheet" />}
          title="Google Sheet"
          description="When you mark a job as applied, a row is added below the last row of this sheet. Your sheet's own columns are kept: map each field to the column it belongs in, and leave the rest blank."
        />
        {!googleConfigured ? (
          <div className="mb-4">
            <Alert tone="warning">
              Google sign-in isn&apos;t configured on this deployment, so applications are saved here but not synced to a sheet.
            </Alert>
          </div>
        ) : null}
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
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Column mapping</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SHEET_FIELDS.map((field) => (
                <div key={field}>
                  <Label htmlFor={`col_${field}`}>{SHEET_FIELD_LABELS[field]}</Label>
                  <input
                    id={`col_${field}`}
                    name={`col_${field}`}
                    className={`${inputClass} uppercase`}
                    defaultValue={columnMap[field] ?? ""}
                    placeholder="—"
                    maxLength={3}
                    autoComplete="off"
                    aria-describedby="col-help"
                  />
                </div>
              ))}
            </div>
            <FieldHint id="col-help">
              Column letters (A, B, … AA). Blank = don&apos;t write that field. Save, then use Test connection to see your
              header row.
            </FieldHint>
          </fieldset>
        </ActionForm>
        <div className="mt-4 border-t border-border pt-4">
          <SheetTest disabled={!profile.sheetId || !googleConfigured} />
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Icon name="settings" />} title="Integrations" description="What's live and what's running in mock mode on this deployment." />
        <ul className="divide-y divide-border">
          {features.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="flex items-center gap-2 text-muted">
                {f.note}
                <Badge tone={f.configured ? "success" : "warning"} dot>{f.configured ? "Live" : "Mock"}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </>
  );
}
