"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx, Icon, type IconName } from "./ui";

const LINKS: readonly { href: string; label: string; icon: IconName; section: string; activeClass: string; iconClass: string }[] = [
  { href: "/jobs", label: "Jobs", icon: "briefcase", section: "jobs", activeClass: "bg-blue/15 ring-blue/40", iconClass: "text-[#8fbcff]" },
  { href: "/applications", label: "Applications", icon: "inbox", section: "applications", activeClass: "bg-orange/15 ring-orange/40", iconClass: "text-[#ffb066]" },
  { href: "/resume", label: "Resume", icon: "file", section: "resume", activeClass: "bg-green/15 ring-green/40", iconClass: "text-[#6fdc97]" },
  { href: "/settings", label: "Settings", icon: "settings", section: "settings", activeClass: "bg-pink/15 ring-pink/40", iconClass: "text-[#ff93b9]" },
];

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
                ? cx("text-foreground ring-1 ring-inset", link.activeClass)
                : "text-muted hover:bg-surface-subtle/70 hover:text-foreground",
            )}
          >
            <Icon name={link.icon} className={active ? link.iconClass : undefined} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
