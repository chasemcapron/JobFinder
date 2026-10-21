import { Card, Skeleton } from "@/components/ui";

/** Chip widths for the placeholder groups, so they read as chips rather than lines. */
const CHIPS = ["w-16", "w-24", "w-12", "w-20", "w-28", "w-14"];

function CardHeaderSkeleton() {
  return (
    <div className="mb-5 flex items-start gap-3">
      <Skeleton className="size-8 shrink-0 rounded-control" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
    </div>
  );
}

export default function ResumeLoading() {
  return (
    <div aria-busy="true" aria-label="Loading resume">
      <div className="mb-6 flex items-start gap-3.5 sm:mb-8">
        <Skeleton className="size-11 shrink-0 rounded-card" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-1.5 rounded-pill" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24 max-w-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeaderSkeleton />
          <Skeleton className="mb-4 h-8 w-52" />
          <Skeleton className="h-36 rounded-card" />
          <Skeleton className="mt-4 h-9 w-28" />
        </Card>
        <Card>
          <CardHeaderSkeleton />
          <div className="grid gap-x-6 gap-y-7 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, group) => (
              <div key={group} className="flex flex-col gap-3">
                <Skeleton className="h-9 rounded-control" />
                <div className="flex flex-wrap gap-1.5">
                  {CHIPS.slice(0, group === 1 ? 6 : 4).map((w, i) => (
                    <Skeleton key={i} className={`h-6 rounded-pill ${w}`} />
                  ))}
                </div>
                <Skeleton className="h-9" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
