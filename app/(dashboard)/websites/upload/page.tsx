import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRequiredWebsiteImportColumns } from "@/services/website-import";
import { clearSavedWebsitesAction, removeUploadedFileAction, renameUploadedFileAction, uploadWebsitesAction } from "./actions";
import fs from "node:fs/promises";
import path from "node:path";

type UploadSearchParams = {
  totalRows?: string;
  savedRows?: string;
  duplicateRows?: string;
  invalidRows?: string;
  failedRows?: string;
  message?: string;
};

function readNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function WebsiteUploadPage({
  searchParams
}: {
  searchParams: Promise<UploadSearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const hasSummary =
    params.totalRows !== undefined ||
    params.savedRows !== undefined ||
    params.duplicateRows !== undefined ||
    params.invalidRows !== undefined ||
    params.failedRows !== undefined ||
    params.message !== undefined;
  const columns = getRequiredWebsiteImportColumns();
  const savedWebsites = await prisma.targetWebsite.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      websiteName: true,
      websiteUrl: true,
      contactPageUrl: true,
      status: true
    }
  });
  const summaryCards = [
    { label: "Total rows", value: readNumber(params.totalRows) },
    { label: "Saved rows", value: readNumber(params.savedRows) },
    { label: "Duplicate rows", value: readNumber(params.duplicateRows) },
    { label: "Invalid rows", value: readNumber(params.invalidRows) },
    { label: "Failed rows", value: readNumber(params.failedRows) }
  ];
  const savedCards = [
    { label: "Saved website rows", value: savedWebsites.length },
    { label: "Required columns", value: columns.length }
  ];
  const uploadedFiles = await fs.readdir(path.join(process.cwd(), "public", "uploads")).catch(() => [] as string[]);

  return (
    <>
      <PageHeader
        description="Upload a spreadsheet of approved demo target websites. This import only saves website data and does not start automation."
        title="Upload Websites"
      />
      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form
          action={uploadWebsitesAction}
          className="rounded-lg border border-line bg-white p-5 shadow-soft"
        >
          <h2 className="mb-4 text-lg font-semibold text-ink">Excel import</h2>
          <label className="block">
            <span className="text-sm font-medium text-ink">Website Excel file</span>
            <input
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink focus:border-brand focus:ring-2 focus:ring-brand/20"
              name="file"
              required
              type="file"
            />
          </label>
          <div className="mt-5 flex items-center gap-3">
            <SubmitButton>Import Websites</SubmitButton>
            <Link className="text-sm font-semibold text-brand" href="/websites">
              Back to websites
            </Link>
          </div>
        </form>

        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-ink">Uploaded Excel files</h2>
            <div className="mt-4 space-y-2">{uploadedFiles.map((fileName) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas p-3" key={fileName}><span className="text-sm font-semibold">{fileName.replace(/^\d+-/, "")}</span><div className="flex flex-wrap gap-2"><a className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700" href={`/uploads/${encodeURIComponent(fileName)}`} target="_blank">Open</a><a className="rounded-lg bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700" download href={`/uploads/${encodeURIComponent(fileName)}`}>Download</a><form action={renameUploadedFileAction} className="flex gap-1"><input name="fileName" type="hidden" value={fileName} /><input className="w-24 rounded-lg border border-line px-2 text-xs" name="newName" placeholder="New name" required /><button className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Rename</button></form><form action={removeUploadedFileAction}><input name="fileName" type="hidden" value={fileName} /><button className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Remove</button></form></div></div>)}{uploadedFiles.length === 0 ? <p className="text-sm text-muted">No Excel files uploaded yet.</p> : null}</div>
          </section>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-ink">Required column</h2>
            <p className="mt-1 text-sm text-muted">
              Extra columns such as No. and testMode are allowed and ignored when not needed.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {columns.map((column) => (
                <code
                  className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
                  key={column}
                >
                  {column}
                </code>
              ))}
            </div>
          </section>

          {hasSummary ? (
            <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <h2 className="text-lg font-semibold text-ink">Import summary</h2>
              {params.message ? (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {params.message}
                </p>
              ) : null}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {summaryCards.map((card) => (
                  <div className="rounded-lg border border-line bg-canvas p-4" key={card.label}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {card.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-ink">{card.value}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">Saved websites</h2>
                <p className="mt-1 text-sm text-muted">
                  These records are available in the Run Automation saved website dropdown.
                </p>
              </div>
              <Link
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-canvas"
                href="/automation"
              >
                Go to automation
              </Link>
              <form action={clearSavedWebsitesAction}><button className="inline-flex min-h-9 items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100" disabled={savedWebsites.length === 0} type="submit">Clear saved websites</button></form>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {savedCards.map((card) => (
                <div className="rounded-lg border border-line bg-canvas p-4" key={card.label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {card.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-ink">{card.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead className="bg-canvas text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Website</th>
                    <th className="px-4 py-3">Contact / booking URL</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {savedWebsites.slice(0, 8).map((website) => (
                    <tr key={website.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{website.websiteName}</p>
                        <p className="break-all text-xs text-muted">{website.websiteUrl}</p>
                      </td>
                      <td className="break-all px-4 py-3 text-muted">{website.contactPageUrl}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-canvas px-2 py-1 text-xs font-semibold capitalize text-ink">
                          {website.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {savedWebsites.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted" colSpan={3}>
                        No saved websites yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
