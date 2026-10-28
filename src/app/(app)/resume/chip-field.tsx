"use client";

import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { BarHeading, Button, cx, FieldHint, Icon, inputClass, type Hue } from "@/components/ui";
import { parseList } from "@/lib/parse-input";

/** Soft chip tints, the same as the job-board chips (each text colour is AA on its tint). */
const chipTone: Record<Hue, string> = {
  blue: "border-blue/40 bg-blue/15 text-info-fg",
  green: "border-green/30 bg-green/15 text-success-fg",
  orange: "border-orange/30 bg-orange/15 text-warning-fg",
  pink: "border-pink/30 bg-pink/15 text-danger-fg",
};

/** Solid rank tiles: white on blue, charcoal on the others (as on StatTile). */
const rankTone: Record<Hue, string> = {
  blue: "bg-blue text-white",
  green: "bg-green text-ink",
  orange: "bg-orange text-ink",
  pink: "bg-pink text-ink",
};

/** Ranked lists highlight this many leading items (the titles employer sites are searched for). */
const RANK_HIGHLIGHT = 3;

const sameItem = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * An editable list under a colour bar: type and press Enter (or paste a comma- or line-separated
 * list) to add, click an item to edit it, × to remove it. `ranked` shows a numbered list with
 * move-up buttons instead of chips (target titles, best fit first). The list submits as one
 * newline-separated field called `name`, which parseList splits on the server.
 */
export function ChipField({
  id,
  name,
  label,
  hue,
  values,
  onChange,
  max,
  placeholder,
  hint,
  emptyText = "Nothing here yet.",
  ranked = false,
}: {
  id?: string;
  name: string;
  label: string;
  hue: Hue;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  placeholder: string;
  hint?: ReactNode;
  emptyText?: string;
  ranked?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  // Where an item being edited goes back to, so editing doesn't move it to the end.
  const [editAt, setEditAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const full = values.length >= max && editAt === null;

  function commit(raw: string) {
    const next = [...values];
    let at = editAt ?? next.length;
    let duplicate: string | null = null;
    let overflow = false;
    for (const item of parseList(raw, Infinity)) {
      if (next.some((v) => sameItem(v, item))) duplicate ??= item;
      else if (next.length >= max) overflow = true;
      else next.splice(at++, 0, item);
    }
    if (next.length !== values.length) onChange(next);
    setText("");
    setEditAt(null);
    setNote(
      overflow ? `${label} keeps up to ${max}; the rest weren't added.` : duplicate ? `"${duplicate}" is already in the list.` : null,
    );
  }

  function edit(index: number) {
    onChange(values.filter((_, i) => i !== index));
    setText(values[index]);
    setEditAt(index);
    setNote(null);
    inputRef.current?.focus();
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
    setNote(null);
    inputRef.current?.focus();
  }

  function moveUp(index: number) {
    const next = [...values];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    // Enter would otherwise submit the whole form.
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(text);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!/[\n,]/.test(pasted)) return;
    e.preventDefault();
    commit(text + pasted);
  }

  const removeButton = (value: string, index: number) => (
    <button
      type="button"
      onClick={() => remove(index)}
      aria-label={`Remove ${value}`}
      className="grid size-5 shrink-0 place-items-center rounded-full opacity-75 transition-[opacity,background-color] hover:bg-current/15 hover:opacity-100"
    >
      <Icon name="x" className="size-3" />
    </button>
  );

  return (
    <div id={id} role="group" aria-label={label} className="flex min-w-0 scroll-mt-4 flex-col">
      <BarHeading hue={hue} as="h3" count={values.length}>
        {label}
      </BarHeading>

      <div className="mt-3">
        {values.length === 0 ? (
          <p className="border-b border-border pb-3 text-[13px] text-muted">{emptyText}</p>
        ) : ranked ? (
          <ol className="flex flex-col gap-1.5">
            {values.map((v, i) => (
              <li key={v.toLowerCase()} className="flex min-w-0 items-center gap-2 rounded-control border border-border bg-surface-subtle p-1 pr-1.5">
                <span
                  className={cx(
                    "grid size-6 shrink-0 place-items-center rounded-[5px] font-label text-[13px] leading-none font-bold tabular-nums",
                    i < RANK_HIGHLIGHT ? rankTone[hue] : "bg-surface-raised text-muted",
                  )}
                >
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => edit(i)}
                  aria-label={`Edit ${v}`}
                  title={v}
                  className="min-w-0 flex-1 truncate rounded-sm text-left text-sm font-medium hover:text-section-fg"
                >
                  {v}
                </button>
                <button
                  type="button"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  aria-label={`Move ${v} up`}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:invisible"
                >
                  <Icon name="chevron-down" className="size-3.5 rotate-180" />
                </button>
                <span className="text-muted">{removeButton(v, i)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {values.map((v, i) => (
              <li
                key={v.toLowerCase()}
                className={cx("inline-flex max-w-full items-center rounded-pill border pr-0.5 text-[13px] leading-6 font-medium", chipTone[hue])}
              >
                <button type="button" onClick={() => edit(i)} aria-label={`Edit ${v}`} title={v} className="min-w-0 truncate rounded-pill pr-1 pl-2.5 hover:underline">
                  {v}
                </button>
                {removeButton(v, i)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2.5 flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Add to {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNote(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          // Typed-but-not-added text is kept when the field loses focus (e.g. clicking Save).
          onBlur={() => (text.trim() || editAt !== null ? commit(text) : undefined)}
          disabled={full}
          placeholder={full ? `Limit of ${max} reached` : placeholder}
          autoComplete="off"
          enterKeyHint="done"
          className={inputClass}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={full}
          // Keep focus in the input so the next item can be typed straight away.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            commit(text);
            inputRef.current?.focus();
          }}
        >
          <Icon name="plus" />
          Add
        </Button>
      </div>
      {note ? (
        <p role="status" className="mt-1.5 text-xs text-warning-fg">
          {note}
        </p>
      ) : null}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <input type="hidden" name={name} value={[...values, ...(text.trim() ? [text] : [])].join("\n")} />
    </div>
  );
}
