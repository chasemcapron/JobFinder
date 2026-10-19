"use client";

import { useState, useTransition } from "react";
import { markAppliedAction, removeApplicationAction } from "@/app/(app)/applications/actions";
import { SyncStatus } from "@/components/sync-status";
import { Alert, Button, Icon } from "@/components/ui";
import type { SheetSyncStatus } from "@/db/schema";

/** "Mark applied" on a job card; once applied, shows sheet sync state and an undo. */
export function ApplyActions({
  jobId,
  application,
}: {
  jobId: string;
  application: { id: string; sheetSyncStatus: SheetSyncStatus; sheetSyncError: string | null } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  if (!application) {
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const r = await markAppliedAction(jobId);
              if (!r.ok) setError(r.message);
              else if (r.sync.status !== "synced") setSyncMessage(r.sync.message);
            })
          }
        >
          {pending ? (
            "Saving…"
          ) : (
            <>
              <Icon name="check" className="size-3.5" />
              Mark applied
            </>
          )}
        </Button>
        {error ? (
          <Alert tone="error" className="w-full">
            {error}
          </Alert>
        ) : null}
      </>
    );
  }

  return (
    <>
      <SyncStatus applicationId={application.id} status={application.sheetSyncStatus} error={syncMessage ?? application.sheetSyncError} />
      <Button
        variant="ghost"
        size="sm"
        loading={pending}
        onClick={() => startTransition(() => removeApplicationAction(application.id))}
        title="Remove from your applications (doesn't change your sheet)"
      >
        {pending ? "Undoing…" : "Undo"}
      </Button>
    </>
  );
}
