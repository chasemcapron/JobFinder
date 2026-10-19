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

/** Tab-bar grid under the header on phones, plain text links from `sm` up (active one in the accent hue). */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="grid grid-cols-4 sm:flex sm:items-center sm:gap-6">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex flex-col items-center gap-1 border-b-2 px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors",
              "sm:flex-row sm:px-0 sm:text-[15px]",
              active
                ? "border-accent-text text-accent-text"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            <Icon name={link.icon} className="sm:hidden" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
