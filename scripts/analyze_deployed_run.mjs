import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const BASE_URL = 'http://207.244.246.116';

async function run() {
  console.log('🔍 Connecting to deployed server to extract analysis...');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  }).catch(() => chromium.launch({ channel: 'msedge', headless: true }));

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  const outputDir = path.join(process.cwd(), 'outputs', 'deployed_analysis');
  await fs.mkdir(outputDir, { recursive: true });

  try {
    // 1. Login
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="loginId"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(2000);

    // 2. Go to Automation Page
    await page.goto(`${BASE_URL}/automation`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(outputDir, '01_automation_dashboard.png'), fullPage: true });

    // Extract live dashboard stats
    const dashboardStats = await page.evaluate(() => {
      const allText = document.body.innerText;
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
      const badges = Array.from(document.querySelectorAll('.rounded-full, .status-badge, [class*="badge"], [class*="bg-emerald"], [class*="bg-red"], [class*="bg-amber"]')).map(b => b.innerText.trim());
      
      const tableRows = Array.from(document.querySelectorAll('table tbody tr')).map(tr => {
        return Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      });

      return {
        allTextSnippet: allText.slice(0, 1500),
        buttons,
        badges,
        tableRowsCount: tableRows.length,
        tableRowsSample: tableRows.slice(0, 15)
      };
    });
    console.log('Dashboard Stats:', JSON.stringify(dashboardStats, null, 2));

    // 3. Open Analysis Modal
    const analysisButton = await page.$(
      'button:has-text("View Full Analysis"), button:has-text("Analysis")'
    );

    let modalData = null;
    if (analysisButton) {
      console.log('Clicking Analysis button...');
      await analysisButton.click();
      await page.waitForTimeout(2500);

      await page.screenshot({ path: path.join(outputDir, '02_analysis_modal.png'), fullPage: true });

      modalData = await page.evaluate(() => {
        const modal = document.querySelector('.fixed.inset-0, [role="dialog"]');
        if (!modal) return { found: false, text: 'Modal element not found' };

        const headerText = modal.querySelector('h2, h3')?.innerText || '';
        const fullModalText = (modal).innerText;
        
        // Extract category counts if any
        const statCards = Array.from(modal.querySelectorAll('div[class*="rounded-2xl"], div[class*="rounded-xl"]'))
          .map(d => (d).innerText.trim())
          .filter(t => t.length > 0 && t.length < 200);

        // Extract list of websites / trials
        const items = Array.from(modal.querySelectorAll('table tbody tr, .divide-y > div')).map(el => {
          return (el).innerText.replace(/\n+/g, ' | ');
        });

        return {
          found: true,
          headerText,
          fullModalText,
          statCards,
          itemsCount: items.length,
          items
        };
      });

      console.log('Modal Data extracted. Total items:', modalData.itemsCount);
      console.log('Modal Text Snippet:\n', modalData.fullModalText?.slice(0, 1000));
    }

    // 4. Extract Reports Page Data
    console.log('\n--- Extracting Reports Page ---');
    await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(outputDir, '03_reports_page.png'), fullPage: true });

    const reportsData = await page.evaluate(() => {
      const summaryCards = Array.from(document.querySelectorAll('div[class*="rounded-2xl"], div[class*="rounded-xl"]'))
        .map(d => (d).innerText.trim())
        .filter(t => t.length > 0 && t.length < 150);

      const tableRows = Array.from(document.querySelectorAll('table tbody tr')).map(tr => {
        return Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      });

      return {
        pageTextSnippet: document.body.innerText.slice(0, 1200),
        summaryCards,
        tableRowsCount: tableRows.length,
        tableRows
      };
    });

    // 5. Extract Analytics Page Data
    console.log('\n--- Extracting Analytics Page ---');
    await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outputDir, '04_analytics_page.png'), fullPage: true });

    const analyticsData = await page.evaluate(() => {
      return {
        pageTextSnippet: document.body.innerText.slice(0, 1500)
      };
    });

    const comprehensiveAnalysis = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      dashboardStats,
      modalData,
      reportsData,
      analyticsData
    };

    await fs.writeFile(
      path.join(outputDir, 'comprehensive_analysis.json'),
      JSON.stringify(comprehensiveAnalysis, null, 2)
    );

    console.log('✅ Analysis extraction complete! Output saved to outputs/deployed_analysis/');

  } catch (err) {
    console.error('❌ Error in analysis extraction:', err);
  } finally {
    await browser.close();
  }
}

run();
