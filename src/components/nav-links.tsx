"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx, Icon, type IconName, type Section } from "./ui";

const LINKS: readonly { href: string; label: string; icon: IconName; section: Section }[] = [
  { href: "/jobs", label: "Jobs", icon: "briefcase", section: "jobs" },
  { href: "/applications", label: "Applications", icon: "inbox", section: "applications" },
  { href: "/resume", label: "Resume", icon: "file", section: "resume" },
  { href: "/settings", label: "Settings", icon: "settings", section: "settings" },
];

/** Wraps the page content so everything inside picks up the current section's colour. */
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
            data-section={link.section}
            className={cx(
              "flex flex-col items-center gap-1 rounded-control px-2 py-1.5 font-display text-sm font-medium tracking-wider whitespace-nowrap uppercase transition-colors",
              "sm:flex-row sm:gap-2 sm:px-3.5 sm:text-[15px]",
              active
                ? "bg-section text-white"
                : "text-muted hover:bg-surface-subtle hover:text-foreground",
            )}
          >
            <Icon name={link.icon} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
