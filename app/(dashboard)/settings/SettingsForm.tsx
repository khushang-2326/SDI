"use client";

import { useActionState, useState, useTransition, useMemo } from "react";
import { updateCaptchaSettingsAction, validateCaptchaKeyAction } from "./actions";
import { CAPTCHA_PROVIDERS, CaptchaProviderInfo } from "@/lib/captcha/providers";
import { SubmitButton } from "@/components/SubmitButton";

interface HistoryItem {
  id: string;
  provider: string;
  captchaType: string;
  status: string;
  durationMs: number;
  errorMessage: string | null;
  createdAt: Date;
}

interface SettingsFormProps {
  initialSettings: {
    captchaEnabled: boolean;
    captchaProvider: string;
    hasKey: boolean;
  };
  history: HistoryItem[];
}

export function SettingsForm({ initialSettings, history }: SettingsFormProps) {
  const [formState, formSubmitAction] = useActionState(updateCaptchaSettingsAction, {});
  const [providerSearch, setProviderSearch] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState(initialSettings.captchaProvider);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(initialSettings.hasKey ? "••••••••" : "");
  const [enabled, setEnabled] = useState(initialSettings.captchaEnabled);

  // Connection testing state
  const [isPending, startTransition] = useTransition();
  const [validationResult, setValidationResult] = useState<{
    success?: boolean;
    balance?: number;
    message?: string;
  } | null>(null);

  // Filter providers based on search query
  const filteredProviders = useMemo(() => {
    const search = providerSearch.toLowerCase().trim();
    if (!search) return CAPTCHA_PROVIDERS;
    return CAPTCHA_PROVIDERS.filter((provider) =>
      provider.name.toLowerCase().includes(search)
    );
  }, [providerSearch]);

  // Active provider details
  const activeProvider = useMemo(() => {
    return CAPTCHA_PROVIDERS.find((p) => p.id === selectedProviderId) || CAPTCHA_PROVIDERS[0];
  }, [selectedProviderId]);

  const handleTestConnection = () => {
    setValidationResult(null);
    startTransition(async () => {
      const res = await validateCaptchaKeyAction(selectedProviderId, apiKeyInput);
      setValidationResult(res);
    });
  };

  const selectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setDropdownOpen(false);
    setProviderSearch("");
    setValidationResult(null);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      {/* Settings Form Panel */}
      <div className="lg:col-span-5">
        <form action={formSubmitAction} className="rounded-2xl border border-line bg-white p-6 shadow-soft card-enter">
          <h2 className="mb-5 text-lg font-bold text-ink">Solver Configurations</h2>
          
          <div className="space-y-6">
            {/* Toggle Enable/Disable */}
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <label className="text-sm font-semibold text-ink" htmlFor="captchaEnabled">
                  CAPTCHA Solving Automation
                </label>
                <p className="text-xs text-muted mt-0.5">Solve bot verification checks dynamically during jobs.</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  checked={enabled}
                  className="peer sr-only"
                  id="captchaEnabled"
                  name="captchaEnabled"
                  onChange={(e) => setEnabled(e.target.checked)}
                  type="checkbox"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-brand peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
              </label>
            </div>

            {/* Provider Combobox */}
            <div className="relative">
              <label className="block text-sm font-semibold text-ink">
                Preferred Provider
              </label>
              <input name="captchaProvider" type="hidden" value={selectedProviderId} />
              
              <button
                className="mt-2 flex w-full items-center justify-between rounded-lg border border-line bg-white px-3 py-2.5 text-left text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                type="button"
              >
                <span>{activeProvider.name}</span>
                <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-lg [scrollbar-width:thin]">
                  <div className="sticky top-0 bg-white p-2 border-b border-line">
                    <input
                      className="w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                      onChange={(e) => setProviderSearch(e.target.value)}
                      placeholder="Search providers..."
                      type="text"
                      value={providerSearch}
                    />
                  </div>
                  <ul className="py-1">
                    {filteredProviders.map((provider) => (
                      <li key={provider.id}>
                        <button
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-canvas transition ${
                            provider.id === selectedProviderId ? "bg-brand/10 font-semibold text-brand" : "text-ink"
                          }`}
                          onClick={() => selectProvider(provider.id)}
                          type="button"
                        >
                          {provider.name}
                        </button>
                      </li>
                    ))}
                    {filteredProviders.length === 0 && (
                      <li className="px-3 py-4 text-center text-xs text-muted">No providers match search query.</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Official Purchase Link */}
              {activeProvider.website && (
                <p className="mt-2 text-xs text-muted">
                  Need credentials?{" "}
                  <a
                    className="font-semibold text-brand hover:underline"
                    href={activeProvider.website}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Visit {activeProvider.name} to purchase key ↗
                  </a>
                </p>
              )}
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-semibold text-ink animate-fade-in" htmlFor="captchaApiKey">
                API Key / Authentication Token
              </label>
              <input
                className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                id="captchaApiKey"
                name="captchaApiKey"
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={selectedProviderId === "mock" ? "Simulation mode - key optional" : "Enter API Key"}
                type="password"
                value={apiKeyInput}
              />
              <p className="text-xs text-muted mt-1.5">Stored securely at rest. Masked on subsequent loads.</p>
            </div>

            {/* Testing Actions */}
            <div className="flex gap-3 border-t border-line pt-4">
              <button
                className="flex-1 rounded-lg border border-line bg-canvas px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-200 disabled:opacity-50"
                disabled={isPending}
                onClick={handleTestConnection}
                type="button"
              >
                {isPending ? "Testing..." : "Test Connection"}
              </button>
              <SubmitButton>
                Save Settings
              </SubmitButton>
            </div>

            {/* Validation Outputs */}
            {validationResult && (
              <div className={`rounded-lg border p-4 text-sm card-enter ${
                validationResult.success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
              }`}>
                <div className="flex gap-2">
                  <span className="font-bold">{validationResult.success ? "✓ Active Connection" : "✗ Connection Failed"}</span>
                </div>
                {validationResult.success && validationResult.balance !== undefined && (
                  <p className="mt-1 text-xs font-medium">Account balance: ${validationResult.balance.toFixed(2)}</p>
                )}
                {validationResult.message && (
                  <p className="mt-1 text-xs">{validationResult.message}</p>
                )}
              </div>
            )}

            {/* Save state status */}
            {formState.success && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 text-center card-enter">
                Settings saved successfully.
              </div>
            )}
            {formState.error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 text-center card-enter">
                {formState.error}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* History panel */}
      <div className="lg:col-span-7">
        <div className="rounded-2xl border border-line bg-white shadow-soft card-enter h-full flex flex-col overflow-hidden">
          <div className="border-b border-line px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-ink">Recent Solve History</h2>
              <p className="text-xs text-muted mt-0.5">Summary of bot checks bypass results.</p>
            </div>
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-brand">
              Total bypassed: {history.length}
            </span>
          </div>

          <div className="flex-1 overflow-x-auto [scrollbar-width:thin]">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-canvas text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((item) => (
                  <tr className="hover:bg-canvas/50 transition" key={item.id}>
                    <td className="px-4 py-3 text-xs text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink capitalize">
                      {item.provider}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {item.captchaType}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        item.status === "Success" 
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                          : "bg-rose-50 text-rose-700 border border-rose-100"
                      }`}>
                        {item.status}
                      </span>
                      {item.errorMessage && (
                        <p className="text-[10px] text-rose-500 mt-0.5 max-w-[200px] truncate" title={item.errorMessage}>
                          {item.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {(item.durationMs / 1000).toFixed(2)}s
                    </td>
                  </tr>
                ))}
                {history.length === 0 ? (
                  <tr>
                    <td className="px-4 py-12 text-center text-muted" colSpan={5}>
                      No solves recorded. Complete outreach automation runs to compile history.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
