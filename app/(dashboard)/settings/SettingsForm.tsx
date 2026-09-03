"use client";

import { useActionState, useState, useTransition, useMemo } from "react";
import {
  updateCaptchaSettingsAction,
  validateCaptchaKeyAction,
  updateProxySettingsAction,
  validateProxyAction
} from "./actions";
import { CAPTCHA_PROVIDERS } from "@/lib/captcha/providers";
import { parseProxyString } from "@/lib/proxy/parser";
import type { ProxyProtocol, ProxyTestResult } from "@/lib/proxy/types";
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
  initialProxySettings: {
    proxyEnabled: boolean;
    proxyProtocol: string;
    proxyHost: string;
    proxyPort: string;
    proxyUsername: string;
    hasPassword: boolean;
    proxyBandwidthSaver: boolean;
  };
  history: HistoryItem[];
}

export function SettingsForm({ initialSettings, initialProxySettings, history }: SettingsFormProps) {
  // CAPTCHA State
  const [captchaFormState, captchaFormAction] = useActionState(updateCaptchaSettingsAction, {});
  const [providerSearch, setProviderSearch] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState(initialSettings.captchaProvider);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(initialSettings.hasKey ? "••••••••" : "");
  const [captchaEnabled, setCaptchaEnabled] = useState(initialSettings.captchaEnabled);
  const [isCaptchaPending, startCaptchaTransition] = useTransition();
  const [captchaValidationResult, setCaptchaValidationResult] = useState<{
    success?: boolean;
    balance?: number;
    message?: string;
  } | null>(null);

  // Proxy State
  const [proxyFormState, proxyFormAction] = useActionState(updateProxySettingsAction, {});
  const [proxyEnabled, setProxyEnabled] = useState(initialProxySettings.proxyEnabled);
  const [proxyProtocol, setProxyProtocol] = useState<ProxyProtocol>(
    (initialProxySettings.proxyProtocol as ProxyProtocol) || "http"
  );
  const [proxyHost, setProxyHost] = useState(initialProxySettings.proxyHost);
  const [proxyPort, setProxyPort] = useState(initialProxySettings.proxyPort);
  const [proxyUsername, setProxyUsername] = useState(initialProxySettings.proxyUsername);
  const [proxyPassword, setProxyPassword] = useState(initialProxySettings.hasPassword ? "••••••••" : "");
  const [proxyBandwidthSaver, setProxyBandwidthSaver] = useState(initialProxySettings.proxyBandwidthSaver);
  const [rawQuickImport, setRawQuickImport] = useState("");
  const [quickImportMessage, setQuickImportMessage] = useState<string | null>(null);

  const [isProxyPending, startProxyTransition] = useTransition();
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);

  // Filter CAPTCHA providers
  const filteredProviders = useMemo(() => {
    const search = providerSearch.toLowerCase().trim();
    if (!search) return CAPTCHA_PROVIDERS;
    return CAPTCHA_PROVIDERS.filter((provider) =>
      provider.name.toLowerCase().includes(search)
    );
  }, [providerSearch]);

  const activeProvider = useMemo(() => {
    return CAPTCHA_PROVIDERS.find((p) => p.id === selectedProviderId) || CAPTCHA_PROVIDERS[0];
  }, [selectedProviderId]);

  const handleTestCaptchaConnection = () => {
    setCaptchaValidationResult(null);
    startCaptchaTransition(async () => {
      const res = await validateCaptchaKeyAction(selectedProviderId, apiKeyInput);
      setCaptchaValidationResult(res);
    });
  };

  const selectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setDropdownOpen(false);
    setProviderSearch("");
    setCaptchaValidationResult(null);
  };

  // Quick-import proxy string parser
  const handleQuickImport = () => {
    setQuickImportMessage(null);
    if (!rawQuickImport.trim()) {
      setQuickImportMessage("Please paste a proxy line first.");
      return;
    }
    const parsed = parseProxyString(rawQuickImport);
    if (!parsed) {
      setQuickImportMessage("Could not parse format. Ensure it follows host:port@user:pass, user:pass@host:port, or host:port.");
      return;
    }

    setProxyProtocol(parsed.protocol);
    setProxyHost(parsed.host);
    setProxyPort(String(parsed.port));
    if (parsed.username) setProxyUsername(parsed.username);
    if (parsed.password) setProxyPassword(parsed.password);
    setQuickImportMessage(`✓ Auto-filled: ${parsed.host}:${parsed.port} (${parsed.protocol.toUpperCase()})`);
    setRawQuickImport("");
  };

  // Test live proxy connection
  const handleTestProxyConnection = () => {
    setProxyTestResult(null);
    startProxyTransition(async () => {
      const data = new FormData();
      data.set("proxyProtocol", proxyProtocol);
      data.set("proxyHost", proxyHost);
      data.set("proxyPort", proxyPort);
      data.set("proxyUsername", proxyUsername);
      data.set("proxyPassword", proxyPassword);
      const res = await validateProxyAction(data);
      setProxyTestResult(res);
    });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-12 items-start">
      {/* Left Column: Configuration Forms */}
      <div className="lg:col-span-6 space-y-8">
        {/* 1. CAPTCHA Solver Configurations */}
        <form action={captchaFormAction} className="rounded-2xl border border-line bg-white p-6 shadow-soft card-enter">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-ink">Solver Configurations</h2>
              <p className="text-xs text-muted mt-0.5">Automate bot verification and CAPTCHA solving during outreach jobs.</p>
            </div>
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
              captchaEnabled ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-muted"
            }`}>
              {captchaEnabled ? "Active" : "Disabled"}
            </span>
          </div>

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
                <input name="captchaEnabled" type="hidden" value={captchaEnabled ? "true" : "false"} />
                <input
                  checked={captchaEnabled}
                  className="peer sr-only"
                  id="captchaEnabled"
                  onChange={(e) => setCaptchaEnabled(e.target.checked)}
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
                disabled={isCaptchaPending}
                onClick={handleTestCaptchaConnection}
                type="button"
              >
                {isCaptchaPending ? "Testing..." : "Test Connection"}
              </button>
              <SubmitButton>
                Save Settings
              </SubmitButton>
            </div>

            {/* Validation Outputs */}
            {captchaValidationResult && (
              <div className={`rounded-lg border p-4 text-sm card-enter ${
                captchaValidationResult.success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
              }`}>
                <div className="flex gap-2">
                  <span className="font-bold">{captchaValidationResult.success ? "✓ Active Connection" : "✗ Connection Failed"}</span>
                </div>
                {captchaValidationResult.success && captchaValidationResult.balance !== undefined && (
                  <p className="mt-1 text-xs font-medium">Account balance: ${captchaValidationResult.balance.toFixed(2)}</p>
                )}
                {captchaValidationResult.message && (
                  <p className="mt-1 text-xs">{captchaValidationResult.message}</p>
                )}
              </div>
            )}

            {/* Save state status */}
            {captchaFormState.success && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 text-center card-enter">
                CAPTCHA settings saved successfully.
              </div>
            )}
            {captchaFormState.error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 text-center card-enter">
                {captchaFormState.error}
              </div>
            )}
          </div>
        </form>

        {/* 2. Proxy Configurations (Proxy-Seller & Any Universal Provider) */}
        <form action={proxyFormAction} className="rounded-2xl border border-line bg-white p-6 shadow-soft card-enter">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-ink">Proxy Configurations</h2>
              <p className="text-xs text-muted mt-0.5">Route Playwright browser sessions through residential or custom proxy servers.</p>
            </div>
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
              proxyEnabled ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-muted"
            }`}>
              {proxyEnabled ? "Proxy Enabled" : "Direct Connection"}
            </span>
          </div>

          <div className="space-y-6">
            {/* Toggle Proxy Enable/Disable */}
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <label className="text-sm font-semibold text-ink" htmlFor="proxyEnabled">
                  Enable Proxy Routing
                </label>
                <p className="text-xs text-muted mt-0.5">Applies to target discovery, form submissions, and meeting bookings.</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input name="proxyEnabled" type="hidden" value={proxyEnabled ? "true" : "false"} />
                <input
                  checked={proxyEnabled}
                  className="peer sr-only"
                  id="proxyEnabled"
                  onChange={(e) => setProxyEnabled(e.target.checked)}
                  type="checkbox"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-brand peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
              </label>
            </div>

            {/* Quick-Import Universal String Box */}
            <div className="rounded-xl border border-brand/20 bg-brand/5 p-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-brand">
                ⚡ Quick Import Proxy Line
              </label>
              <p className="text-xs text-muted mt-0.5">
                Paste any line from Proxy-Seller, Bright Data, Oxylabs, Webshare, etc.
              </p>
              <div className="mt-2.5 flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-xs font-mono outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  onChange={(e) => setRawQuickImport(e.target.value)}
                  placeholder="e.g. res.proxy-seller.com:10000@user:pass or user:pass@host:port"
                  type="text"
                  value={rawQuickImport}
                />
                <button
                  className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand/90"
                  onClick={handleQuickImport}
                  type="button"
                >
                  Auto-Fill
                </button>
              </div>
              {quickImportMessage && (
                <p className={`mt-2 text-xs font-medium ${
                  quickImportMessage.startsWith("✓") ? "text-emerald-700" : "text-amber-700"
                }`}>
                  {quickImportMessage}
                </p>
              )}
            </div>

            {/* Protocol Selector */}
            <div>
              <label className="block text-sm font-semibold text-ink">
                Proxy Protocol
              </label>
              <input name="proxyProtocol" type="hidden" value={proxyProtocol} />
              <div className="mt-2 flex gap-2">
                {(["http", "https", "socks5"] as const).map((proto) => (
                  <button
                    key={proto}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold uppercase transition ${
                      proxyProtocol === proto
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-line bg-white text-muted hover:border-slate-300"
                    }`}
                    onClick={() => setProxyProtocol(proto)}
                    type="button"
                  >
                    {proto}
                  </button>
                ))}
              </div>
            </div>

            {/* Host & Port Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-ink" htmlFor="proxyHost">
                  Proxy Host / Server
                </label>
                <input
                  className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-mono outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  id="proxyHost"
                  name="proxyHost"
                  onChange={(e) => setProxyHost(e.target.value)}
                  placeholder="res.proxy-seller.com"
                  type="text"
                  value={proxyHost}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink" htmlFor="proxyPort">
                  Port
                </label>
                <input
                  className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-mono outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  id="proxyPort"
                  name="proxyPort"
                  onChange={(e) => setProxyPort(e.target.value)}
                  placeholder="10000"
                  type="number"
                  value={proxyPort}
                />
              </div>
            </div>

            {/* Username & Password Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-ink" htmlFor="proxyUsername">
                  Username / Login
                </label>
                <input
                  className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-mono outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  id="proxyUsername"
                  name="proxyUsername"
                  onChange={(e) => setProxyUsername(e.target.value)}
                  placeholder="Leave blank if IP whitelist"
                  type="text"
                  value={proxyUsername}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink" htmlFor="proxyPassword">
                  Password
                </label>
                <input
                  className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-mono outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  id="proxyPassword"
                  name="proxyPassword"
                  onChange={(e) => setProxyPassword(e.target.value)}
                  placeholder="Enter proxy password"
                  type="password"
                  value={proxyPassword}
                />
              </div>
            </div>

            {/* Bandwidth Saver Toggle */}
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
              <div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-ink" htmlFor="proxyBandwidthSaver">
                    Bandwidth Saver (Block Media)
                  </label>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    Saves 95% Data
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Aborts heavy images, videos, and fonts in Playwright so your 1 GB plan lasts for 4,000+ websites.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input name="proxyBandwidthSaver" type="hidden" value={proxyBandwidthSaver ? "true" : "false"} />
                <input
                  checked={proxyBandwidthSaver}
                  className="peer sr-only"
                  id="proxyBandwidthSaver"
                  onChange={(e) => setProxyBandwidthSaver(e.target.checked)}
                  type="checkbox"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 border-t border-line pt-4">
              <button
                className="flex-1 rounded-lg border border-line bg-canvas px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-200 disabled:opacity-50"
                disabled={isProxyPending}
                onClick={handleTestProxyConnection}
                type="button"
              >
                {isProxyPending ? "Testing Proxy..." : "Test Connection"}
              </button>
              <SubmitButton>
                Save Proxy Settings
              </SubmitButton>
            </div>

            {/* Live Proxy Test Output */}
            {proxyTestResult && (
              <div className={`rounded-xl border p-4 text-sm card-enter ${
                proxyTestResult.success
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-rose-200 bg-rose-50 text-rose-900"
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    {proxyTestResult.success ? "✓ Proxy Connection Successful" : "✗ Proxy Connection Failed"}
                  </span>
                  {proxyTestResult.latencyMs !== undefined && (
                    <span className="text-xs font-mono bg-white/70 px-2 py-0.5 rounded border border-current">
                      {proxyTestResult.latencyMs} ms
                    </span>
                  )}
                </div>
                {proxyTestResult.success && (
                  <div className="mt-2 space-y-1 text-xs">
                    <p><span className="font-semibold">Public IP:</span> <code className="font-mono bg-white/60 px-1 py-0.5 rounded">{proxyTestResult.ip}</code></p>
                    {proxyTestResult.country && (
                      <p><span className="font-semibold">Location:</span> {proxyTestResult.city ? `${proxyTestResult.city}, ` : ""}{proxyTestResult.country}</p>
                    )}
                    {proxyTestResult.isp && (
                      <p><span className="font-semibold">ISP:</span> {proxyTestResult.isp}</p>
                    )}
                  </div>
                )}
                {proxyTestResult.message && (
                  <p className="mt-2 text-xs font-medium opacity-90">{proxyTestResult.message}</p>
                )}
              </div>
            )}

            {/* Save state status */}
            {proxyFormState.success && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 text-center card-enter">
                Proxy configurations saved successfully.
              </div>
            )}
            {proxyFormState.error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 text-center card-enter">
                {proxyFormState.error}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Right Column: History & Analytics Panel */}
      <div className="lg:col-span-6 space-y-8">
        <div className="rounded-2xl border border-line bg-white shadow-soft card-enter flex flex-col overflow-hidden">
          <div className="border-b border-line px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-ink">Recent Solve History</h2>
              <p className="text-xs text-muted mt-0.5">Summary of bot checks bypass results.</p>
            </div>
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-brand">
              Total bypassed: {history.length}
            </span>
          </div>

          <div className="overflow-x-auto [scrollbar-width:thin]">
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

        {/* Proxy Health & Tips Card */}
        <div className="rounded-2xl border border-line bg-gradient-to-br from-slate-50 to-white p-6 shadow-soft card-enter">
          <h3 className="text-base font-bold text-ink">Residential Proxy Best Practices</h3>
          <ul className="mt-3 space-y-2.5 text-xs text-muted">
            <li className="flex items-start gap-2">
              <span className="text-brand font-bold">1.</span>
              <span><strong>Sticky Sessions:</strong> In Proxy-Seller, set rotation method to <em>30 min</em> or <em>60 min</em> so multi-step booking forms (Calendly/HubSpot) don&apos;t reset midway.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-600 font-bold">2.</span>
              <span><strong>Bandwidth Saver:</strong> Keep Bandwidth Saver turned <strong>ON</strong> to avoid loading large videos and banner images, making a 1 GB plan last for 4,000+ website submissions.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-600 font-bold">3.</span>
              <span><strong>Universal Compatibility:</strong> Works with any HTTP or SOCKS5 provider worldwide (Proxy-Seller, Bright Data, Oxylabs, Webshare, etc.).</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
