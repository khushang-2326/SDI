import type { Locator, Page } from "playwright";

export type SemanticFieldType =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "company"
  | "job_title"
  | "website"
  | "address"
  | "city"
  | "state"
  | "country"
  | "postal_code"
  | "subject"
  | "message"
  | "inquiry"
  | "budget"
  | "service_interest"
  | "referral_source"
  | "industry"
  | "company_size"
  | "date"
  | "time"
  | "preferred_contact_method"
  | "consent"
  | "newsletter"
  | "attachment"
  | "honeypot"
  | "unknown";

export interface FieldSignals {
  index: number;
  tagName: "input" | "textarea" | "select";
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  ariaLabelledby: string;
  autocomplete: string;
  title: string;
  dataAttributes?: string;
  explicitLabel: string;
  associatedLabels: string[];
  surroundingLabel: string;
  legendText: string;
  parentContainerText: string;
  precedingSiblingText: string;
  followingSiblingText: string;
  isRequired: boolean;
  isDisabled: boolean;
  isReadOnly: boolean;
  isVisible: boolean;
  domPosition: number;
  selectOptions?: Array<{ text: string; value: string; disabled: boolean }>;
}

export interface FieldClassification {
  fieldType: SemanticFieldType;
  confidence: number; // 0.0 to 1.0
  evidence: string[];
  isNegative: boolean;
  negativeReason?: string;
}

export interface FieldVerificationItem {
  fieldIndex: number;
  fieldType: SemanticFieldType;
  mappedSource: string;
  confidence: number;
  evidence: string[];
  filled: boolean;
  verified: boolean;
  finalValue?: string;
}

export interface UnmappedRequiredFieldDetail {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  availableOptions?: string[];
  reason: string;
}

export interface FormFillMetrics {
  fieldsDetected?: number;
  fieldsClassified?: number;
  filledFieldsCount: number;
  verifiedFieldsCount: number;
  unmappedRequiredFields: string[];
  unmappedRequiredDetails?: UnmappedRequiredFieldDetail[];
  unmappedOptionalFields: string[];
  items: FieldVerificationItem[];
}

export const COMMON_INPUT_SELECTOR = [
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset'])",
  "textarea",
  "select"
].join(",");

// Regex for controls that must NEVER be filled with lead data
const NEGATIVE_FIELD_PATTERN = /\b(password|passwd|pwd|passcode|site[-_]?search|search[-_]?input|coupon|promo|voucher|discount|captcha|recaptcha|turnstile|hcaptcha|cf-turnstile|botcheck|honeypot)\b/i;

