import { Skeleton } from "@/components/ui";

export default function ApplicationsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading applications">
      <div className="mb-6 sm:mb-8">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-56 max-w-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, col) => (
          <div key={col} className="flex flex-col gap-3">
            <Skeleton className="h-9 rounded-control" />
            {Array.from({ length: col === 0 ? 3 : 1 }, (_, i) => (
              <Skeleton key={i} className="h-32 rounded-control" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
