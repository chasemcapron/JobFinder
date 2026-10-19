import { describe, expect, it, vi } from "vitest";
import { anchorColumns, appendMappedRow, asText, buildRow, columnIndex, columnLetter, inspectSheet, tabPrefix } from "./sheets";

describe("column letters", () => {
  it("converts both ways", () => {
    expect(columnIndex("A")).toBe(0);
    expect(columnIndex("z")).toBe(25);
    expect(columnIndex("AA")).toBe(26);
    expect(columnIndex("AZ")).toBe(51);
    for (const n of [0, 25, 26, 51, 52, 701, 702]) expect(columnIndex(columnLetter(n))).toBe(n);
    expect(columnLetter(702)).toBe("AAA");
  });
});

describe("buildRow", () => {
  it("places values by mapping and leaves unmapped columns null", () => {
    expect(buildRow({ company: "B", title: "D", link: "C" }, { company: "Acme", title: "Engineer", link: "https://x" })).toEqual({
      startColumn: "B",
      cells: ["Acme", "https://x", "Engineer"],
    });
    expect(buildRow({ company: "A", status: "E" }, { company: "Acme", status: "Applied" }).cells).toEqual(["Acme", null, null, null, "Applied"]);
  });

  it("skips mapped fields with no value and errors when nothing is mapped", () => {
    expect(buildRow({ company: "A", score: "B" }, { company: "Acme" })).toEqual({ startColumn: "A", cells: ["Acme"] });
    expect(() => buildRow({}, { company: "Acme" })).toThrow(/No sheet columns/);
  });

  it("neutralizes formula-looking text from job postings but not the date", () => {
    expect(asText("=IMPORTXML(1)")).toBe("'=IMPORTXML(1)");
    expect(asText("+1 role")).toBe("'+1 role");
    expect(asText("Engineer")).toBe("Engineer");
    expect(buildRow({ title: "A", dateApplied: "B" }, { title: "=HYPERLINK(x)", dateApplied: "2026-10-15" }).cells).toEqual([
      "'=HYPERLINK(x)",
      "2026-10-15",
    ]);
  });
});

describe("tabPrefix", () => {
  it("quotes tab names and escapes apostrophes", () => {
    expect(tabPrefix(null)).toBe("");
    expect(tabPrefix("Job Hunt")).toBe("'Job Hunt'!");
    expect(tabPrefix("Alex's jobs")).toBe("'Alex''s jobs'!");
  });
});

