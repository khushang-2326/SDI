import { PageHeader } from "@/components/PageHeader";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        description="Submission reports will be populated after the Phase 2 automation worker creates job results."
        title="Reports"
      />
      <div className="rounded-lg border border-line bg-white p-5 text-sm text-muted">
        No reports yet.
      </div>
    </>
  );
}
