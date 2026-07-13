"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useActionState, useEffect, useState } from "react";
import {
  runAutomationAction,
  startBackgroundAutomationAction,
  getBackgroundAutomationAction,
  cancelBackgroundAutomationAction,
  resetBackgroundAutomationAction,
  type AutomationResult,
  type AutomationRunnerState
} from "@/app/(dashboard)/automation/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: AutomationRunnerState = {
  result: null
};

type SavedWebsiteOption = {
  id: string;
  websiteName: string;
  websiteUrl: string;
  contactPageUrl: string;
};
type FileGroup = { fileName: string; displayName: string; websiteIds: string[] };

type LiveBatchItem = {
  id: string;
  name: string;
  url: string;
  status: "waiting" | "discovering" | "completed" | "failed" | "cancelled";
  detail: string;
  result?: AutomationResult;
};

export function AutomationRunner({ websites, fileGroups }: { websites: SavedWebsiteOption[]; fileGroups: FileGroup[] }) {
  const [state, formAction] = useActionState(runAutomationAction, initialState);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState("");
  const [sourceMode, setSourceMode] = useState<"manual" | "excel">("manual");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [liveBatchItems, setLiveBatchItems] = useState<LiveBatchItem[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const usingUploadedWebsite = sourceMode === "excel";
  const processingAllUploaded = selectedWebsiteId.startsWith("__file__:");
  const selectedFileGroup = fileGroups.find((group) => `__file__:${group.fileName}` === selectedWebsiteId);
  const batchWebsites = selectedFileGroup ? websites.filter((website) => selectedFileGroup.websiteIds.includes(website.id)) : [];
  const batchResults = state.results ?? [];
  const finishedCount = liveBatchItems.filter(
    (item) => item.status === "completed" || item.status === "failed" || item.status === "cancelled"
  ).length;
  const progressPercent = liveBatchItems.length
    ? Math.round((finishedCount / liveBatchItems.length) * 100)
    : 0;

  function applyBackgroundJob(job: Awaited<ReturnType<typeof getBackgroundAutomationAction>>) {
    if (!job) return;
    setLiveBatchItems(job.items);
    setCurrentJobId(job.id);
    setIsBatchRunning(job.status === "running");
    if (job.status === "running") window.setTimeout(() => void pollBackgroundJob(job.id), 1200);
  }

  async function pollBackgroundJob(jobId: string) { applyBackgroundJob(await getBackgroundAutomationAction(jobId)); }
  async function cancelAutomation() { if (currentJobId) applyBackgroundJob(await cancelBackgroundAutomationAction(currentJobId)); }
  async function resetAutomation() { if (!currentJobId || isBatchRunning) return; if (await resetBackgroundAutomationAction(currentJobId)) { setLiveBatchItems([]); setCurrentJobId(null); setIsBatchRunning(false); } }

  useEffect(() => { void getBackgroundAutomationAction().then(applyBackgroundJob); }, []);

  async function submitWorkflow(event: FormEvent<HTMLFormElement>) {
    if (!processingAllUploaded) {
      openMonitorTab(event.currentTarget);
      return;
    }

    event.preventDefault();
    if (isBatchRunning) return;

    const baseFormData = new FormData(event.currentTarget);
    const initialItems = batchWebsites.map((website) => ({
      id: website.id,
      name: website.websiteName,
      url: website.websiteUrl,
      status: "waiting" as const,
      detail: "Waiting to start"
    }));
    setLiveBatchItems(initialItems);
    setIsBatchRunning(true);

    baseFormData.set("websiteIds", JSON.stringify(batchWebsites.map((website) => website.id)));
    try { applyBackgroundJob(await startBackgroundAutomationAction(baseFormData)); }
    catch (error) { setIsBatchRunning(false); setLiveBatchItems((items) => items.map((item) => ({ ...item, status: "failed", detail: error instanceof Error ? error.message : "Unable to start background automation" }))); }
  }

  function openMonitorTab(form: HTMLFormElement) {
    const formData = new FormData(form);
    const shouldOpenTab = formData.get("openMonitorTab") === "on";
    const targetUrl = websiteUrl.trim();

    if (shouldOpenTab && targetUrl) {
      const monitorWindow = window.open("about:blank", "_blank");

      if (monitorWindow) {
        monitorWindow.opener = null;
        monitorWindow.location.href = targetUrl;
      }
    }
  }

  function openCurrentUrl() {
    const targetUrl = websiteUrl.trim();

    if (targetUrl) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  }

  function updateUrlFromSavedWebsite(event: ChangeEvent<HTMLSelectElement>) {
    const selectedOption = event.currentTarget.selectedOptions[0];
    setSelectedWebsiteId(event.currentTarget.value);
    setWebsiteUrl(selectedOption?.dataset.targetUrl ?? "");
  }

  function updateSourceMode(event: ChangeEvent<HTMLSelectElement>) {
    const mode = event.currentTarget.value as "manual" | "excel";
    setSourceMode(mode);
    setWebsiteUrl("");
    setSelectedWebsiteId(mode === "excel" && fileGroups[0] ? `__file__:${fileGroups[0].fileName}` : "");
  }

  return (
    <section className="grid items-start gap-7 xl:grid-cols-[470px_1fr]">
      <form
        action={formAction}
        className="flex flex-col overflow-hidden rounded-3xl border border-white/80 bg-white/90 shadow-soft backdrop-blur xl:h-[calc(100vh-190px)] xl:min-h-[620px]"
        onSubmit={submitWorkflow}
      >
        <div className="bg-gradient-to-r from-indigo-600 via-brand to-cyan-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 text-lg shadow-inner ring-1 ring-white/20">▶</span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-100">Automation launchpad</p>
              <h2 className="mt-1 text-xl font-bold">Run workflow</h2>
            </div>
          </div>
        </div>
        <div className="space-y-5 overflow-y-auto p-6 [scrollbar-width:thin]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">1</span>
            Choose the target
          </div>
          <label className="block">
            <span className="text-sm font-medium text-ink">Automation Type</span>
            <select
              className="mt-2 w-full rounded-xl border border-line bg-slate-50/70 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
              name="automationType"
            >
              <option value="auto">Auto discover if needed</option>
              <option value="booking">Use this exact URL as booking widget</option>
              <option value="hubspot">Use this exact URL as HubSpot</option>
              <option value="calendly">Use this exact URL as Calendly</option>
              <option value="contact">Use this exact URL as contact form</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Website source</span>
            <select
              className="mt-2 w-full rounded-xl border border-line bg-slate-50/70 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
              name="sourceMode"
              onChange={updateSourceMode}
              value={sourceMode}
            >
              <option value="manual">
                Enter URL manually
              </option>
              <option disabled={fileGroups.length === 0} value="excel">Uploaded Excel file</option>
            </select>
            <span className="mt-1 block text-xs text-muted">
              Choose manual entry or process one uploaded workbook.
            </span>
          </label>
          {sourceMode === "excel" ? <label className="block"><span className="text-sm font-medium text-ink">Select Excel file</span><select className="mt-2 w-full rounded-xl border border-line bg-slate-50/70 px-3 py-2.5 text-sm" name="websiteId" onChange={updateUrlFromSavedWebsite} value={selectedWebsiteId}>{fileGroups.map((group) => <option data-target-url="" key={group.fileName} value={`__file__:${group.fileName}`}>{group.displayName} ({group.websiteIds.length} websites)</option>)}</select></label> : null}
          <div>
            <Field
              label={
                processingAllUploaded
                  ? "Uploaded website URLs"
                  : usingUploadedWebsite
                    ? "Selected uploaded website URL"
                    : "Website / Contact URL"
              }
              name="websiteUrl"
              onChange={(event) => setWebsiteUrl(event.currentTarget.value)}
              placeholder={usingUploadedWebsite ? undefined : "https://example.com"}
              readOnly={usingUploadedWebsite}
              required={!usingUploadedWebsite}
              type="url"
              value={websiteUrl}
            />
            {processingAllUploaded ? (
              <p className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2.5 text-xs text-indigo-700">
                All {batchWebsites.length} websites from {selectedFileGroup?.displayName} will run one by one using the lead details below.
                A failure will not stop the remaining websites.
              </p>
            ) : null}
            <button
              className="mt-2 inline-flex min-h-9 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:-translate-y-0.5 hover:bg-indigo-100"
              onClick={openCurrentUrl}
              type="button"
            >
              Open Monitor Tab
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">2</span>
            Lead information
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full Name" name="fullName" defaultValue="Demo Lead" />
            <Field label="Email" name="email" type="email" defaultValue="demo.lead@example.com" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile" name="mobile" defaultValue="5551234567" />
            <Field label="Company Name" name="companyName" defaultValue="Demo Company" />
          </div>
          <TextArea label="Address" name="address" defaultValue="123 Demo Street, New York, NY" />
          <TextArea
            label="Message"
            name="message"
            defaultValue="Hello, this is a demo inquiry from the dashboard workflow."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Preferred Date" name="preferredDate" required={false} placeholder="July 7" />
            <Field label="Preferred Time" name="preferredTime" required={false} placeholder="9:30am" />
            <Field label="Timezone" name="timezone" required={false} placeholder="Eastern" />
          </div>
          <div className="flex items-center gap-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">3</span>
            Run settings
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-ink transition hover:border-indigo-200 hover:bg-indigo-50/40">
            <input className="mt-1" defaultChecked name="openMonitorTab" type="checkbox" />
            <span>
              Open target link in a new browser tab
              <span className="block text-xs text-muted">
                Opens the URL you entered. This tab is only for monitoring, not the controlled automation browser.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-ink transition hover:border-indigo-200 hover:bg-indigo-50/40">
            <input className="mt-1" name="showBrowser" type="checkbox" />
            <span>
              Show Playwright automation browser
              <span className="block text-xs text-muted">
                Opens the browser window Playwright controls. Use this to watch actual clicks live.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3 text-sm text-amber-900">
            <input className="mt-1" name="liveSubmit" type="checkbox" />
            <span>
              Live submit
              <span className="block text-xs">Unchecked means dry run. Dry run stops before final booking/submission.</span>
            </span>
          </label>
          <SubmitButton disabled={isBatchRunning} pendingLabel="Processing websites...">
            Start Workflow
          </SubmitButton>
        </div>
      </form>

      <div className="flex min-h-[520px] flex-col overflow-hidden rounded-3xl border border-white/80 bg-white/90 shadow-soft backdrop-blur xl:h-[calc(100vh-190px)] xl:min-h-[620px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-gradient-to-r from-slate-50 to-indigo-50/70 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Activity stream</p>
            <h2 className="mt-1 text-xl font-bold text-ink">Workflow result</h2>
          </div>
          <div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${isBatchRunning ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700"}`}>{isBatchRunning ? "● Automation running" : "● Ready"}</span>{isBatchRunning ? <button className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700" onClick={cancelAutomation} type="button">Cancel</button> : null}<button className="rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-brand transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" disabled={isBatchRunning || !currentJobId || liveBatchItems.length === 0} onClick={resetAutomation} type="button">Reset</button></div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 [scrollbar-width:thin]">
        {liveBatchItems.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Live automation progress</h3>
              <span className="rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-muted">
                {finishedCount}
                /{liveBatchItems.length} finished
              </span>
            </div>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand via-indigo-500 to-cyan-400 transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
              {isBatchRunning ? <span className="workflow-shimmer absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/70 to-transparent" /> : null}
            </div>
            {liveBatchItems.map((item, index) => (
              <div className={`card-enter relative overflow-hidden rounded-2xl border p-4 transition duration-300 ${statusCardClass(item.status)}`} key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Website {index + 1} of {liveBatchItems.length}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">{item.name}</p>
                    <p className="break-all text-xs text-muted">{item.url}</p>
                  </div>
                  <span className={`flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(item.status)}`}>
                    <span className={`h-2 w-2 rounded-full ${item.status === "discovering" ? "workflow-pulse bg-indigo-500" : item.status === "completed" ? "bg-emerald-500" : item.status === "failed" ? "bg-red-500" : item.status === "cancelled" ? "bg-amber-500" : "bg-slate-400"}`} />
                    {item.status}
                  </span>
                </div>
                <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${item.status === "failed" ? "border border-red-200 bg-red-50 font-semibold text-red-700" : "text-muted"}`}><span className="mr-1 font-semibold">{item.status === "failed" ? "Failure reason:" : "Progress:"}</span>{item.detail}</div>
                {item.result?.screenshotPath ? (
                  <a className="mt-2 block text-xs font-semibold text-brand" href={item.result.screenshotPath} target="_blank">
                    Open latest screenshot
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {batchResults.length > 1 ? (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Uploaded website batch results</h3>
              <span className="rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-muted">
                {batchResults.length} processed sequentially
              </span>
            </div>
            {batchResults.map((result, index) => (
              <div className="rounded-lg border border-line bg-canvas p-4" key={`${result.websiteUrl}-${index}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="break-all text-sm font-semibold text-ink">{result.websiteUrl}</p>
                    <p className="mt-1 text-xs text-muted">{result.targetType ?? "Target not detected"}</p>
                  </div>
                  <span className="rounded-full border border-line bg-white px-2 py-1 text-xs font-semibold text-ink">
                    {result.status}
                  </span>
                </div>
                {result.errorMessage ? (
                  <p className="mt-3 text-xs text-red-700">{result.errorMessage}</p>
                ) : null}
                {result.screenshotPath ? (
                  <a className="mt-3 block text-xs font-semibold text-brand" href={result.screenshotPath} target="_blank">
                    Open screenshot
                  </a>
                ) : null}
              </div>
            ))}
            <h3 className="pt-2 text-sm font-semibold text-ink">Last processed website details</h3>
          </div>
        ) : null}
        {state.result ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Summary label="Status" value={state.result.status} />
              <Summary label="Submitted At" value={new Date(state.result.submittedAt).toLocaleString()} />
              <Summary label="Resolved URL" value={state.result.resolvedUrl} />
              <Summary label="Target Type" value={state.result.targetType ?? "-"} />
              <Summary label="Selected Date" value={state.result.selectedDate ?? "-"} />
              <Summary label="Selected Time" value={state.result.selectedTime ?? "-"} />
            </div>
            {state.result.discoveryReason ? (
              <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink">
                {state.result.discoveryReason}
              </p>
            ) : null}
            {state.result.errorMessage ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.result.errorMessage}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <ListBox title="Filled fields" items={state.result.filledFields} />
              <ListBox title="Skipped fields" items={state.result.skippedFields} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Screenshot proof</h3>
              <div className="mt-3 space-y-2">
                {state.result.screenshotPaths.length > 0 ? (
                  state.result.screenshotPaths.map((screenshotPath) => (
                    <a
                      className="block rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium text-brand"
                      href={screenshotPath}
                      key={screenshotPath}
                      target="_blank"
                    >
                      {screenshotPath}
                    </a>
                  ))
                ) : (
                  <p className="text-sm text-muted">No screenshots saved.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[440px] flex-col items-center justify-center text-center">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-100 to-cyan-100 text-3xl text-brand shadow-inner">
              ◎
              <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-emerald-400 ring-4 ring-white" />
            </div>
            <h3 className="mt-5 text-lg font-bold text-ink">Ready for automation</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
              Start a workflow and this space will come alive with discovery, form filling, status updates and screenshot proof.
            </p>
          </div>
        )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  value,
  onChange,
  placeholder,
  readOnly = false,
  required = true,
  type = "text"
}: {
  label: string;
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  type?: "text" | "email" | "url";
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        className="mt-2 w-full rounded-xl border border-line bg-slate-50/70 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10 read-only:bg-indigo-50/50"
        defaultValue={defaultValue}
        name={name}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue
}: {
  label: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <textarea
        className="mt-2 min-h-24 w-full rounded-xl border border-line bg-slate-50/70 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
        defaultValue={defaultValue}
        name={name}
      />
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function ListBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm text-muted">{items.length > 0 ? items.join(", ") : "-"}</p>
    </div>
  );
}

function statusCardClass(status: LiveBatchItem["status"]) {
  if (status === "discovering") return "border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50 shadow-md shadow-indigo-100/60";
  if (status === "completed") return "border-emerald-200 bg-emerald-50/60";
  if (status === "failed") return "border-red-200 bg-red-50/60";
  if (status === "cancelled") return "border-amber-200 bg-amber-50/60";
  return "border-slate-200 bg-slate-50/70";
}

function statusBadgeClass(status: LiveBatchItem["status"]) {
  if (status === "discovering") return "bg-indigo-100 text-indigo-700";
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "cancelled") return "bg-amber-100 text-amber-700";
  return "bg-slate-200 text-slate-600";
}
