"use client";

import { useState } from "react";
import { resetAnalyticsAction } from "@/app/(dashboard)/analytics/actions";

export function ResetAnalyticsButton({ error, message }: { error?: string; message?: string }) {
  const [open, setOpen] = useState(Boolean(error));
  return <>
    {message ? <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
    <button className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700" onClick={() => setOpen(true)} type="button">Reset analytics</button>
    {open ? <div aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-red-600">Danger zone</p><h2 className="mt-1 text-xl font-bold text-ink">Reset analytics data?</h2></div><button aria-label="Close" className="rounded-lg bg-slate-100 px-3 py-2 text-slate-600" onClick={() => setOpen(false)} type="button">×</button></div>
        <p className="mt-3 text-sm leading-6 text-muted">This permanently deletes every stored analytics transaction for this account.</p>
        {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        <form action={resetAnalyticsAction} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold text-ink">Reason<textarea className="mt-2 min-h-24 w-full rounded-xl border border-line p-3" name="reason" placeholder="Explain why analytics should be reset" required /></label>
          <label className="block text-sm font-semibold text-ink">Admin password<input className="mt-2 w-full rounded-xl border border-line p-3" name="password" placeholder="Enter admin password" required type="password" /></label>
          <div className="flex justify-end gap-3 pt-2"><button className="rounded-xl border border-line px-4 py-2.5 font-semibold text-muted" onClick={() => setOpen(false)} type="button">Cancel</button><button className="rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white hover:bg-red-700">Confirm reset</button></div>
        </form>
      </div>
    </div> : null}
  </>;
}
