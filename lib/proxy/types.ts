export type ProxyProtocol = "http" | "https" | "socks5";
export type ProxyStrategy = "fallback_only" | "always" | "disabled";

export interface ProxyConfig {
  enabled: boolean;
  strategy?: ProxyStrategy;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  bandwidthSaver: boolean;
}

export interface ParsedProxy {
  strategy?: ProxyStrategy;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ProxyTestResult {
  success: boolean;
  ip?: string;
  country?: string;
  city?: string;
  isp?: string;
  latencyMs?: number;
  message?: string;
}
