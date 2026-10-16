import { EmptyState, PageHeader } from "@/components/ui";

export default function Page() {
  return (
    <>
      <PageHeader title="Resume" />
      <EmptyState title="Nothing here yet">Resume upload is coming next.</EmptyState>
    </>
  );
}
