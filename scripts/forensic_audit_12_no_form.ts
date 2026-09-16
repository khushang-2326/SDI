import { chromium } from "playwright";
import * as fs from "fs";

interface AuditResult {
  domain: string;
  initialUrl: string;
  finalLandingUrl: string;
  httpStatus: number | null;
  redirectChain: string[];
  pageTitle: string;
  cmsFramework: string;
  iframesCount: number;
  crossOriginIframes: string[];
  shadowRootsCount: number;
  navCandidatesExamined: string[];
  formFoundOnDiscoveredPage: boolean;
  formDetails: string | null;
  phoneOnlyCues: string[];
  emailOnlyCues: string[];
  clientPortalCues: string[];
  errorOrTimeout: string | null;
  forensicConclusion: string;
  classification: string;
}

const TARGETS_12 = [
  "https://zapier.com",
  "https://www.davispolk.com",
  "https://www.goodwinlaw.com",
  "https://www.bain.com",
  "https://www.cbiz.com",
  "https://www.bakertilly.com",
  "https://www.rotorooter.com",
  "https://www.servpro.com",
  "https://www.mistersparky.com",
  "https://www.benjaminfranklinplumbing.com",
  "https://www.citymd.com",
  "https://www.instrument.com"
];

async function auditSite(url: string, browser: any): Promise<AuditResult> {
  const domain = new URL(url).hostname;
  const redirectChain: string[] = [];
  let httpStatus: number | null = null;
  let finalLandingUrl = url;
  let pageTitle = "";
  let cmsFramework = "Unknown";
  let iframesCount = 0;
  const crossOriginIframes: string[] = [];
  let shadowRootsCount = 0;
  const navCandidatesExamined: string[] = [];
  let formFoundOnDiscoveredPage = false;
  let formDetails: string | null = null;
  const phoneOnlyCues: string[] = [];
  const emailOnlyCues: string[] = [];
  const clientPortalCues: string[] = [];
  let errorOrTimeout: string | null = null;

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    httpStatus = response ? response.status() : null;
    finalLandingUrl = page.url();

    // Check redirects
    let req = response ? response.request() : null;
    while (req) {
      const redirect = req.redirectedFrom();
      if (redirect) {
        redirectChain.unshift(redirect.url());
        req = redirect;
      } else {
        break;
      }
    }

    await page.waitForTimeout(2000);
    pageTitle = await page.title();

    // Inspect CMS / Framework
    cmsFramework = await page.evaluate(() => {
      const cues: string[] = [];
      if ((window as any).__NEXT_DATA__) cues.push("Next.js");
      if ((window as any).__NUXT__) cues.push("Nuxt");
      if (document.querySelector('meta[name="generator"]')) {
        cues.push(document.querySelector('meta[name="generator"]')?.getAttribute("content") || "");
      }
      if (document.querySelector('script[src*="wp-content"]') || document.querySelector('link[href*="wp-content"]')) cues.push("WordPress");
      if (document.querySelector('script[src*="drupal"]') || (window as any).Drupal) cues.push("Drupal");
      if (document.querySelector('html[data-wf-site]') || document.querySelector('script[src*="webflow"]')) cues.push("Webflow");
      if (document.querySelector('script[src*="hubspot"]') || (window as any).hbspt) cues.push("HubSpot");
      if (document.querySelector('script[src*="marketo"]') || (window as any).Munchkin) cues.push("Marketo");
      if (document.querySelector('script[src*="salesforce"]') || (window as any).sf) cues.push("Salesforce");
      return cues.filter(Boolean).join(", ") || "Custom/Static";
    });

    // Inspect Frames & Shadow DOM
    const frames = page.frames();
    iframesCount = frames.length - 1;
    for (const f of frames.slice(1)) {
      try {
        const frameOrigin = new URL(f.url()).origin;
        if (frameOrigin !== new URL(finalLandingUrl).origin) {
          crossOriginIframes.push(f.url().slice(0, 80));
        }
      } catch {
        crossOriginIframes.push(f.url().slice(0, 80));
      }
    }

    shadowRootsCount = await page.evaluate(() => {
      let count = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement;
        if (el.shadowRoot) count++;
      }
      return count;
    });

    // Inspect Links for contact/portal/phone/email
    const linkAnalysis = await page.evaluate(() => {
      const candidates: string[] = [];
      const portals: string[] = [];
      const phones: string[] = [];
      const emails: string[] = [];

      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = (a.getAttribute("href") || "").trim();
        const text = (a.textContent || "").toLowerCase().trim();

        if (href.startsWith("tel:")) {
          phones.push(href.replace("tel:", ""));
        } else if (href.startsWith("mailto:")) {
          emails.push(href.replace("mailto:", ""));
        } else if (text.includes("portal") || text.includes("client login") || text.includes("sign in") || href.includes("portal") || href.includes("login")) {
          portals.push(`${text}: ${href}`);
        }

        if (
          text.includes("contact") ||
          text.includes("get in touch") ||
          text.includes("talk to") ||
          text.includes("reach us") ||
          text.includes("book") ||
          text.includes("schedule") ||
          text.includes("estimate") ||
          text.includes("quote") ||
          href.includes("contact") ||
          href.includes("get-in-touch") ||
          href.includes("schedule")
        ) {
          if (!href.startsWith("javascript") && !href.startsWith("#") && !href.startsWith("tel:") && !href.startsWith("mailto:")) {
            try {
              const full = new URL(href, window.location.href).href;
              if (!candidates.includes(full)) candidates.push(full);
            } catch {}
          }
        }
      }

      // Check text for phone numbers
      const bodyText = document.body.innerText || "";
      const phoneMatch = bodyText.match(/(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g);
      if (phoneMatch) {
        for (const p of phoneMatch.slice(0, 3)) {
          if (!phones.includes(p)) phones.push(p);
        }
      }

      return { candidates: candidates.slice(0, 10), portals: portals.slice(0, 5), phones: phones.slice(0, 5), emails: emails.slice(0, 5) };
    });

    navCandidatesExamined.push(...linkAnalysis.candidates);
    phoneOnlyCues.push(...linkAnalysis.phones);
    emailOnlyCues.push(...linkAnalysis.emails);
    clientPortalCues.push(...linkAnalysis.portals);

    // Check if there is an existing form on the landing page
    const landingFormCheck = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll("form"));
      const visibleForms = forms.filter(f => {
        const r = f.getBoundingClientRect();
        return r.width > 50 && r.height > 50;
      });
      const inputs = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea"));
      return {
        formCount: forms.length,
        visibleFormCount: visibleForms.length,
        inputCount: inputs.length,
        inputDetails: inputs.slice(0, 5).map(i => `${(i as HTMLInputElement).name || (i as HTMLInputElement).id || i.tagName}: ${i.getAttribute("type") || "text"}`)
      };
    });

    if (landingFormCheck.visibleFormCount > 0 && landingFormCheck.inputCount >= 2) {
      formFoundOnDiscoveredPage = true;
      formDetails = `Landing page has ${landingFormCheck.visibleFormCount} visible form(s) with ${landingFormCheck.inputCount} input(s): ${landingFormCheck.inputDetails.join(", ")}`;
    }

    // If no form on landing page, check top 1-2 candidate URLs if any
    if (!formFoundOnDiscoveredPage && navCandidatesExamined.length > 0) {
      const candidateUrl = navCandidatesExamined[0];
      try {
        console.log(`    [Auditing candidate link]: ${candidateUrl}`);
        await page.goto(candidateUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(1500);

        const candFormCheck = await page.evaluate(() => {
          const forms = Array.from(document.querySelectorAll("form"));
          const inputs = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea"));
          return {
            url: window.location.href,
            formCount: forms.length,
            inputCount: inputs.length,
            inputDetails: inputs.slice(0, 5).map(i => `${(i as HTMLInputElement).name || (i as HTMLInputElement).id || i.tagName}: ${i.getAttribute("type") || "text"}`)
          };
        });

        if (candFormCheck.inputCount >= 2) {
          formFoundOnDiscoveredPage = true;
          formDetails = `Candidate page (${candFormCheck.url}) has ${candFormCheck.formCount} form(s), ${candFormCheck.inputCount} input(s): ${candFormCheck.inputDetails.join(", ")}`;
        }
      } catch (err: any) {
        console.log(`    Candidate check failed: ${err?.message}`);
      }
    }

  } catch (err: any) {
    errorOrTimeout = err?.message || String(err);
  } finally {
    await context.close();
  }

  // Derive forensic conclusion & classification
  let forensicConclusion = "";
  let classification = "";

  if (errorOrTimeout) {
    if (errorOrTimeout.includes("Timeout")) {
      forensicConclusion = `Page navigation timed out (${errorOrTimeout.slice(0, 60)})`;
      classification = "FAILURE_NAVIGATION_TIMEOUT";
    } else {
      forensicConclusion = `Error loading target: ${errorOrTimeout.slice(0, 60)}`;
      classification = "FAILURE_OTHER";
    }
  } else if (formFoundOnDiscoveredPage) {
    forensicConclusion = `Public web form actually exists (${formDetails})`;
    classification = "FAILURE_FORM_NOT_DETECTED"; // It was missed during discovery!
  } else if (phoneOnlyCues.length > 0 || emailOnlyCues.length > 0 || clientPortalCues.length > 0) {
    forensicConclusion = `Genuine no public form: contact is primarily via phone (${phoneOnlyCues.slice(0, 2).join(", ")}), email (${emailOnlyCues.slice(0, 1).join(", ")}), or client portal (${clientPortalCues.slice(0, 1).join(", ")})`;
    classification = "INELIGIBLE_GENUINE_NO_PUBLIC_FORM";
  } else {
    forensicConclusion = "No contact form, scheduler, or lead capture detected on examined pages";
    classification = "INELIGIBLE_GENUINE_NO_PUBLIC_FORM";
  }

  return {
    domain,
    initialUrl: url,
    finalLandingUrl,
    httpStatus,
    redirectChain,
    pageTitle,
    cmsFramework,
    iframesCount,
    crossOriginIframes,
    shadowRootsCount,
    navCandidatesExamined,
    formFoundOnDiscoveredPage,
    formDetails,
    phoneOnlyCues,
    emailOnlyCues,
    clientPortalCues,
    errorOrTimeout,
    forensicConclusion,
    classification
  };
}

import { getChromiumExecutablePath } from "../services/browser-executable";

async function main() {
  console.log("==================================================");
  console.log("FORENSIC AUDIT: 12 'NO_PUBLIC_FORM' TARGETS");
  console.log("==================================================");

  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const results: AuditResult[] = [];

  for (let i = 0; i < TARGETS_12.length; i++) {
    const url = TARGETS_12[i];
    console.log(`[${i + 1}/${TARGETS_12.length}] Auditing: ${url}`);
    const res = await auditSite(url, browser);
    results.push(res);
    console.log(`  -> Status: ${res.httpStatus} | Landing: ${res.finalLandingUrl}`);
    console.log(`  -> Form found: ${res.formFoundOnDiscoveredPage} | Details: ${res.formDetails}`);
    console.log(`  -> Classification: ${res.classification} | Conclusion: ${res.forensicConclusion}`);
  }

  await browser.close();

  const outPath = "scratch/audit_12_no_form_results.json";
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch(console.error);
