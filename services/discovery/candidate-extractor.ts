import type { Page } from "playwright";
import { CandidateLocation, CandidateType } from "./types";

export interface RawCandidate {
  href: string;
  text: string;
  ariaLabel: string;
  title: string;
  parentText: string;
  nearbyText: string;
  location: CandidateLocation;
  candidateType: CandidateType;
  hasOnClick: boolean;
  distanceFromTop: number;
  mobileMenuSource: boolean;
}

const SKIPPED_PATH_PATTERN =
  /\/(privacy|terms|cookies?|blog|news|articles?|category|tags?|login|sign-?in|sign-?up|cart|checkout)(\/|$)/i;
const SKIPPED_EXTENSION_PATTERN =
  /\.(pdf|jpe?g|png|gif|svg|webp|zip|rar|mp[34]|avi|mov|docx?|xlsx?|css|js|json|xml|ico|woff2?|ttf|eot)(\?|$)/i;

function isCalendlyEventUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "calendly.com" && !hostname.endsWith(".calendly.com")) return false;
  return url.pathname.split("/").filter(Boolean).length >= 2;
}

function isPipedriveSchedulerUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    (hostname === "pipedrive.com" || hostname.endsWith(".pipedrive.com")) &&
    /^\/scheduler\/[^/]+\/[^/]+/i.test(url.pathname)
  );
}

export function isSupportedExternalTarget(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return isCalendlyEventUrl(url) || isPipedriveSchedulerUrl(url) || hostname === "meetings.hubspot.com";
}

