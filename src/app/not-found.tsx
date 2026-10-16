import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">That page doesn&apos;t exist.</p>
      <Link href="/jobs" className={buttonClass("secondary")}>
        Go to your jobs
      </Link>
    </main>
  );
}
