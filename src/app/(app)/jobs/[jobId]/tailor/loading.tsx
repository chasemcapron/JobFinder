import { Card, Skeleton } from "@/components/ui";

export default function TailorLoading() {
  return (
    <div aria-busy="true" aria-label="Loading tailoring">
      <div className="mb-6 flex flex-col gap-2 sm:mb-8">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="mb-4 h-8 w-64" />
      <Card className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </Card>
    </div>
  );
}
