export default function JobsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading jobs" className="animate-pulse">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-24 rounded bg-border" />
          <div className="h-4 w-64 max-w-full rounded bg-border" />
        </div>
        <div className="h-9 w-28 rounded-md bg-border" />
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="h-12 rounded-lg bg-border/60 lg:h-[28rem] lg:w-64 lg:shrink-0" />
        <ul className="flex flex-1 flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="flex gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="size-12 shrink-0 rounded-md bg-border" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-4 w-2/3 rounded bg-border" />
                <div className="h-3 w-1/3 rounded bg-border" />
                <div className="h-3 w-5/6 rounded bg-border" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
