import { Card, Skeleton } from "@/components/ui";

export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading settings">
      <div className="mb-6 sm:mb-8">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <div className="mb-5 flex items-start gap-3">
              <Skeleton className="size-8" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
