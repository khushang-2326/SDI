import { chromium } from 'playwright';

async function testPipedrive() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const url = 'https://muslimadnetwork.pipedrive.com/scheduler/9KmA9sa/muslim-ad-network-advertising-partnership-next-steps';
  console.log('Navigating to Pipedrive scheduler...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const DATE_SELECTOR = "button, [role='button'], .vdpCell.selectable, [aria-label*='Booking slot available' i], [aria-label*='slot available' i]";
  const count = await page.locator(DATE_SELECTOR).count();
  console.log('Matched date elements count:', count);

  const slotCard = page.locator("[aria-label*='Booking slot available' i]").first();
  if (await slotCard.count() > 0) {
    const text = await slotCard.textContent();
    const label = await slotCard.getAttribute('aria-label');
    console.log('Clicking slot card:', label, text?.trim().slice(0, 50));
    await slotCard.click();
    await page.waitForTimeout(2000);

    const afterClick = await page.evaluate(() => {
      const times = Array.from(document.querySelectorAll('button, [role="button"], div, a')).filter(el => {
        const t = el.textContent?.trim() || '';
        return /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(t) && el.getBoundingClientRect().width > 0;
      }).map(el => el.textContent?.trim().slice(0, 30));
      return { timesCount: times.length, sampleTimes: times.slice(0, 8) };
    });
    console.log('After click time slots:', afterClick);
  }

  await browser.close();
}

testPipedrive().catch(console.error);
