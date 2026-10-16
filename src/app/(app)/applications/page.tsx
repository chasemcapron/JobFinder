import { EmptyState, PageHeader } from "@/components/ui";

export default function Page() {
  return (
    <>
      <PageHeader title="Applications" />
      <EmptyState title="Nothing here yet">Jobs you mark as applied will be listed here.</EmptyState>
    </>
  );
}
