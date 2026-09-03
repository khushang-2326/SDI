export type ProxyProtocol = "http" | "https" | "socks5";

export interface ProxyConfig {
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  bandwidthSaver: boolean;
}

export interface ParsedProxy {
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