function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("appendMappedRow", () => {
  it("finds the last used row across mapped columns and writes the next row exactly where mapped", async () => {
    const { impl, calls } = fakeFetch([
      // batchGet with majorDimension=COLUMNS: B has 7 rows, D has 9 (e.g. a note further down)
      { body: { valueRanges: [{ values: [["Company", "a", "b", "c", "d", "e", "f"]] }, { values: [["Link", 1, 2, 3, 4, 5, 6, 7, 8]] }, {}] } },
      { body: { updatedRange: "'Jobs'!B10:D10" } },
    ]);
    const result = await appendMappedRow({
      token: "tok",
      sheetId: "sheet123",
      tab: "Jobs",
      map: { company: "B", title: "C", link: "D" },
      values: { company: "Acme", title: "Engineer", link: "https://x" },
      fetchImpl: impl,
    });
    expect(result).toEqual({ updatedRange: "'Jobs'!B10:D10", row: 10 });

    const get = new URL(calls[0].url);
    expect(get.pathname).toBe("/v4/spreadsheets/sheet123/values:batchGet");
    expect(get.searchParams.getAll("ranges")).toEqual(["'Jobs'!B:B", "'Jobs'!C:C", "'Jobs'!D:D"]);
    expect(get.searchParams.get("majorDimension")).toBe("COLUMNS");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");

    expect(calls[1].init.method).toBe("PUT");
    expect(decodeURIComponent(calls[1].url)).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet123/values/'Jobs'!B10:D10?valueInputOption=USER_ENTERED",
    );
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      range: "'Jobs'!B10:D10",
      majorDimension: "ROWS",
      values: [["Acme", "Engineer", "https://x"]],
    });
  });

  it("ignores pre-filled status/date/score columns when finding the last entry", async () => {
    const { impl, calls } = fakeFetch([
      // Company and title end at row 99; Status (C) has a dropdown default down to row 966.
      { body: { valueRanges: [{ values: [Array(99).fill("x")] }, { values: [Array(99).fill("x")] }, { values: [Array(80).fill("x")] }] } },
      { body: {} },
    ]);
    const result = await appendMappedRow({
      token: "t",
      sheetId: "s",
      tab: "Tracker",
      map: { company: "A", title: "B", status: "C", link: "D", dateApplied: "F", score: "M" },
      values: { company: "Acme", title: "Engineer", status: "Applied", link: "https://x", dateApplied: "2026-10-19", score: 80 },
      fetchImpl: impl,
    });
    expect(new URL(calls[0].url).searchParams.getAll("ranges")).toEqual(["'Tracker'!A:A", "'Tracker'!B:B", "'Tracker'!D:D"]);
    expect(result.row).toBe(100);
  });

  it("falls back to every mapped column when no identity column is mapped", () => {
    expect(anchorColumns({ status: "C", dateApplied: "F" })).toEqual(["C", "F"]);
    expect(anchorColumns({ company: "A", title: "A", status: "C" })).toEqual(["A"]);
  });

  it("writes to row 1 of an empty sheet", async () => {
    const { impl } = fakeFetch([{ body: { valueRanges: [{}] } }, { body: {} }]);
    const result = await appendMappedRow({ token: "t", sheetId: "s", tab: null, map: { company: "A" }, values: { company: "X" }, fetchImpl: impl });
    expect(result).toEqual({ updatedRange: "A1:A1", row: 1 });
  });

  it("turns API errors into readable messages", async () => {
    const notFound = fakeFetch([{ status: 404, body: { error: { message: "Requested entity was not found." } } }]);
    await expect(
      appendMappedRow({ token: "t", sheetId: "s", tab: null, map: { company: "A" }, values: { company: "X" }, fetchImpl: notFound.impl }),
    ).rejects.toThrow("Spreadsheet not found. Check the sheet ID.");
    const badTab = fakeFetch([{ status: 400, body: { error: { message: "Unable to parse range: 'Nope'!A:A" } } }]);
    await expect(
      appendMappedRow({ token: "t", sheetId: "s", tab: "Nope", map: { company: "A" }, values: { company: "X" }, fetchImpl: badTab.impl }),
    ).rejects.toThrow("That tab name doesn't exist");
  });
});

describe("inspectSheet", () => {
  it("returns the title, tabs, and header labels by column", async () => {
    const { impl, calls } = fakeFetch([
      { body: { properties: { title: "Job Hunt 2026" }, sheets: [{ properties: { title: "Applications" } }, { properties: { title: "Notes" } }] } },
      { body: { values: [["Company", "Role", "", "Applied On"]] } },
    ]);
    expect(await inspectSheet({ token: "t", sheetId: "s", tab: null, fetchImpl: impl })).toEqual({
      title: "Job Hunt 2026",
      tabs: ["Applications", "Notes"],
      tab: "Applications",
      headers: [
        { column: "A", label: "Company" },
        { column: "B", label: "Role" },
        { column: "D", label: "Applied On" },
      ],
    });
    expect(decodeURIComponent(calls[1].url)).toContain("/values/'Applications'!1:1");
  });

  it("rejects an unknown tab", async () => {
    const { impl } = fakeFetch([{ body: { properties: { title: "T" }, sheets: [{ properties: { title: "Sheet1" } }] } }]);
    await expect(inspectSheet({ token: "t", sheetId: "s", tab: "Other", fetchImpl: impl })).rejects.toThrow('No tab named "Other"');
  });
});
