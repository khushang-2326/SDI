/**
 * Authorized Test Environment Registry for CAPTCHA Testing.
 * 
 * Strict protection rule: Automated CAPTCHA solving/bypassing is ONLY
 * permitted against explicitly authorized local or mock test environments.
 * Arbitrary production domains are strictly prohibited and will always
 * be rejected immediately.
 */

const DEFAULT_AUTHORIZED_TEST_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "local.test",
  "mock-captcha.test",
  "authorized-test.local"
]);

const customAuthorizedHosts: Set<string> = new Set();

/**
 * Checks if a target URL belongs to an explicitly authorized CAPTCHA test environment.
 */
export function isAuthorizedCaptchaTestTarget(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();

    // 1. Check default local and mock hostnames
    if (DEFAULT_AUTHORIZED_TEST_HOSTS.has(hostname)) {
      return true;
    }

    // 2. Check dynamically registered authorized test hosts
    if (customAuthorizedHosts.has(hostname)) {
      return true;
    }

    // 3. Check environment variable allowlists
    const envDomains = (
      process.env.CAPTCHA_TEST_DOMAINS ||
      process.env.AUTHORIZED_CAPTCHA_TEST_HOSTS ||
      ""
    )
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    for (const allowed of envDomains) {
      if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Registers an authorized test hostname for the current test suite execution.
 */
export function registerAuthorizedCaptchaTestHost(host: string): void {
  if (host && typeof host === "string") {
    customAuthorizedHosts.add(host.trim().toLowerCase());
  }
}

/**
 * Removes an authorized test hostname.
 */
export function unregisterAuthorizedCaptchaTestHost(host: string): void {
  if (host && typeof host === "string") {
    customAuthorizedHosts.delete(host.trim().toLowerCase());
  }
}

/**
 * Clears all dynamically registered test hosts.
 */
export function clearAuthorizedCaptchaTestHosts(): void {
  customAuthorizedHosts.clear();
}

/**
 * Returns all currently authorized test hostnames.
 */
export function getAuthorizedCaptchaTestHosts(): string[] {
  const envDomains = (
    process.env.CAPTCHA_TEST_DOMAINS ||
    process.env.AUTHORIZED_CAPTCHA_TEST_HOSTS ||
    ""
  )
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(
    new Set([
      ...Array.from(DEFAULT_AUTHORIZED_TEST_HOSTS),
      ...Array.from(customAuthorizedHosts),
      ...envDomains
    ])
  );
}
