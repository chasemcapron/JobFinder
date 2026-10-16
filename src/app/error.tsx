"use client";

import { ErrorView } from "@/components/error-view";

// Catches failures in the signed-in layout itself (e.g. the database is unreachable).
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col">
      <ErrorView error={error} retry={retry} title="Job Finder couldn't load" />
    </main>
  );
}
