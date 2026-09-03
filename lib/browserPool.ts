import { chromium, type Browser, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import type { ProxyConfig } from "@/lib/proxy/types";

type BrowserMode = "headless" | "headed";

type PooledBrowser = {
  browser: Browser | null;
  launchPromise: Promise<Browser> | null;
  activeContexts: number;
  contextsCreated: number;
};

const browserPools: Record<BrowserMode, PooledBrowser> = {
  headless: { browser: null, launchPromise: null, activeContexts: 0, contextsCreated: 0 },
  headed: { browser: null, launchPromise: null, activeContexts: 0, contextsCreated: 0 }
};
const contextModes = new WeakMap<BrowserContext, BrowserMode>();

async function launchBrowser(headless: boolean): Promise<Browser> {
  const executablePath = await getChromiumExecutablePath();
  const effectiveHeadless = process.env.NODE_ENV === "production" || (!process.env.DISPLAY && process.platform !== "win32") ? true : headless;
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: effectiveHeadless,
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
  // A healthy process is deliberately kept alive and shared by all jobs.
  if (pool.browser && !pool.browser.isConnected()) {
    pool.browser = null;
    pool.activeContexts = 0;
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
    console.log(`[BrowserPool] Started shared ${mode} Chromium process.`);
    return browser;
  }).catch((err) => {
    pool.launchPromise = null;
    throw err;
  });

  return pool.launchPromise;
}

export type AcquireContextOptions = {
  headless?: boolean;
  userId?: string;
  proxy?: Partial<ProxyConfig>;
  bandwidthSaver?: boolean;
};

/**
 * Resolves the effective proxy configuration for a browser session.
 */
async function resolveProxyConfig(options: AcquireContextOptions): Promise<{
  server?: string;
  username?: string;
  password?: string;
  bandwidthSaver: boolean;
} | null> {
  // 1. Explicit proxy passed in options
  if (options.proxy?.enabled && options.proxy.host && options.proxy.port) {
    const protocol = options.proxy.protocol || "http";
    return {
      server: `${protocol}://${options.proxy.host}:${options.proxy.port}`,
      username: options.proxy.username || undefined,
      password: options.proxy.password || undefined,
      bandwidthSaver: options.bandwidthSaver ?? options.proxy.bandwidthSaver ?? true
    };
  }

  // 2. User profile database proxy settings
  if (options.userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: options.userId },
        select: {
          proxyEnabled: true,
          proxyProtocol: true,
          proxyHost: true,
          proxyPort: true,
          proxyUsername: true,
          proxyPassword: true,
          proxyBandwidthSaver: true
        }
      });

      if (user?.proxyEnabled && user.proxyHost && user.proxyPort) {
        const protocol = user.proxyProtocol || "http";
        const password = user.proxyPassword ? decrypt(user.proxyPassword) : undefined;
        return {
          server: `${protocol}://${user.proxyHost}:${user.proxyPort}`,
          username: user.proxyUsername || undefined,
          password: password || undefined,
          bandwidthSaver: options.bandwidthSaver ?? user.proxyBandwidthSaver ?? true
        };
      }
    } catch (e) {
      console.warn("[BrowserPool] Failed to fetch user proxy settings:", e);
    }
  }

  // 3. Fallback to environment variable proxy config
  if (config.proxy?.enabled && config.proxy.host && config.proxy.port) {
    const protocol = config.proxy.protocol || "http";
    return {
      server: `${protocol}://${config.proxy.host}:${config.proxy.port}`,
      username: config.proxy.username || undefined,
      password: config.proxy.password || undefined,
      bandwidthSaver: options.bandwidthSaver ?? config.proxy.bandwidthSaver ?? true
    };
  }

  return null;
}

/**
 * Creates and returns a new BrowserContext from the browser pool.
 * Automatically applies proxy configuration and bandwidth-saving filters.
 */
export async function acquireContext(options: AcquireContextOptions = {}): Promise<BrowserContext> {
  const headless = options.headless ?? true;
  const browser = await getBrowser(headless);

  const proxySettings = await resolveProxyConfig(options);
  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ignoreHTTPSErrors: true
  };

  if (proxySettings?.server) {
    contextOptions.proxy = {
      server: proxySettings.server,
      username: proxySettings.username,
      password: proxySettings.password
    };
  }

  const context = await browser.newContext(contextOptions);

  // Bandwidth optimization: block heavy images/media/fonts if enabled
  const shouldSaveBandwidth = proxySettings?.bandwidthSaver ?? options.bandwidthSaver ?? false;
  if (shouldSaveBandwidth) {
    await context.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) {
        return route.abort();
      }
      return route.continue();
    }).catch(() => undefined);
  }

  const mode: BrowserMode = headless ? "headless" : "headed";
  browserPools[mode].activeContexts++;
  browserPools[mode].contextsCreated++;
  contextModes.set(context, mode);
  return context;
}

/**
 * Safely closes a context and handles browser error tracking.
 */
export async function releaseContext(context: BrowserContext): Promise<void> {
  const mode = contextModes.get(context);
  await context.close().catch(() => undefined);
  if (mode) {
    const pool = browserPools[mode];
    pool.activeContexts = Math.max(0, pool.activeContexts - 1);
    contextModes.delete(context);
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
      pool.activeContexts = 0;
      pool.contextsCreated = 0;
    }
  }
}
