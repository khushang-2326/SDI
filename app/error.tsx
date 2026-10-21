"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = String(error?.message || "");
    if (
      msg.includes("Failed to find Server Action") ||
      msg.includes("older or newer deployment") ||
      msg.includes("ChunkLoadError") ||
      msg.includes("Loading chunk")
    ) {
      console.warn("[RootError] Deployment mismatch detected. Reloading newest assets...", error);
      window.location.reload();
      return;
    }
    console.error("[RootError] Uncaught application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans text-slate-900">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl text-indigo-600 ring-1 ring-indigo-200">
            🔄
          </div>
          <h2 className="mt-4 text-xl font-bold">New Update Available</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            The application has been updated with new automation improvements. Please reload to load the latest version.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow transition hover:bg-indigo-700"
            >
              Reload Page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
