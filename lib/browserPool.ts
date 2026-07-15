import { chromium, type Browser, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";

type BrowserMode = "headless" | "headed";

type PooledBrowser = {
  browser: Browser | null;
  launchPromise: Promise<Browser> | null;
  contextCount: number;
};

const browserPools: Record<BrowserMode, PooledBrowser> = {
  headless: { browser: null, launchPromise: null, contextCount: 0 },
  headed: { browser: null, launchPromise: null, contextCount: 0 }
};
const MAX_CONTEXTS_PER_BROWSER = 50;

async function launchBrowser(headless: boolean): Promise<Browser> {
  const executablePath = await getChromiumExecutablePath();
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless,
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

export async function getBrowser(headless = true): Promise<Browser> {
  const mode: BrowserMode = headless ? "headless" : "headed";
  const pool = browserPools[mode];
  // If the browser is disconnected or has handled too many contexts, recycle it
  if (pool.browser && (!pool.browser.isConnected() || pool.contextCount >= MAX_CONTEXTS_PER_BROWSER)) {
    console.log(`[BrowserPool] Recycling ${mode} browser instance. Contexts handled: ${pool.contextCount}`);
    await pool.browser.close().catch(() => undefined);
    pool.browser = null;
    pool.contextCount = 0;
  }

  if (pool.browser) {
    return pool.browser;
  }

  if (pool.launchPromise) {
    return pool.launchPromise;
  }

  pool.launchPromise = launchBrowser(headless).then((browser) => {
    pool.browser = browser;
    pool.launchPromise = null;
    return browser;
  }).catch((err) => {
    pool.launchPromise = null;
    throw err;
  });

  return pool.launchPromise;
}

/**
 * Creates and returns a new BrowserContext from the browser pool.
 */
export async function acquireContext(options: { headless?: boolean } = {}): Promise<BrowserContext> {
  const headless = options.headless ?? true;
  const browser = await getBrowser(headless);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  browserPools[headless ? "headless" : "headed"].contextCount++;
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
  for (const pool of Object.values(browserPools)) {
    if (pool.browser) {
      await pool.browser.close().catch(() => undefined);
      pool.browser = null;
      pool.contextCount = 0;
    }
  }
}
