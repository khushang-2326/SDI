"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = String(error?.message || "");
    // Automatically reload if this is a deployment version mismatch or stale server action hash
    if (
      msg.includes("Failed to find Server Action") ||
      msg.includes("older or newer deployment") ||
      msg.includes("ChunkLoadError") ||
      msg.includes("Loading chunk")
    ) {
      console.warn("[DashboardError] Deployment mismatch detected. Reloading newest assets...", error);
      window.location.reload();
      return;
    }
    console.error("[DashboardError] Uncaught dashboard error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md rounded-3xl border border-line bg-white p-8 shadow-soft">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl text-amber-600 ring-1 ring-amber-200">
          ⚠️
        </div>
        <h2 className="mt-4 text-xl font-bold text-ink">Page Temporary Issue</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          A new version of the automation service was deployed or a component encountered a temporary hiccup.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl border border-line bg-canvas px-4 py-2.5 text-xs font-bold text-ink hover:bg-slate-200 transition active:scale-95"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand/90 active:scale-95"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}
