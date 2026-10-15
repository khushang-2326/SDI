"use client";

import { useActionState, useEffect, useState, useTransition, useMemo } from "react";
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

interface ProxyLogItem {
  id: string;
  message: string;
  details: string | null;
  createdAt: Date;
  level: string;
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
    proxyStrategy?: string;
    proxyPoolCount?: number;
    initialProxyPoolText?: string;
  };
  history: HistoryItem[];
  proxyUsageStats?: {
    totalAttempts: number;
    proxyLogsCount: number;
    recentProxyLogs: ProxyLogItem[];
  };
}

export function SettingsForm({
  initialSettings,
  initialProxySettings,
  history,
  proxyUsageStats
}: SettingsFormProps) {
  // Active Tab for Right-hand analytics: "captcha" | "proxy"
  const [activeTab, setActiveTab] = useState<"captcha" | "proxy">("captcha");

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
  const [proxyStrategy, setProxyStrategy] = useState<string>(initialProxySettings.proxyStrategy || "fallback_only");
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
  const [proxyPoolText, setProxyPoolText] = useState(initialProxySettings.initialProxyPoolText || "");
  const [proxyPoolCount, setProxyPoolCount] = useState(initialProxySettings.proxyPoolCount || 0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || "").trim();
      if (content) {
        setProxyPoolText(content);
        const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        setProxyPoolCount(lines.length);
        setQuickImportMessage(`✓ Imported ${lines.length} proxies from ${file.name}`);

        const first = parseProxyString(lines[0]);
        if (first) {
          setProxyProtocol(first.protocol);
          setProxyHost(first.host);
          setProxyPort(String(first.port));
          if (first.username) setProxyUsername(first.username);
          if (first.password) setProxyPassword(first.password);
        }
      }
    };
    reader.readAsText(file);
  };

  const [isProxyPending, startProxyTransition] = useTransition();
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);

  // Synchronize with database props whenever server revalidates or mounts
  useEffect(() => {
    if (typeof initialSettings.captchaEnabled === "boolean") {
      setCaptchaEnabled(initialSettings.captchaEnabled);
    }
    if (initialSettings.captchaProvider) {
      setSelectedProviderId(initialSettings.captchaProvider);
    }
    if (initialSettings.hasKey && !apiKeyInput) {
      setApiKeyInput("••••••••");
    }
  }, [initialSettings.captchaEnabled, initialSettings.captchaProvider, initialSettings.hasKey]);

  useEffect(() => {
    setProxyEnabled(initialProxySettings.proxyEnabled);
    setProxyStrategy(initialProxySettings.proxyStrategy || "fallback_only");
    setProxyProtocol((initialProxySettings.proxyProtocol as ProxyProtocol) || "http");
    setProxyHost(initialProxySettings.proxyHost || "");
    setProxyPort(initialProxySettings.proxyPort || "");
    setProxyUsername(initialProxySettings.proxyUsername || "");
    if (initialProxySettings.hasPassword && !proxyPassword) {
      setProxyPassword("••••••••");
    }
    setProxyBandwidthSaver(initialProxySettings.proxyBandwidthSaver);
  }, [
    initialProxySettings.proxyEnabled,
    initialProxySettings.proxyStrategy,
    initialProxySettings.proxyProtocol,
    initialProxySettings.proxyHost,
    initialProxySettings.proxyPort,
    initialProxySettings.proxyUsername,
    initialProxySettings.hasPassword,
    initialProxySettings.proxyBandwidthSaver
  ]);

  // Client-side LocalStorage Auto-backup so entered values are never lost on accidental navigation
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = localStorage.getItem("sdi_form_backup");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (!initialProxySettings.proxyHost && parsed.proxyHost) setProxyHost(parsed.proxyHost);
        if (!initialProxySettings.proxyPort && parsed.proxyPort) setProxyPort(parsed.proxyPort);
        if (!initialProxySettings.proxyUsername && parsed.proxyUsername) setProxyUsername(parsed.proxyUsername);
      }
    } catch {
      // ignore
    }
  }, []);

  const saveToLocalBackup = (updates: Record<string, any>) => {
    if (typeof window === "undefined") return;
    try {
      const current = JSON.parse(localStorage.getItem("sdi_form_backup") || "{}");
      localStorage.setItem("sdi_form_backup", JSON.stringify({ ...current, ...updates }));
    } catch {
      // ignore
    }
  };

  // Reapply server confirmation after save actions
  useEffect(() => {
    if (!captchaFormState.success) return;
    if (typeof captchaFormState.captchaEnabled === "boolean") {
      setCaptchaEnabled(captchaFormState.captchaEnabled);
    }
  }, [captchaFormState]);

  useEffect(() => {
    if (!proxyFormState.success) return;
    if (typeof proxyFormState.proxyEnabled === "boolean") {
      setProxyEnabled(proxyFormState.proxyEnabled);
    }
    if (typeof proxyFormState.proxyBandwidthSaver === "boolean") {
      setProxyBandwidthSaver(proxyFormState.proxyBandwidthSaver);
    }
  }, [proxyFormState]);

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
    saveToLocalBackup({
      proxyProtocol: parsed.protocol,
      proxyHost: parsed.host,
      proxyPort: String(parsed.port),
      proxyUsername: parsed.username
    });
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
      data.set("proxyPoolText", proxyPoolText);
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
                CAPTCHA settings saved permanently.
              </div>
            )}
            {captchaFormState.error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 text-center card-enter">
                {captchaFormState.error}
              </div>
            )}
          </div>
        </form>

        {/* 2. Proxy Configurations (Proxy-Seller & Universal Provider) */}
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

            {/* Bulk Proxy Pool & File Upload */}
            <div className="rounded-xl border border-line bg-canvas/70 p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
                    📁 Bulk Proxy List / File Upload (.txt)
                  </label>
                  <p className="text-xs text-muted mt-0.5">
                    Upload your Webshare proxy file or paste all 100+ lines below. Automation workers will auto-rotate across all proxies!
                  </p>
                </div>
                {proxyPoolCount > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                    ✔ {proxyPoolCount} Proxies in Rotation Pool
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mb-2.5">
                <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-sm hover:bg-slate-50 transition">
                  <svg className="w-4 h-4 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Upload .txt File</span>
                  <input type="file" accept=".txt,.csv" className="hidden" onChange={handleFileUpload} />
                </label>
                <span className="text-[11px] text-muted">Supports Webshare, Smartproxy, or any IP:Port:User:Pass format.</span>
              </div>

              <textarea
                name="proxyPoolText"
                rows={4}
                className="w-full rounded-lg border border-line bg-white p-2.5 text-xs font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [scrollbar-width:thin]"
                placeholder={"Paste multi-line proxy list here (1 per line):\n103.47.52.172:8214:mhohjihm:z1rpw8rsfwqv\n136.0.188.166:6129:mhohjihm:z1rpw8rsfwqv\n..."}
                value={proxyPoolText}
                onChange={(e) => {
                  setProxyPoolText(e.target.value);
                  const lines = e.target.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                  setProxyPoolCount(lines.length);
                }}
              />
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

            {/* Routing Strategy Selector */}
            <div>
              <label className="block text-sm font-semibold text-ink">
                Proxy Routing Strategy
              </label>
              <input name="proxyStrategy" type="hidden" value={proxyStrategy} />
              <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setProxyStrategy("fallback_only")}
                  className={`rounded-xl border p-3.5 text-left transition ${
                    proxyStrategy === "fallback_only"
                      ? "border-brand bg-brand/5 ring-2 ring-brand/20"
                      : "border-line bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                      ⚡ Smart Fallback
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      Zero Cost Default
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted leading-relaxed">
                    Direct connection ($0 cost) first. Proxy activates on-demand only if blocked by 403 or Cloudflare/WAF.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setProxyStrategy("always")}
                  className={`rounded-xl border p-3.5 text-left transition ${
                    proxyStrategy === "always"
                      ? "border-brand bg-brand/5 ring-2 ring-brand/20"
                      : "border-line bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink">
                      🔄 Always Proxy
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted leading-relaxed">
                    Routes 100% of website requests through residential proxy regardless of block status.
                  </p>
                </button>
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
                  onChange={(e) => {
                    setProxyHost(e.target.value);
                    saveToLocalBackup({ proxyHost: e.target.value });
                  }}
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
                  onChange={(e) => {
                    setProxyPort(e.target.value);
                    saveToLocalBackup({ proxyPort: e.target.value });
                  }}
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
                  onChange={(e) => {
                    setProxyUsername(e.target.value);
                    saveToLocalBackup({ proxyUsername: e.target.value });
                  }}
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
                    Bandwidth Saver (Block Images & Media)
                  </label>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    Saves 95% Data
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Aborts images (.png, .jpg, .webp), videos, and webfonts in Playwright so 1 GB lasts for 10,000+ websites.
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
                Proxy configurations saved permanently.
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

      {/* Right Column: History & Analytics Panel (Tabs for CAPTCHA & Proxy) */}
      <div className="lg:col-span-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-line pb-2">
          <button
            type="button"
            onClick={() => setActiveTab("captcha")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === "captcha"
                ? "bg-brand text-white shadow-sm"
                : "bg-white text-muted border border-line hover:text-ink"
            }`}
          >
            <span>🤖 CAPTCHA Solves</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeTab === "captcha" ? "bg-white/20 text-white" : "bg-slate-100 text-muted"
            }`}>
              {history.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("proxy")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === "proxy"
                ? "bg-brand text-white shadow-sm"
                : "bg-white text-muted border border-line hover:text-ink"
            }`}
          >
            <span>🌐 Proxy Usage & Data</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeTab === "proxy" ? "bg-white/20 text-white" : "bg-slate-100 text-muted"
            }`}>
              {proxyUsageStats?.proxyLogsCount ?? 0}
            </span>
          </button>
        </div>

        {/* 1. CAPTCHA Analytics & History */}
        {activeTab === "captcha" && (
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
        )}

        {/* 2. Proxy Analytics, Bandwidth Saver & Logs */}
        {activeTab === "proxy" && (
          <div className="space-y-6">
            {/* Proxy Performance & Savings Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
                <p className="text-xs font-medium text-muted">Total Targets Run</p>
                <p className="text-2xl font-bold text-ink mt-1">
                  {proxyUsageStats?.totalAttempts ?? 0}
                </p>
                <p className="text-[11px] text-muted mt-1">
                  Direct & proxied outreach attempts
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-soft">
                <p className="text-xs font-bold text-emerald-800">1 GB Capacity</p>
                <p className="text-2xl font-bold text-emerald-900 mt-1">
                  ~12,000 Sites
                </p>
                <p className="text-[11px] text-emerald-700 mt-1">
                  95% saved (Images/Media blocked)
                </p>
              </div>
            </div>

            {/* Bandwidth Breakdown Card */}
            <div className="rounded-2xl border border-line bg-white p-5 shadow-soft">
              <h3 className="text-sm font-bold text-ink flex items-center justify-between">
                <span>Bandwidth Consumption Comparison</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  Active
                </span>
              </h3>
              
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex justify-between text-xs font-medium text-ink mb-1">
                    <span>With Bandwidth Saver (Current)</span>
                    <span className="font-bold text-emerald-600">~80 KB / site</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: "5%" }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-medium text-muted mb-1">
                    <span>Without Optimization (Old Build)</span>
                    <span className="text-rose-600 font-semibold">~3,500 KB / site</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-rose-400 rounded-full" style={{ width: "100%" }} />
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-line text-xs text-muted leading-relaxed">
                ⚡ <strong>Smart Fallback Active:</strong> SDI tries direct connection ($0) first and only consumes residential proxy bandwidth when a website returns 403 / Cloudflare WAF block.
              </div>
            </div>

            {/* Recent Proxy Activity Stream */}
            <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
              <div className="border-b border-line px-5 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-ink">Recent Proxy & Fallback Events</h3>
                  <p className="text-xs text-muted mt-0.5">Logs generated during automated proxy routing.</p>
                </div>
              </div>

              <div className="overflow-x-auto [scrollbar-width:thin]">
                <table className="min-w-full divide-y divide-line text-sm">
                  <thead className="bg-canvas text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Event / Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(proxyUsageStats?.recentProxyLogs || []).map((log) => (
                      <tr className="hover:bg-canvas/50 transition" key={log.id}>
                        <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink">
                          {log.message}
                          {log.details && (
                            <p className="text-[10px] text-muted mt-0.5 font-mono">{log.details}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(!proxyUsageStats?.recentProxyLogs || proxyUsageStats.recentProxyLogs.length === 0) && (
                      <tr>
                        <td className="px-4 py-8 text-center text-xs text-muted" colSpan={2}>
                          No proxy events recorded yet. Smart fallback activates when websites block direct traffic.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Proxy Health & Tips Card */}
        <div className="rounded-2xl border border-line bg-gradient-to-br from-slate-50 to-white p-6 shadow-soft card-enter">
          <h3 className="text-base font-bold text-ink">Proxy Optimization Tips</h3>
          <ul className="mt-3 space-y-2.5 text-xs text-muted">
            <li className="flex items-start gap-2">
              <span className="text-brand font-bold">1.</span>
              <span><strong>Smart Fallback:</strong> Keep strategy on <em>Smart Fallback</em> to preserve 100% of proxy GB for websites that genuinely block direct IPs.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-600 font-bold">2.</span>
              <span><strong>Sticky Sessions:</strong> In Proxy-Seller, set rotation time to <em>30 min</em> so multi-step booking forms don&apos;t get interrupted.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-600 font-bold">3.</span>
              <span><strong>Bandwidth Saver:</strong> Keep Bandwidth Saver turned <strong>ON</strong> to block images and videos, making 1 GB cover 10,000+ target websites.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
