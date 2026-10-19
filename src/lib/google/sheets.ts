import type { SheetColumnMap, SheetField } from "@/db/schema";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export const SHEET_FIELD_LABELS: Record<SheetField, string> = {
  company: "Company",
  title: "Job title",
  dateApplied: "Date applied",
  link: "Link",
  location: "Location",
  status: "Status",
  source: "Source",
  score: "Match score",
};

/** Used until the user saves their own mapping. Matches the example in the brief. */
export const DEFAULT_COLUMN_MAP: SheetColumnMap = {
  company: "A",
  title: "B",
  dateApplied: "C",
  link: "D",
  location: "E",
  status: "F",
};

/** "A" -> 0, "Z" -> 25, "AA" -> 26 */
export function columnIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Text from job postings goes into the sheet with USER_ENTERED, which would evaluate
 * anything starting with = + - @ as a formula. Prefixing an apostrophe stores it as text.
 */
export function asText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export type SheetRowValues = Partial<Record<SheetField, string | number>>;

/**
 * Lays out values by the column mapping: returns the cells from the first to the last mapped
 * column, with null (= "leave this cell alone") for columns that aren't mapped.
 */
export function buildRow(map: SheetColumnMap, values: SheetRowValues): { startColumn: string; cells: (string | number | null)[] } {
  const entries = (Object.entries(map) as [SheetField, string | undefined][]).filter(
    (e): e is [SheetField, string] => Boolean(e[1]) && values[e[0]] !== undefined,
  );
  if (entries.length === 0) throw new Error("No sheet columns are mapped.");
  const indexes = entries.map(([, col]) => columnIndex(col));
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  const cells: (string | number | null)[] = Array.from({ length: last - first + 1 }, () => null);
  for (const [field, col] of entries) {
    const v = values[field]!;
    cells[columnIndex(col) - first] = typeof v === "string" && field !== "dateApplied" ? asText(v) : v;
  }
  return { startColumn: columnLetter(first), cells };
}

/** A1 prefix for a tab: "'My Tab'!" or "" for the first sheet. */
export function tabPrefix(tab: string | null | undefined): string {
  return tab ? `'${tab.replace(/'/g, "''")}'!` : "";
}

export class SheetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(fetchImpl: typeof fetch, token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 404) throw new SheetsApiError("Spreadsheet not found. Check the sheet ID.", 404);
    if (res.status === 403) throw new SheetsApiError(`No access to that spreadsheet (${msg}). Make sure it's in your Google account.`, 403);
    if (res.status === 400 && /parse range/i.test(msg)) throw new SheetsApiError("That tab name doesn't exist in the spreadsheet.", 400);
    throw new SheetsApiError(`Google Sheets error: ${msg}`, res.status);
  }
  return body;
}

/**
 * Fields that only have a value on a real application row. Trackers often pre-fill other
 * columns (a Status dropdown default, a date or score formula) far below the last entry,
 * so those columns can't tell where the entries end.
 */
const ROW_IDENTITY_FIELDS: SheetField[] = ["company", "title", "link"];

/** Columns used to find the last entry: the mapped identity columns, or every mapped column if none are. */
export function anchorColumns(map: SheetColumnMap): string[] {
  const pick = (fields: SheetField[]) => [...new Set(fields.map((f) => map[f]).filter(Boolean) as string[])];
  const identity = pick(ROW_IDENTITY_FIELDS);
  return identity.length > 0 ? identity : pick(Object.keys(map) as SheetField[]);
}

/**
 * Writes one row below the last entry (see anchorColumns).
 * Uses batchGet + values.update instead of values.append: append writes starting at the
 * detected table's first column, which misplaces values when the table doesn't start at A.
 */
export async function appendMappedRow(opts: {
  token: string;
  sheetId: string;
  tab: string | null;
  map: SheetColumnMap;
  values: SheetRowValues;
  fetchImpl?: typeof fetch;
}): Promise<{ updatedRange: string; row: number }> {
  const f = opts.fetchImpl ?? fetch;
  const prefix = tabPrefix(opts.tab);
  const { startColumn, cells } = buildRow(opts.map, opts.values);
  const params = new URLSearchParams({ majorDimension: "COLUMNS" });
  for (const col of anchorColumns(opts.map)) params.append("ranges", `${prefix}${col}:${col}`);
  const existing = await call<{ valueRanges?: { values?: unknown[][] }[] }>(
    f,
    opts.token,
    `${API}/${encodeURIComponent(opts.sheetId)}/values:batchGet?${params}`,
  );
  // With COLUMNS, values[0] is the column top-down with trailing blanks trimmed: its length is the last used row.
  const lastUsedRow = Math.max(0, ...(existing.valueRanges ?? []).map((r) => r.values?.[0]?.length ?? 0));
  const row = lastUsedRow + 1;
  const endColumn = columnLetter(columnIndex(startColumn) + cells.length - 1);
  const range = `${prefix}${startColumn}${row}:${endColumn}${row}`;

  const result = await call<{ updatedRange?: string }>(
    f,
    opts.token,
    `${API}/${encodeURIComponent(opts.sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values: [cells] }) },
  );
  return { updatedRange: result.updatedRange ?? range, row };
}

/** For the settings page: confirms access and shows the tabs and header row to help with mapping. */
export async function inspectSheet(opts: { token: string; sheetId: string; tab: string | null; fetchImpl?: typeof fetch }) {
  const f = opts.fetchImpl ?? fetch;
  const meta = await call<{ properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] }>(
    f,
    opts.token,
    `${API}/${encodeURIComponent(opts.sheetId)}?fields=${encodeURIComponent("properties.title,sheets.properties.title")}`,
  );
  const tabs = (meta.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
  if (opts.tab && !tabs.includes(opts.tab)) {
    throw new SheetsApiError(`No tab named "${opts.tab}". Tabs: ${tabs.join(", ")}`, 400);
  }
  const tab = opts.tab ?? tabs[0] ?? null;
  const header = await call<{ values?: string[][] }>(
    f,
    opts.token,
    `${API}/${encodeURIComponent(opts.sheetId)}/values/${encodeURIComponent(`${tabPrefix(tab)}1:1`)}`,
  );
  return {
    title: meta.properties?.title ?? "(untitled)",
    tabs,
    tab,
    headers: (header.values?.[0] ?? []).map((label, i) => ({ column: columnLetter(i), label: String(label) })).filter((h) => h.label),
  };
}
