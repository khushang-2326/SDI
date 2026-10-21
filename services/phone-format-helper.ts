import type { Locator } from "playwright";

/**
 * Universal Mobile / Phone Number Formatter & Requirement Resolver.
 * 
 * Supports all standard formats of mobile numbers entered by users:
 * - Raw 10-digits: 1234567890
 * - Dashed US: 123-456-7890
 * - Standard Parentheses: (123) 456-7890
 * - Tight Parentheses: (123)456-7890
 * - Dotted: 123.456.7890
 * - Spaced: 123 456 7890
 * - International E.164: +11234567890
 * - International Spaced: +1 123 456 7890
 * - International Dashed: +1-123-456-7890
 * - International Parentheses: +1 (123) 456-7890
 * - 11-digit US: 11234567890
 * - 11-digit Dashed: 1-123-456-7890
 * 
 * Dynamically resolves the optimal format based on website requirements:
 * - HTML5 `pattern` attribute regex matching
 * - `maxlength` / `minlength` limits
 * - `type="number"` / `inputmode="numeric"`
 * - `placeholder` formatting hints
 * - Input mask libraries (Cleave, IMask, jQuery Mask)
 * - Live in-browser `checkValidity()` verification
 */

export interface PhoneFormats {
  raw10: string;
  dashed: string;
  paren: string;
  parenTight: string;
  dotted: string;
  spaced: string;
  e164: string;
  intlSpaced: string;
  intlDashed: string;
  intlParen: string;
  raw11: string;
  dashed11: string;
  area: string;
  prefix: string;
  line: string;
  countryCode: string;
  original: string;
  allOrdered: string[];
}

export function buildAllPhoneFormats(inputPhone: string): PhoneFormats {
  const original = (inputPhone || "").trim();
  const digits = original.replace(/\D/g, "");

  let area = "555";
  let prefix = "234";
  let line = "5678";
  let countryCode = "1";

  if (digits.length === 10) {
    area = digits.slice(0, 3);
    prefix = digits.slice(3, 6);
    line = digits.slice(6, 10);
    countryCode = "1";
  } else if (digits.length === 11 && digits.startsWith("1")) {
    countryCode = "1";
    area = digits.slice(1, 4);
    prefix = digits.slice(4, 7);
    line = digits.slice(7, 11);
  } else if (digits.length > 10) {
    // International numbers
    const last10 = digits.slice(-10);
    area = last10.slice(0, 3);
    prefix = last10.slice(3, 6);
    line = last10.slice(6, 10);
    countryCode = digits.slice(0, digits.length - 10) || "1";
  } else if (digits.length === 7) {
    area = "555";
    prefix = digits.slice(0, 3);
    line = digits.slice(3, 7);
  } else if (digits.length > 0) {
    const padded = digits.padEnd(10, "0");
    area = padded.slice(0, 3);
    prefix = padded.slice(3, 6);
    line = padded.slice(6, 10);
  }

  const raw10 = `${area}${prefix}${line}`;
  const dashed = `${area}-${prefix}-${line}`;
  const paren = `(${area}) ${prefix}-${line}`;
  const parenTight = `(${area})${prefix}-${line}`;
  const dotted = `${area}.${prefix}.${line}`;
  const spaced = `${area} ${prefix} ${line}`;
  const e164 = `+${countryCode}${raw10}`;
  const intlSpaced = `+${countryCode} ${area} ${prefix} ${line}`;
  const intlDashed = `+${countryCode}-${area}-${prefix}-${line}`;
  const intlParen = `+${countryCode} (${area}) ${prefix}-${line}`;
  const raw11 = `${countryCode}${raw10}`;
  const dashed11 = `${countryCode}-${area}-${prefix}-${line}`;

  // Unique list of candidate formats in priority order
  const allOrdered = [
    paren,        // (123) 456-7890 (Most common US form format)
    dashed,       // 123-456-7890
    raw10,        // 1234567890 (Digits only)
    e164,         // +11234567890 (International E.164)
    intlParen,    // +1 (123) 456-7890
    intlSpaced,   // +1 123 456 7890
    intlDashed,   // +1-123-456-7890
    dotted,       // 123.456.7890
    parenTight,   // (123)456-7890
    spaced,       // 123 456 7890
    raw11,        // 11234567890
    dashed11,     // 1-123-456-7890
    original      // Original user entry
  ];

  return {
    raw10,
    dashed,
    paren,
    parenTight,
    dotted,
    spaced,
    e164,
    intlSpaced,
    intlDashed,
    intlParen,
    raw11,
    dashed11,
    area,
    prefix,
    line,
    countryCode,
    original,
    allOrdered
  };
}

export interface InputPhoneAttributes {
  pattern?: string;
  placeholder?: string;
  maxlength?: number;
  minlength?: number;
  type?: string;
  inputmode?: string;
  name?: string;
  id?: string;
  ariaLabel?: string;
  hasMask?: boolean;
}

