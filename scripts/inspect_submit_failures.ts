import { chromium } from 'playwright';

async function inspectSites() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const urls = [
    'https://www.efficiencymedia.com/contact',
    'https://triscari.com/contact/',
    'https://thefouriq.com/contact-us/'
  ];

  for (const url of urls) {
    console.log('\n========================================');
    console.log('INSPECTING:', url);
    console.log('========================================');
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll('form')).map((f, fIdx) => {
          const inputs = Array.from(f.querySelectorAll('input, textarea, select')).map(i => ({
            tag: i.tagName.toLowerCase(),
            type: i.getAttribute('type'),
            name: i.getAttribute('name'),
            id: i.id,
            placeholder: i.getAttribute('placeholder'),
            ariaLabel: i.getAttribute('aria-label'),
            visible: i.getBoundingClientRect().width > 0 && i.getBoundingClientRect().height > 0
          }));
          const buttons = Array.from(f.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a, div[class*="btn"], div[class*="button"], span[class*="btn"]')).map(b => ({
            tag: b.tagName.toLowerCase(),
            type: b.getAttribute('type'),
            role: b.getAttribute('role'),
            className: b.className,
            text: b.textContent?.trim().slice(0, 100),
            value: (b as HTMLInputElement).value || null,
            id: b.id,
            visible: b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0,
            rect: { w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }
          })).filter(b => b.text || b.value || b.role === 'button' || b.type === 'submit');

          // Look for any element inside the form with click or submit in class, or text matching submit concepts
          const allDescendants = Array.from(f.querySelectorAll('*')).filter(el => {
            const text = el.textContent?.trim() || '';
            const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
            return /submit|send|enviar|contact|talk|quote|message/i.test(text) || cls.includes('submit') || cls.includes('send');
          }).map(el => ({
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className : '',
            id: el.id,
            text: el.textContent?.trim().slice(0, 80),
            visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
            childrenCount: el.children.length
          })).slice(0, 10);

          return { fIdx, id: f.id, action: f.action, className: f.className, inputsCount: inputs.length, inputs, buttons, allDescendants };
        });

        const externalButtons = Array.from(document.querySelectorAll('button[form], input[form]')).map(b => ({
          tag: b.tagName.toLowerCase(),
          formAttr: b.getAttribute('form'),
          text: b.textContent?.trim(),
          type: b.getAttribute('type')
        }));

        // Also check if there are forms inside iframes
        const iframes = Array.from(document.querySelectorAll('iframe')).map(ifr => ({
          src: ifr.src,
          id: ifr.id,
          name: ifr.name,
          visible: ifr.getBoundingClientRect().width > 0
        }));

        return { forms, externalButtons, iframes };
      });

      console.log(JSON.stringify(info, null, 2));
    } catch (e: any) {
      console.error('Error on', url, e.message);
    } finally {
      await page.close();
    }
  }
  await browser.close();
}

inspectSites().catch(console.error);
