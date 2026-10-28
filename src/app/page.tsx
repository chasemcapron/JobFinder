import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { SubmitButton } from "@/components/action-form";
import { Alert, Divider, Icon, type IconName } from "@/components/ui";
import { env } from "@/lib/env";
import { getUser } from "@/lib/profile";

const FEATURES: { icon: IconName; title: string; body: string; tile: string }[] = [
  {
    icon: "target",
    tile: "bg-blue text-white",
    title: "Matched to your resume",
    body: "Company career sites (Greenhouse, Lever, Ashby, Workday) and USAJobs, ranked by fit for your level.",
  },
  { icon: "sheet", tile: "bg-green text-ink", title: "Tracked in your Google Sheet", body: "Mark a job applied and it's logged as a new row." },
  { icon: "mail", tile: "bg-orange text-ink", title: "A morning digest", body: "The top new matches in your inbox every day." },
];

const TILES: { icon: IconName; cls: string }[] = [
  { icon: "briefcase", cls: "-rotate-6 bg-blue text-white" },
  { icon: "inbox", cls: "rotate-3 bg-orange text-ink" },
  { icon: "file", cls: "-rotate-3 bg-green text-ink" },
  { icon: "settings", cls: "rotate-6 bg-pink text-ink" },
];

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.31v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const session = await auth();
  // A session whose user is gone (database reset, account removed) shows sign-in: /jobs would send it back here, in a loop.
  if (session?.user?.id && (await getUser(session.user.id))) redirect("/jobs");
  const { error } = await searchParams;

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/jobs" });
  }

  async function signInAsDemo() {
    "use server";
    await signIn("demo", { redirectTo: "/jobs" });
  }

  return (
    <main className="relative isolate flex w-full flex-1 flex-col items-center justify-center px-4 py-12 sm:py-20">
      <div
        aria-hidden
        className="stripe absolute inset-x-0 top-0 grid h-1 grid-cols-4"
      >
        <span className="bg-pink" />
        <span className="bg-orange" />
        <span className="bg-blue" />
        <span className="bg-green" />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div aria-hidden className="flex gap-2.5">
            {TILES.map((t) => (
              <span key={t.icon} className={`grid size-12 place-items-center rounded-card shadow-xs transition-transform duration-200 hover:-translate-y-1 ${t.cls}`}>
                <Icon name={t.icon} className="size-6" />
              </span>
            ))}
          </div>
          <h1 className="font-display mt-5 text-4xl font-bold tracking-tight">Job Finder</h1>
          <p className="mt-3 text-xl leading-snug font-light text-balance sm:text-2xl">
            <span className="text-muted">Jobs matched to your resume,</span> tracked until you&apos;re hired.
          </p>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-raised sm:p-8">
          <ul className="flex flex-col gap-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className={`grid size-8 shrink-0 place-items-center rounded-control ${f.tile}`}>
                  <Icon name={f.icon} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-sm text-muted">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <Divider className="my-6" />

          <div className="flex flex-col gap-3">
            {error === "AccessDenied" ? (
              <Alert tone="error">This Google account isn&apos;t allowed to use this app.</Alert>
            ) : error ? (
              <Alert tone="error">Sign-in failed ({String(error)}). Please try again.</Alert>
            ) : null}

            {env.googleConfigured ? (
              <form action={signInWithGoogle}>
                <SubmitButton
                  label="Sign in with Google"
                  pendingLabel="Redirecting…"
                  variant="secondary"
                  size="lg"
                  icon={<GoogleLogo />}
                  className="w-full"
                />
              </form>
            ) : null}

            {env.googleConfigured && env.demoLoginEnabled ? <Divider label="or" /> : null}

            {env.demoLoginEnabled ? (
              <form action={signInAsDemo}>
                <SubmitButton
                  label="Continue with demo account"
                  pendingLabel="Signing in…"
                  variant={env.googleConfigured ? "ghost" : "primary"}
                  size="lg"
                  className="w-full"
                />
              </form>
            ) : null}

            {!env.googleConfigured ? (
              <Alert tone="warning">
                Google sign-in isn&apos;t configured yet. Set <code>AUTH_GOOGLE_ID</code> and{" "}
                <code>AUTH_GOOGLE_SECRET</code> (see README).{" "}
                {env.demoLoginEnabled ? "Until then you can use the local demo account." : null}
              </Alert>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