// Compact normalized multilingual token patterns across EN, ES, FR, DE, IT, PT, NL
const MULTILINGUAL_SYNONYMS: Record<Exclude<SemanticFieldType, "unknown">, RegExp[]> = {
  first_name: [
    /\b(first[ _-]?name|firstname|fname|f_name|given[ _-]?name|forename|your[ _-]?first[ _-]?name|your[ _-]?name|c_firstname|txtname|name_first|footer[-_]?first[-_]?name)\b/i,
    /\b(prenom|vorname|nombre|nome|primeiro[ _-]?nome|voornaam)\b/i,
    /(^|[ _-])(first-name|firstname|fname|f_name|given-name|forename|your-name|wpforms\[fields\]\[\d+\]\[first\])([ _-]|$)/i
  ],
  last_name: [
    /\b(last[ _-]?name|lastname|lname|l_name|surname|family[ _-]?name|your[ _-]?last[ _-]?name|your[ _-]?last|c_lastname|name_last)\b/i,
    /\b(nom[ _-]?de[ _-]?famille|nachname|familienname|apellido|cognome|sobrenome|achternaam)\b/i,
    /(^|[ _-])(last-name|lastname|lname|l_name|surname|family-name|your-last|wpforms\[fields\]\[\d+\]\[last\])([ _-]|$)/i
  ],
  full_name: [
    /\b(full[ _-]?name|fullname|your[ _-]?name|yourname|contact[ _-]?name|complete[ _-]?name|client[ _-]?name|lead[ _-]?name|user[ _-]?name|contactusform\[name\]|queryform\[name\]|user_query\[name\])\b/i,
    /\b(nom[ _-]?complet|vollstaendiger[ _-]?name|voller[ _-]?name|nombre[ _-]?completo|nome[ _-]?completo|volledige[ _-]?naam)\b/i,
    // Generic "name" with boundary check (not company name, user name, etc., handling optional trailing required asterisk)
    /(?<!(company|business|user|file|brand|org|organisation)[ _-])\b(name|nom|nombre|nome|naam)\b(?![ _-]?(of|company|business|user))/i,
    /\b(ihr[ _-]?name|votre[ _-]?nom|su[ _-]?nombre|il[ _-]?tuo[ _-]?nome|uw[ _-]?naam)\b/i
  ],
  email: [
    /\b(e-?mail|emailaddress|email[ _-]?address|work[ _-]?email|business[ _-]?email|corporate[ _-]?email|your[ _-]?email|youremail|contact[ _-]?email|footer[-_]?email)\b/i,
    /\b(courriel|correo|correo[ _-]?electronico|indirizzo[ _-]?email|e-post|e-mailadresse)\b/i,
    /(^|[ _-])(email|work-email|business-email|user-email|contact-email|lead-email|form_fields\[email.*\]|fields\[email.*\]|footer-email|newsletter_email)([ _-]|$)/i
  ],
  phone: [
    /\b(phone|telephone|tel|mobile|cell|cellphone|contact[ _-]?number|phone[ _-]?number|mobile[ _-]?number|contact[ _-]?no|your[ _-]?phone|yourphone|mobile[ _-]?no|phonenumber|pn)\b/i,
    /\b(telefon|telephone|telefono|numero[ _-]?telefono|celular|telefone|telefoonnummer)\b/i,
    /(^|[ _-])(phone|mobile|telephone|tel|contact-phone|phone-number|mobile-number|form_fields\[phone.*\]|fields\[phone.*\]|your-phone|tel-\d+|phone-[0-9a-f-]+)([ _-]|$)/i
  ],
  company: [
    /\b(company|business|organization|organisation|brand|firm|agency|enterprise|compañía|compania)\b/i,
    /\b(company[ _-]?name|business[ _-]?name|firm[ _-]?name|organization[ _-]?name|your[ _-]?company|businessname|companyname)\b/i,
    /\b(societe|entreprise|unternehmen|firma|empresa|azienda|bedrijf|bedrijfsnaam)\b/i,
    /(^|[ _-])(company|company-name|business-name|organization|firm|agency|0-1\/company)([ _-]|$)/i
  ],
  job_title: [
    /\b(job[ _-]?title|title|role|position|occupation|designation)\b/i,
    /\b(poste|fonction|beruf|position|cargo|funzione|functie)\b/i
  ],
  website: [
    /\b(website|web[ _-]?site|url|domain|company[ _-]?website|site[ _-]?url|web[ _-]?address)\b/i,
    /\b(site[ _-]?web|sitio[ _-]?web|webseite|siteweb)\b/i
  ],
  address: [
    /\b(address|street|street[ _-]?address|addr|location|physical[ _-]?address|streetaddress|address1|address[ _-]?line[ _-]?1)\b/i,
    /\b(adresse|strasse|str\.|direccion|indirizzo|endereco|adres)\b/i,
    /(^|[ _-])(address|street|street-address|address-line-1|address1|street_address)([ _-]|$)/i
  ],
  city: [
    /\b(city|town|municipality|suburb)\b/i,
    /\b(ville|stadt|ciudad|citta|cidade|stad)\b/i
  ],
  state: [
    /\b(state|province|region|territory)\b/i,
    /\b(province|bundesland|departement|estado|provincia|regione|provincie)\b/i
  ],
  country: [
    /\b(country|nation)\b/i,
    /\b(pays|land|pais|paese|land)\b/i
  ],
  postal_code: [
    /\b(zip|zipcode|zip[ _-]?code|postal|postal[ _-]?code|postcode)\b/i,
    /\b(code[ _-]?postal|plz|postleitzahl|codigo[ _-]?postal|cap|postcode)\b/i
  ],
  subject: [
    /\b(subject|regarding|topic|reason[ _-]?for[ _-]?contact|how[ _-]?can[ _-]?we[ _-]?help|describe[ _-]?your[ _-]?needs|inquiry[ _-]?type|contact[ _-]?reason|contacttype|title)\b/i,
    /\b(sujet|betreff|asunto|oggetto|assunto|onderwerp)\b/i
  ],
  message: [
    /\b(message|comment|comments|note|notes|details|description|project[ _-]?details|how[ _-]?can[ _-]?we[ _-]?help|brief|tell[ _-]?us|your[ _-]?message|yourmessage|ymessage|leave[ _-]?us[ _-]?a[ _-]?message|project[ _-]?description|inquiry[ _-]?details|contact-message|question|your-message)\b/i,
    /\b(nachricht|mitteilung|mensaje|messaggio|mensagem|bericht|opmerkingen)\b/i,
    /(^|[ _-])(message|comments|inquiry-message|form_fields\[message.*\]|fields\[message.*\]|ymessage|contact-message|your-message|question)([ _-]|$)/i
  ],
  inquiry: [
    /\b(enquiry|inquiry|consultation|request|question|query|user_query|demande|anfrage|consulta|richiesta)\b/i
  ],
  budget: [
    /\b(budget|estimated[ _-]?budget|price[ _-]?range|investment|monthly[ _-]?budget|project[ _-]?budget|current[ _-]?budget|marketing[ _-]?budget|approximate[ _-]?budget)\b/i,
    /\b(tarif|kosten|presupuesto|preventivo|orcamento)\b/i
  ],
  service_interest: [
    /\b(services?[ _-]?interested[ _-]?in|services?[ _-]?of[ _-]?interest|preferred[ _-]?services?|services?[ _-]?required|select[ _-]?services?|interested[ _-]?in|area[ _-]?of[ _-]?service|service|services|interested-service)\b/i,
    /\b(dienstleistung|servicio|servicios|prestation|servizi|diensten)\b/i
  ],
  referral_source: [
    /\b(how[ _-]?did[ _-]?you[ _-]?(hear|find|know)[ _-]?(about)?[ _-]?us|where[ _-]?did[ _-]?you[ _-]?(hear|find)|referral[ _-]?source|referral|source|self[ _-]?reported[ _-]?source|how[ _-]?you[ _-]?heard)\b/i,
    /\b(comment[ _-]?nous[ _-]?avez[ _-]?vous[ _-]?connu|como[ _-]?nos[ _-]?conocio|come[ _-]?ci[ _-]?hai[ _-]?conosciuto|hoe[ _-]?heeft[ _-]?u[ _-]?ons[ _-]?gevonden|woher[ _-]?kennen[ _-]?sie[ _-]?uns)\b/i
  ],
  industry: [
    /\b(industry|sector|business[ _-]?sector|vertical|business[ _-]?type|domain)\b/i,
    /\b(branche|secteur|industria|sector[ _-]?empresarial|bedrijfstak)\b/i
  ],
  company_size: [
    /\b(company[ _-]?size|employees?|number[ _-]?of[ _-]?employees|team[ _-]?size|organization[ _-]?size)\b/i
  ],
  date: [
    /\b(date|preferred[ _-]?date|booking[ _-]?date|meeting[ _-]?date|appointment[ _-]?date)\b/i,
    /\b(datum|fecha|data)\b/i
  ],
  time: [
    /\b(time|preferred[ _-]?time|booking[ _-]?time|meeting[ _-]?time)\b/i,
    /\b(zeit|uhrzeit|heure|hora|ora|tijd)\b/i
  ],
  preferred_contact_method: [
    /\b(preferred[ _-]?contact|how[ _-]?should[ _-]?we[ _-]?contact|contact[ _-]?method)\b/i
  ],
  consent: [
    /\b(consent|agree|terms|privacy|privacy[ _-]?policy|terms[ _-]?of[ _-]?service|gdpr|datenschutz|accept|conditions)\b/i,
    /\b(disclaimer|legal|acceptance|authorization|terms[ _-]?of[ _-]?use|privacy[ _-]?statement|data[ _-]?protection|agree[ _-]?terms|declar|confirm|trattamento|privacidad)\b/i,
    /(^|[ _-])(wpcf7-acceptance|gfield--type-consent|consent|terms|privacy|datenschutz)([ _-]|$)/i,
    /\b(j'accepte|ich[ _-]?stimme[ _-]?zu|acepto|acconsento|concordo|akkoord)\b/i
  ],
  newsletter: [
    /\b(newsletter|subscribe|subscription|marketing[ _-]?emails|keep[ _-]?me[ _-]?updated|promotions)\b/i,
    /\b(abonner|abonnieren|suscribir|iscriviti)\b/i
  ],
  attachment: [
    /\b(attachment|attach|upload|file|resume|cv|document)\b/i,
    /\b(fichier|datei|anhang|archivo|allegato|bestand)\b/i
  ],
  honeypot: [
    /\b(honeypot|leave[ _-]?this[ _-]?field[ _-]?(blank|empty)|if[ _-]?you[ _-]?are[ _-]?human|do[ _-]?not[ _-]?fill|please[ _-]?leave[ _-]?empty)\b/i
  ]
};

export function splitFullName(fullName?: string | null): { firstName: string; middleName: string; lastName: string } {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: parts[0] };
  if (parts.length === 2) return { firstName: parts[0], middleName: "", lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1]
  };
}

