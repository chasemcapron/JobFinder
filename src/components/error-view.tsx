"use client";

import { useEffect } from "react";
import { Button, Icon } from "./ui";

/** Shared body for error boundaries. Production hides server error messages, so show the digest for log lookup. */
export function ErrorView({ error, retry, title = "Something went wrong" }: { error: unknown; retry: () => void; title?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest?: unknown }).digest) : null;
  const message = error instanceof Error && !digest ? error.message : null;
  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-full border border-danger-border bg-danger-bg text-danger-fg [&_svg]:size-5">
        <Icon name="alert-triangle" />
      </span>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted">
        {message ?? "An unexpected error happened on the server. Try again; if it keeps happening, check the server logs."}
      </p>
      {digest ? <p className="rounded-md bg-surface-subtle px-2 py-1 font-mono text-xs text-muted">Error reference: {digest}</p> : null}
      <Button onClick={() => retry()} className="mt-2">
        <Icon name="refresh" />
        Try again
      </Button>
    </div>
  );
}
