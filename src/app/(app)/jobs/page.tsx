import { EmptyState, PageHeader } from "@/components/ui";

export default function Page() {
  return (
    <>
      <PageHeader title="Jobs" />
      <EmptyState title="Nothing here yet">Matching jobs will appear here once job search is built.</EmptyState>
    </>
  );
}
