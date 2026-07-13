import Link from "next/link";
import { Field, TextAreaField } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createWebsiteAction, discoverWebsiteTargetAction } from "./actions";

type WebsiteRow = {
  id: string;
  websiteName: string;
  websiteUrl: string;
  contactPageUrl: string;
  status: string;
  notes: string | null;
};

export default async function WebsitesPage() {
  const user = await requireUser();
  const websites = await prisma.targetWebsite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return (
    <>
      <PageHeader
        description="Register only websites you own, have permission to test, or use as demos."
        title="Target Websites"
      />
      <div className="mb-6">
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-canvas"
          href="/websites/upload"
        >
          Upload Excel
        </Link>
      </div>
      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form action={createWebsiteAction} className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold text-ink">Add website</h2>
          <div className="space-y-4">
            <Field label="Website Name" name="websiteName" />
            <Field label="Website URL" name="websiteUrl" type="url" />
            <Field
              label="Contact Page URL"
              name="contactPageUrl"
              placeholder="Optional. Use Discover if you only know the main site."
              required={false}
              type="url"
            />
            <label className="block">
              <span className="text-sm font-medium text-ink">Status</span>
              <select
                className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                name="status"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <TextAreaField label="Notes" name="notes" required={false} />
            <SubmitButton>Save Website</SubmitButton>
          </div>
        </form>
        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-lg font-semibold text-ink">Saved websites</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-canvas text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Website</th>
                  <th className="px-4 py-3">Contact URL</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Discovery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {websites.map((website: WebsiteRow) => (
                  <tr key={website.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{website.websiteName}</p>
                      <p className="text-xs text-muted">{website.websiteUrl}</p>
                    </td>
                    <td className="px-4 py-3 text-muted">{website.contactPageUrl}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-canvas px-2 py-1 text-xs font-semibold capitalize text-ink">
                        {website.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{website.notes ?? "-"}</td>
                    <td className="px-4 py-3">
                      <form action={discoverWebsiteTargetAction}>
                        <input name="websiteId" type="hidden" value={website.id} />
                        <button
                          className="inline-flex min-h-9 items-center justify-center rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink transition hover:bg-canvas"
                          type="submit"
                        >
                          Discover
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {websites.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-muted" colSpan={5}>
                      No websites saved yet.
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
