import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Alert, Button } from "@/components/ui";
import { env } from "@/lib/env";

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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Job Finder</h1>
        <p className="mt-3 text-muted">
          Finds postings that match your resume across Greenhouse, Lever, Ashby, Adzuna, and USAJobs. Filter and track
          them, log applications to your Google Sheet, and get the top new matches by email every morning.
        </p>
      </div>

      {error === "AccessDenied" ? (
        <Alert tone="error">This Google account isn&apos;t allowed to use this app.</Alert>
      ) : error ? (
        <Alert tone="error">Sign-in failed ({String(error)}). Please try again.</Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        {env.googleConfigured ? (
          <form action={signInWithGoogle}>
            <Button type="submit" className="w-full sm:w-auto">
              Sign in with Google
            </Button>
          </form>
        ) : null}
        {env.demoLoginEnabled ? (
          <form action={signInAsDemo}>
            <Button type="submit" variant={env.googleConfigured ? "secondary" : "primary"} className="w-full sm:w-auto">
              Continue with demo account
            </Button>
          </form>
        ) : null}
      </div>

      {!env.googleConfigured ? (
        <Alert tone="warning">
          Google sign-in isn&apos;t configured yet. Set <code>AUTH_GOOGLE_ID</code> and <code>AUTH_GOOGLE_SECRET</code>{" "}
          (see README). {env.demoLoginEnabled ? "Until then you can use the local demo account." : null}
        </Alert>
      ) : null}
    </main>
  );
}
