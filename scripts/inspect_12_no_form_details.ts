import { chromium } from "playwright";
import * as fs from "fs";
import { getChromiumExecutablePath } from "../services/browser-executable";

interface DetailedAudit12 {
  domain: string;
  finalLandingUrl: string;
  httpStatus: number | null;
  cmsFramework: string;
  shadowDomIframes: string;
  navCandidatesExamined: string[];
  formOnPage: string;
  phoneEmailCues: string;
  clientPortalCues: string;
  trueStatus: "INELIGIBLE_GENUINE_NO_PUBLIC_FORM" | "FAILURE_NAVIGATION_TIMEOUT" | "FAILURE_FORM_NOT_DETECTED" | "FAILURE_CONTACT_DESTINATION_NOT_FOUND";
  classificationAndRootCause: string;
}

const TARGETS_12 = [
  { domain: "zapier.com", url: "https://zapier.com", contactPath: "/l/contact-sales" },
  { domain: "davispolk.com", url: "https://www.davispolk.com", contactPath: "/about/contact" },
  { domain: "goodwinlaw.com", url: "https://www.goodwinlaw.com", contactPath: "/en/footer/secure-login" },
  { domain: "bain.com", url: "https://www.bain.com", contactPath: "/about/contact-us/" },
  { domain: "cbiz.com", url: "https://www.cbiz.com", contactPath: "/contact-us" },
  { domain: "bakertilly.com", url: "https://www.bakertilly.com", contactPath: "/contact" },
  { domain: "rotorooter.com", url: "https://www.rotorooter.com", contactPath: "/schedule-service/" },
  { domain: "servpro.com", url: "https://www.servpro.com", contactPath: "/about/contact" },
  { domain: "mistersparky.com", url: "https://www.mistersparky.com", contactPath: "/request-an-appointment/" },
  { domain: "benjaminfranklinplumbing.com", url: "https://www.benjaminfranklinplumbing.com", contactPath: "/request-an-appointment/" },
  { domain: "citymd.com", url: "https://www.citymd.com", contactPath: "/urgent-care-locations" },
  { domain: "instrument.com", url: "https://www.instrument.com", contactPath: "/contact/" }
];

