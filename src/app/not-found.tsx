import Link from "next/link";
import { BrandMark, buttonClass, Icon } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <BrandMark size="lg" />
      <p className="mt-2 text-sm font-medium tracking-wide text-muted uppercase">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted">That page doesn&apos;t exist, or it may have moved.</p>
      <Link href="/jobs" className={buttonClass("primary")}>
        <Icon name="search" />
        Go to your jobs
      </Link>
    </main>
  );
}
