import { chromium } from "playwright";
import * as fs from "fs";
import { getChromiumExecutablePath } from "../services/browser-executable";

interface BlockedAuditResult {
  domain: string;
  url: string;
  httpStatus: number | null;
  serverHeader: string | null;
  cfRayHeader: string | null;
  responseHeaders: Record<string, string>;
  pageTitle: string;
  challengeScriptOrElement: string | null;
  visibleBlockingText: string | null;
  trueStatus: "WAF_BLOCKED" | "CAPTCHA_CHALLENGE" | "FALSE_POSITIVE_ACCESSIBLE";
  verificationProof: string;
}

const BLOCKED_TARGETS_8 = [
  "https://www.wilsonlaw.com",
  "https://www.crowe.com",
  "https://www.thecleaningauthority.com",
  "https://www.brightstarcare.com",
  "https://www.cleanslatecenters.com",
  "https://www.oakstreethealth.com",
  "https://www.mckinsey.com",
  "https://www.deloitte.com"
];

async function auditBlockedSite(url: string, browser: any): Promise<BlockedAuditResult> {
  const domain = new URL(url).hostname;
  let httpStatus: number | null = null;
  let serverHeader: string | null = null;
  let cfRayHeader: string | null = null;
  const headersMap: Record<string, string> = {};
  let pageTitle = "";
  let challengeScriptOrElement: string | null = null;
  let visibleBlockingText: string | null = null;
  let trueStatus: BlockedAuditResult["trueStatus"] = "WAF_BLOCKED";
  let verificationProof = "";

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch((err: any) => {
      verificationProof = `Navigation error: ${err.message}`;
      return null;
    });

    if (response) {
      httpStatus = response.status();
      const allHeaders = await response.allHeaders();
      for (const [k, v] of Object.entries(allHeaders)) {
        headersMap[k.toLowerCase()] = String(v);
      }
      serverHeader = headersMap["server"] || null;
      cfRayHeader = headersMap["cf-ray"] || null;
    }

    await page.waitForTimeout(2500);
    pageTitle = await page.title().catch(() => "");

    const domInspection = await page.evaluate(() => {
      const text = document.body ? (document.body.innerText || "") : "";
      const html = document.documentElement ? document.documentElement.outerHTML : "";

      const challengeCues: string[] = [];
      if (document.querySelector('script[src*="friendly-challenge"]') || document.querySelector('.frc-captcha') || (window as any).friendlyChallenge) {
        challengeCues.push("Friendly Captcha (.frc-captcha / friendly-challenge.js)");
      }
      if (document.querySelector('script[src*="mtcaptcha"]') || document.querySelector('.mtcap') || (window as any).mtcaptcha) {
        challengeCues.push("MTCaptcha (.mtcap / mtcaptcha.js)");
      }
      if (document.querySelector('iframe[src*="recaptcha"]') || document.querySelector('.g-recaptcha') || (window as any).grecaptcha) {
        challengeCues.push("Google reCAPTCHA");
      }
      if (document.querySelector('iframe[src*="hcaptcha"]') || document.querySelector('.h-captcha') || (window as any).hcaptcha) {
        challengeCues.push("hCaptcha");
      }
      if (document.querySelector('iframe[src*="challenges.cloudflare.com"]') || document.querySelector('.cf-turnstile')) {
        challengeCues.push("Cloudflare Turnstile");
      }
      if (text.includes("Attention Required! | Cloudflare") || html.includes("challenge-running") || html.includes("cf-browser-verification")) {
        challengeCues.push("Cloudflare Managed Challenge");
      }
      if (text.includes("Just a moment...") || text.includes("Checking your browser")) {
        challengeCues.push("Cloudflare Under Attack / Browser Verification Screen");
      }
      if (text.includes("Access Denied") || text.includes("403 Forbidden") || text.includes("You don't have permission to access")) {
        challengeCues.push("WAF Access Denied / 403 Page");
      }

      // Check for public forms
      const forms = Array.from(document.querySelectorAll("form"));
      const inputs = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea"));

      return {
        textSnippet: text.slice(0, 300).replace(/\s+/g, " "),
        challengeCues,
        formsCount: forms.length,
        inputsCount: inputs.length
      };
    }).catch(() => ({
      textSnippet: "",
      challengeCues: [] as string[],
      formsCount: 0,
      inputsCount: 0
    }));

    challengeScriptOrElement = domInspection.challengeCues.join("; ") || null;
    visibleBlockingText = domInspection.textSnippet || null;

    if (httpStatus === 403) {
      trueStatus = "WAF_BLOCKED";
      verificationProof = `HTTP 403 Forbidden from server '${serverHeader || "unknown"}' (cf-ray: ${cfRayHeader || "none"}). Page title: '${pageTitle}'`;
    } else if (challengeScriptOrElement && (challengeScriptOrElement.includes("Captcha") || challengeScriptOrElement.includes("Turnstile") || challengeScriptOrElement.includes("Challenge"))) {
      trueStatus = "CAPTCHA_CHALLENGE";
      verificationProof = `Challenge active: ${challengeScriptOrElement}. HTTP status: ${httpStatus}. Title: '${pageTitle}'`;
    } else if (domInspection.formsCount > 0 && domInspection.inputsCount >= 2 && httpStatus === 200) {
      trueStatus = "FALSE_POSITIVE_ACCESSIBLE";
      verificationProof = `False positive: Accessible HTTP 200 page with ${domInspection.formsCount} form(s) and ${domInspection.inputsCount} input(s)`;
    } else {
      if (visibleBlockingText && (visibleBlockingText.includes("denied") || visibleBlockingText.includes("forbidden") || visibleBlockingText.includes("security"))) {
        trueStatus = "WAF_BLOCKED";
        verificationProof = `WAF block text detected: '${visibleBlockingText.slice(0, 100)}'`;
      } else {
        trueStatus = "WAF_BLOCKED";
        verificationProof = `Blocked with status ${httpStatus}. Title: '${pageTitle}'`;
      }
    }

  } catch (err: any) {
    verificationProof = `Exception during audit: ${err.message}`;
    trueStatus = "WAF_BLOCKED";
  } finally {
    await context.close();
  }

  return {
    domain,
    url,
    httpStatus,
    serverHeader,
    cfRayHeader,
    responseHeaders: {
      server: serverHeader || "",
      "cf-ray": cfRayHeader || "",
      "content-type": headersMap["content-type"] || ""
    },
    pageTitle,
    challengeScriptOrElement,
    visibleBlockingText,
    trueStatus,
    verificationProof
  };
}

async function main() {
  console.log("==================================================");
  console.log("FORENSIC AUDIT: 8 'BLOCKED' TARGETS");
  console.log("==================================================");

  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const results: BlockedAuditResult[] = [];

  for (let i = 0; i < BLOCKED_TARGETS_8.length; i++) {
    const url = BLOCKED_TARGETS_8[i];
    console.log(`[${i + 1}/${BLOCKED_TARGETS_8.length}] Auditing: ${url}`);
    const res = await auditBlockedSite(url, browser);
    results.push(res);
    console.log(`  -> Status: ${res.httpStatus} | True Status: ${res.trueStatus}`);
    console.log(`  -> Challenge: ${res.challengeScriptOrElement}`);
    console.log(`  -> Proof: ${res.verificationProof}`);
  }

  await browser.close();

  fs.mkdirSync("scratch", { recursive: true });
  const outPath = "scratch/audit_8_blocked_results.json";
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch(console.error);