async function main() {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const results: DetailedAudit12[] = [];

  for (const t of TARGETS_12) {
    console.log(`Auditing ${t.domain}...`);
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    let landingUrl = t.url;
    let status: number | null = null;
    let cms = "Custom/Static";
    let shadowIframes = "None";
    const candidates: string[] = [];
    let formOnPage = "None detected";
    let phoneEmail = "None";
    let portal = "None";
    let trueStatus: DetailedAudit12["trueStatus"] = "INELIGIBLE_GENUINE_NO_PUBLIC_FORM";
    let rootCause = "";
    let classificationAndRootCause = "";

    try {
      const resp = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(e => {
        rootCause = `Initial navigation timeout: ${e.message}`;
        return null;
      });

      if (resp) {
        status = resp.status();
        landingUrl = page.url();
      }

      await page.waitForTimeout(2000);

      // Extract details from root
      const rootData = await page.evaluate(() => {
        const cmsList: string[] = [];
        if ((window as any).__NEXT_DATA__) cmsList.push("Next.js");
        if ((window as any).__NUXT__) cmsList.push("Nuxt");
        if (document.querySelector('meta[name="generator"]')) cmsList.push(document.querySelector('meta[name="generator"]')?.getAttribute("content") || "");
        if (document.querySelector('script[src*="wp-content"]')) cmsList.push("WordPress");
        if (document.querySelector('script[src*="drupal"]')) cmsList.push("Drupal");
        if (document.querySelector('html[data-wf-site]')) cmsList.push("Webflow");
        if (document.querySelector('script[src*="hubspot"]')) cmsList.push("HubSpot");

        // Frames
        const iframes = Array.from(document.querySelectorAll("iframe")).map(i => i.src || "about:blank");
        
        // Shadow DOM
        let shadowCount = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
          if ((walker.currentNode as HTMLElement).shadowRoot) shadowCount++;
        }

        // Links
        const cands: string[] = [];
        const phones: string[] = [];
        const emails: string[] = [];
        const portals: string[] = [];

        document.querySelectorAll("a[href]").forEach(a => {
          const href = a.getAttribute("href") || "";
          const text = (a.textContent || "").toLowerCase().trim();
          if (href.startsWith("tel:")) phones.push(href.replace("tel:", ""));
          if (href.startsWith("mailto:")) emails.push(href.replace("mailto:", ""));
          if (text.includes("portal") || text.includes("login") || href.includes("portal") || href.includes("login")) {
            portals.push(`${text}: ${href}`);
          }
          if (text.includes("contact") || text.includes("sales") || text.includes("get in touch") || text.includes("appointment") || href.includes("contact") || href.includes("schedule")) {
            try {
              const full = new URL(href, window.location.href).href;
              if (!cands.includes(full)) cands.push(full);
            } catch {}
          }
        });

        // Forms on root
        const forms = Array.from(document.querySelectorAll("form"));
        const inputs = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea, select"));

        return {
          cms: cmsList.filter(Boolean).join(", ") || "Custom",
          iframeCount: iframes.length,
          shadowCount,
          cands: cands.slice(0, 8),
          phones: Array.from(new Set(phones)).slice(0, 3),
          emails: Array.from(new Set(emails)).slice(0, 3),
          portals: Array.from(new Set(portals)).slice(0, 2),
          rootForms: forms.length,
          rootInputs: inputs.map(i => `${(i as HTMLInputElement).name || i.id || i.tagName}: ${i.getAttribute("type") || "text"}`).slice(0, 6)
        };
      }).catch(() => null);

      if (rootData) {
        cms = rootData.cms;
        shadowIframes = `Iframes: ${rootData.iframeCount}, ShadowRoots: ${rootData.shadowCount}`;
        candidates.push(...rootData.cands);
        if (rootData.phones.length > 0) phoneEmail = `Phone: ${rootData.phones.join(", ")}`;
        if (rootData.emails.length > 0) phoneEmail += ` | Email: ${rootData.emails.join(", ")}`;
        if (rootData.portals.length > 0) portal = rootData.portals.join("; ");

        if (rootData.rootInputs.length >= 3 && (rootData.rootInputs.some(i => i.includes("email") || i.includes("tel") || i.includes("name")))) {
          formOnPage = `Root page has contact form (${rootData.rootInputs.join(", ")})`;
        }
      }

      // Now check contact path / top candidate
      const targetContactUrl = candidates[0] || (t.contactPath ? new URL(t.contactPath, t.url).href : null);
      if (targetContactUrl) {
        console.log(`  -> Navigating to candidate: ${targetContactUrl}`);
        const cResp = await page.goto(targetContactUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(e => {
          return null;
        });

        if (cResp) {
          await page.waitForTimeout(2000);
          landingUrl = page.url();
          const pageData = await page.evaluate(() => {
            const forms = Array.from(document.querySelectorAll("form"));
            const inputs = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea, select"));
            const phones: string[] = [];
            const emails: string[] = [];
            document.querySelectorAll("a[href]").forEach(a => {
              const href = a.getAttribute("href") || "";
              if (href.startsWith("tel:")) phones.push(href.replace("tel:", ""));
              if (href.startsWith("mailto:")) emails.push(href.replace("mailto:", ""));
            });
            return {
              forms: forms.length,
              inputs: inputs.map(i => `${(i as HTMLInputElement).name || i.id || i.tagName}: ${i.getAttribute("type") || "text"}`).slice(0, 8),
              phones: Array.from(new Set(phones)).slice(0, 3),
              emails: Array.from(new Set(emails)).slice(0, 3),
              title: document.title
            };
          });

          if (pageData.inputs.length >= 2) {
            formOnPage = `${pageData.forms} form(s) on ${landingUrl} with inputs: ${pageData.inputs.join(", ")}`;
          }
          if (pageData.phones.length > 0) phoneEmail = `Phone: ${pageData.phones.join(", ")}`;
          if (pageData.emails.length > 0) phoneEmail += ` | Email: ${pageData.emails.join(", ")}`;
        }
      }

    } catch (err: any) {
      rootCause = err.message;
    } finally {
      await context.close();
    }

    // Determine final true status & root cause
    if (rootCause.includes("Timeout") || rootCause.includes("timeout")) {
      trueStatus = "FAILURE_NAVIGATION_TIMEOUT";
      classificationAndRootCause = `Initial navigation timeout on target page (${rootCause.slice(0, 80)})`;
    } else if (formOnPage.includes("form(s)") || formOnPage.includes("contact form")) {
      trueStatus = "FAILURE_FORM_NOT_DETECTED";
      classificationAndRootCause = `Public form exists (${formOnPage.slice(0, 80)}), but was missed during discovery or timed out during discovery phase`;
    } else if (portal !== "None") {
      trueStatus = "INELIGIBLE_GENUINE_NO_PUBLIC_FORM";
      classificationAndRootCause = `Genuine no public lead form: requires client portal authentication (${portal.slice(0, 60)})`;
    } else if (phoneEmail !== "None") {
      trueStatus = "INELIGIBLE_GENUINE_NO_PUBLIC_FORM";
      classificationAndRootCause = `Genuine no public web form: inbound contact is strictly via direct phone / email (${phoneEmail.slice(0, 60)})`;
    } else {
      trueStatus = "INELIGIBLE_GENUINE_NO_PUBLIC_FORM";
      classificationAndRootCause = `Genuine no public form: navigation examined candidates (${candidates.slice(0, 2).join(", ")}), no web contact form exists on site`;
    }

    results.push({
      domain: t.domain,
      finalLandingUrl: landingUrl,
      httpStatus: status,
      cmsFramework: cms,
      shadowDomIframes: shadowIframes,
      navCandidatesExamined: candidates,
      formOnPage,
      phoneEmailCues: phoneEmail,
      clientPortalCues: portal,
      trueStatus,
      classificationAndRootCause
    });
    console.log(`  => True Status: ${trueStatus} | Form: ${formOnPage}`);
  }

  await browser.close();

  fs.mkdirSync("scratch", { recursive: true });
  fs.writeFileSync("scratch/detailed_12_no_form_results.json", JSON.stringify(results, null, 2));
  console.log("Written scratch/detailed_12_no_form_results.json");
}

main().catch(console.error);
