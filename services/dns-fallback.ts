import { URL } from "node:url";

/**
 * Checks if an error string represents a DNS resolution failure.
 */
export function isDnsResolutionError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("err_name_not_resolved") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    msg.includes("dns_probe_finished_nxdomain") ||
    msg.includes("dns_probe_finished_bad_config")
  );
}

/**
 * Returns an alternate URL switching between apex domain and www subdomain.
 * e.g.
 * - https://www.sweethomemedia.com/contact -> https://sweethomemedia.com/contact
 * - https://warnermiller.com/about -> https://www.warnermiller.com/about
 * Returns null if the URL is invalid, an IP address, or localhost.
 */
export function getAlternateDnsUrl(rawUrl: string): string | null {
  try {
    const withProto = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(withProto);
    const hostname = parsed.hostname.toLowerCase();

    // Do not toggle IPs or single-token hosts like localhost
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || !hostname.includes(".")) {
      return null;
    }

    let altHostname: string;
    if (hostname.startsWith("www.")) {
      altHostname = hostname.slice(4);
    } else {
      altHostname = `www.${hostname}`;
    }

    parsed.hostname = altHostname;
    return parsed.toString();
  } catch {
    return null;
  }
}
