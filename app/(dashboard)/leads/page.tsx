import { Field, TextAreaField } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLeadAction } from "./actions";

type LeadRow = {
  id: string;
  fullName: string;
  mobileNumber: string;
  email: string;
  companyName: string;
  createdAt: Date;
};

export default async function LeadsPage() {
  const user = await requireUser();
  const leads = await prisma.lead.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return (
    <>
      <PageHeader
        description="Enter a lead once. Later phases will submit the saved record to selected approved websites."
        title="Leads"
      />
      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form action={createLeadAction} className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold text-ink">Add lead</h2>
          <div className="space-y-4">
            <Field label="Full Name" name="fullName" />
            <Field label="Mobile Number" name="mobileNumber" type="tel" />
            <Field label="Email" name="email" type="email" />
            <Field label="Company Name" name="companyName" />
            <TextAreaField label="Address" name="address" />
            <TextAreaField label="Message" name="message" />
            <SubmitButton>Save Lead</SubmitButton>
          </div>
        </form>
        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-lg font-semibold text-ink">Saved leads</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-canvas text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leads.map((lead: LeadRow) => (
                  <tr key={lead.id}>
                    <td className="px-4 py-3 font-medium text-ink">{lead.fullName}</td>
                    <td className="px-4 py-3 text-muted">{lead.mobileNumber}</td>
                    <td className="px-4 py-3 text-muted">{lead.email}</td>
                    <td className="px-4 py-3 text-muted">{lead.companyName}</td>
                    <td className="px-4 py-3 text-muted">
                      {lead.createdAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {leads.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-muted" colSpan={5}>
                      No leads saved yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
