import { ActionForm } from "@/components/action-form";
import { Badge, cx, Icon, inputClass, Label } from "@/components/ui";
import { NOTE_LIMITS } from "@/lib/applications";
import { APP_TIME_ZONE, localDate } from "@/lib/time";
import { saveNotesAction } from "./actions";

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: APP_TIME_ZONE });

type Notes = { id: string; notes: string; contact: string; nextStep: string; nextStepAt: Date | null };

/** "Next: Phone screen · Thu, Nov 12", amber once the day has passed. */
export function NextStepBadge({ app, now = new Date() }: { app: Notes; now?: Date }) {
  if (!app.nextStep && !app.nextStepAt) return null;
  const past = app.nextStepAt ? localDate(app.nextStepAt) < localDate(now) : false;
  return (
    <Badge tone={past ? "warning" : "info"} title={past ? "This day has passed: update the next step" : "Next step"}>
      <Icon name="calendar" className="size-3" />
      Next: {[app.nextStep, app.nextStepAt ? dayFormat.format(app.nextStepAt) : null].filter(Boolean).join(" · ")}
    </Badge>
  );
}

/** A card's notes, contact and next step: closed by default, a short preview in the summary. */
export function ApplicationNotes({ app }: { app: Notes }) {
  const id = (field: string) => `${field}-${app.id}`;
  const preview = app.notes.split("\n")[0]?.slice(0, 60);
  return (
    <details className="group/notes text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-section-fg select-none hover:underline">
        <Icon name="file" className="size-3.5" />
        {app.notes || app.contact || app.nextStep || app.nextStepAt ? "Notes" : "Add notes"}
        {preview ? <span className="min-w-0 truncate font-normal text-muted">· {preview}</span> : null}
        <Icon name="chevron-down" className="size-3.5 shrink-0 transition-transform group-open/notes:rotate-180" />
      </summary>
      <ActionForm action={saveNotesAction} submitLabel="Save notes" className="mt-2 gap-3">
        <input type="hidden" name="applicationId" value={app.id} />
        <div>
          <Label htmlFor={id("notes")}>Notes</Label>
          <textarea
            id={id("notes")}
            name="notes"
            defaultValue={app.notes}
            maxLength={NOTE_LIMITS.notes}
            placeholder="What you talked about, what to prepare, salary range…"
            className={cx(inputClass, "field-sizing-content min-h-20 py-2 leading-relaxed")}
          />
        </div>
        <div>
          <Label htmlFor={id("contact")}>Contact</Label>
          <input id={id("contact")} name="contact" defaultValue={app.contact} maxLength={NOTE_LIMITS.contact} placeholder="Recruiter name, email" className={inputClass} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1 2xl:grid-cols-2">
          <div>
            <Label htmlFor={id("nextStep")}>Next step</Label>
            <input id={id("nextStep")} name="nextStep" defaultValue={app.nextStep} maxLength={NOTE_LIMITS.nextStep} placeholder="Phone screen" className={inputClass} />
          </div>
          <div>
            <Label htmlFor={id("nextStepAt")}>On</Label>
            <input id={id("nextStepAt")} name="nextStepAt" type="date" defaultValue={app.nextStepAt ? localDate(app.nextStepAt) : ""} className={inputClass} />
          </div>
        </div>
      </ActionForm>
    </details>
  );
}
