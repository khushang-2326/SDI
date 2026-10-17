import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `docker exec sdi npx tsx -e "
    import { chromium } from 'playwright';

    async function test() {
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      page.on('request', req => {
        if (req.method() === 'POST' || req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
          console.log('>> [REQ]', req.method(), req.url(), req.postData()?.substring(0, 200));
        }
      });
      page.on('response', async res => {
        const req = res.request();
        if (req.method() === 'POST' || req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
          let b = '';
          try { b = (await res.text()).substring(0, 200); } catch {}
          console.log('<< [RES]', res.status(), res.url(), b);
        }
      });

      await page.goto('https://www.creativedigitalseo.com/contact-us', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // Trigger user activity to un-delay WP Rocket JS
      await page.mouse.move(200, 300);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('mousemove'));
        window.dispatchEvent(new Event('touchstart'));
      });
      await page.waitForTimeout(1000);

      // Fill each input using Playwright type/fill and dispatch jQuery change/blur
      const inputs = [
        { sel: 'input[name=\"us_form_1_text_1\"]', val: 'Alex' },
        { sel: 'input[name=\"us_form_1_text_2\"]', val: 'Rivera' },
        { sel: 'input[name=\"us_form_1_email_1\"]', val: 'alex.rivera@growthpulse.io' },
        { sel: 'input[name=\"us_form_1_text_3\"]', val: '4155552671' },
        { sel: 'input[name=\"us_form_1_text_4\"]', val: 'https://growthpulse.io' },
        { sel: 'textarea[name=\"us_form_1_textarea_1\"]', val: 'Hello, we would like to discuss a potential partnership.' }
      ];

      for (const item of inputs) {
        const loc = page.locator(item.sel).first();
        if (await loc.count() > 0) {
          await loc.click();
          await loc.fill(item.val);
          await loc.evaluate((el: any) => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            el.dispatchEvent(new Event('focusout', { bubbles: true }));
            if ((window as any).jQuery) {
              (window as any).jQuery(el).trigger('input').trigger('change').trigger('blur').trigger('focusout');
            }
          });
        }
      }

      // Select dropdown
      const selLoc = page.locator('select[name=\"us_form_1_select_1\"]').first();
      if (await selLoc.count() > 0) {
        await selLoc.selectOption({ index: 1 });
        await selLoc.evaluate((el: any) => {
          el.dispatchEvent(new Event('change', { bubbles: true }));
          if ((window as any).jQuery) {
            (window as any).jQuery(el).trigger('change');
          }
        });
      }

      console.log('Inputs filled. Clicking submit button...');
      const btn = page.locator('button[type=\"submit\"]').first();
      await btn.click();

      await page.waitForTimeout(5000);

      const state = await page.evaluate(() => {
        const errors = Array.from(document.querySelectorAll('.w-form-row-state:not(:empty), .w-form-message')).map(e => e.textContent?.trim());
        return {
          errors,
          bodySnippet: document.body.innerText.substring(0, 400)
        };
      });
      console.log('STATE AFTER PROPER FILL:', JSON.stringify(state, null, 2));

      await browser.close();
    }
    test();
  "`;

  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', (d: Buffer) => process.stdout.write(d.toString()));
    stream.stderr.on('data', (d: Buffer) => process.stderr.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '207.244.246.116', port: 22, username: 'root', password: 'Kadar786' });
