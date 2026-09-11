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
  | "date"
  | "time"
  | "preferred_contact_method"
  | "consent"
  | "newsletter"
  | "attachment"
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

export interface FormFillMetrics {
  filledFieldsCount: number;
  verifiedFieldsCount: number;
  unmappedRequiredFields: string[];
  unmappedOptionalFields: string[];
  items: FieldVerificationItem[];
}

export const COMMON_INPUT_SELECTOR = [
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset'])",
  "textarea",
  "select"
].join(",");

// Regex for controls that must NEVER be filled with lead data
const NEGATIVE_FIELD_PATTERN = /\b(password|passwd|pwd|passcode|search|query|find|coupon|promo|voucher|discount|captcha|recaptcha|turnstile|hcaptcha|cf-turnstile|botcheck|honeypot|filter|search-input|site-search)\b/i;

// Compact normalized multilingual token patterns across EN, ES, FR, DE, IT, PT, NL
const MULTILINGUAL_SYNONYMS: Record<Exclude<SemanticFieldType, "unknown">, RegExp[]> = {
  first_name: [
    /\b(first[ _-]?name|firstname|fname|given[ _-]?name|forename)\b/i,
    /\b(prenom|vorname|nombre|nome|primeiro[ _-]?nome|voornaam)\b/i
  ],
  last_name: [
    /\b(last[ _-]?name|lastname|lname|surname|family[ _-]?name)\b/i,
    /\b(nom[ _-]?de[ _-]?famille|nachname|familienname|apellido|cognome|sobrenome|achternaam)\b/i
  ],
  full_name: [
    /\b(full[ _-]?name|fullname|your[ _-]?name|contact[ _-]?name|complete[ _-]?name)\b/i,
    /\b(nom[ _-]?complet|vollstaendiger[ _-]?name|voller[ _-]?name|nombre[ _-]?completo|nome[ _-]?completo|volledige[ _-]?naam)\b/i,
    // Generic "name" with boundary check (not company name, user name, etc., handling optional trailing required asterisk)
    /(?<!(company|business|user|file|brand|org|organisation)[ _-])\b(name|nom|nombre|nome|naam)\b(?![ _-]?(of|company|business|user))/i,
    /\b(ihr[ _-]?name|votre[ _-]?nom|su[ _-]?nombre|il[ _-]?tuo[ _-]?nome|uw[ _-]?naam)\b/i
  ],
  email: [
    /\b(e-?mail|emailaddress|email[ _-]?address|work[ _-]?email|business[ _-]?email)\b/i,
    /\b(courriel|correo|correo[ _-]?electronico|indirizzo[ _-]?email|e-post|e-mailadresse)\b/i
  ],
  phone: [
    /\b(phone|telephone|tel|mobile|cell|cellphone|contact[ _-]?number|phone[ _-]?number|mobile[ _-]?number)\b/i,
    /\b(telefon|telephone|telefono|numero[ _-]?telefono|celular|telefone|telefoonnummer)\b/i
  ],
  company: [
    /\b(company|business|organization|organisation|brand|firm|agency|enterprise)\b/i,
    /\b(company[ _-]?name|business[ _-]?name|firm[ _-]?name)\b/i,
    /\b(societe|entreprise|unternehmen|firma|empresa|azienda|bedrijf|bedrijfsnaam)\b/i
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
    /\b(address|street|street[ _-]?address|addr|location)\b/i,
    /\b(adresse|strasse|str\.|direccion|indirizzo|endereco|adres)\b/i
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
    /\b(subject|regarding|topic|reason[ _-]?for[ _-]?contact)\b/i,
    /\b(sujet|betreff|asunto|oggetto|assunto|onderwerp)\b/i
  ],
  message: [
    /\b(message|comment|comments|note|notes|details|description|project[ _-]?details|how[ _-]?can[ _-]?we[ _-]?help|brief|tell[ _-]?us)\b/i,
    /\b(nachricht|mitteilung|mensaje|messaggio|mensagem|bericht|opmerkingen)\b/i
  ],
  inquiry: [
    /\b(enquiry|inquiry|consultation|request|question|demande|anfrage|consulta|richiesta)\b/i
  ],
  budget: [
    /\b(budget|estimated[ _-]?budget|price[ _-]?range|investment)\b/i,
    /\b(tarif|kosten|presupuesto|preventivo|orcamento)\b/i
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
    /\b(j'accepte|ich[ _-]?stimme[ _-]?zu|acepto|acconsento|concordo|akkoord)\b/i
  ],
  newsletter: [
    /\b(newsletter|subscribe|subscription|marketing[ _-]?emails|keep[ _-]?me[ _-]?updated|promotions)\b/i,
    /\b(abonner|abonnieren|suscribir|iscriviti)\b/i
  ],
  attachment: [
    /\b(attachment|attach|upload|file|resume|cv|document)\b/i,
    /\b(fichier|datei|anhang|archivo|allegato|bestand)\b/i
  ]
};

export function splitFullName(fullName: string): { firstName: string; middleName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: parts[0] };
  if (parts.length === 2) return { firstName: parts[0], middleName: "", lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1]
  };
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

      // Explicit labels (<label for="id">)
      let explicitLabel = "";
      if (id) {
        try {
          const el = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (el) explicitLabel = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        } catch {
          // ignore selector escape errors
        }
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

      // Immediate parent container text (limited to 150 chars to avoid giant block noise)
      const parentContainer = input.closest("div, p, li, td, tr, .form-group, .field, .form-field, .elementor-field-group, .hs-form-field");
      const parentContainerText = (parentContainer?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150);

      // Sibling texts
      const precedingSiblingText = (input.previousElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      const followingSiblingText = (input.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

      // Required state
      const isRequired = input.required ||
        input.getAttribute("aria-required") === "true" ||
        input.classList.contains("required") ||
        Boolean(parentContainer?.classList.contains("required")) ||
        parentContainerText.includes("*");

      // Disabled / Readonly
      const isDisabled = input.disabled || input.getAttribute("aria-disabled") === "true";
      const isReadOnly = (input as HTMLInputElement).readOnly || false;

      // Visibility & Position
      const style = window.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      const isVisible = style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0;

      // Select options
      let selectOptions: Array<{ text: string; value: string; disabled: boolean }> | undefined;
      if (tagName === "select") {
        const select = input as HTMLSelectElement;
        selectOptions = Array.from(select.options).map((opt) => ({
          text: (opt.textContent ?? "").replace(/\s+/g, " ").trim(),
          value: opt.value.trim(),
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
        ariaLabel,
        ariaLabelledby,
        autocomplete,
        title,
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

function matchSynonyms(text: string, patterns: RegExp[]): boolean {
  if (!text) return false;
  return patterns.some((regex) => regex.test(text));
}

export function classifyField(signals: FieldSignals, allFormSignals: FieldSignals[] = []): FieldClassification {
  const evidence: string[] = [];

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

  if (NEGATIVE_FIELD_PATTERN.test(combinedAttributes)) {
    const match = combinedAttributes.match(NEGATIVE_FIELD_PATTERN)?.[0] ?? "negative";
    return {
      fieldType: "unknown",
      confidence: 0,
      evidence: [`negative match: ${match}`],
      isNegative: true,
      negativeReason: `matches negative pattern: ${match}`
    };
  }

  // Check for search type
  if (signals.type === "search" || signals.ariaLabel.toLowerCase().includes("search") || signals.placeholder.toLowerCase().includes("search")) {
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

  // Checkbox consent handling
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

  const technicalIdentifiers = [signals.name, signals.id].filter(Boolean).join(" ");

  const contextualText = [
    signals.precedingSiblingText,
    signals.followingSiblingText,
    signals.legendText,
    signals.parentContainerText
  ].filter(Boolean).join(" ");

  const testCandidate = (type: Exclude<SemanticFieldType, "unknown">): { matched: boolean; conf: number; ev: string } => {
    const patterns = MULTILINGUAL_SYNONYMS[type];

    if (matchSynonyms(primarySignalsText, patterns)) {
      return { matched: true, conf: 0.92, ev: `primary label/placeholder matched ${type}` };
    }

    if (matchSynonyms(technicalIdentifiers, patterns)) {
      return { matched: true, conf: 0.88, ev: `name/id attribute matched ${type}` };
    }

    if (matchSynonyms(contextualText, patterns)) {
      return { matched: true, conf: 0.70, ev: `contextual container matched ${type}` };
    }

    return { matched: false, conf: 0, ev: "" };
  };

  const firstNameTest = testCandidate("first_name");
  if (firstNameTest.matched) {
    evidence.push(firstNameTest.ev);
    return { fieldType: "first_name", confidence: firstNameTest.conf, evidence, isNegative: false };
  }

  const lastNameTest = testCandidate("last_name");
  if (lastNameTest.matched) {
    evidence.push(lastNameTest.ev);
    return { fieldType: "last_name", confidence: lastNameTest.conf, evidence, isNegative: false };
  }

  const fullNameTest = testCandidate("full_name");
  if (fullNameTest.matched) {
    if (/\b(company|business|firm|enterprise)\b/i.test(primarySignalsText || technicalIdentifiers)) {
      evidence.push("contains company qualifier");
      return { fieldType: "company", confidence: 0.85, evidence, isNegative: false };
    }
    evidence.push(fullNameTest.ev);
    return { fieldType: "full_name", confidence: fullNameTest.conf, evidence, isNegative: false };
  }

  const emailTest = testCandidate("email");
  if (emailTest.matched) {
    evidence.push(emailTest.ev);
    return { fieldType: "email", confidence: emailTest.conf, evidence, isNegative: false };
  }

  const phoneTest = testCandidate("phone");
  if (phoneTest.matched) {
    evidence.push(phoneTest.ev);
    return { fieldType: "phone", confidence: phoneTest.conf, evidence, isNegative: false };
  }

  const companyTest = testCandidate("company");
  if (companyTest.matched) {
    evidence.push(companyTest.ev);
    return { fieldType: "company", confidence: companyTest.conf, evidence, isNegative: false };
  }

  const websiteTest = testCandidate("website");
  if (websiteTest.matched) {
    evidence.push(websiteTest.ev);
    return { fieldType: "website", confidence: websiteTest.conf, evidence, isNegative: false };
  }

  const subjectTest = testCandidate("subject");
  if (subjectTest.matched) {
    evidence.push(subjectTest.ev);
    return { fieldType: "subject", confidence: subjectTest.conf, evidence, isNegative: false };
  }

  const messageTest = testCandidate("message");
  if (messageTest.matched) {
    evidence.push(messageTest.ev);
    return { fieldType: "message", confidence: messageTest.conf, evidence, isNegative: false };
  }

  for (const locType of ["city", "state", "postal_code", "country", "address"] as const) {
    const test = testCandidate(locType);
    if (test.matched) {
      evidence.push(test.ev);
      return { fieldType: locType, confidence: test.conf, evidence, isNegative: false };
    }
  }

  const jobTitleTest = testCandidate("job_title");
  if (jobTitleTest.matched) {
    evidence.push(jobTitleTest.ev);
    return { fieldType: "job_title", confidence: jobTitleTest.conf, evidence, isNegative: false };
  }

  const budgetTest = testCandidate("budget");
  if (budgetTest.matched) {
    evidence.push(budgetTest.ev);
    return { fieldType: "budget", confidence: budgetTest.conf, evidence, isNegative: false };
  }

  const dateTest = testCandidate("date");
  if (dateTest.matched) {
    evidence.push(dateTest.ev);
    return { fieldType: "date", confidence: dateTest.conf, evidence, isNegative: false };
  }

  const timeTest = testCandidate("time");
  if (timeTest.matched) {
    evidence.push(timeTest.ev);
    return { fieldType: "time", confidence: timeTest.conf, evidence, isNegative: false };
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