export function solveMathOrSpamChallenge(descriptor: string): string | null {
  if (!descriptor) return null;
  const text = descriptor.toLowerCase().replace(/\s+/g, " ").trim();

  // 1. Text extraction instructions: e.g. "Spam check please enter: seo", "Spam Check Enter: seolosangeles", "enter: XYZ", "type 'XYZ'"
  const enterMatch = text.match(/(?:please\s+)?(?:enter|type|input|write|code)[:\s]+['"]?([a-zA-Z0-9_-]+)['"]?/i);
  if (enterMatch && enterMatch[1]) {
    const word = enterMatch[1].trim();
    if (!["the", "your", "a", "an", "this", "number", "text", "answer", "code", "message", "name", "email", "phone"].includes(word.toLowerCase())) {
      return word;
    }
  }

  // 2. Arithmetic math quizzes: e.g. "3+4 = *", "3+4=?", "3+2=?", "1+2=", "2 +3 =?", "23+23 *", "4 - 0 =", "What is 9 + 8 = ?", "What is 8 + 10*", "5+7=?", "3+3 = *"
  const mathRegex = /(\d+)\s*([\+\-\*\/xX]|plus|minus|times|multiplied\s+by|divided\s+by)\s*(\d+)/i;
  const mathMatch = text.match(mathRegex);
  if (mathMatch) {
    const num1 = parseInt(mathMatch[1], 10);
    const op = mathMatch[2].toLowerCase();
    const num2 = parseInt(mathMatch[3], 10);
    if (!isNaN(num1) && !isNaN(num2)) {
      if (op === "+" || op === "plus") return String(num1 + num2);
      if (op === "-" || op === "minus") return String(num1 - num2);
      if (op === "*" || op === "x" || op === "times" || op.includes("multiplied")) return String(num1 * num2);
      if ((op === "/" || op.includes("divided")) && num2 !== 0) return String(Math.floor(num1 / num2));
    }
  }

  // 3. Word numbers: "one plus two", "three + four", "two plus three"
  const wordMap: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
  };
  const wordMathRegex = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(\+|\-|plus|minus|times)\s*(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;
  const wordMatch = text.match(wordMathRegex);
  if (wordMatch) {
    const n1 = wordMap[wordMatch[1].toLowerCase()];
    const op = wordMatch[2].toLowerCase();
    const n2 = wordMap[wordMatch[3].toLowerCase()];
    if (n1 !== undefined && n2 !== undefined) {
      if (op === "+" || op === "plus") return String(n1 + n2);
      if (op === "-" || op === "minus") return String(n1 - n2);
      if (op === "*" || op === "times") return String(n1 * n2);
    }
  }

  // 4. Common knowledge security questions:
  if (text.includes("color") && text.includes("sky")) return "blue";
  if (text.includes("color") && text.includes("grass")) return "green";
  if (text.includes("color") && text.includes("snow")) return "white";
  if (text.includes("color") && text.includes("sun")) return "yellow";
  if (text.includes("capital") && text.includes("japan")) return "Tokyo";
  if (text.includes("capital") && text.includes("france")) return "Paris";
  if (text.includes("capital") && (text.includes("usa") || text.includes("united states") || text.includes("america"))) return "Washington";
  if (text.includes("capital") && (text.includes("uk") || text.includes("england") || text.includes("united kingdom"))) return "London";
  if (text.includes("capital") && text.includes("germany")) return "Berlin";
  if (text.includes("capital") && text.includes("italy")) return "Rome";
  if (text.includes("capital") && text.includes("spain")) return "Madrid";
  if (text.includes("capital") && text.includes("canada")) return "Ottawa";
  if (text.includes("capital") && text.includes("australia")) return "Canberra";
  if (text.includes("days") && text.includes("week")) return "7";
  if (text.includes("hours") && text.includes("day")) return "24";
  if (text.includes("months") && text.includes("year")) return "12";
  if (/\b(are\s+you\s+(a\s+)?human|human\s+verification)\b/i.test(text)) return "yes";

  return null;
}

export async function extractFieldSignals(scope: Page | Locator): Promise<FieldSignals[]> {
  return scope.locator(COMMON_INPUT_SELECTOR).evaluateAll((elements) => {
    return elements.map((element, index) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const tagName = input.tagName.toLowerCase() as "input" | "textarea" | "select";
      const type = (input.getAttribute("type") ?? (tagName === "textarea" ? "textarea" : tagName === "select" ? "select" : "text")).toLowerCase();
      const id = input.id || "";
      const name = input.getAttribute("name") || "";
      const placeholder = input.getAttribute("placeholder") || "";
      const ariaLabel = input.getAttribute("aria-label") || "";
      const ariaLabelledby = input.getAttribute("aria-labelledby") || "";
      const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
      const title = input.getAttribute("title") || "";
      const dataAttributes = [
        input.getAttribute("data-testid"),
        input.getAttribute("data-test"),
        input.getAttribute("data-qa"),
        input.getAttribute("data-cy"),
        input.getAttribute("data-field"),
        input.getAttribute("data-name"),
        input.getAttribute("data-field-name")
      ].filter(Boolean).join(" ");

      // Dereference aria-labelledby to its element text content
      let ariaLabelledbyText = "";
      if (ariaLabelledby) {
        try {
          const ids = ariaLabelledby.split(/\s+/).filter(Boolean);
          ariaLabelledbyText = ids
            .map((refId) => document.getElementById(refId)?.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        } catch {
          // ignore selector errors
        }
      }
      const effectiveAriaLabel = [ariaLabel, ariaLabelledbyText].filter(Boolean).join(" ");

      // Explicit labels (<label for="id"> or <label for="name">)
      let explicitLabel = "";
      if (id) {
        try {
          const el = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (el) explicitLabel = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        } catch {
          // ignore selector escape errors
        }
      }
      if (!explicitLabel && name) {
        try {
          const el = document.querySelector(`label[for="${CSS.escape(name)}"]`);
          if (el) explicitLabel = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        } catch {
          // ignore selector escape errors
        }
      }
      if (!explicitLabel) {
        try {
          const quizSpan = input.parentElement?.querySelector(".wpcf7-quiz-label") ||
                           input.closest(".wpcf7-form-control-wrap")?.querySelector(".wpcf7-quiz-label") ||
                           (input.previousElementSibling?.classList?.contains("wpcf7-quiz-label") ? input.previousElementSibling : null);
          if (quizSpan) {
            explicitLabel = (quizSpan.textContent ?? "").replace(/\s+/g, " ").trim();
          }
        } catch {}
      }

      // Associated labels property
      const associatedLabels = Array.from((input as HTMLInputElement).labels ?? []).map(
        (l) => (l.textContent ?? "").replace(/\s+/g, " ").trim()
      ).filter(Boolean);

      // Surrounding label (if wrapped inside a <label>)
      const surroundingLabelEl = input.closest("label");
      let surroundingLabel = "";
      if (surroundingLabelEl) {
        surroundingLabel = (surroundingLabelEl.textContent ?? "").replace(/\s+/g, " ").trim();
      }

      // Legend text (if inside a fieldset)
      const fieldset = input.closest("fieldset");
      const legendText = fieldset?.querySelector("legend")?.textContent?.replace(/\s+/g, " ").trim() ?? "";

      // Hierarchical field container: look up to 4 ancestors for field wrappers (Gravity Forms, Pardot, Formidable, Elementor, HubSpot, Divs)
      let fieldContainer: HTMLElement | null = null;
      let curr = input.parentElement;
      let depth = 0;
      while (curr && depth < 4) {
        const cls = (curr.className || "").toString().toLowerCase();
        const tag = curr.tagName.toLowerCase();
        if (
          cls.includes("form-field") ||
          cls.includes("gfield") ||
          cls.includes("frm_form_field") ||
          cls.includes("elementor-field-group") ||
          cls.includes("form-group") ||
          cls.includes("hs-form-field") ||
          cls.includes("field") ||
          tag === "fieldset" ||
          tag === "p" ||
          tag === "li"
        ) {
          fieldContainer = curr;
          break;
        }
        curr = curr.parentElement;
        depth++;
      }
      if (!fieldContainer) fieldContainer = input.parentElement;

      const containerLabel = fieldContainer?.querySelector("label")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!explicitLabel && containerLabel) {
        explicitLabel = containerLabel;
      }
      const parentContainerText = (fieldContainer?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);

      // Sibling texts
      const precedingSiblingText = (input.previousElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      const followingSiblingText = (input.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

      // Required state
      const isRequired = input.required ||
        input.getAttribute("aria-required") === "true" ||
        input.classList.contains("required") ||
        Boolean(fieldContainer?.classList.contains("required")) ||
        parentContainerText.includes("*");

      // Disabled / Readonly
      const isDisabled = input.disabled || input.getAttribute("aria-disabled") === "true";
      const isReadOnly = (input as HTMLInputElement).readOnly || false;

      // Visibility & Position
      const style = window.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      const isCheckboxOrRadio = type === "checkbox" || type === "radio";
      const isVisible = style.display !== "none" &&
        style.visibility !== "hidden" &&
        (isCheckboxOrRadio || (style.opacity !== "0" && (rect.width > 0 || input.offsetParent !== null) && (rect.height > 0 || input.offsetParent !== null))) &&
        rect.left > -1000 &&
        rect.top > -1000;

      // Select options
      let selectOptions: Array<{ text: string; value: string; disabled: boolean }> | undefined;
      if (tagName === "select") {
        const select = input as HTMLSelectElement;
        selectOptions = Array.from(select.options).map((opt) => ({
          text: (opt.textContent ?? "").replace(/\s+/g, " ").trim(),
          value: (opt.value || "").trim(),
          disabled: opt.disabled
        }));
      }

      return {
        index,
        tagName,
        type,
        name,
        id,
        placeholder,
        ariaLabel: effectiveAriaLabel,
        ariaLabelledby,
        autocomplete,
        title,
        dataAttributes,
        explicitLabel,
        associatedLabels,
        surroundingLabel,
        legendText,
        parentContainerText,
        precedingSiblingText,
        followingSiblingText,
        isRequired,
        isDisabled,
        isReadOnly,
        isVisible,
        domPosition: index,
        selectOptions
      };
    });
  });
}

export function isHoneypotField(signals: FieldSignals): boolean {
  const combinedText = [
    signals.explicitLabel,
    ...signals.associatedLabels,
    signals.surroundingLabel,
    signals.placeholder,
    signals.ariaLabel,
    signals.title
  ].filter(Boolean).join(" ").toLowerCase();

  // Explicit honeypot instructions (e.g. "If you are human, leave this field blank", "Please leave this field empty")
  if (/\b(leave\s+this\s+(field\s+)?(blank|empty)|if\s+you\s+are\s+human|do\s+not\s+fill|please\s+leave\s+(this\s+field\s+)?empty|human\s+check\s+leave\s+blank|honeypot)\b/i.test(combinedText)) {
    return true;
  }

  const technical = [signals.name, signals.id, signals.dataAttributes].filter(Boolean).join(" ").toLowerCase();
  if (/(honeypot|hp_|_hp|botcheck|fake_field|item_meta\[\d+\]_hp|gform_validation_container|wpforms-field-hp|gform_hp|antispam|form-antispam)/i.test(technical)) {
    return true;
  }

  // Identifiable contact fields (email, phone, name, message, address, company, etc.) must NEVER be flagged as honeypots
  const isLikelyContactField = (
    signals.type === "email" ||
    signals.type === "tel" ||
    signals.tagName === "textarea" ||
    /\b(email|phone|tel|mobile|name|first|last|fname|lname|message|comment|inquiry|company|website|address|city|state|zip|postal|subject)\b/i.test(
      `${technical} ${combinedText}`
    )
  );

  if (isLikelyContactField) {
    return false;
  }

  // Hidden off-screen with negative coordinates or display:none that is NOT an identifiable contact field
  if (!signals.isVisible) {
    return true;
  }

  return false;
}

function matchSynonyms(text: string, patterns: RegExp[]): boolean {
  if (!text) return false;
  return patterns.some((regex) => regex.test(text));
}

export function classifyField(signals: FieldSignals, allFormSignals: FieldSignals[] = []): FieldClassification {
  const evidence: string[] = [];

  // 0. Honeypot check
  if (isHoneypotField(signals)) {
    return {
      fieldType: "honeypot",
      confidence: 0.99,
      evidence: ["detected honeypot field"],
      isNegative: true,
      negativeReason: "honeypot trap"
    };
  }

  // 1. Negative control check (Passwords, search bars, coupons, CAPTCHA)
  if (signals.type === "password") {
    return {
      fieldType: "unknown",
      confidence: 0,
      evidence: ["type=password"],
      isNegative: true,
      negativeReason: "password field"
    };
  }

  const combinedAttributes = [
    signals.name,
    signals.id,
    signals.placeholder,
    signals.ariaLabel,
    signals.title
  ].filter(Boolean).join(" ");

  const isZipOrPostal = /\b(zip|postal|postcode|zipcode|plz)\b/i.test(combinedAttributes);
  const isLikelyContactField = (
    signals.type === "email" ||
    signals.type === "tel" ||
    signals.tagName === "textarea" ||
    /\b(email|phone|tel|mobile|name|first|last|fname|lname|message|comment|inquiry|company|website|address|city|state|zip|postal|subject)\b/i.test(
      combinedAttributes
    )
  );

  if (!isZipOrPostal && !isLikelyContactField && NEGATIVE_FIELD_PATTERN.test(combinedAttributes)) {
    const match = combinedAttributes.match(NEGATIVE_FIELD_PATTERN)?.[0] ?? "negative";
    return {
      fieldType: "unknown",
      confidence: 0,
      evidence: [`negative match: ${match}`],
      isNegative: true,
      negativeReason: `matches negative pattern: ${match}`
    };
  }

  // Check for search type (excluding zip/postal intake)
  if (!isZipOrPostal && (signals.type === "search" || signals.ariaLabel.toLowerCase().includes("search") || signals.placeholder.toLowerCase().includes("search"))) {
    return {
      fieldType: "unknown",
      confidence: 0,
      evidence: ["search control"],
      isNegative: true,
      negativeReason: "search field"
    };
  }

  // Check for newsletter-only controls (single email input inside newsletter context)
  const isNewsletterWrapper = /\b(newsletter|subscribe|subscription)\b/i.test(signals.parentContainerText) &&
    !/\b(contact|message|quote|inquiry|touch|help)\b/i.test(signals.parentContainerText);

  // 2. High-confidence Browser-Level Technical Attributes
  // Autocomplete standards
  if (signals.autocomplete) {
    if (signals.autocomplete === "email") {
      evidence.push("autocomplete=email");
      return { fieldType: "email", confidence: 0.99, evidence, isNegative: false };
    }
    if (signals.autocomplete === "tel" || signals.autocomplete === "tel-national") {
      evidence.push("autocomplete=tel");
      return { fieldType: "phone", confidence: 0.99, evidence, isNegative: false };
    }
    if (signals.autocomplete === "given-name") {
      evidence.push("autocomplete=given-name");
      return { fieldType: "first_name", confidence: 0.99, evidence, isNegative: false };
    }
    if (signals.autocomplete === "family-name") {
      evidence.push("autocomplete=family-name");
      return { fieldType: "last_name", confidence: 0.99, evidence, isNegative: false };
    }
    if (signals.autocomplete === "name") {
      evidence.push("autocomplete=name");
      return { fieldType: "full_name", confidence: 0.98, evidence, isNegative: false };
    }
    if (signals.autocomplete === "organization") {
      evidence.push("autocomplete=organization");
      return { fieldType: "company", confidence: 0.98, evidence, isNegative: false };
    }
    if (signals.autocomplete === "url") {
      evidence.push("autocomplete=url");
      return { fieldType: "website", confidence: 0.98, evidence, isNegative: false };
    }
    if (signals.autocomplete === "street-address") {
      evidence.push("autocomplete=street-address");
      return { fieldType: "address", confidence: 0.98, evidence, isNegative: false };
    }
    if (signals.autocomplete === "postal-code") {
      evidence.push("autocomplete=postal-code");
      return { fieldType: "postal_code", confidence: 0.98, evidence, isNegative: false };
    }
  }

  // HTML5 Input Types
  if (signals.type === "email") {
    evidence.push("type=email");
    if (isNewsletterWrapper && allFormSignals.length === 1) {
      return { fieldType: "newsletter", confidence: 0.85, evidence, isNegative: true, negativeReason: "isolated newsletter" };
    }
    return { fieldType: "email", confidence: 0.98, evidence, isNegative: false };
  }

  if (signals.type === "tel") {
    evidence.push("type=tel");
    return { fieldType: "phone", confidence: 0.98, evidence, isNegative: false };
  }

  if (signals.type === "url") {
    evidence.push("type=website");
    return { fieldType: "website", confidence: 0.95, evidence, isNegative: false };
  }

  if (signals.type === "file") {
    evidence.push("type=file");
    return { fieldType: "attachment", confidence: 0.95, evidence, isNegative: false };
  }

  // Checkbox & Radio handling
  if (signals.type === "checkbox") {
    const text = [
      signals.explicitLabel,
      ...signals.associatedLabels,
      signals.surroundingLabel,
      signals.followingSiblingText,
      signals.parentContainerText
    ].join(" ");

    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.consent)) {
      evidence.push("checkbox matching consent keywords");
      return { fieldType: "consent", confidence: 0.90, evidence, isNegative: false };
    }
    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.newsletter)) {
      evidence.push("checkbox matching newsletter opt-in");
      return { fieldType: "newsletter", confidence: 0.85, evidence, isNegative: false };
    }
    evidence.push("non-consent checkbox selection");
    return { fieldType: "unknown", confidence: 0, evidence, isNegative: false };
  }

  if (signals.type === "radio") {
    evidence.push("radio selection");
    return { fieldType: "unknown", confidence: 0, evidence, isNegative: false };
  }

  // Select options semantic inspection
  if (signals.tagName === "select" && signals.selectOptions && signals.selectOptions.length > 0) {
    const optionTexts = signals.selectOptions
      .map((o) => o.text.toLowerCase())
      .filter((t) => t && !/^(select|choose|please|none|--)/.test(t));
    const combinedOptions = optionTexts.join(" ");

    // Country detection
    if (
      /\b(united states|canada|united kingdom|australia|germany|france|spain|italy|netherlands|brazil|india|japan)\b/i.test(combinedOptions)
    ) {
      evidence.push("select options contain country names");
      return { fieldType: "country", confidence: 0.95, evidence, isNegative: false };
    }

    // State detection
    if (
      /\b(california|new york|texas|florida|illinois|pennsylvania|ohio|georgia|north carolina|michigan)\b/i.test(combinedOptions)
    ) {
      evidence.push("select options contain state names");
      return { fieldType: "state", confidence: 0.95, evidence, isNegative: false };
    }

    // Job title / role / position level detection
    if (
      /\b(ceo|cfo|cto|cio|cmo|vp|director|manager|executive|founder|owner|partner|consultant|purchaser|operational|board of directors)\b/i.test(combinedOptions)
    ) {
      evidence.push("select options contain job roles / levels");
      return { fieldType: "job_title", confidence: 0.92, evidence, isNegative: false };
    }

    // Budget detection
    if (
      /\b(\$|€|£|\b\d+k\b|budget|under \$|over \$|\d+,\d{3})/i.test(combinedOptions)
    ) {
      evidence.push("select options contain budget ranges");
      return { fieldType: "budget", confidence: 0.92, evidence, isNegative: false };
    }

    // Service / Interest detection
    if (
      /\b(seo|web design|marketing|ppc|advertising|consulting|development|branding|social media|audit|software|design)\b/i.test(combinedOptions)
    ) {
      evidence.push("select options contain services of interest");
      return { fieldType: "service_interest", confidence: 0.90, evidence, isNegative: false };
    }

    // Referral source detection
    if (
      /\b(google|friend|referral|search engine|social media|linkedin|facebook|advertisement|other|word of mouth|recommendation)\b/i.test(combinedOptions)
    ) {
      evidence.push("select options contain referral sources");
      return { fieldType: "referral_source", confidence: 0.90, evidence, isNegative: false };
    }

    // Industry detection
    if (
      /\b(technology|healthcare|finance|education|real estate|retail|legal|construction|automotive|ecommerce|hospitality)\b/i.test(combinedOptions)
    ) {
      evidence.push("select options contain industries");
      return { fieldType: "industry", confidence: 0.90, evidence, isNegative: false };
    }

    // Subject / Inquiry reason detection
    if (
      /\b(general|inquiry|enquiry|sales|support|billing|partnerships?|services?|business|quote|careers)\b/i.test(combinedOptions)
    ) {
      evidence.push("select options contain inquiry topics / reasons");
      return { fieldType: "subject", confidence: 0.88, evidence, isNegative: false };
    }
  }

  // Textarea handling
  if (signals.tagName === "textarea") {
    evidence.push("tag=textarea");
    const text = [
      signals.explicitLabel,
      ...signals.associatedLabels,
      signals.surroundingLabel,
      signals.placeholder,
      signals.name,
      signals.ariaLabel
    ].join(" ");

    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.email)) {
      evidence.push("textarea with email label/placeholder");
      return { fieldType: "email", confidence: 0.92, evidence, isNegative: false };
    }
    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.first_name)) {
      evidence.push("textarea with first name label/placeholder");
      return { fieldType: "first_name", confidence: 0.90, evidence, isNegative: false };
    }
    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.last_name)) {
      evidence.push("textarea with last name label/placeholder");
      return { fieldType: "last_name", confidence: 0.90, evidence, isNegative: false };
    }
    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.full_name)) {
      evidence.push("textarea with name label/placeholder");
      return { fieldType: "full_name", confidence: 0.90, evidence, isNegative: false };
    }
    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.phone)) {
      evidence.push("textarea with phone label/placeholder");
      return { fieldType: "phone", confidence: 0.90, evidence, isNegative: false };
    }
    if (matchSynonyms(text, MULTILINGUAL_SYNONYMS.message)) {
      evidence.push("textarea with message label/placeholder");
      return { fieldType: "message", confidence: 0.95, evidence, isNegative: false };
    }
    return { fieldType: "message", confidence: 0.85, evidence, isNegative: false };
  }

  // 3. Multi-Signal Semantic Text Matching
  const primarySignalsText = [
    signals.explicitLabel,
    ...signals.associatedLabels,
    signals.surroundingLabel,
    signals.placeholder,
    signals.ariaLabel
  ].filter(Boolean).join(" ");

  const technicalIdentifiers = [signals.name, signals.id, signals.dataAttributes].filter(Boolean).join(" ");

  const contextualText = [
    signals.precedingSiblingText,
    signals.followingSiblingText,
    signals.legendText,
    signals.parentContainerText
  ].filter(Boolean).join(" ");

  const CANDIDATE_TYPES: Exclude<SemanticFieldType, "unknown" | "honeypot" | "consent" | "newsletter" | "attachment">[] = [
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone",
    "company",
    "website",
    "subject",
    "message",
    "city",
    "state",
    "postal_code",
    "country",
    "address",
    "job_title",
    "budget",
    "service_interest",
    "referral_source",
    "industry",
    "company_size",
    "date",
    "time"
  ];

  // PASS 1: Check primary signals (explicit label, placeholder, aria-label) across all candidate types
  for (const type of CANDIDATE_TYPES) {
    const patterns = MULTILINGUAL_SYNONYMS[type];
    if (matchSynonyms(primarySignalsText, patterns)) {
      if (type === "full_name" && /\b(company|business|firm|enterprise)\b/i.test(primarySignalsText || technicalIdentifiers)) {
        evidence.push("contains company qualifier");
        return { fieldType: "company", confidence: 0.85, evidence, isNegative: false };
      }
      evidence.push(`primary label/placeholder matched ${type}`);
      return { fieldType: type, confidence: 0.92, evidence, isNegative: false };
    }
  }

  // PASS 2: Check technical identifiers (name, id attributes) across all candidate types
  for (const type of CANDIDATE_TYPES) {
    const patterns = MULTILINGUAL_SYNONYMS[type];
    if (matchSynonyms(technicalIdentifiers, patterns)) {
      if (type === "full_name" && /\b(company|business|firm|enterprise)\b/i.test(primarySignalsText || technicalIdentifiers)) {
        evidence.push("contains company qualifier");
        return { fieldType: "company", confidence: 0.85, evidence, isNegative: false };
      }
      evidence.push(`name/id attribute matched ${type}`);
      return { fieldType: type, confidence: 0.88, evidence, isNegative: false };
    }
  }

  // PASS 3: Check contextual container text (only as low-confidence fallback when primary/technical did not match)
  for (const type of CANDIDATE_TYPES) {
    const patterns = MULTILINGUAL_SYNONYMS[type];
    if (matchSynonyms(contextualText, patterns)) {
      if (type === "full_name" && /\b(company|business|firm|enterprise)\b/i.test(primarySignalsText || technicalIdentifiers)) {
        evidence.push("contains company qualifier");
        return { fieldType: "company", confidence: 0.85, evidence, isNegative: false };
      }
      evidence.push(`contextual container matched ${type}`);
      return { fieldType: type, confidence: 0.70, evidence, isNegative: false };
    }
  }

  // 4. Structural Form-Order Fallback (When labels are weak/absent or non-standard, e.g. name="field_1")
  if (allFormSignals.length >= 2 && (signals.tagName === "input" && (signals.type === "text" || !signals.type))) {
    const emailIndex = allFormSignals.findIndex((s) => s.type === "email" || matchSynonyms([s.name, s.id, s.placeholder, s.explicitLabel].join(" "), MULTILINGUAL_SYNONYMS.email));

    if (emailIndex >= 0) {
      const textInputsBeforeEmail = allFormSignals
        .slice(0, emailIndex)
        .filter((s) => s.tagName === "input" && (s.type === "text" || !s.type));

      if (textInputsBeforeEmail.length === 1 && textInputsBeforeEmail[0].index === signals.index) {
        evidence.push("structural fallback: single text field before email -> full_name");
        return { fieldType: "full_name", confidence: 0.72, evidence, isNegative: false };
      }
      if (textInputsBeforeEmail.length === 2) {
        if (textInputsBeforeEmail[0].index === signals.index) {
          evidence.push("structural fallback: first text field before email -> first_name");
          return { fieldType: "first_name", confidence: 0.70, evidence, isNegative: false };
        }
        if (textInputsBeforeEmail[1].index === signals.index) {
          evidence.push("structural fallback: second text field before email -> last_name");
          return { fieldType: "last_name", confidence: 0.70, evidence, isNegative: false };
        }
      }
    }
  }

  return {
    fieldType: "unknown",
    confidence: 0,
    evidence: ["no confident semantic or structural match"],
    isNegative: false
  };
}

export function classifyAllFormFields(signalsList: FieldSignals[]): Map<number, FieldClassification> {
  const classifications = new Map<number, FieldClassification>();
  for (const signals of signalsList) {
    classifications.set(signals.index, classifyField(signals, signalsList));
  }
  return classifications;
}
