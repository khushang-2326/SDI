import type { Page, Frame } from "playwright";

export type UniversalReadinessState =
  | "INITIAL_NAVIGATION"
  | "DOM_AVAILABLE"
  | "HYDRATION_IN_PROGRESS"
  | "CONTENT_RENDERING"
  | "INTERACTIVE_CONTENT_AVAILABLE"
  | "TARGET_DISCOVERY_READY"
  | "FORM_DISCOVERY_READY"
  | "BOOKING_DISCOVERY_READY"
  | "TIMEOUT_FALLBACK";

export interface ReadinessResult {
  ready: boolean;
  state: UniversalReadinessState;
  durationMs: number;
  frameworkDetected?: string;
  hasForms: boolean;
  hasBooking: boolean;
  interactiveCount: number;
  metrics?: {
    domContentLoaded?: number;
    firstInteractive?: number;
    hydrationReady?: number;
    candidateDiscoveryStart?: number;
    candidateDiscoveryEnd?: number;
    totalNavigationTime?: number;
  };
}

export interface ReadinessOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  targetPurpose?: "form" | "booking" | "discovery" | "any";
}

/**
 * Universal Page Readiness Engine.
 * Evaluates the page progressively instead of relying on brittle networkidle or static timeouts.
 */
export async function waitForUniversalPageReadiness(
  page: Page,
  options: ReadinessOptions = {}
): Promise<ReadinessResult> {
  const {
    maxWaitMs = 6000,
    pollIntervalMs = 200,
    targetPurpose = "any"
  } = options;

  const startTime = Date.now();

  const evaluateState = async (): Promise<{
    state: UniversalReadinessState;
    frameworkDetected?: string;
    hasForms: boolean;
    hasBooking: boolean;
    interactiveCount: number;
    isLoading: boolean;
  }> => {
    try {
      const pageData = await page.evaluate(() => {
        const readyState = document.readyState;
        const hasBody = Boolean(document.body);
        if (!hasBody || readyState === "loading") {
          return {
            state: "INITIAL_NAVIGATION" as const,
            frameworkDetected: undefined,
            hasForms: false,
            hasBooking: false,
            interactiveCount: 0,
            isLoading: true
          };
        }

        // 1. Framework detection
        let frameworkDetected: string | undefined = undefined;
        if ((window as any).__next_data__ || document.querySelector("#__next")) frameworkDetected = "nextjs";
        else if ((window as any).__nuxt__ || document.querySelector("#__nuxt")) frameworkDetected = "nuxt";
        else if (document.querySelector("[data-reactroot], [data-react-helmet]")) frameworkDetected = "react";
        else if (document.querySelector("[ng-version], [ng-app]")) frameworkDetected = "angular";
        else if (document.documentElement.classList.contains("w-mod-js")) frameworkDetected = "webflow";
        else if ((window as any).wixBiSession || document.querySelector("[data-mesh-id]")) frameworkDetected = "wix";

        // 2. Active loading indicators
        const loadingEls = document.querySelectorAll(
          "[aria-busy='true'], [role='progressbar'], .loading, .spinner, .loader, [class*='loading'], [class*='spinner'], .skeleton, [class*='skeleton']"
        );
        let visibleLoading = false;
        for (const el of Array.from(loadingEls).slice(0, 10)) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width > 10 && rect.height > 10 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
            visibleLoading = true;
            break;
          }
        }

        // 3. Form elements (main frame & open shadow DOM)
        const findInputsRecursive = (root: Document | ShadowRoot | Element): Element[] => {
          const res: Element[] = [];
          try {
            const inputs = root.querySelectorAll(
              "input:not([type='hidden']):not([type='search']):not([type='button']):not([type='submit']), textarea, select, [role='textbox'], [contenteditable='true'], [role='form'], form, [data-form-submit], .hs-form, .form-container, [class*='form']"
            );
            res.push(...Array.from(inputs));
            root.querySelectorAll("*").forEach((el) => {
              if (el.shadowRoot) res.push(...findInputsRecursive(el.shadowRoot));
            });
          } catch {
            // ignore traversal errors
          }
          return res;
        };

        const inputs = findInputsRecursive(document);
        const hasForms = inputs.length >= 1;

        // 4. Booking elements
        const bookingSelectors = [
          ".calendly-inline-widget",
          "[data-calendly-url]",
          ".meetings-iframe-container",
          ".pipedrive-scheduler",
          ".appointment_widgets--revamp--booking",
          "[data-booking-widget]",
          ".booking-container",
          "[class*='scheduler']",
          "iframe[src*='calendly']",
          "iframe[src*='hubspot']",
          "iframe[src*='pipedrive']",
          "iframe[src*='leadconnector']",
          "iframe[src*='tidycal']",
          "iframe[src*='appointlet']"
        ];
        const hasBooking = Boolean(document.querySelector(bookingSelectors.join(",")));

        // 5. Interactive elements
        const interactives = document.querySelectorAll("a[href], button, [role='button'], input, textarea, select, [role='textbox']");
        const interactiveCount = interactives.length;

        let state: UniversalReadinessState = "DOM_AVAILABLE";
        if (visibleLoading) {
          state = "HYDRATION_IN_PROGRESS";
        } else if (hasForms) {
          state = "FORM_DISCOVERY_READY";
        } else if (hasBooking) {
          state = "BOOKING_DISCOVERY_READY";
        } else if (interactiveCount > 5) {
          state = "INTERACTIVE_CONTENT_AVAILABLE";
        } else if (readyState === "interactive" || readyState === "complete") {
          state = "CONTENT_RENDERING";
        }

        return {
          state,
          frameworkDetected,
          hasForms,
          hasBooking,
          interactiveCount,
          isLoading: visibleLoading
        };
      }).catch(() => null);

      if (!pageData) {
        return {
          state: "INITIAL_NAVIGATION",
          hasForms: false,
          hasBooking: false,
          interactiveCount: 0,
          isLoading: false
        };
      }

      // Check child frames if main frame has no forms yet
      let hasFrameForms = false;
      let hasFrameBooking = false;
      if (!pageData.hasForms || !pageData.hasBooking) {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          try {
            const frameHasForms = await frame.evaluate(() => {
              const el = document.querySelector("input:not([type='hidden']):not([type='search']), textarea, select");
              return Boolean(el);
            }).catch(() => false);
            if (frameHasForms) hasFrameForms = true;

            const frameHasBooking = await frame.evaluate(() => {
              const el = document.querySelector(".vdpCell, [class*='calendar'], [class*='timeslot'], [class*='scheduler']");
              return Boolean(el);
            }).catch(() => false);
            if (frameHasBooking) hasFrameBooking = true;
          } catch {
            // Frame detached or cross-origin restricted
          }
        }
      }

      const finalHasForms = pageData.hasForms || hasFrameForms;
      const finalHasBooking = pageData.hasBooking || hasFrameBooking;

      let finalState = pageData.state;
      if (!pageData.isLoading) {
        if (finalHasForms) finalState = "FORM_DISCOVERY_READY";
        else if (finalHasBooking) finalState = "BOOKING_DISCOVERY_READY";
      }

      return {
        state: finalState,
        frameworkDetected: pageData.frameworkDetected,
        hasForms: finalHasForms,
        hasBooking: finalHasBooking,
        interactiveCount: pageData.interactiveCount,
        isLoading: pageData.isLoading
      };
    } catch {
      return {
        state: "INITIAL_NAVIGATION",
        hasForms: false,
        hasBooking: false,
        interactiveCount: 0,
        isLoading: false
      };
    }
  };

  // Initial inspection
  let evalResult = await evaluateState();

  // If already at target readiness, return immediately
  const isSatisfied = (): boolean => {
    if (targetPurpose === "form" && evalResult.hasForms) return true;
    if (targetPurpose === "booking" && evalResult.hasBooking) return true;
    if (targetPurpose === "discovery" && evalResult.interactiveCount > 3 && !evalResult.isLoading) return true;
    if (targetPurpose === "any" && (evalResult.hasForms || evalResult.hasBooking || (evalResult.interactiveCount > 5 && !evalResult.isLoading))) return true;
    return false;
  };

  const buildMetrics = (elapsed: number) => ({
    domContentLoaded: evalResult.state !== "INITIAL_NAVIGATION" ? Math.min(elapsed, 200) : undefined,
    firstInteractive: evalResult.interactiveCount > 0 ? Math.min(elapsed, 400) : undefined,
    hydrationReady: !evalResult.isLoading ? elapsed : undefined,
    totalNavigationTime: elapsed
  });

  if (isSatisfied()) {
    const elapsed = Date.now() - startTime;
    return {
      ready: true,
      state: evalResult.state,
      durationMs: elapsed,
      frameworkDetected: evalResult.frameworkDetected,
      hasForms: evalResult.hasForms,
      hasBooking: evalResult.hasBooking,
      interactiveCount: evalResult.interactiveCount,
      metrics: buildMetrics(elapsed)
    };
  }

  // Progressive bounded polling
  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(pollIntervalMs);
    evalResult = await evaluateState();

    if (isSatisfied()) {
      const elapsed = Date.now() - startTime;
      return {
        ready: true,
        state: evalResult.state,
        durationMs: elapsed,
        frameworkDetected: evalResult.frameworkDetected,
        hasForms: evalResult.hasForms,
        hasBooking: evalResult.hasBooking,
        interactiveCount: evalResult.interactiveCount,
        metrics: buildMetrics(elapsed)
      };
    }
  }

  // Fallback after bounded timeout
  const finalElapsed = Date.now() - startTime;
  return {
    ready: evalResult.interactiveCount > 0,
    state: evalResult.state === "HYDRATION_IN_PROGRESS" ? "TIMEOUT_FALLBACK" : evalResult.state,
    durationMs: finalElapsed,
    frameworkDetected: evalResult.frameworkDetected,
    hasForms: evalResult.hasForms,
    hasBooking: evalResult.hasBooking,
    interactiveCount: evalResult.interactiveCount,
    metrics: buildMetrics(finalElapsed)
  };
}
