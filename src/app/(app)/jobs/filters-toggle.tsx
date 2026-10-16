"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Filters collapse behind a button on small screens and are always visible on large ones. */
export function FiltersToggle({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-sm font-semibold lg:hidden"
        aria-expanded={open}
        aria-controls="job-filters"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Filters{activeCount ? ` (${activeCount})` : ""}</span>
        <span className="text-muted" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      <div id="job-filters" className={cx("mt-4 lg:mt-0 lg:block", !open && "hidden")}>
        {children}
      </div>
    </div>
  );
}
