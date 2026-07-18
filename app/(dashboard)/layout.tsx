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
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/70 bg-white/85 px-3 py-2.5 shadow-sm backdrop-blur-xl sm:px-4 sm:py-3 md:px-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">
              Automation Control Center
            </p>
            <p className="hidden truncate text-sm text-muted min-[420px]:block">Discover, fill and verify every target</p>
          </div>
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm sm:px-3 sm:text-xs">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Dry mode ready
          </span>
        </header>
        <main className="min-w-0 flex-1 px-3 pb-28 pt-5 sm:px-4 sm:pt-7 md:px-8 md:pb-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
