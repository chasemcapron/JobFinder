import Link from "next/link";
import { signOut } from "@/auth";
import { AppHeader, NavLinks, SectionScope } from "@/components/nav-links";
import { Avatar, BrandMark, Button, Icon } from "@/components/ui";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user } = await requireUser();

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 text-sm font-medium shadow-raised focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <AppHeader className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-md">
        <div aria-hidden className="stripe grid h-1 grid-cols-4">
          <span className="bg-pink" />
          <span className="bg-orange" />
          <span className="bg-blue" />
          <span className="bg-green" />
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/jobs" className="flex items-center gap-2.5 rounded-control font-display text-lg font-bold tracking-tight">
            <BrandMark />
            Job Finder
          </Link>
          <div className="order-last -mx-1 w-[calc(100%+0.5rem)] sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
            <NavLinks />
          </div>
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <span className="hidden items-center gap-2 md:flex" title={user.email ?? undefined}>
              <Avatar name={user.name ?? user.email} />
              <span className="max-w-48 truncate text-sm text-muted">{user.email}</span>
            </span>
            <form action={doSignOut}>
              <Button variant="ghost" size="sm" type="submit" className="text-muted hover:text-foreground">
                <Icon name="log-out" />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </AppHeader>
      <SectionScope id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </SectionScope>
    </>
  );
}
