export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex animate-pulse flex-col gap-4">
      <div className="h-8 w-48 rounded bg-border" />
      <div className="h-4 w-72 max-w-full rounded bg-border" />
      <div className="mt-2 h-40 rounded-lg bg-border/60" />
      <div className="h-40 rounded-lg bg-border/60" />
    </div>
  );
}
