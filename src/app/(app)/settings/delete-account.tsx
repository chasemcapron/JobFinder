"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/action-form";
import { Alert, Card, CardHeader, Icon, inputClass, Label } from "@/components/ui";
import { confirmsEmail } from "@/lib/confirm-email";
import { deleteAccountAction } from "./account-actions";

/** Settings → Danger zone: deletes the account and its data once the user types their email. */
export function DeleteAccount({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const [state, action] = useActionState(deleteAccountAction, null);
  const matches = confirmsEmail(typed, email);
  return (
    <Card id="account" className="scroll-mt-16">
      <CardHeader
        icon={<Icon name="trash" />}
        title="Delete my account"
        description="Removes your resume, matches, applications and notes, tailored resumes, and settings from this app. It can't be undone."
      />
      <form action={action} className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Your Google Sheet isn&apos;t touched. You&apos;ll be signed out; signing in again with the same Google account starts a
          new, empty account unless the owner removes your email from the allowed list.
        </p>
        <div>
          <Label htmlFor="confirm-delete">Type {email} to confirm</Label>
          <input
            id="confirm-delete"
            name="confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton label="Delete my account" pendingLabel="Deleting…" variant="danger" disabled={!matches} />
          {state && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}
        </div>
      </form>
    </Card>
  );
}
