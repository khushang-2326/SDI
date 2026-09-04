"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  runAutomationAction,
  startBackgroundAutomationAction,
  getBackgroundAutomationAction,
  processLocalBackgroundAutomationAction,
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

type AnalysisItem = {
  id: string;
  name: string;
  url: string;
  status: "waiting" | "discovering" | "completed" | "failed" | "cancelled";
  isSuccess: boolean;
  trialsCount: number;
  successfulTrialsCount: number;
  detail: string;
  screenshotPath?: string | null;
  attempts?: AutomationResult["attempts"];
};

function AutomationAnalysisModal({
  isOpen,
  onClose,
  items,
  totalTrialsExecuted,
  totalTrialsSuccessful,
  batchStatus
}: {
  isOpen: boolean;
  onClose: () => void;
  items: AnalysisItem[];
  totalTrialsExecuted: number;
  totalTrialsSuccessful: number;
  batchStatus: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<"all" | "success" | "failed" | "pending">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const totalWebsites = items.length;
  const successWebsites = items.filter((i) => i.isSuccess);
  const failedWebsites = items.filter((i) => i.status === "failed" && !i.isSuccess);
  const pendingWebsites = items.filter((i) => i.status === "waiting" || i.status === "discovering" || i.status === "cancelled");

  const successRate = totalWebsites > 0 ? Math.round((successWebsites.length / totalWebsites) * 100) : 0;
  const failureRate = totalWebsites > 0 ? Math.round((failedWebsites.length / totalWebsites) * 100) : 0;

  const filteredItems = items.filter((item) => {
    if (filter === "success" && !item.isSuccess) return false;
    if (filter === "failed" && (item.isSuccess || item.status !== "failed")) return false;
    if (filter === "pending" && (item.isSuccess || item.status === "failed")) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const copySummary = () => {
    const text = `AUTOMATION RUN ANALYSIS REPORT
Status: ${batchStatus.toUpperCase()}
Total Websites Analyzed: ${totalWebsites}
✓ Succeeded Automations: ${successWebsites.length} (${successRate}%)
✕ Failed Automations (0 tests succeeded): ${failedWebsites.length} (${failureRate}%)
⏳ Pending / Cancelled: ${pendingWebsites.length}
Total Target Trials: ${totalTrialsExecuted} (${totalTrialsSuccessful} successful)

WEBSITE BREAKDOWN:
${items
  .map(
    (i, idx) =>
      `${idx + 1}. [${i.isSuccess ? "SUCCESS" : "FAILED"}] ${i.name} (${i.url}) - Trials: ${
        i.successfulTrialsCount
      }/${i.trialsCount} - Detail: ${i.detail}`
  )
  .join("\n")}`;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-xl text-indigo-400 ring-1 ring-indigo-500/30">
              📊
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">Automation Performance Analysis</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${
                    batchStatus === "completed"
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                      : batchStatus === "cancelled"
                      ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                      : "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40"
                  }`}
                >
                  {batchStatus}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Detailed success vs failure metrics across all website trials
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copySummary}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
              title="Copy analysis summary report"
            >
              <span>{copied ? "✓ Copied" : "📋 Copy Report"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-sm font-bold text-slate-300 hover:bg-red-600 hover:text-white transition"
              title="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 [scrollbar-width:thin]">
          {/* Top 4 KPI Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Websites */}
            <div className="rounded-2xl border border-slate-800 bg-slate-800/50 p-4 shadow-inner">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Targets</p>
              <p className="mt-2 text-2xl font-black text-white">{totalWebsites}</p>
              <p className="mt-1 text-xs text-slate-400">Websites in workflow</p>
            </div>

            {/* Succeeded Websites (GREEN) */}
            <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/40 p-4 shadow-inner ring-1 ring-emerald-500/20">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Succeeded</p>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  {successRate}%
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-emerald-400">{successWebsites.length}</p>
              <p className="mt-1 text-xs text-emerald-300/80">≥ 1 trial successful</p>
            </div>

            {/* Failed Websites (0 tests succeeded - RED) */}
            <div className="rounded-2xl border border-red-800/50 bg-red-950/40 p-4 shadow-inner ring-1 ring-red-500/20">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Failed (0 Success)</p>
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                  {failureRate}%
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-red-400">{failedWebsites.length}</p>
              <p className="mt-1 text-xs text-red-300/80">0 successful trials</p>
            </div>

            {/* Total Trials Executed */}
            <div className="rounded-2xl border border-indigo-800/50 bg-indigo-950/40 p-4 shadow-inner ring-1 ring-indigo-500/20">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Trials Executed</p>
                <span className="text-[11px] font-bold text-indigo-400">
                  {totalTrialsSuccessful}/{totalTrialsExecuted}
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-indigo-300">{totalTrialsExecuted}</p>
              <p className="mt-1 text-xs text-indigo-300/80">
                {totalWebsites > 0 ? (totalTrialsExecuted / totalWebsites).toFixed(1) : 0} avg trials / website
              </p>
            </div>
          </div>

          {/* Stacked Visual Proportion Bar */}
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-800/40 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Outcome Distribution</span>
              <span>
                {successWebsites.length} Succeeded • {failedWebsites.length} Failed • {pendingWebsites.length} Other
              </span>
            </div>
            <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-800 flex">
              {successWebsites.length > 0 ? (
                <div
                  style={{ width: `${(successWebsites.length / totalWebsites) * 100}%` }}
                  className="bg-emerald-500 transition-all duration-500"
                  title={`Succeeded: ${successWebsites.length} (${successRate}%)`}
                />
              ) : null}
              {failedWebsites.length > 0 ? (
                <div
                  style={{ width: `${(failedWebsites.length / totalWebsites) * 100}%` }}
                  className="bg-red-500 transition-all duration-500"
                  title={`Failed: ${failedWebsites.length} (${failureRate}%)`}
                />
              ) : null}
              {pendingWebsites.length > 0 ? (
                <div
                  style={{ width: `${(pendingWebsites.length / totalWebsites) * 100}%` }}
                  className="bg-amber-500 transition-all duration-500"
                  title={`Pending/Cancelled: ${pendingWebsites.length}`}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Succeeded ({successWebsites.length})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Failed with 0 success ({failedWebsites.length})
              </span>
              {pendingWebsites.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Pending / Cancelled ({pendingWebsites.length})
                </span>
              ) : null}
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  filter === "all"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                }`}
              >
                All ({totalWebsites})
              </button>
              <button
                type="button"
                onClick={() => setFilter("success")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  filter === "success"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-emerald-400 hover:bg-slate-700"
                }`}
              >
                ✓ Succeeded ({successWebsites.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("failed")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  filter === "failed"
                    ? "bg-red-600 text-white"
                    : "bg-slate-800 text-red-400 hover:bg-slate-700"
                }`}
              >
                ✕ Failed ({failedWebsites.length})
              </button>
              {pendingWebsites.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setFilter("pending")}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    filter === "pending"
                      ? "bg-amber-600 text-white"
                      : "bg-slate-800 text-amber-400 hover:bg-slate-700"
                  }`}
                >
                  ⏳ Pending / Cancelled ({pendingWebsites.length})
                </button>
              ) : null}
            </div>

            <input
              type="text"
              placeholder="Filter by name, URL, reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-white placeholder-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Filtered Website List */}
          <div className="space-y-3">
            {filteredItems.map((item, idx) => (
              <div
                key={item.id || idx}
                className={`rounded-2xl border p-4 transition ${
                  item.isSuccess
                    ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-100"
                    : item.status === "failed"
                    ? "border-red-700/60 bg-red-950/30 text-red-100"
                    : "border-slate-800 bg-slate-800/40 text-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                      <h4 className="text-sm font-bold text-white">{item.name}</h4>
                    </div>
                    <p className="break-all text-xs opacity-75">{item.url}</p>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                      item.isSuccess
                        ? "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                        : item.status === "failed"
                        ? "border border-red-500/40 bg-red-500/20 text-red-300"
                        : "border border-slate-600 bg-slate-700 text-slate-300"
                    }`}
                  >
                    {item.isSuccess
                      ? "✓ Succeeded"
                      : item.status === "failed"
                      ? "✕ Failed (0 Success)"
                      : item.status}
                  </span>
                </div>

                <div
                  className={`mt-2.5 rounded-xl px-3 py-2 text-xs ${
                    item.isSuccess
                      ? "bg-emerald-900/40 text-emerald-200 border border-emerald-800/50"
                      : item.status === "failed"
                      ? "bg-red-900/40 text-red-200 border border-red-800/50"
                      : "bg-slate-800/60 text-slate-300"
                  }`}
                >
                  <span className="mr-1 font-bold">
                    {item.isSuccess ? "Outcome:" : "Failure Reason:"}
                  </span>
                  {item.detail}
                  {item.trialsCount > 0 ? (
                    <span className="ml-2 font-bold opacity-80">
                      ({item.successfulTrialsCount}/{item.trialsCount} trials succeeded)
                    </span>
                  ) : null}
                </div>

                {item.screenshotPath ? (
                  <div className="mt-3">
                    <ScreenshotViewer src={item.screenshotPath} alt={item.name} />
                  </div>
                ) : null}
              </div>
            ))}

            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-800/30 p-8 text-center text-xs text-slate-400">
                No websites match the selected filter.
              </div>
            ) : null}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-6 py-4">
          <span className="text-xs text-slate-400">
            {successWebsites.length} of {totalWebsites} websites succeeded ({successRate}% success rate)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

function ScreenshotViewer({ src, alt = "Screenshot" }: { src: string; alt?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-5 backdrop-blur-sm cursor-zoom-out"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="relative flex flex-1 flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar with Title and Close Button */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-4 text-white">
          <span className="text-base font-semibold truncate pr-6">{alt}</span>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition active:scale-95 shadow-md"
            title="Close full screen view"
          >
            <span>✕</span>
            <span>Close</span>
          </button>
        </div>

        {/* Full Screen Image Container (scrollable to see tall screenshots) */}
        <div className="flex-1 overflow-y-auto p-6 flex justify-center items-start bg-slate-950">
          <div className="w-full max-w-5xl rounded-xl overflow-hidden border border-slate-800 bg-slate-900 shadow-2xl">
            <img
              src={src}
              alt={alt}
              className="w-full h-auto object-contain block"
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mt-2 w-full">
      {/* Gallery-style thumbnail with contain sizing so nothing is cropped */}
      <div
        onClick={() => setIsOpen(true)}
        className="group relative flex max-h-48 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-1 shadow-sm transition hover:border-brand/40 hover:shadow"
      >
        <img
          src={src}
          alt={alt}
          className="max-h-46 max-w-full rounded-lg object-contain transition duration-200 group-hover:scale-[1.01]"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition duration-150 group-hover:opacity-100">
          <span className="rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md border border-slate-100">
            Click to maximize
          </span>
        </div>
      </div>

      {isOpen && mounted && createPortal(modalContent, document.body)}
    </div>
  );
}

export function AutomationRunner({ websites, fileGroups }: { websites: SavedWebsiteOption[]; fileGroups: FileGroup[] }) {
  const [state, formAction] = useActionState(runAutomationAction, initialState);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState("");
  const [sourceMode, setSourceMode] = useState<"manual" | "excel">("manual");
  const [automationType, setAutomationType] = useState("auto");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [directContactUrl, setDirectContactUrl] = useState("");
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [liveBatchItems, setLiveBatchItems] = useState<LiveBatchItem[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<"idle" | "running" | "completed" | "cancelled">("idle");
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const cancelledJobId = useRef<string | null>(null);
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
  const elapsedMs = jobStartedAt ? Math.max(0, clock - jobStartedAt) : 0;
  const estimatedRemainingMs = finishedCount > 0
    ? Math.max(0, (elapsedMs / finishedCount) * (liveBatchItems.length - finishedCount))
    : null;

  const analysisItems: AnalysisItem[] = useMemo(() => {
    if (liveBatchItems.length > 0) {
      return liveBatchItems.map((item) => {
        const isSuccess = hasSuccessfulAttempt(item);
        const trialsCount = item.result?.attempts?.length ?? (item.status === "completed" || item.status === "failed" ? 1 : 0);
        const successfulTrialsCount = item.result?.attempts?.filter(isAttemptSuccessful).length ?? (isSuccess ? 1 : 0);
        return {
          id: item.id,
          name: item.name,
          url: item.url,
          status: item.status,
          isSuccess,
          trialsCount,
          successfulTrialsCount,
          detail: item.detail,
          screenshotPath: item.result?.screenshotPath,
          attempts: item.result?.attempts
        };
      });
    }

    if (batchResults.length > 0) {
      return batchResults.map((res, idx) => {
        const isSuccess = isResultSuccessful(res);
        const trialsCount = res.attempts?.length ?? 1;
        const successfulTrialsCount = res.attempts?.filter(isAttemptSuccessful).length ?? (isSuccess ? 1 : 0);
        return {
          id: `batch-${idx}`,
          name: res.websiteUrl,
          url: res.websiteUrl,
          status: isSuccess ? "completed" : "failed",
          isSuccess,
          trialsCount,
          successfulTrialsCount,
          detail: res.errorMessage || res.discoveryReason || (isSuccess ? "Automation completed" : "Failed"),
          screenshotPath: res.screenshotPath,
          attempts: res.attempts
        };
      });
    }

    if (state.result) {
      const isSuccess = isResultSuccessful(state.result);
      const trialsCount = state.result.attempts?.length ?? 1;
      const successfulTrialsCount = state.result.attempts?.filter(isAttemptSuccessful).length ?? (isSuccess ? 1 : 0);
      return [
        {
          id: "single-1",
          name: state.result.websiteUrl || "Manual Target",
          url: state.result.websiteUrl,
          status: isSuccess ? "completed" : "failed",
          isSuccess,
          trialsCount,
          successfulTrialsCount,
          detail: state.result.errorMessage || state.result.discoveryReason || (isSuccess ? "Automation completed" : "Failed"),
          screenshotPath: state.result.screenshotPath,
          attempts: state.result.attempts
        }
      ];
    }

    return [];
  }, [liveBatchItems, batchResults, state.result]);

  const totalTrialsExecuted = useMemo(() => {
    return analysisItems.reduce((acc, item) => acc + Math.max(1, item.trialsCount), 0);
  }, [analysisItems]);

  const totalTrialsSuccessful = useMemo(() => {
    return analysisItems.reduce((acc, item) => acc + item.successfulTrialsCount, 0);
  }, [analysisItems]);

  const applyBackgroundJob = useCallback((job: Awaited<ReturnType<typeof getBackgroundAutomationAction>>) => {
    if (!job) return;
    if (cancelledJobId.current === job.id && job.status !== "cancelled") return;
    setLiveBatchItems(job.items);
    setCurrentJobId(job.id);
    setJobStartedAt(new Date(job.createdAt).getTime());
    setIsBatchRunning(job.status === "running");
    setBatchStatus(job.status);
  }, []);

  function togglePauseAutomation() {
    setIsPaused((prev) => {
      const next = !prev;
      isPausedRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    if (!isBatchRunning) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isBatchRunning]);

  async function cancelAutomation() {
    if (!currentJobId || isCancelling) return;
    cancelledJobId.current = currentJobId;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsCancelling(true);
    setIsBatchRunning(false);
    setBatchStatus("cancelled");
    setLiveBatchItems((items) =>
      items.map((item) =>
        item.status === "completed" || item.status === "failed"
          ? item
          : { ...item, status: "cancelled", detail: "Cancelled by user" }
      )
    );
    try {
      const cancelledJob = await cancelBackgroundAutomationAction(currentJobId);
      // Do not allow Reset to race ahead of the database transaction. The
      // returned job is already terminal and makes the Reset button valid.
      if (cancelledJob) applyBackgroundJob(cancelledJob);
    } finally {
      setIsCancelling(false);
    }
  }
  async function resetAutomation() {
    if (!currentJobId || isBatchRunning || isCancelling || isResetting) return;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsResetting(true);
    try {
      if (await resetBackgroundAutomationAction(currentJobId)) {
        cancelledJobId.current = null;
        setLiveBatchItems([]);
        setCurrentJobId(null);
        setIsBatchRunning(false);
        setBatchStatus("idle");
      }
    } finally {
      setIsResetting(false);
    }
  }

  useEffect(() => {
    void getBackgroundAutomationAction().then(applyBackgroundJob);
  }, [applyBackgroundJob]);

  useEffect(() => {
    if (!currentJobId || !isBatchRunning) return;
    const jobId = currentJobId;
    let stopped = false;

    async function refreshProgress() {
      while (!stopped) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        if (stopped) return;

        const job = await getBackgroundAutomationAction(jobId).catch(() => null);
        if (stopped) return;
        if (job) applyBackgroundJob(job);
        if (!job || job.status !== "running") return;

        // If the server watchdog recovered a timed-out website, restart local
        // queue processing without asking the user to refresh the dashboard.
        // The server-side lock keeps this harmless when another request owns it.
        if (!job.items.some((item) => item.status === "discovering")) {
          void processLocalBackgroundAutomationAction(jobId)
            .then((resumedJob) => {
              if (!stopped && resumedJob) applyBackgroundJob(resumedJob);
            })
            .catch(() => undefined);
        }
      }
    }

    void refreshProgress();
    return () => { stopped = true; };
  }, [applyBackgroundJob, currentJobId, isBatchRunning]);

  useEffect(() => {
    if (!currentJobId || !isBatchRunning) return;
    const jobId = currentJobId;
    let stopped = false;

    async function processSequentially() {
      while (!stopped) {
        if (isPausedRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          continue;
        }

        const job = await processLocalBackgroundAutomationAction(jobId).catch(() => null);
        if (stopped) return;
        if (job) applyBackgroundJob(job);
        if (!job || job.status !== "running") return;

        // Avoid request contention if another open dashboard tab currently owns the job lock.
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }

    void processSequentially();
    return () => { stopped = true; };
  }, [applyBackgroundJob, currentJobId, isBatchRunning]);

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
    setJobStartedAt(Date.now());
    setClock(Date.now());
    setIsBatchRunning(true);
    setBatchStatus("running");
    cancelledJobId.current = null;

    baseFormData.set("websiteIds", JSON.stringify(batchWebsites.map((website) => website.id)));
    try { applyBackgroundJob(await startBackgroundAutomationAction(baseFormData)); }
    catch (error) { setIsBatchRunning(false); setBatchStatus("completed"); setLiveBatchItems((items) => items.map((item) => ({ ...item, status: "failed", detail: error instanceof Error ? error.message : "Unable to start background automation" }))); }
  }

  function openMonitorTab(form: HTMLFormElement) {
    const formData = new FormData(form);
    const shouldOpenTab = formData.get("openMonitorTab") === "on";
    const targetUrl = automationType === "direct_contact"
      ? directContactUrl.trim()
      : websiteUrl.trim();

    if (shouldOpenTab && targetUrl) {
      const monitorWindow = window.open("about:blank", "_blank");

      if (monitorWindow) {
        monitorWindow.opener = null;
        monitorWindow.location.href = targetUrl;
      }
    }
  }

  function openCurrentUrl() {
    const targetUrl = automationType === "direct_contact"
      ? directContactUrl.trim()
      : websiteUrl.trim();

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
    <section className="grid min-w-0 items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(380px,470px)_minmax(0,1fr)] xl:gap-7">
      <form
        action={formAction}
        className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/90 shadow-soft backdrop-blur sm:rounded-3xl xl:h-[calc(100vh-190px)] xl:min-h-[620px]"
        onSubmit={submitWorkflow}
      >
        <div className="bg-gradient-to-r from-indigo-600 via-brand to-cyan-600 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 text-lg shadow-inner ring-1 ring-white/20">▶</span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-100">Automation launchpad</p>
              <h2 className="mt-1 text-xl font-bold">Run workflow</h2>
            </div>
          </div>
        </div>
        <div className="space-y-5 overflow-y-auto p-4 [scrollbar-width:thin] sm:p-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">1</span>
            Choose the target
          </div>
          <label className="block">
            <span className="text-sm font-medium text-ink">Automation Type</span>
            <select
              className="mt-2 w-full rounded-xl border border-line bg-slate-50/70 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
              name="automationType"
              onChange={(event) => setAutomationType(event.currentTarget.value)}
              value={automationType}
            >
              <option value="auto">Auto discover if needed</option>
              <option value="direct_contact">Direct contact page only — fastest</option>
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
          {automationType === "direct_contact" ? (
            sourceMode === "manual" ? (
              <div>
                <Field
                  label="Direct Contact Form URL"
                  name="directContactUrl"
                  onChange={(event) => setDirectContactUrl(event.currentTarget.value)}
                  placeholder="https://example.com/contact-us"
                  type="url"
                  value={directContactUrl}
                />
                <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                  Only this page will be opened. Homepage discovery, sitemap checks, crawling, Calendly and HubSpot detection are skipped.
                </p>
              </div>
            ) : (
              <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-800">
                Each Excel row must contain a <strong>contactPageUrl</strong>. Rows without one will fail fast without opening the homepage.
              </p>
            )
          ) : null}
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

      <div className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/90 shadow-soft backdrop-blur sm:min-h-[520px] sm:rounded-3xl xl:h-[calc(100vh-190px)] xl:min-h-[620px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-gradient-to-r from-slate-50 to-indigo-50/70 px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Activity stream</p>
            <h2 className="mt-1 text-xl font-bold text-ink">Workflow result</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {analysisItems.length > 0 ? (
              <button
                type="button"
                onClick={() => setIsAnalysisOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50 px-3 py-1.5 text-xs font-bold text-indigo-800 shadow-sm transition hover:border-indigo-300 hover:from-indigo-100 hover:to-cyan-100 active:scale-95"
                title="Open detailed success/failure analysis"
              >
                <span>📊</span>
                <span>Analysis</span>
                <span className="ml-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-extrabold text-indigo-700 shadow-inner">
                  {analysisItems.filter((i) => i.isSuccess).length} ✓ / {analysisItems.filter((i) => i.status === "failed" && !i.isSuccess).length} ✕
                </span>
              </button>
            ) : null}

            <span
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                isPaused
                  ? "bg-amber-100 text-amber-800"
                  : isBatchRunning
                  ? "bg-indigo-100 text-indigo-700"
                  : batchStatus === "cancelled"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {isPaused
                ? "⏸ Paused"
                : isCancelling
                ? "● Cancelling"
                : isBatchRunning
                ? "● Automation running"
                : batchStatus === "cancelled"
                ? "● Cancelled"
                : "● Ready"}
            </span>

            {isBatchRunning ? (
              <button
                className={`rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-95 ${
                  isPaused ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-500 hover:bg-amber-600"
                }`}
                onClick={togglePauseAutomation}
                type="button"
              >
                {isPaused ? "▶ Resume" : "⏸ Pause"}
              </button>
            ) : null}

            {isBatchRunning ? (
              <button
                className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-red-700 transition active:scale-95 disabled:cursor-not-allowed disabled:bg-red-300"
                disabled={isCancelling}
                onClick={cancelAutomation}
                type="button"
              >
                {isCancelling ? "Cancelling..." : "✕ Cancel"}
              </button>
            ) : null}

            <button
              className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              disabled={isBatchRunning || isCancelling || isResetting || !currentJobId || liveBatchItems.length === 0}
              onClick={resetAutomation}
              type="button"
            >
              {isResetting ? "Resetting..." : "Reset"}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:thin] sm:p-6">
        {analysisItems.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/90 via-white to-cyan-50/90 p-3.5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-[11px]">📊</span>
                <span>Run Analysis:</span>
              </div>
              <span className="rounded-lg border border-emerald-300 bg-emerald-100/80 px-2.5 py-1 text-xs font-bold text-emerald-900 shadow-sm">
                ✓ {analysisItems.filter((i) => i.isSuccess).length} Succeeded
              </span>
              <span className="rounded-lg border border-red-300 bg-red-100/80 px-2.5 py-1 text-xs font-bold text-red-900 shadow-sm">
                ✕ {analysisItems.filter((i) => i.status === "failed" && !i.isSuccess).length} Failed (0 Success)
              </span>
              {analysisItems.some((i) => i.status === "waiting" || i.status === "discovering") ? (
                <span className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  ⏳ {analysisItems.filter((i) => i.status === "waiting" || i.status === "discovering").length} In Progress
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setIsAnalysisOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand/90 active:scale-95"
            >
              <span>View Full Analysis</span>
              <span>→</span>
            </button>
          </div>
        ) : null}

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
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-canvas px-3 py-2"><span className="text-muted">Progress</span><strong className="ml-2 text-ink">{progressPercent}%</strong></div>
              <div className="rounded-xl border border-line bg-canvas px-3 py-2"><span className="text-muted">Elapsed</span><strong className="ml-2 text-ink">{formatDuration(elapsedMs)}</strong></div>
              <div className="rounded-xl border border-line bg-canvas px-3 py-2"><span className="text-muted">Estimated time left</span><strong className="ml-2 text-ink">{estimatedRemainingMs === null ? "Calculating…" : formatDuration(estimatedRemainingMs)}</strong></div>
            </div>
            {liveBatchItems.map((item, index) => {
              const isSuccess = hasSuccessfulAttempt(item);
              const isFailedZeroSuccess = item.status === "failed" && !isSuccess;
              const attemptsCount = item.result?.attempts?.length ?? 0;
              const successfulAttemptsCount = item.result?.attempts?.filter(isAttemptSuccessful).length ?? 0;

              return (
                <div className={`card-enter relative overflow-hidden rounded-2xl border p-4 transition duration-300 ${statusCardClass(item)}`} key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Website {index + 1} of {liveBatchItems.length}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-ink">{item.name}</p>
                      <p className="break-all text-xs text-muted">{item.url}</p>
                    </div>
                    <span className={`flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-bold ${statusBadgeClass(item.status, isSuccess)}`}>
                      <span className={`h-2 w-2 rounded-full ${isSuccess ? "bg-emerald-500" : item.status === "discovering" ? "workflow-pulse bg-indigo-500" : isFailedZeroSuccess ? "bg-red-500" : item.status === "cancelled" ? "bg-amber-500" : "bg-slate-400"}`} />
                      {isSuccess ? (attemptsCount > 1 ? `Completed (${successfulAttemptsCount}/${attemptsCount} trials)` : "Completed") : isFailedZeroSuccess ? "Failed (0 trials succeeded)" : item.status}
                    </span>
                  </div>
                  <div className={`mt-3 rounded-xl px-3.5 py-2.5 text-xs ${isSuccess ? "border border-emerald-200 bg-emerald-100/70 font-semibold text-emerald-900" : isFailedZeroSuccess ? "border border-red-200 bg-red-100/70 font-semibold text-red-900" : "text-muted"}`}>
                    <span className="mr-1.5 font-bold">
                      {isSuccess ? "Success:" : isFailedZeroSuccess ? "Failure (0 successful trials):" : "Progress:"}
                    </span>
                    {item.detail}
                  </div>
                  {item.result?.screenshotPath ? (
                    <ScreenshotViewer src={item.result.screenshotPath} alt={item.name} />
                  ) : null}
                  {item.result?.attempts?.length ? (
                    <div className="mt-3 space-y-2 border-t border-line/70 pt-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">
                        Target Trials ({successfulAttemptsCount}/{attemptsCount} Succeeded)
                      </p>
                      {item.result.attempts.map((attempt) => {
                        const isAttemptSuccess = isAttemptSuccessful(attempt);
                        return (
                          <div className={`rounded-xl border p-3 transition ${isAttemptSuccess ? "border-emerald-300 bg-emerald-50/90 text-emerald-950 shadow-sm" : "border-red-300 bg-red-50/90 text-red-950 shadow-sm"}`} key={attempt.id}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-bold">
                                  Trial #{attempt.executionOrder} — {attempt.targetType}
                                </p>
                                <p className="break-all text-[11px] opacity-80">{attempt.targetUrl}</p>
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${isAttemptSuccess ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-red-100 text-red-800 border border-red-300"}`}>
                                {isAttemptSuccess ? "✓ Success" : "✕ Failed"}
                              </span>
                            </div>
                            {attempt.errorMessage ? (
                              <p className="mt-2 rounded-lg border border-red-200 bg-red-100/80 px-2.5 py-1.5 text-xs text-red-800">{attempt.errorMessage}</p>
                            ) : null}
                            {attempt.screenshotPath ? (
                              <ScreenshotViewer src={attempt.screenshotPath} alt={`Trial ${attempt.executionOrder}`} />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
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
            {batchResults.map((result, index) => {
              const isSuccess = isResultSuccessful(result);
              return (
                <div className={`rounded-2xl border p-4 transition duration-300 ${isSuccess ? "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200/70 shadow-sm" : "border-red-300 bg-red-50/80 ring-1 ring-red-200/70 shadow-sm"}`} key={`${result.websiteUrl}-${index}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="break-all text-sm font-semibold text-ink">{result.websiteUrl}</p>
                      <p className="mt-1 text-xs text-muted">{result.targetType ?? "Target not detected"}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isSuccess ? "border border-emerald-300 bg-emerald-100 text-emerald-800" : "border border-red-300 bg-red-100 text-red-800"}`}>
                      {isSuccess ? "✓ Success" : "✕ Failed (0 successful tests)"}
                    </span>
                  </div>
                  {result.errorMessage ? (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-100/70 p-2 text-xs text-red-800">{result.errorMessage}</p>
                  ) : null}
                  {result.screenshotPath ? (
                    <ScreenshotViewer src={result.screenshotPath} alt={result.websiteUrl} />
                  ) : null}
                </div>
              );
            })}
            <h3 className="pt-2 text-sm font-semibold text-ink">Last processed website details</h3>
          </div>
        ) : null}
        {state.result ? (() => {
          const isSuccess = isResultSuccessful(state.result);
          return (
            <div className={`mt-5 space-y-4 rounded-2xl border p-5 transition duration-300 ${isSuccess ? "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200/70 shadow-sm" : "border-red-300 bg-red-50/80 ring-1 ring-red-200/70 shadow-sm"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-3">
                <div>
                  <h3 className="text-base font-bold text-ink">Automation Outcome</h3>
                  <p className="text-xs text-muted">Trial completed for {state.result.websiteUrl || "target"}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${isSuccess ? "border border-emerald-300 bg-emerald-100 text-emerald-800" : "border border-red-300 bg-red-100 text-red-800"}`}>
                  {isSuccess ? "✓ SUCCESS" : "✕ FAILED (0 successful tests)"}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Summary label="Status" value={state.result.status} />
                <Summary label="Submitted At" value={new Date(state.result.submittedAt).toLocaleString()} />
                <Summary label="Resolved URL" value={state.result.resolvedUrl} />
                <Summary label="Target Type" value={state.result.targetType ?? "-"} />
                <Summary label="Selected Date" value={state.result.selectedDate ?? "-"} />
                <Summary label="Selected Time" value={state.result.selectedTime ?? "-"} />
              </div>
              {state.result.discoveryReason ? (
                <p className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink">
                  {state.result.discoveryReason}
                </p>
              ) : null}
              {state.result.errorMessage ? (
                <p className="rounded-xl border border-red-200 bg-red-100/70 px-3 py-2 text-sm font-medium text-red-800">
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
                    <div className="flex flex-wrap gap-3">
                      {state.result.screenshotPaths.map((screenshotPath, index) => (
                        <ScreenshotViewer
                          src={screenshotPath}
                          key={screenshotPath}
                          alt={`Screenshot Proof ${index + 1}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No screenshots saved.</p>
                  )}
                </div>
              </div>
            </div>
          );
        })() : (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-2 text-center sm:min-h-[440px]">
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

      <AutomationAnalysisModal
        isOpen={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        items={analysisItems}
        totalTrialsExecuted={totalTrialsExecuted}
        totalTrialsSuccessful={totalTrialsSuccessful}
        batchStatus={isPaused ? "paused" : batchStatus}
      />
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

function isAttemptSuccessful(attempt: { status: string }): boolean {
  const s = (attempt.status || "").toLowerCase();
  return s === "completed" || s === "success" || s === "dry_run_ready_to_book";
}

function isResultSuccessful(res?: AutomationResult | null): boolean {
  if (!res) return false;
  const s = (res.status || "").toLowerCase();
  if (s === "success" || s === "completed" || s === "dry_run_ready_to_book") {
    return true;
  }
  if (res.attempts && res.attempts.length > 0) {
    return res.attempts.some(isAttemptSuccessful);
  }
  return false;
}

function hasSuccessfulAttempt(item: LiveBatchItem): boolean {
  if (item.status === "completed") return true;
  if (isResultSuccessful(item.result)) return true;
  return false;
}

function statusCardClass(item: LiveBatchItem) {
  if (hasSuccessfulAttempt(item)) {
    return "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200/70 shadow-sm";
  }
  if (item.status === "discovering") {
    return "border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50 shadow-md shadow-indigo-100/60";
  }
  if (item.status === "failed") {
    return "border-red-300 bg-red-50/80 ring-1 ring-red-200/70 shadow-sm";
  }
  if (item.status === "cancelled") {
    return "border-amber-200 bg-amber-50/70";
  }
  return "border-slate-200 bg-slate-50/70";
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusBadgeClass(status: LiveBatchItem["status"], isSuccess = false) {
  if (isSuccess || status === "completed") return "bg-emerald-100 text-emerald-800 border border-emerald-300";
  if (status === "discovering") return "bg-indigo-100 text-indigo-700 border border-indigo-200";
  if (status === "failed") return "bg-red-100 text-red-800 border border-red-300";
  if (status === "cancelled") return "bg-amber-100 text-amber-800 border border-amber-200";
  return "bg-slate-200 text-slate-700 border border-slate-300";
}
