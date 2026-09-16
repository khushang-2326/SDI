import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'http://207.244.246.116';

async function main() {
  console.log("Launching browser to inspect VPS reports and analytics...");
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  }).catch(() => chromium.launch({ channel: 'msedge', headless: true }));

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  // 1. Login
  console.log("Logging into", BASE_URL);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="loginId"]', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  console.log("Logged in! Current URL:", page.url());

  // 2. Go to Reports Page
  console.log("Navigating to /reports...");
  await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Extract all report sections
  const reportCards = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('section.rounded-2xl'));
    return sections.map(sec => {
      const title = sec.querySelector('h2')?.innerText.trim() || '';
      const siteUrl = sec.querySelector('p')?.innerText.trim() || '';
      const badge = sec.querySelector('span.rounded-full')?.innerText.trim() || '';
      const attempts = Array.from(sec.querySelectorAll('.grid.gap-2')).map(att => {
        const spans = Array.from(att.querySelectorAll('span')).map(s => s.innerText.trim());
        const error = att.querySelector('p')?.innerText.trim() || null;
        return {
          order: spans[0] || '',
          type: spans[1] || '',
          targetUrl: spans[2] || '',
          statusText: spans[3] || '',
          error
        };
      });

      return {
        title,
        siteUrl,
        badge,
        attemptsCount: attempts.length,
        attempts
      };
    });
  });

  console.log(`Extracted ${reportCards.length} report cards from /reports.`);

  // 3. Go to Analytics Page
  console.log("Navigating to /analytics...");
  await page.goto(`${BASE_URL}/analytics?range=7`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const analyticsTable = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr')).map(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      return {
        time: tds[0] || '',
        website: tds[1] || '',
        target: tds[2] || '',
        status: tds[3] || '',
        mode: tds[4] || ''
      };
    });
    return rows;
  });

  console.log(`Extracted ${analyticsTable.length} transactions from /analytics.`);

  const output = {
    extractedAt: new Date().toISOString(),
    totalReportCards: reportCards.length,
    reportCards,
    totalAnalyticsRows: analyticsTable.length,
    analyticsTable
  };

  await fs.writeFile('outputs/vps_extracted_data.json', JSON.stringify(output, null, 2), 'utf8');
  console.log("Saved extracted data to outputs/vps_extracted_data.json");

  await browser.close();
}

main().catch(console.error);
