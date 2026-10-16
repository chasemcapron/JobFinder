export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Job Finder</h1>
      <p className="text-muted">
        Finds job postings that match your resume, lets you filter and track them, logs applications to your Google
        Sheet, and emails you the top matches every morning.
      </p>
    </main>
  );
}
