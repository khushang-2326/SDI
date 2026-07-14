import { chromium, type Browser, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";

let browserInstance: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;
let contextCount = 0;
const MAX_CONTEXTS_PER_BROWSER = 50;

async function launchBrowser(): Promise<Browser> {
  const executablePath = await getChromiumExecutablePath();
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu"
    ]
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  const browser = await chromium.launch(launchOptions);
  return browser;
}

export async function getBrowser(): Promise<Browser> {
  // If the browser is disconnected or has handled too many contexts, recycle it
  if (browserInstance && (!browserInstance.isConnected() || contextCount >= MAX_CONTEXTS_PER_BROWSER)) {
    console.log(`[BrowserPool] Recycling browser instance. Contexts handled: ${contextCount}`);
    await browserInstance.close().catch(() => undefined);
    browserInstance = null;
    contextCount = 0;
  }

  if (browserInstance) {
    return browserInstance;
  }

  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = launchBrowser().then((browser) => {
    browserInstance = browser;
    launchPromise = null;
    return browser;
  }).catch((err) => {
    launchPromise = null;
    throw err;
  });

  return launchPromise;
}

/**
 * Creates and returns a new BrowserContext from the browser pool.
 */
export async function acquireContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  contextCount++;
  return context;
}

/**
 * Safely closes a context and handles browser error tracking.
 */
export async function releaseContext(context: BrowserContext): Promise<void> {
  if (context) {
    await context.close().catch(() => undefined);
  }
}

/**
 * Closes the browser pool entirely on worker shutdown.
 */
export async function closePool(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => undefined);
    browserInstance = null;
    contextCount = 0;
  }
}
