import type { Page } from "playwright";

export interface PageContext {
  pageTitle: string;
  metaDescription: string;
  headings: string[];
  hasExistingForm: boolean;
  hasPhoneOrEmailOnly: boolean;
  contactKeywordsInHeadings: string[];
}

export async function analyzePageContext(page: Page): Promise<PageContext> {
  try {
    return await page.evaluate(() => {
      const pageTitle = (document.title || "").trim();
      const metaDescEl = document.querySelector('meta[name="description"], meta[property="og:description"]');
      const metaDescription = (metaDescEl?.getAttribute("content") || "").trim();

      // Collect H1, H2, H3 headings
      const headingEls = Array.from(document.querySelectorAll("h1, h2, h3"));
      const headings = headingEls
        .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 0 && t.length < 150)
        .slice(0, 15);

      const contactKeywordsInHeadings: string[] = [];
      const headingText = headings.join(" ").toLowerCase();
      const checkTerms = [
        "contact",
        "get in touch",
        "let's talk",
        "lets talk",
        "book a call",
        "schedule",
        "consultation",
        "quote",
        "estimate",
        "work with us",
        "start a project",
        "ready to grow",
        "start something"
      ];
      for (const term of checkTerms) {
        if (headingText.includes(term)) {
          contactKeywordsInHeadings.push(term);
        }
      }

      // Check if page already has interactive forms
      const forms = Array.from(document.querySelectorAll("form"));
      const hasInteractiveForm = forms.some((f) => {
        const action = (f.getAttribute("action") || "").toLowerCase();
        if (action.includes("search")) return false;
        const inputs = f.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea");
        return inputs.length > 0;
      });

      // Check if page has phone/email links but no forms
      const mailtoOrTel = document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]');
      const hasPhoneOrEmailOnly = !hasInteractiveForm && mailtoOrTel.length > 0;

      return {
        pageTitle,
        metaDescription,
        headings,
        hasExistingForm: hasInteractiveForm,
        hasPhoneOrEmailOnly,
        contactKeywordsInHeadings
      };
    });
  } catch {
    return {
      pageTitle: "",
      metaDescription: "",
      headings: [],
      hasExistingForm: false,
      hasPhoneOrEmailOnly: false,
      contactKeywordsInHeadings: []
    };
  }
}
