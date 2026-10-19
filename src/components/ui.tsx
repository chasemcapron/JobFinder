import type { ComponentProps, ReactNode } from "react";

/*
 * Shared UI primitives. Colors come only from the tokens in globals.css
 * (bg-surface, text-muted, bg-success-bg, ...); don't use raw Tailwind palette
 * colors (slate/emerald/red...) in components. Server-safe: no hooks here.
 */

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ Icons */

const ICONS = {
  briefcase: (
    <>
      <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <rect width="20" height="14" x="2" y="6" rx="2" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8M16 17H8M10 9H8" />
    </>
  ),
  settings: <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  "external-link": <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M5 12h14M12 5v14" />,
  trash: <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  mail: (
    <>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  building: (
    <>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4" />
    </>
  ),
  calendar: (
    <>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  sheet: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  "log-out": <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
} as const;

export type IconName = keyof typeof ICONS;

/** Inline SVG icon (Lucide-style strokes). Decorative unless `title` is given. */
export function Icon({ name, className, title }: { name: IconName; className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("size-4 shrink-0", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cx("size-4 shrink-0 animate-spin", className)} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------- Buttons */

const buttonVariants = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary: "border border-border-strong bg-surface-subtle text-foreground hover:bg-surface-raised",
  ghost: "text-foreground hover:bg-surface-subtle",
  subtle: "bg-accent-subtle text-accent-text hover:bg-accent-subtle/70",
  danger: "border border-danger-border bg-danger-bg text-danger-fg hover:bg-danger-border",
} as const;

const buttonSizes = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-9 gap-2 px-4 text-sm",
  lg: "h-11 gap-2 px-5 text-[15px]",
  icon: "size-9",
  "icon-sm": "size-8",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

/** Button styles, also for links: `<Link className={buttonClass("secondary", "sm")}>`. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return cx(
    "inline-flex shrink-0 items-center justify-center rounded-control font-medium whitespace-nowrap no-underline select-none",
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-150",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-wait",
    buttonSizes[size],
    buttonVariants[variant],
  );
}

/**
 * `loading` disables the button and shows a spinner (keeps its width stable by
 * keeping the label). Icon-only buttons (size "icon" / "icon-sm") need an aria-label.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      className={cx(buttonClass(variant, size), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** Inline text link style (accent colored, AA on surface in both themes). */
export const linkClass =
  "font-medium text-accent-text underline-offset-2 hover:underline focus-visible:rounded-sm";

/* ------------------------------------------------------------------ Cards */

const cardPadding = { none: "", sm: "p-3 sm:p-4", md: "p-4 sm:p-6" } as const;

export function Card({
  className,
  padding = "md",
  interactive = false,
  ...props
}: ComponentProps<"section"> & { padding?: keyof typeof cardPadding; interactive?: boolean }) {
  return (
    <section
      className={cx(
        "rounded-card border border-border bg-surface",
        cardPadding[padding],
        interactive && "transition-colors hover:border-border-strong hover:bg-surface-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-subtle text-accent-text">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-lg font-medium tracking-tight">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- Inputs */

/** For <input>, <textarea> and <select>. Use `selectClass` for a select with the custom chevron. */
export const inputClass = cx(
  "block w-full min-w-0 rounded-control border border-border-strong bg-surface-subtle px-3 py-[7px] text-sm text-foreground",
  "transition-[border-color,box-shadow] duration-150 placeholder:text-muted",
  "focus:border-accent focus:ring-3 focus:ring-accent/25 focus:outline-none focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-70",
  "aria-invalid:border-danger aria-invalid:ring-danger/20",
  "file:mr-3 file:rounded-control file:border-0 file:bg-surface-raised file:px-2.5 file:py-0.5 file:text-[13px] file:font-medium file:text-foreground",
);

export const selectClass = cx(inputClass, "select-chevron pr-9");

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-foreground">
      {children}
      {hint ? <span className="ml-1 font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

/** Small helper / error text under a field. */
export function FieldHint({ children, tone = "muted", id }: { children: ReactNode; tone?: "muted" | "danger"; id?: string }) {
  return (
    <p id={id} className={cx("mt-1.5 text-xs", tone === "danger" ? "text-danger-fg" : "text-muted")}>
      {children}
    </p>
  );
}

/* ----------------------------------------------------------- Status color */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
/** Legacy color names, kept so existing callers compile. Prefer the semantic `Tone` names. */
export type LegacyTone = "green" | "amber" | "red" | "blue";

const legacyTone: Record<LegacyTone, Tone> = { green: "success", amber: "warning", red: "danger", blue: "info" };
const toTone = (tone: Tone | LegacyTone): Tone => (tone in legacyTone ? legacyTone[tone as LegacyTone] : (tone as Tone));

const toneSoft: Record<Tone, string> = {
  neutral: "border-neutral-border bg-neutral-bg text-neutral-fg",
  accent: "border-transparent bg-accent-subtle text-accent-text",
  success: "border-success-border bg-success-bg text-success-fg",
  warning: "border-warning-border bg-warning-bg text-warning-fg",
  danger: "border-danger-border bg-danger-bg text-danger-fg",
  info: "border-info-border bg-info-bg text-info-fg",
};

const toneSolid: Record<Tone, string> = {
  neutral: "bg-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** Solid flat tile fills (white text, AA on every hue). */
const toneTile: Record<Tone, string> = {
  neutral: "bg-neutral text-on-solid",
  accent: "bg-accent text-on-solid",
  success: "bg-success text-on-solid",
  warning: "bg-warning text-on-solid",
  danger: "bg-danger text-on-solid",
  info: "bg-info text-on-solid",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone | LegacyTone;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  const t = toTone(tone);
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-control border px-1.5 py-px text-xs leading-5 font-medium whitespace-nowrap",
        toneSoft[t],
        className,
      )}
    >
      {dot ? <span className={cx("size-1.5 rounded-full", toneSolid[t])} aria-hidden /> : null}
      {children}
    </span>
  );
}

const alertIcon: Record<"info" | "success" | "error" | "warning", IconName> = {
  info: "info",
  success: "check-circle",
  error: "alert-circle",
  warning: "alert-triangle",
};

export function Alert({
  tone = "info",
  title,
  icon,
  className,
  children,
}: {
  tone?: "info" | "success" | "error" | "warning" | "danger";
  title?: ReactNode;
  /** Defaults to an icon for the tone; pass `false` to hide it. */
  icon?: ReactNode | false;
  className?: string;
  children: ReactNode;
}) {
  const t = tone === "danger" ? "error" : tone;
  const soft = toneSoft[t === "error" ? "danger" : t];
  return (
    <div
      role={t === "error" ? "alert" : "status"}
      className={cx("flex items-start gap-2.5 rounded-control border px-3 py-2 text-sm", soft, className)}
    >
      {icon === false ? null : (
        <span className="mt-0.5 shrink-0">{icon ?? <Icon name={alertIcon[t]} />}</span>
      )}
      <div className="min-w-0 flex-1 [&_a]:font-medium [&_a]:underline">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5 opacity-90" : undefined}>{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Page structure */

export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface/60 px-6 py-14 text-center">
      {icon ? (
        <span className="mb-1 grid size-11 place-items-center rounded-control bg-accent text-accent-foreground [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <h3 className="text-lg font-medium tracking-tight">{title}</h3>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold tracking-widest text-accent-text uppercase">{eyebrow}</p> : null}
        <h1 className="text-3xl font-light tracking-tight text-balance sm:text-4xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Divider({ label, className }: { label?: ReactNode; className?: string }) {
  if (!label) return <hr className={cx("border-0 border-t border-border", className)} />;
  return (
    <div className={cx("flex items-center gap-3 text-xs text-muted", className)} role="separator">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Loading placeholder block; size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cx("animate-pulse rounded-control bg-surface-subtle", className)} {...props} />;
}

/** A labelled number as a solid colour tile, for summary rows (e.g. "Applied this week: 4"). */
export function Stat({
  label,
  value,
  hint,
  icon,
  className,
  tone = "accent",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
  tone?: Tone | LegacyTone;
}) {
  return (
    <div className={cx("rounded-card p-4", toneTile[toTone(tone)], className)}>
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium opacity-90">
        {label}
        {icon}
      </div>
      <div className="mt-1.5 text-4xl font-light tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs opacity-90">{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------ Match score */

/** Score (0-100) to tone. Same thresholds as the jobs page: 75 / 55 / 35. */
export function matchTone(score: number): Tone {
  return score >= 75 ? "success" : score >= 55 ? "info" : score >= 35 ? "warning" : "neutral";
}

/** Square match-score tile, e.g. `<ScoreBadge score={82} label="KW" />`. */
export function ScoreBadge({ score, label, title }: { score: number; label?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex size-12 shrink-0 flex-col items-center justify-center rounded-card tabular-nums",
        toneTile[matchTone(score)],
      )}
    >
      <span className="sr-only">Match score </span>
      <span className="text-xl leading-none font-medium">{Math.round(score)}</span>
      {label ? (
        <span className="mt-0.5 text-[9px] leading-none font-medium tracking-wide uppercase opacity-90">{label}</span>
      ) : null}
    </span>
  );
}

/** Horizontal meter for a 0-100 score. */
export function ScoreMeter({ score, showValue = true, className }: { score: number; showValue?: boolean; className?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <div
        role="meter"
        aria-label="Match score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-pill bg-surface-subtle"
      >
        <div className={cx("h-full rounded-pill", toneSolid[matchTone(value)])} style={{ width: `${value}%` }} />
      </div>
      {showValue ? <span className="w-7 text-right text-xs font-medium text-muted tabular-nums">{value}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Misc */

/** The app's logo mark: a solid blue tile with a target. */
export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center bg-accent text-accent-foreground",
        size === "lg" ? "size-14 rounded-card [&_svg]:size-8" : "size-8 rounded-card",
      )}
    >
      <Icon name="target" />
    </span>
  );
}

/** Initials avatar for a name or email. */
export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  const initials =
    (name ?? "")
      .replace(/@.*/, "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={cx(
        "grid size-7 shrink-0 place-items-center rounded-card bg-neutral text-[11px] font-semibold text-on-solid",
        className,
      )}
    >
      {initials}
    </span>
  );
}
