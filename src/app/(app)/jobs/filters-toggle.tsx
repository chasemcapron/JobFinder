"use client";

import { useState, type ReactNode } from "react";
import { Badge, Card, cx, Icon } from "@/components/ui";

/** Filters collapse behind a button on small screens and are always visible on large ones. */
export function FiltersToggle({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card padding="sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-control text-sm font-semibold lg:pointer-events-none"
        aria-expanded={open}
        aria-controls="job-filters"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="inline-flex items-center gap-2">
          <Icon name="filter" className="size-4 text-muted" />
          Filters
          {activeCount ? <Badge tone="accent">{activeCount}</Badge> : null}
        </span>
        <Icon name="chevron-down" className={cx("size-4 text-muted transition-transform lg:hidden", open && "rotate-180")} />
      </button>
      <div id="job-filters" className={cx("mt-4 lg:block", !open && "hidden")}>
        {children}
      </div>
    </Card>
  );
}
