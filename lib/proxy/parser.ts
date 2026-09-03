import type { ParsedProxy, ProxyProtocol } from "./types";

/**
 * Universal proxy string parser.
 * Supports:
 * - host:port@username:password (Proxy-Seller standard)
 * - username:password@host:port (Webshare, Bright Data)
 * - host:port:username:password (Oxylabs, standard 4-part)
 * - protocol://username:password@host:port (URL format)
 * - protocol://host:port@username:password
 * - host:port (IP whitelist / No auth)
 */
export function parseProxyString(raw: string): ParsedProxy | null {
  if (!raw || typeof raw !== "string") return null;

  let str = raw.trim();
  if (!str) return null;

  let protocol: ProxyProtocol = "http";

  // Check and extract protocol prefix if present
  if (str.startsWith("socks5://")) {
    protocol = "socks5";
    str = str.slice("socks5://".length);
  } else if (str.startsWith("https://")) {
    protocol = "https";
    str = str.slice("https://".length);
  } else if (str.startsWith("http://")) {
    protocol = "http";
    str = str.slice("http://".length);
  }

  // Remove trailing slashes
  str = str.replace(/\/+$/, "");

  // Format A: host:port@username:password (Proxy-Seller)
  // e.g. res.proxy-seller.com:10000@8c55593e776f08c3:NaQrjPuGHXw09CR6
  if (str.includes("@")) {
    const [part1, part2] = str.split("@");
    
    // Check if part1 is host:port
    const part1Colons = part1.split(":");
    const part2Colons = part2.split(":");

    // Case 1: host:port@username:password
    if (part1Colons.length === 2 && !isNaN(Number(part1Colons[1]))) {
      const host = part1Colons[0].trim();
      const port = parseInt(part1Colons[1].trim(), 10);
      const username = part2Colons[0]?.trim() || undefined;
      const password = part2Colons.slice(1).join(":")?.trim() || undefined;

      if (host && port > 0 && port <= 65535) {
        return { protocol, host, port, username, password };
      }
    }

    // Case 2: username:password@host:port
    if (part2Colons.length === 2 && !isNaN(Number(part2Colons[1]))) {
      const host = part2Colons[0].trim();
      const port = parseInt(part2Colons[1].trim(), 10);
      const username = part1Colons[0]?.trim() || undefined;
      const password = part1Colons.slice(1).join(":")?.trim() || undefined;

      if (host && port > 0 && port <= 65535) {
        return { protocol, host, port, username, password };
      }
    }
  }

  // Colon separated formats
  const colons = str.split(":");

  // Format B: host:port:username:password (4 parts)
  if (colons.length === 4) {
    const host = colons[0].trim();
    const port = parseInt(colons[1].trim(), 10);
    const username = colons[2].trim();
    const password = colons[3].trim();

    if (host && !isNaN(port) && port > 0 && port <= 65535) {
      return { protocol, host, port, username, password };
    }
  }

  // Format C: host:port (2 parts - IP Whitelist)
  if (colons.length === 2) {
    const host = colons[0].trim();
    const port = parseInt(colons[1].trim(), 10);

    if (host && !isNaN(port) && port > 0 && port <= 65535) {
      return { protocol, host, port };
    }
  }

  return null;
}