export async function extractRawCandidates(page: Page, baseUrl: string): Promise<RawCandidate[]> {
  const base = new URL(baseUrl);

  const extractDomElements = async (isMobileMenu: boolean = false): Promise<RawCandidate[]> => {
    return page
      .evaluate(([baseOrigin, isMobile]) => {
        const results: Array<{
          href: string;
          text: string;
          ariaLabel: string;
          title: string;
          parentText: string;
          nearbyText: string;
          location: CandidateLocation;
          candidateType: CandidateType;
          hasOnClick: boolean;
          distanceFromTop: number;
          mobileMenuSource: boolean;
        }> = [];

        const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1);

        // 1. Anchors across the rendered page
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        for (const anchor of anchors) {
          const href = (anchor.getAttribute("href") ?? "").trim();
          if (!href || href === "#" || href.startsWith("javascript:void")) continue;

          const rect = anchor.getBoundingClientRect();
          const top = window.scrollY + rect.top;
          const distanceFromTop = Math.min(1.0, Math.max(0.0, top / docHeight));

          const text = (anchor.textContent ?? "").replace(/\s+/g, " ").trim();
          const ariaLabel = (anchor.getAttribute("aria-label") ?? "").trim();
          const title = (anchor.getAttribute("title") ?? "").trim();
          const parentText = (anchor.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150);

          let location: CandidateLocation = "body";
          if (isMobile) {
            location = "mobile menu";
          } else if (anchor.closest("nav, [role='navigation'], .navbar, .menu, .nav")) {
            location = "nav";
          } else if (anchor.closest("header, .site-header, .header, #header, [role='banner']")) {
            location = "header";
          } else if (anchor.closest("footer, .site-footer, .footer, #footer, [role='contentinfo']")) {
            location = "footer";
          } else if (anchor.closest("aside, .sidebar")) {
            location = "sidebar";
          } else if (anchor.closest(".hero, [class*='hero']")) {
            location = "hero";
          } else if (anchor.closest(".cta, [class*='cta']")) {
            location = "main CTA";
          }

          const candidateType: CandidateType = location === "main CTA" || location === "hero" ? "cta" : "anchor";

          results.push({
            href,
            text,
            ariaLabel,
            title,
            parentText,
            nearbyText: "",
            location,
            candidateType,
            hasOnClick: Boolean(anchor.getAttribute("onclick")),
            distanceFromTop,
            mobileMenuSource: Boolean(isMobile)
          });
        }

        // 2. Buttons and JS navigation elements
        const buttons = Array.from(
          document.querySelectorAll("button, [role='button'], div[onclick], a[href='#'], [data-url], [data-href]")
        );
        for (const el of buttons) {
          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          const ariaLabel = (el.getAttribute("aria-label") ?? "").trim();
          const title = (el.getAttribute("title") ?? "").trim();

          const dataUrl =
            el.getAttribute("data-url") ||
            el.getAttribute("data-href") ||
            el.getAttribute("data-target") ||
            "";

          const onclick = (el.getAttribute("onclick") ?? "").toLowerCase();
          let extractedUrl = dataUrl;
          if (!extractedUrl && onclick) {
            const match =
              onclick.match(/(?:location\.href|window\.open|location\.assign)\s*=\s*['"]([^'"]+)['"]/i) ||
              onclick.match(/(?:window\.open|location\.assign)\(\s*['"]([^'"]+)['"]/i);
            if (match) extractedUrl = match[1];
          }

          if (!extractedUrl) continue;

          const rect = el.getBoundingClientRect();
          const top = window.scrollY + rect.top;
          const distanceFromTop = Math.min(1.0, Math.max(0.0, top / docHeight));

          let location: CandidateLocation = "body";
          if (isMobile) {
            location = "mobile menu";
          } else if (el.closest("nav, [role='navigation'], .navbar, .menu")) {
            location = "nav";
          } else if (el.closest("header, .site-header, .header, [role='banner']")) {
            location = "header";
          } else if (el.closest("footer, .site-footer, .footer, [role='contentinfo']")) {
            location = "footer";
          } else if (el.closest(".hero, [class*='hero']")) {
            location = "hero";
          } else if (el.closest(".cta, [class*='cta']")) {
            location = "main CTA";
          }

          results.push({
            href: extractedUrl,
            text,
            ariaLabel,
            title,
            parentText: (el.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150),
            nearbyText: "",
            location,
            candidateType: "button",
            hasOnClick: Boolean(onclick),
            distanceFromTop,
            mobileMenuSource: Boolean(isMobile)
          });
        }

        return results;
      }, [base.origin, isMobileMenu])
      .then((raw) => {
        const sanitized: RawCandidate[] = [];
        const seenUrls = new Set<string>();

        for (const item of raw) {
          try {
            const resolved = new URL(item.href, base);

            // Same domain check or supported external booking targets
            if (resolved.origin !== base.origin && !isSupportedExternalTarget(resolved)) {
              continue;
            }

            // Exclude mailto, tel, javascript, media/documents, and blacklisted paths
            if (
              ["mailto:", "tel:", "javascript:"].includes(resolved.protocol) ||
              SKIPPED_PATH_PATTERN.test(resolved.pathname) ||
              SKIPPED_EXTENSION_PATTERN.test(`${resolved.pathname}${resolved.search}`)
            ) {
              continue;
            }

            const cleanUrl = resolved.origin + resolved.pathname + resolved.search;
            if (seenUrls.has(cleanUrl)) continue;
            seenUrls.add(cleanUrl);

            sanitized.push({
              ...item,
              href: cleanUrl
            });
          } catch {
            continue;
          }
        }
        return sanitized;
      })
      .catch((err) => {
        console.error("[CANDIDATE-EXTRACTOR] Error in extractDomElements:", err);
        return [];
      });
  };

  let candidates = await extractDomElements(false);

  // Check if we need mobile menu disclosure (if candidate count is small or lacks high-intent keywords)
  const hasStrongCandidate = candidates.some((c) => {
    const combined = `${c.text} ${c.href} ${c.ariaLabel}`.toLowerCase();
    return (
      combined.includes("contact") ||
      combined.includes("get in touch") ||
      combined.includes("book a call") ||
      combined.includes("schedule") ||
      combined.includes("lets talk") ||
      combined.includes("let's talk")
    );
  });

  if (!hasStrongCandidate) {
    try {
      const menuTrigger = page.locator(
        "button[aria-label*='menu' i], button.navbar-toggler, .hamburger, [aria-expanded='false'], .menu-toggle, .mobile-menu-btn, button:has(span.navbar-toggler-icon)"
      ).first();
      const isVisible = await menuTrigger.isVisible().catch(() => false);
      if (isVisible) {
        await menuTrigger.click({ timeout: 1000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        const mobileCandidates = await extractDomElements(true);
        const existingHrefs = new Set(candidates.map((c) => c.href));
        for (const mc of mobileCandidates) {
          if (!existingHrefs.has(mc.href)) {
            candidates.push(mc);
          }
        }
      }
    } catch {
      // Ignore mobile menu click failure
    }
  }

  return candidates;
}