/**
 * Pure heuristic format picker based on DOM element attributes.
 */
export function pickOptimalPhoneFormat(
  formats: PhoneFormats,
  attrs: InputPhoneAttributes
): string {
  const p = (attrs.pattern || "").trim();
  const ph = (attrs.placeholder || "").trim();
  const max = attrs.maxlength && attrs.maxlength > 0 ? attrs.maxlength : 999;
  const isNumericOnly = attrs.type === "number" || attrs.inputmode === "numeric" || /numeric|digits[ _-]?only/i.test(attrs.ariaLabel || "");

  // 1. If an input mask library is active, feeding raw digits allows the mask to format naturally
  if (attrs.hasMask) {
    return formats.raw10;
  }

  // 2. Numeric inputs or strict 10-char limit
  if (isNumericOnly || max === 10) {
    return formats.raw10;
  }
  if (max === 11) {
    return formats.raw11;
  }

  // 3. Match against explicit regex pattern attribute
  if (p) {
    try {
      const rx = new RegExp(p);
      for (const fmt of formats.allOrdered) {
        if (fmt.length <= max && rx.test(fmt)) {
          return fmt;
        }
      }
    } catch {
      // Invalid pattern regex, continue
    }
  }

  // 4. Match against placeholder hint
  if (ph) {
    if (ph.includes("(") && ph.includes(")")) {
      if (ph.includes("+")) return formats.intlParen;
      if (ph.includes(") ")) return formats.paren;
      return formats.parenTight;
    }
    if (ph.includes(".")) {
      return formats.dotted;
    }
    if (ph.includes("+")) {
      if (ph.includes("-")) return formats.intlDashed;
      if (ph.includes(" ")) return formats.intlSpaced;
      return formats.e164;
    }
    if (ph.includes("-")) {
      if (ph.startsWith("1-")) return formats.dashed11;
      return formats.dashed;
    }
    if (ph.includes(" ")) {
      return formats.spaced;
    }
    if (/^\d{10}$/.test(ph.replace(/\D/g, "")) && !/\W/.test(ph)) {
      return formats.raw10;
    }
  }

  // 5. Length restrictions
  if (max < formats.paren.length && max >= formats.dashed.length) {
    return formats.dashed;
  }
  if (max < formats.dashed.length && max >= formats.raw10.length) {
    return formats.raw10;
  }

  // 6. Default standard: (123) 456-7890
  return formats.paren;
}

/**
 * Resolves the optimal phone format for a Playwright Locator by inspecting element
 * attributes and testing against the browser's live constraint validation engine.
 */
export async function resolveOptimalPhoneValue(
  locator: Locator,
  rawPhone: string
): Promise<string> {
  const formats = buildAllPhoneFormats(rawPhone);

  const attrs = await locator.evaluate((el: HTMLElement) => {
    const input = el as HTMLInputElement;
    const style = window.getComputedStyle(input);
    return {
      pattern: input.getAttribute("pattern") || "",
      placeholder: input.getAttribute("placeholder") || "",
      maxlength: input.maxLength > 0 ? input.maxLength : 0,
      minlength: input.minLength > 0 ? input.minLength : 0,
      type: (input.getAttribute("type") || "").toLowerCase(),
      inputmode: (input.getAttribute("inputmode") || "").toLowerCase(),
      name: (input.getAttribute("name") || "").toLowerCase(),
      id: (input.id || "").toLowerCase(),
      ariaLabel: (input.getAttribute("aria-label") || "").toLowerCase(),
      hasMask: Boolean(
        (input as any).inputmask ||
        input.dataset.mask ||
        input.className?.includes("mask") ||
        input.getAttribute("data-inputmask")
      )
    };
  }).catch(() => null);

  if (!attrs) return formats.paren;

  const heuristicOptimal = pickOptimalPhoneFormat(formats, attrs);

  // Live in-browser validation test: verify if heuristicOptimal passes checkValidity()
  const testedFormat = await locator.evaluate((el: HTMLElement, { heuristic, candidates }: { heuristic: string; candidates: string[] }) => {
    const input = el as HTMLInputElement;
    if (!input || typeof input.checkValidity !== "function") return heuristic;

    const max = input.maxLength > 0 ? input.maxLength : 999;
    const testList = [heuristic, ...candidates.filter((c) => c !== heuristic)];

    for (const cand of testList) {
      if (cand.length > max) continue;
      const prevVal = input.value;
      input.value = cand;
      const valid = input.checkValidity();
      input.value = prevVal;
      if (valid) return cand;
    }

    return heuristic;
  }, { heuristic: heuristicOptimal, candidates: formats.allOrdered }).catch(() => heuristicOptimal);

  return testedFormat || heuristicOptimal;
}
