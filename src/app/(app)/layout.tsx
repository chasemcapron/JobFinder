import Link from "next/link";
import { signOut } from "@/auth";
import { NavLinks } from "@/components/nav-links";
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
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/jobs" className="flex items-center gap-2.5 rounded-control font-semibold tracking-tight">
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
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>
    </>
  );
}
