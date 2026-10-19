import { Card, Skeleton } from "@/components/ui";

export default function ApplicationsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading applications">
      <div className="mb-6 sm:mb-8">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-56 max-w-full" />
      </div>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex flex-col gap-3 p-4 sm:flex-row sm:justify-between sm:px-6">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-9 w-40" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
