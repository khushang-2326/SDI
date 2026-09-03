import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export default async function DashboardPage() {
  // The dashboard layout has already required this user. getCurrentUser is
  // request-memoized, so this reuses that result instead of querying twice.
  const user = await getCurrentUser();
  if (!user) return null;
  const [leadCount, websiteCount, jobCount] = await Promise.all([
    prisma.lead.count({ where: { userId: user.id } }),
    prisma.targetWebsite.count({ where: { userId: user.id } }),
    prisma.submissionJob.count({ where: { userId: user.id } })
  ]);

  const cards = [
    { label: "Saved leads", value: leadCount },
    { label: "Target websites", value: websiteCount },
    { label: "Submission jobs", value: jobCount }
  ];

  return (
    <>
      <PageHeader
        description="Manage the lead data and approved demo destinations that future automation jobs will use."
        title="Dashboard"
      />
      <section className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <div className="rounded-lg border border-line bg-white p-5 shadow-soft" key={card.label}>
            <p className="text-sm text-muted">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold text-ink">{card.value}</p>
          </div>
        ))}
      </section>
      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">Phase 1 scope</h2>
        <p className="mt-2 text-sm text-muted">
          Demo mode, Prisma persistence, lead capture, target website setup, and
          dashboard tables are enabled. Playwright automation is intentionally
          deferred to Phase 2.
        </p>
      </section>
    </>
  );
}
