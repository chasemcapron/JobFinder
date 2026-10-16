"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { retrySyncAction } from "@/app/(app)/applications/actions";
import type { SheetSyncStatus } from "@/db/schema";
import { Badge, Button } from "./ui";

const LABELS: Record<SheetSyncStatus, { text: string; tone: "green" | "red" | "neutral" | "amber" }> = {
  synced: { text: "In sheet", tone: "green" },
  failed: { text: "Sheet sync failed", tone: "red" },
  not_configured: { text: "Not synced", tone: "neutral" },
  pending: { text: "Syncing…", tone: "amber" },
};

/** Sheet sync badge with a Retry button when the last attempt failed. */
export function SyncStatus({
  applicationId,
  status,
  error,
}: {
  applicationId: string;
  status: SheetSyncStatus;
  error?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const label = LABELS[status];
  const detail = message ?? error ?? null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span title={detail ?? undefined}>
        <Badge tone={label.tone}>{label.text}</Badge>
      </span>
      {status === "failed" || status === "pending" ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await retrySyncAction(applicationId);
              setMessage(r.ok ? r.sync.message : r.message);
            })
          }
        >
          {pending ? "Retrying…" : "Retry sync"}
        </Button>
      ) : null}
      {status === "not_configured" && detail ? (
        <span className="text-muted">
          {detail}{" "}
          {/settings/i.test(detail) ? (
            <Link href="/settings#sheet" className="underline">
              Settings
            </Link>
          ) : null}
        </span>
      ) : status === "failed" && detail ? (
        <span className="text-red-700 dark:text-red-400">{detail}</span>
      ) : null}
    </span>
  );
}
