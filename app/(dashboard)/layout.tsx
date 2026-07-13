import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen md:flex">
      <Sidebar userName={user.name} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-xl md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">
              Automation Control Center
            </p>
            <p className="text-sm text-muted">Discover, fill and verify every target</p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Dry mode ready
          </span>
        </header>
        <main className="flex-1 px-4 py-8 md:px-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
