"use client";

import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui";
import { testSheetAction, type SheetCheck } from "./actions";

export function SheetTest({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SheetCheck | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          onClick={() => startTransition(async () => setResult(await testSheetAction()))}
        >
          {pending ? "Checking…" : "Test connection"}
        </Button>
      </div>
      {result?.ok === false ? <Alert tone="error">{result.message}</Alert> : null}
      {result?.ok ? (
        <Alert tone="success">
          <p>
            Connected to <strong>{result.title}</strong>
            {result.tab ? (
              <>
                , tab <strong>{result.tab}</strong>
              </>
            ) : null}
            .
          </p>
          {result.headers.length ? (
            <p className="mt-1">
              Header row: {result.headers.map((h) => `${h.column} = ${h.label}`).join(" · ")}
            </p>
          ) : (
            <p className="mt-1">The first row is empty, so there are no headers to match against.</p>
          )}
          {result.tabs.length > 1 ? <p className="mt-1">Other tabs: {result.tabs.filter((t) => t !== result.tab).join(", ")}</p> : null}
        </Alert>
      ) : null}
    </div>
  );
}
