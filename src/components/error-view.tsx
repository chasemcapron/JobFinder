"use client";

import { useEffect } from "react";
import { Button } from "./ui";

/** Shared body for error boundaries. Production hides server error messages, so show the digest for log lookup. */
export function ErrorView({ error, retry, title = "Something went wrong" }: { error: unknown; retry: () => void; title?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest?: unknown }).digest) : null;
  const message = error instanceof Error && !digest ? error.message : null;
  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-16 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted">
        {message ?? "An unexpected error happened on the server. Try again; if it keeps happening, check the server logs."}
      </p>
      {digest ? <p className="font-mono text-xs text-muted">Error reference: {digest}</p> : null}
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
