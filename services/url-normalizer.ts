export type UrlClassification =
  | "VALID_WEBSITE"
  | "INVALID_URL"
  | "MAILTO"
  | "JAVASCRIPT_URL"
  | "IMAGE_ASSET"
  | "VIDEO_ASSET"
  | "CSS_ASSET"
  | "JS_ASSET"
  | "FONT_ASSET"
  | "TRACKING_ASSET"
  | "DUPLICATE"
  | "UNSUPPORTED_SCHEME"
  | "EMPTY_ROW"
  | "MALFORMED_RECOVERED"
  | "OTHER_INVALID";

export interface NormalizedUrlResult {
  originalInputUrl: string;
  normalizedTargetUrl: string | null;
  isValidTarget: boolean;
  classification: UrlClassification;
  reason: string;
  hostname: string | null;
}

const ASSET_PATTERNS = {
  image: /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|avif)(\?.*)?$/i,
  video: /\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v)(\?.*)?$/i,
  css: /\.(css|scss|sass|less)(\?.*)?$/i,
  js: /\.(js|mjs|cjs|jsx|ts|tsx)(\?.*)?$/i,
  font: /\.(woff|woff2|ttf|eot|otf)(\?.*)?$/i,
  tracking: /\b(cdn-cgi|wp-content\/plugins|gtag\/js|analytics\.js|pixel\.gif)\b/i
};

export function normalizeInputTargetUrl(rawInput: unknown): NormalizedUrlResult {
  const originalInputUrl = String(rawInput ?? "").trim();

  if (!originalInputUrl) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "EMPTY_ROW",
      reason: "Input URL is empty",
      hostname: null
    };
  }

  const lowerRaw = originalInputUrl.toLowerCase();

  if (lowerRaw.startsWith("mailto:")) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "MAILTO",
      reason: "Direct mailto: URI scheme (not a navigable website)",
      hostname: null
    };
  }

  if (lowerRaw.startsWith("javascript:")) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "JAVASCRIPT_URL",
      reason: "Direct javascript: pseudo-protocol",
      hostname: null
    };
  }

  if (lowerRaw.startsWith("tel:")) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "UNSUPPORTED_SCHEME",
      reason: "Telephone URI scheme",
      hostname: null
    };
  }

  // Handle malformed URLs such as https://example.com/mailto:contact@example.com
  if (/^https?:\/\/[^\/]+\/mailto:/i.test(originalInputUrl)) {
    try {
      const parts = originalInputUrl.split(/\/mailto:/i);
      const hostPart = parts[0];
      const parsed = new URL(hostPart);
      const normalizedTargetUrl = `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
      return {
        originalInputUrl,
        normalizedTargetUrl,
        isValidTarget: true,
        classification: "MALFORMED_RECOVERED",
        reason: "Recovered unambiguous website origin from malformed mailto-path URL",
        hostname: parsed.hostname.toLowerCase()
      };
    } catch {
      return {
        originalInputUrl,
        normalizedTargetUrl: null,
        isValidTarget: false,
        classification: "INVALID_URL",
        reason: "Malformed mailto-path URL could not be parsed to a valid origin",
        hostname: null
      };
    }
  }

  let parsed: URL;
  try {
    const withProto = /^https?:\/\//i.test(originalInputUrl)
      ? originalInputUrl
      : `https://${originalInputUrl}`;
    parsed = new URL(withProto);
  } catch (err: any) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "INVALID_URL",
      reason: `URL parsing failed: ${err?.message || "Invalid syntax"}`,
      hostname: null
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "UNSUPPORTED_SCHEME",
      reason: `Unsupported protocol scheme: ${parsed.protocol}`,
      hostname: null
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || !hostname.includes(".")) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "INVALID_URL",
      reason: `Invalid or unqualified hostname: ${hostname}`,
      hostname: hostname || null
    };
  }

  const pathname = parsed.pathname.toLowerCase();

  // Check asset extensions
  if (ASSET_PATTERNS.image.test(pathname)) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "IMAGE_ASSET",
      reason: "URL points directly to a static image asset",
      hostname
    };
  }
  if (ASSET_PATTERNS.video.test(pathname)) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "VIDEO_ASSET",
      reason: "URL points directly to a video media file",
      hostname
    };
  }
  if (ASSET_PATTERNS.css.test(pathname)) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "CSS_ASSET",
      reason: "URL points directly to a CSS stylesheet",
      hostname
    };
  }
  if (ASSET_PATTERNS.js.test(pathname)) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "JS_ASSET",
      reason: "URL points directly to a JavaScript script asset",
      hostname
    };
  }
  if (ASSET_PATTERNS.font.test(pathname)) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "FONT_ASSET",
      reason: "URL points directly to a font file asset",
      hostname
    };
  }
  if (ASSET_PATTERNS.tracking.test(parsed.href)) {
    return {
      originalInputUrl,
      normalizedTargetUrl: null,
      isValidTarget: false,
      classification: "TRACKING_ASSET",
      reason: "URL points to a CDN / tracking script asset",
      hostname
    };
  }

  // Canonicalize normalized target URL
  parsed.hash = "";
  parsed.hostname = hostname;
  let cleanPath = parsed.pathname.replace(/\/+$/, "");
  if (cleanPath === "") cleanPath = "";
  const normalizedTargetUrl = `${parsed.protocol}//${parsed.hostname}${cleanPath}${parsed.search}`;

  return {
    originalInputUrl,
    normalizedTargetUrl,
    isValidTarget: true,
    classification: "VALID_WEBSITE",
    reason: "Valid website target",
    hostname
  };
}
