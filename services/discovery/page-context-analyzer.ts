import type { Page } from "playwright";
import { DetectedCmsFramework } from "./types";

export interface PageContext {
  pageTitle: string;
  metaDescription: string;
  headings: string[];
  detectedLanguage: string;
  detectedCms: DetectedCmsFramework;
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

      // 1. Language Detection
      let detectedLanguage = "unknown";
      const htmlLang = document.documentElement.getAttribute("lang") || document.documentElement.getAttribute("xml:lang") || "";
      if (htmlLang) {
        detectedLanguage = htmlLang.split(/[-_]/)[0].toLowerCase();
      } else {
        const metaLang = document.querySelector('meta[http-equiv="content-language"]')?.getAttribute("content") || "";
        if (metaLang) {
          detectedLanguage = metaLang.split(/[-_]/)[0].toLowerCase();
        }
      }

      // 2. CMS & Frontend Framework Detection
      let detectedCms: DetectedCmsFramework = "custom";
      const htmlContent = document.documentElement.outerHTML.slice(0, 50000).toLowerCase();
      const generator = document.querySelector('meta[name="generator"]')?.getAttribute("content")?.toLowerCase() || "";

      if (generator.includes("wordpress") || htmlContent.includes("wp-content") || htmlContent.includes("wp-includes")) {
        detectedCms = "wordpress";
      } else if (htmlContent.includes("data-wf-page") || htmlContent.includes("webflow") || document.documentElement.classList.contains("w-mod-js")) {
        detectedCms = "webflow";
      } else if (htmlContent.includes("wix.com") || htmlContent.includes("data-mesh-id") || (window as any).wixBiSession) {
        detectedCms = "wix";
      } else if (htmlContent.includes("squarespace") || generator.includes("squarespace")) {
        detectedCms = "squarespace";
      } else if (htmlContent.includes("cdn.shopify.com") || (window as any).Shopify) {
        detectedCms = "shopify";
      } else if (htmlContent.includes("__next_data__") || htmlContent.includes("/_next/")) {
        detectedCms = "nextjs";
      } else if (htmlContent.includes("__nuxt__") || htmlContent.includes("/_nuxt/")) {
        detectedCms = "vue";
      } else if (htmlContent.includes("data-framer-name") || htmlContent.includes("framer.com")) {
        detectedCms = "framer";
      } else if (htmlContent.includes("hubspot") || generator.includes("hubspot")) {
        detectedCms = "hubspot";
      } else if (generator.includes("drupal")) {
        detectedCms = "drupal";
      } else if (generator.includes("joomla")) {
        detectedCms = "joomla";
      } else if (generator.includes("ghost")) {
        detectedCms = "ghost";
      } else if (document.querySelector("[ng-version], [ng-app]")) {
        detectedCms = "angular";
      } else if (document.querySelector("[data-reactroot]")) {
        detectedCms = "react";
      }

      // 3. Multi-Lingual Heading Intent Collection
      const headingEls = Array.from(document.querySelectorAll("h1, h2, h3"));
      const headings = headingEls
        .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 0 && t.length < 150)
        .slice(0, 15);

      const contactKeywordsInHeadings: string[] = [];
      const headingText = headings.join(" ").toLowerCase();
      const multiLangTerms = [
        // English
        "contact", "get in touch", "let's talk", "lets talk", "book a call", "schedule",
        "consultation", "quote", "estimate", "work with us", "start a project", "ready to grow",
        // French
        "nous contacter", "contactez-nous", "devis", "prendre rendez-vous", "discutons", "parlons",
        // Spanish
        "contacto", "contáctenos", "contacta", "presupuesto", "pedir cita", "reserva", "hablemos",
        // German
        "kontakt", "kontaktieren", "nachricht", "termin", "anfrage", "beratung", "sprechen wir",
        // Italian
        "contattaci", "contatto", "preventivo", "prenota", "appuntamento", "parla con noi",
        // Portuguese
        "contato", "contacto", "fale conosco", "orçamento", "agendar", "vamos conversar",
        // Dutch
        "contact opnemen", "afspraak", "offerte", "gesprek"
      ];

      for (const term of multiLangTerms) {
        if (headingText.includes(term)) {
          contactKeywordsInHeadings.push(term);
        }
      }

      // 4. Universal Form Detection on Page (Does not strictly require <form>)
      const forms = Array.from(document.querySelectorAll("form, [role='form'], .w-form, .hs-form"));
      const hasInteractiveForm = forms.some((f) => {
        const action = (f.getAttribute("action") || "").toLowerCase();
        if (action.includes("search")) return false;
        const inputs = f.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea, select");
        return inputs.length > 0;
      });

      // Check if page has phone/email links but no interactive form
      const mailtoOrTel = document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]');
      const hasPhoneOrEmailOnly = !hasInteractiveForm && mailtoOrTel.length > 0;

      return {
        pageTitle,
        metaDescription,
        headings,
        detectedLanguage,
        detectedCms,
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
      detectedLanguage: "unknown",
      detectedCms: "custom",
      hasExistingForm: false,
      hasPhoneOrEmailOnly: false,
      contactKeywordsInHeadings: []
    };
  }
}
