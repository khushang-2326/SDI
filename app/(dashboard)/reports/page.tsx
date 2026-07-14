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
        {results.map((result) => (
          <section className="rounded-2xl border border-line bg-white p-5 shadow-soft" key={result.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="font-bold text-ink">{result.targetWebsite.websiteName}</h2><p className="break-all text-xs text-muted">{result.targetWebsite.websiteUrl}</p></div>
              <span className="rounded-full bg-canvas px-3 py-1 text-xs font-semibold">{result.status}</span>
            </div>
            <div className="mt-4 space-y-2">
              {result.attempts.map((attempt) => (
                <div className="grid gap-2 rounded-xl border border-line bg-canvas p-3 text-sm md:grid-cols-[30px_150px_1fr_100px]" key={attempt.id}>
                  <span className="font-semibold">{attempt.executionOrder}</span>
                  <span className="font-semibold">{attempt.targetType}</span>
                  <span className="break-all text-xs text-muted">{attempt.targetUrl}</span>
                  <span className={attempt.status === "Completed" ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{attempt.status}</span>
                  {attempt.errorMessage ? <p className="text-xs text-red-700 md:col-start-2 md:col-span-3">{attempt.errorMessage}</p> : null}
                </div>
              ))}
            </div>
          </section>
        ))}
        {results.length === 0 ? <div className="rounded-lg border border-line bg-white p-5 text-sm text-muted">No multi-target reports yet.</div> : null}
      </div>
    </>
  );
}
