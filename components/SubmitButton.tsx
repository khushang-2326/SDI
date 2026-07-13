"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  disabled = false,
  pendingLabel = "Saving..."
}: {
  children: React.ReactNode;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-brand via-indigo-600 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition duration-300 hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
      disabled={pending || disabled}
      type="submit"
    >
      {pending || disabled ? pendingLabel : children}
    </button>
  );
}
