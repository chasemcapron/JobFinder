"use client";

import { useTransition } from "react";
import { Button, cx, Icon, selectClass } from "@/components/ui";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/db/schema";
import { removeApplicationAction, updateStatusAction } from "./actions";

const LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Status select and remove. `compact` (the board's narrow columns) fills the width and shows remove as an icon. */
export function ApplicationRowActions({
  applicationId,
  status,
  compact = false,
}: {
  applicationId: string;
  status: ApplicationStatus;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const remove = () => {
    if (confirm("Remove this application? This doesn't change your Google Sheet.")) {
      startTransition(() => removeApplicationAction(applicationId));
    }
  };
  return (
    <div className={cx("flex shrink-0 items-center gap-2", !compact && "flex-wrap")} aria-busy={pending}>
      <label className="sr-only" htmlFor={`status-${applicationId}`}>
        Status
      </label>
      <select
        id={`status-${applicationId}`}
        defaultValue={status}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          startTransition(() => updateStatusAction(applicationId, value));
        }}
        className={cx(selectClass, compact ? "h-8 min-w-0 flex-1 py-0 text-[13px]" : "w-auto py-1")}
      >
        {APPLICATION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LABELS[s]}
          </option>
        ))}
      </select>
      {compact ? (
        <Button
          variant="ghost"
          size="icon-sm"
          loading={pending}
          className="text-muted hover:text-danger-fg"
          aria-label="Remove application"
          title="Remove (doesn't change your Google Sheet)"
          onClick={remove}
        >
          {pending ? null : <Icon name="trash" />}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" loading={pending} className="text-muted hover:text-danger-fg" onClick={remove}>
          <Icon name="trash" />
          Remove
        </Button>
      )}
    </div>
  );
}
