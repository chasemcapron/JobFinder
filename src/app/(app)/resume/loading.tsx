import { Card, Skeleton } from "@/components/ui";

export default function ResumeLoading() {
  return (
    <div aria-busy="true" aria-label="Loading resume">
      <div className="mb-6 flex flex-col gap-2 sm:mb-8">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-24" />
        </Card>
        <Card className="flex flex-col gap-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
        </Card>
      </div>
    </div>
  );
}
