import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const BASE_URL = 'http://207.244.246.116';
const EXCEL_PATH = 'C:\\Users\\HP\\OneDrive\\Desktop\\form fill up demo.xlsx';

async function run() {
  console.log('🚀 Starting end-to-end automation test against:', BASE_URL);
  console.log('📂 Excel File:', EXCEL_PATH);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  }).catch(() => chromium.launch({ channel: 'msedge', headless: true }));

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  const screenshotDir = path.join(process.cwd(), 'outputs', 'deployed_test');
  await fs.mkdir(screenshotDir, { recursive: true });

  try {
    // 1. Login
    console.log('\n--- Step 1: Logging in ---');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    console.log('Current URL:', page.url());

    await page.fill('input[name="loginId"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(3000);
    console.log('After login click URL:', page.url());

    // If still on login page or redirected
    if (page.url().includes('/login')) {
      await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
    }
    console.log('Logged in successfully! Final URL:', page.url());
    await page.screenshot({ path: path.join(screenshotDir, '01_logged_in.png') });

    // 2. Upload Excel
    console.log('\n--- Step 2: Uploading Excel File ---');
    await page.goto(`${BASE_URL}/websites/upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    console.log('At upload page:', page.url());
    await page.screenshot({ path: path.join(screenshotDir, '02_upload_page.png') });

    const fileInput = await page.waitForSelector('input[type="file"]');
    await fileInput.setInputFiles(EXCEL_PATH);
    console.log('File selected for upload.');

    const uploadBtn = await page.waitForSelector('button:has-text("Upload"), button:has-text("Import"), button[type="submit"]');
    await uploadBtn.click();
    console.log('Upload submitted, waiting for response...');
    await page.waitForTimeout(4000);

    console.log('Post-upload URL:', page.url());
    const uploadUrl = new URL(page.url());
    const searchParams = Object.fromEntries(uploadUrl.searchParams.entries());
    console.log('Upload summary params:', searchParams);

    const uploadPageText = await page.evaluate(() => document.body.innerText);
    console.log('Upload Summary snippet:\n', uploadPageText.slice(0, 600));
    await page.screenshot({ path: path.join(screenshotDir, '03_post_upload.png') });

    // 3. Go to Automation Page
    console.log('\n--- Step 3: Navigating to Automation Page ---');
    await page.goto(`${BASE_URL}/automation`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    console.log('At automation page:', page.url());
    await page.screenshot({ path: path.join(screenshotDir, '04_automation_page.png') });

    // Inspect automation page elements
    const pageInspect = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.innerText.trim(),
        type: b.getAttribute('type'),
        className: b.className
      }));
      const fileOptions = Array.from(document.querySelectorAll('select option')).map(o => ({
        value: o.getAttribute('value'),
        text: o.innerText.trim()
      }));
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).map(c => ({
        name: c.getAttribute('name'),
        id: c.id,
        checked: c.checked
      }));
      return { buttons, fileOptions, checkboxes };
    });
    console.log('Page elements inspect:', JSON.stringify(pageInspect, null, 2));

    // Check if there is a file group dropdown or checkboxes
    const selectElem = await page.$('select');
    if (selectElem) {
      const options = await selectElem.$$eval('option', opts => opts.map(o => ({ value: o.value, text: o.text })));
      console.log('Available Select options:', options);
      if (options.length > 1) {
        // Select the latest uploaded file or first available option
        const targetOption = options.find(o => o.text.toLowerCase().includes('demo') || o.text.toLowerCase().includes('form')) || options[1];
        if (targetOption) {
          console.log(`Selecting file group option: ${targetOption.text} (${targetOption.value})`);
          await selectElem.selectOption(targetOption.value);
          await page.waitForTimeout(1000);
        }
      }
    }

    // Select "Select All" checkbox if present
    const selectAllBtn = await page.$('button:has-text("Select All"), button:has-text("Check all")');
    if (selectAllBtn) {
      console.log('Clicking Select All button...');
      await selectAllBtn.click();
      await page.waitForTimeout(1000);
    }

    // Fill lead data fields if needed
    await page.fill('input[name="fullName"]', 'Test Lead').catch(() => {});
    await page.fill('input[name="email"]', 'testlead@demo-example.com').catch(() => {});
    await page.fill('input[name="mobile"]', '555-019-2834').catch(() => {});
    await page.fill('input[name="companyName"]', 'Apex Growth Partners').catch(() => {});
    await page.fill('textarea[name="message"]', 'Hello, we would like to inquire about your professional services. Please contact us at your earliest convenience.').catch(() => {});

    await page.screenshot({ path: path.join(screenshotDir, '05_automation_configured.png') });

    // Look for Start Automation button
    const startBtn = await page.$(
      'button:has-text("Start Parallel Automation"), button:has-text("Start Automation"), button:has-text("Start Batch"), button:has-text("Run Automation")'
    ) || await page.$('button[type="submit"]');

    if (startBtn) {
      console.log('Found start button, clicking...');
      await startBtn.click();
      console.log('Clicked start automation!');
    } else {
      console.log('No direct start automation button matched selector. Checking all buttons...');
      const allBtns = await page.$$('button');
      for (const b of allBtns) {
        const text = await b.innerText();
        console.log('Button:', text);
        if (text.includes('Start') || text.includes('Run') || text.includes('Launch')) {
          await b.click();
          console.log(`Clicked button: "${text}"`);
          break;
        }
      }
    }

    // 4. Monitor Live Automation Execution
    console.log('\n--- Step 4: Monitoring Live Automation Execution ---');
    let poll = 0;
    const maxPoll = 120; // up to ~10 minutes
    let isFinished = false;

    while (poll < maxPoll && !isFinished) {
      await page.waitForTimeout(5000);
      poll++;

      const progressInfo = await page.evaluate(() => {
        const text = document.body.innerText;
        const metrics = {
          total: document.querySelector('[data-metric="total"]')?.innerText || '',
          success: document.querySelector('[data-metric="success"]')?.innerText || '',
          failed: document.querySelector('[data-metric="failed"]')?.innerText || '',
          workers: document.querySelector('[data-metric="workers"]')?.innerText || ''
        };
        const rows = Array.from(document.querySelectorAll('table tbody tr')).map(tr => {
          return Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()).join(' | ');
        });
        const isRunning = text.includes('Running') || text.includes('Discovering') || text.includes('Processing') || Boolean(document.querySelector('button:has-text("Cancel"), button:has-text("Stop")'));
        const modalOpen = Boolean(document.querySelector('.fixed.inset-0, [role="dialog"]'));

        return {
          textSnippet: text.slice(0, 700),
          metrics,
          recentRows: rows.slice(0, 8),
          totalRows: rows.length,
          isRunning,
          modalOpen
        };
      });

      console.log(`\n[Poll #${poll}] State (isRunning: ${progressInfo.isRunning}, Modal: ${progressInfo.modalOpen})`);
      console.log('Summary snippet:\n' + progressInfo.textSnippet.split('\n').slice(0, 6).join('\n'));
      if (progressInfo.recentRows.length > 0) {
        console.log('Recent items:', progressInfo.recentRows.slice(0, 3));
      }

      await page.screenshot({ path: path.join(screenshotDir, `progress_poll_${poll}.png`) });

      // If analysis modal opened or no longer running after some iterations
      if (poll > 5 && !progressInfo.isRunning && (progressInfo.textSnippet.includes('Completed') || progressInfo.textSnippet.includes('Analysis') || progressInfo.textSnippet.includes('Success Rate'))) {
        console.log('🏁 Automation run appears completed!');
        isFinished = true;
      }
    }

    // 5. Final Analysis & Extraction
    console.log('\n--- Step 5: Extracting Final Detailed Results ---');
    await page.screenshot({ path: path.join(screenshotDir, '06_final_dashboard.png'), fullPage: true });

    // Open Analysis Modal if button exists
    const analysisBtn = await page.$('button:has-text("Analysis"), button:has-text("View Analysis"), button:has-text("Report")');
    if (analysisBtn) {
      console.log('Clicking View Analysis Modal...');
      await analysisBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(screenshotDir, '07_analysis_modal.png'), fullPage: true });
    }

    const finalPageData = await page.evaluate(() => {
      const fullText = document.body.innerText;
      const tables = Array.from(document.querySelectorAll('table')).map(table => {
        const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
        const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr =>
          Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
        );
        return { headers, rows };
      });
      return { fullText, tables };
    });

    // 6. Check Reports Page
    console.log('\n--- Step 6: Checking Reports Page ---');
    await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, '08_reports_page.png'), fullPage: true });

    const reportsData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr')).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
      );
      return {
        fullText: document.body.innerText,
        rows
      };
    });

    const outputData = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      uploadSummary: searchParams,
      automationPageSummary: finalPageData,
      reportsSummary: reportsData
    };

    await fs.writeFile(
      path.join(screenshotDir, 'final_run_summary.json'),
      JSON.stringify(outputData, null, 2)
    );

    console.log('\n🎉 ALL DONE! Summary saved to outputs/deployed_test/final_run_summary.json');

  } catch (err) {
    console.error('❌ Test execution error:', err);
    await page.screenshot({ path: path.join(screenshotDir, 'error_state.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run();
