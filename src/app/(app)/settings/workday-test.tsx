"use client";

import { useState, useTransition } from "react";
import { Alert, Button, inputClass, Label } from "@/components/ui";
import { addTestedWorkdaySite, testWorkdaySite, type WorkdayTestResult } from "./actions";

/**
 * Paste any Workday careers URL, see that it works (one live search for the top target title),
 * then add it. Catches wrong site names (404) and wrong tenants or wdN (422) before they're saved.
 */
export function WorkdayTest() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<WorkdayTestResult | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const test = () =>
    startTransition(async () => {
      setAdded(null);
      setAddError(null);
      setResult(await testWorkdaySite(url));
    });
  const add = (slug: string) =>
    startTransition(async () => {
      const r = await addTestedWorkdaySite(slug);
      if (r?.ok) setAdded(r.message ?? "Added.");
      else setAddError(r?.message ?? "Couldn't add it. Try again.");
    });

  return (
    <div className="mb-4 flex flex-col gap-2">
      <Label htmlFor="workday-test">Test a Workday site</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="workday-test"
          className={inputClass}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim()) {
              e.preventDefault();
              test();
            }
          }}
          placeholder="https://acme.wd5.myworkdayjobs.com/en-US/Careers"
          autoComplete="off"
        />
        <Button type="button" variant="secondary" disabled={!url.trim()} loading={pending && !result} onClick={test}>
          Test
        </Button>
      </div>
      {result?.ok === false ? <Alert tone="error">{result.message}</Alert> : null}
      {result?.ok ? (
        <Alert tone="success">
          <p>
            <strong>{result.name}</strong> works ({result.slug}).{" "}
            {result.searchedFor ? (
              <>
                {result.total.toLocaleString()} {result.usFilter ? "US " : ""}posting{result.total === 1 ? "" : "s"} match &ldquo;{result.searchedFor}&rdquo;
              </>
            ) : (
              <>{result.total.toLocaleString()} postings</>
            )}
            {result.usFilter ? "." : "; this site has no country filter, so foreign postings are dropped by location."}
          </p>
          {result.sampleTitles.length ? <p className="mt-1">For example: {result.sampleTitles.join(" · ")}</p> : null}
          <div className="mt-2">
            {result.added || added ? (
              <span className="text-sm">{added ?? "Already in your target companies."}</span>
            ) : (
              <Button type="button" size="sm" loading={pending} onClick={() => add(result.slug)}>
                Add {result.name}
              </Button>
            )}
          </div>
        </Alert>
      ) : null}
      {addError ? <Alert tone="error">{addError}</Alert> : null}
    </div>
  );
}
