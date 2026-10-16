import Link from "next/link";
import { signOut } from "@/auth";
import { NavLinks } from "@/components/nav-links";
import { Button } from "@/components/ui";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user } = await requireUser();

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/jobs" className="font-semibold tracking-tight">
            Job Finder
          </Link>
          <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
            <NavLinks />
          </div>
          <div className="ml-auto flex items-center gap-3 sm:ml-0">
            <span className="hidden max-w-48 truncate text-sm text-muted md:inline" title={user.email ?? undefined}>
              {user.email}
            </span>
            <form action={doSignOut}>
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </>
  );
}
