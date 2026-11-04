import Link from "next/link";
import { SubmitButton } from "@/components/action-form";
import { Card, CardHeader, cx, Icon } from "@/components/ui";
import type { SetupStep } from "@/lib/setup";
import { dismissSetupAction } from "./setup-actions";

/** The Jobs page's setup guide for a new user: each step, done or not, with a link to where it's done. */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.optional);
  return (
    <Card className="mb-6" aria-labelledby="setup-heading">
      <CardHeader
        icon={<Icon name="target" />}
        title={<span id="setup-heading">Get set up</span>}
        description={`${done} of ${required.length} done. Once these are done, new matches arrive every morning.`}
        action={
          <form action={dismissSetupAction}>
            <SubmitButton label="Hide this" variant="ghost" size="sm" />
          </form>
        }
      />
      <ol className="grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              href={s.href}
              aria-current={s === next ? "step" : undefined}
              className={cx(
                "flex h-full items-start gap-3 rounded-control border px-3 py-2.5 no-underline transition-colors",
                s.done ? "border-border text-muted" : "border-border-strong hover:border-section",
                s === next && "border-section bg-section-bg",
              )}
            >
              <Icon
                name={s.done ? "check-circle" : "chevron-right"}
                className={cx("mt-0.5 size-4 shrink-0", s.done ? "text-success-fg" : "text-section-fg")}
                title={s.done ? "Done" : undefined}
              />
              <span className="min-w-0">
                <span className={cx("block text-sm font-medium", s.done ? "line-through decoration-1" : "text-foreground")}>
                  {s.label}
                  {s.optional ? <span className="ml-1 font-normal text-muted">(optional)</span> : null}
                </span>
                <span className="block text-[13px] text-muted">{s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
