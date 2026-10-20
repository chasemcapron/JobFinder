"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cx, Icon, type IconName } from "./ui";

const LINKS: readonly { href: string; label: string; icon: IconName; section: string; activeClass: string; iconClass: string }[] = [
  { href: "/jobs", label: "Jobs", icon: "briefcase", section: "jobs", activeClass: "bg-blue text-white", iconClass: "text-[#8fbcff]" },
  { href: "/applications", label: "Applications", icon: "inbox", section: "applications", activeClass: "bg-orange text-ink", iconClass: "text-[#ffb066]" },
  { href: "/resume", label: "Resume", icon: "file", section: "resume", activeClass: "bg-green text-ink", iconClass: "text-[#6fdc97]" },
  { href: "/settings", label: "Settings", icon: "settings", section: "settings", activeClass: "bg-pink text-ink", iconClass: "text-[#ff93b9]" },
];

/**
 * The sticky app header. Its height changes with the viewport (the nav wraps to a second row on
 * phones), so it's measured into `--header-h` on <html>, which sticky bars and anchor jumps use to sit below it.
 */
export function AppHeader({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--header-h", `${header.offsetHeight}px`));
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);
  return (
    <header ref={ref} className={className}>
      {children}
    </header>
  );
}

/** Tags its children with the current section so tokens like `text-section-fg` pick up the section colour. */
export function SectionScope({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  const pathname = usePathname();
  const section = LINKS.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))?.section;
  return (
    <main id={id} data-section={section} className={className}>
      {children}
    </main>
  );
}

/** Tab-bar grid under the header on phones, inline pills from `sm` up. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="grid grid-cols-4 gap-1 sm:flex sm:items-center">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex flex-col items-center gap-1 rounded-control px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              "sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
              active
                ? cx("font-semibold shadow-xs", link.activeClass)
                : "text-muted hover:bg-surface-subtle/70 hover:text-foreground",
            )}
          >
            <Icon name={link.icon} className={active ? undefined : link.iconClass} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
