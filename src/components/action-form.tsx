"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, cx, type ButtonSize, type ButtonVariant } from "./ui";

export type ActionState = { ok: boolean; message: string } | null;
export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** A form bound to a server action that shows a success/error message after submit. */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  className,
  resetOnSuccess = false,
}: {
  action: FormAction;
  children: ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={cx("flex flex-col gap-4", className)}
      // React resets uncontrolled forms after an action; opt out unless asked.
      onReset={resetOnSuccess ? undefined : (e) => e.preventDefault()}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={submitLabel} />
        {state ? <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert> : null}
      </div>
    </form>
  );
}

export function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
  size = "md",
  icon,
  className,
}: {
  label: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shown before the label; replaced by a spinner while pending. */
  icon?: ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} loading={pending} className={className}>
      {pending ? null : icon}
      {pending ? (pendingLabel ?? "Saving…") : label}
    </Button>
  );
}
