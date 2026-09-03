import { PageHeader } from "@/components/PageHeader";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ReportsPage() {
  const user = await requireUser();
  const results = await prisma.submissionResult.findMany({
    where: { job: { userId: user.id }, attempts: { some: {} } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      targetWebsite: true,
      attempts: { orderBy: { executionOrder: "asc" } }
    }
  });
  return (
    <>
      <PageHeader
        description="Review every discovered target and its independent automation outcome."
        title="Reports"
      />
      <div className="space-y-4">
        {results.map((result) => {
          const hasSuccess = result.attempts.some(
            (a) => ["completed", "success", "dry_run_ready_to_book"].includes(a.status.toLowerCase())
          );
          const successCount = result.attempts.filter(
            (a) => ["completed", "success", "dry_run_ready_to_book"].includes(a.status.toLowerCase())
          ).length;

          return (
            <section
              className={`rounded-2xl border p-5 shadow-soft transition duration-300 ${
                hasSuccess
                  ? "border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-200/70"
                  : "border-red-300 bg-red-50/70 ring-1 ring-red-200/70"
              }`}
              key={result.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-ink">{result.targetWebsite.websiteName}</h2>
                  <p className="break-all text-xs text-muted">{result.targetWebsite.websiteUrl}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    hasSuccess
                      ? "border border-emerald-300 bg-emerald-100 text-emerald-800"
                      : "border border-red-300 bg-red-100 text-red-800"
                  }`}
                >
                  {hasSuccess
                    ? `Completed (${successCount}/${result.attempts.length} trials succeeded)`
                    : `Failed (0/${result.attempts.length} trials succeeded)`}
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {result.attempts.map((attempt) => {
                  const attemptSuccess = ["completed", "success", "dry_run_ready_to_book"].includes(
                    attempt.status.toLowerCase()
                  );

                  return (
                    <div
                      className={`grid gap-2 rounded-xl border p-3 text-sm md:grid-cols-[30px_150px_1fr_100px] ${
                        attemptSuccess
                          ? "border-emerald-300 bg-emerald-100/60 text-emerald-950"
                          : "border-red-300 bg-red-100/60 text-red-950"
                      }`}
                      key={attempt.id}
                    >
                      <span className="font-semibold">{attempt.executionOrder}</span>
                      <span className="font-semibold">{attempt.targetType}</span>
                      <span className="break-all text-xs opacity-80">{attempt.targetUrl}</span>
                      <span
                        className={`font-bold ${
                          attemptSuccess ? "text-emerald-700" : "text-red-700"
                        }`}
                      >
                        {attemptSuccess ? "✓ " + attempt.status : "✕ " + attempt.status}
                      </span>
                      {attempt.errorMessage ? (
                        <p className="rounded-lg border border-red-200 bg-red-50/80 p-2 text-xs text-red-800 md:col-span-3 md:col-start-2">
                          {attempt.errorMessage}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {results.length === 0 ? <div className="rounded-lg border border-line bg-white p-5 text-sm text-muted">No multi-target reports yet.</div> : null}
      </div>
    </>
  );
}
