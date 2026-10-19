import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { SubmitButton } from "@/components/action-form";
import { Alert, BrandMark, Divider, Icon, type IconName } from "@/components/ui";
import { env } from "@/lib/env";

const FEATURES: { icon: IconName; title: string; body: string; color: string }[] = [
  {
    icon: "target",
    title: "Matched to your resume",
    body: "Postings from Greenhouse, Lever, Ashby, Adzuna, and USAJobs, ranked by fit.",
    color: "bg-blue",
  },
  {
    icon: "sheet",
    title: "Tracked in your Google Sheet",
    body: "Mark a job applied and it's logged as a new row.",
    color: "bg-orange",
  },
  {
    icon: "mail",
    title: "A morning digest",
    body: "The top new matches in your inbox every day.",
    color: "bg-green",
  },
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
  if (session?.user?.id) redirect("/jobs");
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
      <div aria-hidden className="absolute inset-x-0 top-0 grid h-1.5 grid-cols-4">
        <span className="bg-pink" />
        <span className="bg-orange" />
        <span className="bg-blue" />
        <span className="bg-green" />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-5 font-display text-5xl leading-none font-semibold tracking-wider uppercase">Job Finder</h1>
          <p className="mt-2 text-balance text-muted">Find jobs that fit your resume, and keep track of where you applied.</p>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 sm:p-8">
          <ul className="flex flex-col">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0">
                <span className={`grid size-9 shrink-0 place-items-center rounded-control text-white ${f.color}`}>
                  <Icon name={f.icon} />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-base font-medium tracking-wider uppercase">{f.title}</p>
                  <p className="text-sm text-muted">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <Divider className="my-5" />

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
