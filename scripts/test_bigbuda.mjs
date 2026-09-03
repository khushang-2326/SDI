import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable.ts";

async function run() {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  
  console.log("Navigating to https://bigbuda.cl/agendar...");
  await page.goto("https://bigbuda.cl/agendar", { waitUntil: "domcontentloaded", timeout: 30000 });

  const iframeLocator = page.locator('iframe[src*="calendly" i], iframe[title*="Calendly" i]').first();
  await iframeLocator.waitFor({ state: "attached", timeout: 15000 });
  const frameElement = await iframeLocator.elementHandle();
  const frame = await frameElement?.contentFrame();
  
  if (!frame) {
    console.error("Frame not found!");
    return;
  }

  console.log("Waiting for calendar availability...");
  await frame.locator('button[aria-label*="available" i], button[aria-label*="disponible" i], [data-testid*="day" i], [role="grid"]').first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);

  const buttons = frame.locator("button, [role='button']");
  const allButtons = await buttons.evaluateAll((elements) =>
    elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      const ariaLabel = element.getAttribute("aria-label") ?? "";
      const className = element.getAttribute("class") ?? "";
      const dataTestId = element.getAttribute("data-testid") ?? "";
      const disabled =
        element.disabled ||
        element.getAttribute("aria-disabled") === "true" ||
        element.getAttribute("disabled") !== null;

      return {
        index,
        text,
        ariaLabel,
        className,
        dataTestId,
        disabled,
        visible: rect.width > 0 && rect.height > 0
      };
    })
  );

  console.log("ALL buttons count:", allButtons.length);
  const visibleButtons = allButtons.filter(b => b.visible);
  console.log("Visible buttons:", visibleButtons);

  // Let's filter for date buttons
  const dateCandidates = visibleButtons.filter(b => {
    const hasDateSignal = /^\d{1,2}$/.test(b.text) || /\b(available|disponible|seleccione)\b.*\b\d{1,2}\b/i.test(b.ariaLabel) || /\b\d{1,2}\b.*\b(available|disponible|seleccione)\b/i.test(b.ariaLabel);
    const explicitlyUnavailable = /\b(no\s+times?\s+available|no\s+disponible|sin\s+horas\s+disponibles)\b/i.test(`${b.ariaLabel} ${b.className}`);
    return !b.disabled && !explicitlyUnavailable && hasDateSignal;
  });

  console.log("Date candidates found:", dateCandidates);

  if (dateCandidates.length > 0) {
    const chosenDate = dateCandidates[0];
    console.log("Clicking date:", chosenDate);
    await buttons.nth(chosenDate.index).click();
    await page.waitForTimeout(3000);

    const buttonsAfterDate = await buttons.evaluateAll((elements) =>
      elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        const ariaLabel = element.getAttribute("aria-label") ?? "";
        const className = element.getAttribute("class") ?? "";
        return {
          index,
          text,
          ariaLabel,
          className,
          visible: rect.width > 0 && rect.height > 0
        };
      })
    );
    console.log("Buttons after date click (visible):", buttonsAfterDate.filter(b => b.visible));

    // Look for time slots
    const timeCandidates = buttonsAfterDate.filter(b => b.visible && (
      /^\s*(\d{1,2}:\d{2}(\s*(am|pm|hrs?|h))?|\d{1,2}\s*(am|pm))\s*$/i.test(b.text) ||
      /\b\d{1,2}(:\d{2})?\s*(am|pm|hrs?|h)\b/i.test(b.ariaLabel) ||
      /\b\d{1,2}:\d{2}\b/.test(b.text)
    ));
    console.log("Time candidates found:", timeCandidates);

    if (timeCandidates.length > 0) {
      console.log("Clicking time slot:", timeCandidates[0]);
      await buttons.nth(timeCandidates[0].index).click();
      await page.waitForTimeout(3000);

      const buttonsAfterTime = await buttons.evaluateAll((elements) =>
        elements.map((element, index) => ({
          index,
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
          ariaLabel: element.getAttribute("aria-label") ?? "",
          visible: element.getBoundingClientRect().width > 0
        }))
      );
      console.log("Buttons after time click:", buttonsAfterTime.filter(b => b.visible));

      // Click Next / Siguiente
      const nextBtn = frame.locator("button, [role='button']").filter({ hasText: /siguiente|next|continue|confirm|avanzar|confirmar/i }).first();
      if (await nextBtn.count() > 0 && await nextBtn.isVisible()) {
        console.log("Clicking next button:", await nextBtn.innerText());
        await nextBtn.click();
        await page.waitForTimeout(4000);
      }

      // Check form fields
      const inputs = await frame.locator("input, textarea, select").evaluateAll(els => els.map(e => ({
        tagName: e.tagName,
        type: e.type,
        name: e.name,
        id: e.id,
        placeholder: e.placeholder,
        ariaLabel: e.getAttribute("aria-label"),
        visible: e.getBoundingClientRect().width > 0
      })));
      console.log("Form inputs:", JSON.stringify(inputs, null, 2));

      // Check form text
      const formText = await frame.locator("body").innerText();
      console.log("Form text:", formText.slice(0, 500));
    }
  }

  await browser.close();
}

run().catch(console.error);
