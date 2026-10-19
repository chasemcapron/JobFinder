"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx, Icon, type IconName } from "./ui";

const LINKS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: "/jobs", label: "Jobs", icon: "briefcase" },
  { href: "/applications", label: "Applications", icon: "inbox" },
  { href: "/resume", label: "Resume", icon: "file" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

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
                ? "bg-surface-subtle text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
                : "text-muted hover:bg-surface-subtle/70 hover:text-foreground",
            )}
          >
            <Icon name={link.icon} className={active ? "text-accent-text" : undefined} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
