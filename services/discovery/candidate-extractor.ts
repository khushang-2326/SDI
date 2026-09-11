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
  domDepth: number;
  isRightmostNav: boolean;
  isProminentButton: boolean;
  isModalTrigger: boolean;
  modalTargetSelector?: string;
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
  return isCalendlyEventUrl(url) || isPipedriveSchedulerUrl(url) || /(^|\.)meetings(-[a-z0-9]+)?\.hubspot\.com$/i.test(hostname);
}

export async function extractRawCandidates(page: Page, baseUrl: string): Promise<RawCandidate[]> {
  const base = new URL(baseUrl);

  // 1. Controlled Hover / Click on Dropdown Menus (reveal hidden submenu links)
  try {
    const dropdownParents = page.locator("nav li:has(ul), .dropdown, [aria-haspopup='true'], .nav-item.dropdown");
    const count = await dropdownParents.count().catch(() => 0);
    const inspectCount = Math.min(count, 4);
    for (let i = 0; i < inspectCount; i++) {
      const parent = dropdownParents.nth(i);
      const text = (await parent.innerText().catch(() => "")).toLowerCase();
      if (/company|about|contact|connect|service|more|kontakt|contacto/i.test(text)) {
        await parent.hover({ timeout: 500 }).catch(() => undefined);
      }
    }
  } catch {
    // Dropdown hover failure is non-fatal
  }

  const extractDomElements = async (isMobileMenu: boolean = false): Promise<RawCandidate[]> => {
    return page
      .evaluate(([baseOrigin, isMobile]) => {
        (window as any).__name = (window as any).__name || function(fn: any) { return fn; };

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
          domDepth: number;
          isRightmostNav: boolean;
          isProminentButton: boolean;
          isModalTrigger: boolean;
          modalTargetSelector?: string;
          mobileMenuSource: boolean;
        }> = [];

        const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1);

        function getDomDepth(el: Element | null): number {
          let depth = 0;
          let curr = el;
          while (curr && curr !== document.body) {
            depth++;
            curr = curr.parentElement;
          }
          return depth;
        }

        // 1. Anchors across the rendered page (capped at 300 to prevent DOM thrashing)
        const anchors = Array.from(document.querySelectorAll("a[href]")).slice(0, 300);
        for (const anchor of anchors) {
          const rawHref = (anchor.getAttribute("href") ?? "").trim();
          if (!rawHref || rawHref.startsWith("javascript:void(0)") || rawHref === "javascript:;") continue;

          const rect = anchor.getBoundingClientRect();
          const top = window.scrollY + rect.top;
          const distanceFromTop = Math.min(1.0, Math.max(0.0, top / docHeight));

          const text = (anchor.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150);
          const ariaLabel = (anchor.getAttribute("aria-label") ?? "").trim();
          const title = (anchor.getAttribute("title") ?? "").trim();
          const parentText = (anchor.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150);
          const domDepth = getDomDepth(anchor);

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

          // Check if rightmost nav item
          let isRightmostNav = false;
          if (location === "nav" || location === "header") {
            const navParent = anchor.closest("nav, .navbar, .menu, header");
            if (navParent) {
              const navAnchors = navParent.querySelectorAll("a[href]");
              if (navAnchors.length > 0 && navAnchors[navAnchors.length - 1] === anchor) {
                isRightmostNav = true;
              }
            }
          }

          // Check modal trigger attributes
          const dataToggle = anchor.getAttribute("data-toggle") || anchor.getAttribute("data-bs-toggle") || "";
          const dataTarget = anchor.getAttribute("data-target") || anchor.getAttribute("data-bs-target") || anchor.getAttribute("data-modal") || "";
          const ariaHasPopup = anchor.getAttribute("aria-haspopup");
          const isModal =
            dataToggle.includes("modal") ||
            Boolean(dataTarget) ||
            ariaHasPopup === "dialog" ||
            anchor.className.toLowerCase().includes("modal-trigger") ||
            (rawHref.startsWith("#") && /modal|contact|quote|popup|drawer/i.test(rawHref));

          const candidateType: CandidateType = isModal
            ? "modal_trigger"
            : location === "main CTA" || location === "hero"
              ? "cta"
              : "anchor";

          const isProminent =
            anchor.className.toLowerCase().includes("btn") ||
            anchor.className.toLowerCase().includes("button") ||
            anchor.getAttribute("role") === "button";

          results.push({
            href: rawHref,
            text,
            ariaLabel,
            title,
            parentText,
            nearbyText: "",
            location,
            candidateType,
            hasOnClick: Boolean(anchor.getAttribute("onclick")),
            distanceFromTop,
            domDepth,
            isRightmostNav,
            isProminentButton: isProminent,
            isModalTrigger: isModal,
            modalTargetSelector: dataTarget || (rawHref.startsWith("#") ? rawHref : undefined),
            mobileMenuSource: Boolean(isMobile)
          });
        }

        // 2. Buttons and JS navigation / modal elements (capped to 200)
        const buttons = Array.from(
          document.querySelectorAll("button, [role='button'], div[onclick], a[href='#'], [data-url], [data-href]")
        ).slice(0, 200);
        for (const el of buttons) {
          const dataUrl =
            el.getAttribute("data-url") ||
            el.getAttribute("data-href") ||
            el.getAttribute("data-target") ||
            el.getAttribute("data-bs-target") ||
            "";

          const onclick = (el.getAttribute("onclick") ?? "").toLowerCase();
          let extractedUrl = dataUrl;
          if (!extractedUrl && onclick) {
            const match =
              onclick.match(/(?:location\.href|window\.open|location\.assign)\s*=\s*['"]([^'"]+)['"]/i) ||
              onclick.match(/(?:window\.open|location\.assign)\(\s*['"]([^'"]+)['"]/i);
            if (match) extractedUrl = match[1];
          }

          // Check if button is a modal/drawer trigger
          const dataToggle = el.getAttribute("data-toggle") || el.getAttribute("data-bs-toggle") || "";
          const ariaHasPopup = el.getAttribute("aria-haspopup");
          const isModal =
            dataToggle.includes("modal") ||
            ariaHasPopup === "dialog" ||
            el.className.toLowerCase().includes("modal-trigger") ||
            el.className.toLowerCase().includes("drawer-trigger") ||
            /modal|drawer|popup/i.test(el.getAttribute("aria-controls") || "");

          if (!extractedUrl && !isModal) continue;

          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150);
          const ariaLabel = (el.getAttribute("aria-label") ?? "").trim();
          const title = (el.getAttribute("title") ?? "").trim();

          const rect = el.getBoundingClientRect();
          const top = window.scrollY + rect.top;
          const distanceFromTop = Math.min(1.0, Math.max(0.0, top / docHeight));
          const domDepth = getDomDepth(el);

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
            href: extractedUrl || "#modal",
            text,
            ariaLabel,
            title,
            parentText: (el.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150),
            nearbyText: "",
            location,
            candidateType: isModal ? "modal_trigger" : "button",
            hasOnClick: Boolean(onclick),
            distanceFromTop,
            domDepth,
            isRightmostNav: false,
            isProminentButton: true,
            isModalTrigger: isModal,
            modalTargetSelector: dataUrl.startsWith("#") ? dataUrl : undefined,
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
            if (item.isModalTrigger) {
              sanitized.push(item);
              continue;
            }

            const resolved = new URL(item.href, base);

            // 1. Insecure candidate auto-upgrade if base is secure HTTPS
            if (base.protocol === "https:" && resolved.protocol === "http:" && resolved.hostname === base.hostname) {
              resolved.protocol = "https:";
            }

            // 2. Same-brand / same-domain check or supported external booking targets
            // Allow same origin OR same base brand across TLDs (e.g. brand.com -> brand.fr / brand.es)
            const getDomainRoot = (host: string) => {
              const parts = host.replace(/^www\./i, "").split(".");
              if (parts.length <= 2) return parts[0];
              // Handle second-level ccTLDs like .co.uk, .com.au, .com.es
              if (parts.length >= 3 && ["co", "com", "org", "net", "gov", "edu"].includes(parts[parts.length - 2])) {
                return parts[parts.length - 3];
              }
              return parts[parts.length - 2];
            };
            const isSameBrandCrossTld = () => {
              const baseRoot = getDomainRoot(base.hostname.toLowerCase());
              const resolvedRoot = getDomainRoot(resolved.hostname.toLowerCase());
              return baseRoot && resolvedRoot && baseRoot === resolvedRoot;
            };

            const isAllowedOrigin =
              resolved.origin === base.origin ||
              isSameBrandCrossTld() ||
              isSupportedExternalTarget(resolved);

            if (!isAllowedOrigin) {
              continue;
            }

            // Exclude mailto, tel, media/documents, and blacklisted paths
            if (
              ["mailto:", "tel:"].includes(resolved.protocol) ||
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

  // Check if we need mobile menu / off-canvas disclosure
  const hasStrongCandidate = candidates.some((c) => {
    const combined = `${c.text} ${c.href} ${c.ariaLabel}`.toLowerCase();
    return (
      combined.includes("contact") ||
      combined.includes("kontakt") ||
      combined.includes("contacto") ||
      combined.includes("contatt") ||
      combined.includes("get in touch") ||
      combined.includes("book a call") ||
      combined.includes("schedule") ||
      combined.includes("lets talk") ||
      combined.includes("let's talk") ||
      combined.includes("devis") ||
      combined.includes("anfrage") ||
      combined.includes("presupuesto") ||
      combined.includes("rendez-vous") ||
      combined.includes("quote")
    );
  });

  if (!hasStrongCandidate) {
    try {
      const menuTrigger = page.locator(
        "button[aria-label*='menu' i], button.navbar-toggler, .hamburger, [aria-expanded='false']:has-text('menu'), .menu-toggle, .mobile-menu-btn, button:has(span.navbar-toggler-icon), [data-drawer-trigger], [data-toggle='drawer'], [data-toggle='offcanvas'], [aria-controls*='drawer'], [aria-controls*='offcanvas'], [aria-controls*='nav']"
      ).first();
      const isVisible = await menuTrigger.isVisible().catch(() => false);
      if (isVisible) {
        // Exclude non-lead utility controls like cart or search
        const triggerAttrs = await menuTrigger.evaluate((el) => {
          return `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.className || ""} ${el.getAttribute("aria-controls") || ""} ${el.getAttribute("data-drawer") || ""}`.toLowerCase();
        }).catch(() => "");
        if (!/\b(cart|bag|basket|search|checkout|cookie)\b/i.test(triggerAttrs)) {
          await menuTrigger.click({ timeout: 1000 }).catch(() => undefined);
          await page.waitForTimeout(500);
          const mobileCandidates = await extractDomElements(true);
          const existingHrefs = new Set(candidates.map((c) => c.href));
          for (const mc of mobileCandidates) {
            if (!existingHrefs.has(mc.href)) {
              candidates.push(mc);
            }
          }
        }
      }
    } catch {
      // Ignore mobile menu click failure
    }
  }

  return candidates;
}
