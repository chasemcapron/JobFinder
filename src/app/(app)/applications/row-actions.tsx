"use client";

import { useTransition } from "react";
import { Button, inputClass } from "@/components/ui";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/db/schema";
import { removeApplicationAction, updateStatusAction } from "./actions";

const LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export function ApplicationRowActions({ applicationId, status }: { applicationId: string; status: ApplicationStatus }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex shrink-0 items-center gap-2" aria-busy={pending}>
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
        className={`${inputClass} w-auto py-1`}
      >
        {APPLICATION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LABELS[s]}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (confirm("Remove this application? This doesn't change your Google Sheet.")) {
            startTransition(() => removeApplicationAction(applicationId));
          }
        }}
      >
        Remove
      </Button>
    </div>
  );
}
