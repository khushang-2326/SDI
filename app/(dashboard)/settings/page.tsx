import { PageHeader } from "@/components/PageHeader";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        description="Configure queue behavior, screenshot retention, and automation limits in a later phase."
        title="Settings"
      />
      <div className="rounded-lg border border-line bg-white p-5 text-sm text-muted">
        Phase 1 uses local SQLite and simple cookie authentication.
      </div>
    </>
  );
}
