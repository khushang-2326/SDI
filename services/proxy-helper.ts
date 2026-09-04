/**
 * Utilities for proxy error handling, HTTP 407 detection, and sensitive data redaction.
 */

export const PROXY_407_MESSAGE =
  "Proxy gateway rejected authentication (HTTP 407 Proxy Authentication Required)";

export class ProxyAuthenticationError extends Error {
  constructor(message = PROXY_407_MESSAGE) {
    super(message);
    this.name = "ProxyAuthenticationError";
  }
}

/**
 * Strips all proxy hostnames, ports, usernames, passwords, tokens, and API keys
 * from error messages, logs, or reports so sensitive details are never leaked.
 */
export function redactProxyDetails(text: string | null | undefined, additionalSecrets?: string[]): string {
  if (!text) return "";
  let sanitized = String(text);

  // Redact URL with embedded credentials: http(s)://user:pass@host:port or similar
  sanitized = sanitized.replace(
    /\b(?:https?|socks5):\/\/[^:\s\/]+:[^@\s\/]+@[^:\s\/]+(?::\d+)?\b/gi,
    "[REDACTED_PROXY]"
  );

  // Redact IP:PORT or host:port patterns associated with proxies or tunneling
  sanitized = sanitized.replace(
    /\b(?:proxy|tunnel|gateway|server)\s*[:=]\s*['"]?[a-zA-Z0-9.-]+:\d+['"]?/gi,
    "[REDACTED_PROXY_HOST]"
  );

  // Redact Proxy-Authorization and Authorization headers
  sanitized = sanitized.replace(
    /(?:proxy-authorization|authorization)\s*:\s*[^\r\n,;]+/gi,
    "[REDACTED_AUTH_HEADER]"
  );

  // Redact generic passwords, tokens, and keys
  sanitized = sanitized.replace(
    /(?:password|passwd|token|apikey|api_key|secret)\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
    "[REDACTED_SECRET]"
  );

  // Redact any explicitly passed secret strings (e.g. user.proxyHost, user.proxyPassword)
  if (additionalSecrets && additionalSecrets.length > 0) {
    for (const secret of additionalSecrets) {
      if (!secret || secret.length < 3) continue;
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      sanitized = sanitized.replace(new RegExp(escaped, "gi"), "[REDACTED]");
    }
  }

  return sanitized;
}

/**
 * Checks whether an error, HTTP status code, or page text indicates an HTTP 407
 * or proxy gateway authentication rejection.
 */
export function isProxyAuthenticationFailure(
  error: unknown,
  responseStatus?: number | null,
  pageText?: string | null
): boolean {
  if (responseStatus === 407) return true;

  if (error instanceof ProxyAuthenticationError) return true;

  const errStr = error instanceof Error ? error.message : String(error ?? "");

  // Common Playwright / Chromium network error signatures for proxy 407
  if (
    /407\b/i.test(errStr) &&
    (/proxy/i.test(errStr) ||
      /authentication/i.test(errStr) ||
      /ERR_HTTP_RESPONSE_CODE_FAILURE/i.test(errStr) ||
      /gateway/i.test(errStr))
  ) {
    return true;
  }

  if (
    /ERR_PROXY_AUTH_REQUESTED/i.test(errStr) ||
    /ERR_PROXY_CONNECTION_FAILED/i.test(errStr) ||
    /ERR_TUNNEL_CONNECTION_FAILED/i.test(errStr) ||
    /Proxy Authentication Required/i.test(errStr)
  ) {
    return true;
  }

  if (pageText) {
    if (
      /407 Proxy Authentication Required/i.test(pageText) ||
      /Proxy Authentication Required/i.test(pageText) ||
      /Proxy Gateway Rejected Authentication/i.test(pageText)
    ) {
      return true;
    }
  }

  return false;
}
