import { Card, Skeleton } from "@/components/ui";

export default function JobsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading jobs">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Skeleton className="h-14 rounded-card lg:h-[32rem] lg:w-64 lg:shrink-0" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-3 h-4 w-32" />
          <ul className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i}>
                <Card padding="sm" className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <Skeleton className="size-11 shrink-0 rounded-control" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <Skeleton className="h-9 w-full" />
                  <div className="flex gap-2 border-t border-border pt-3">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-28" />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
