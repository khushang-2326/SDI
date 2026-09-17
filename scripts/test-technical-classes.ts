import http from "node:http";
import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { findSubmitButtonWithDiagnostics, detectBookingWidget } from "../services/contact-form-automation";

async function main() {
  console.log("==================================================");
  console.log("RUNNING TECHNICAL CLASS GENERALIZATION TESTS");
  console.log("==================================================");

  let server: http.Server | null = null;
  const PORT = 4005;

  const htmlFormlessCustom = `
    <!DOCTYPE html>
    <html>
      <body>
        <div id="contact-wrapper">
          <input type="text" name="first_name" placeholder="First Name" />
          <input type="text" name="last_name" placeholder="Last Name" />
          <input type="email" name="email" placeholder="Email" />
          <textarea name="message" placeholder="Message"></textarea>
          <a href="javascript:void(0)" data-form-submit='{"action":"submit"}' class="custom-action-btn">
            <span>Send Message</span>
          </a>
        </div>
      </body>
    </html>
  `;

  const htmlOperatingHoursFooter = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="contact-area">
          <input type="text" name="first_name" placeholder="First Name" />
          <input type="email" name="email" placeholder="Email" />
          <textarea name="message" placeholder="Message"></textarea>
          <button type="submit">Submit</button>
        </div>
        <footer>
          <a href="/" class="hours-link">Monday-Friday | 9am-5pm EST</a>
        </footer>
      </body>
    </html>
  `;

  const htmlActualCalendar = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="calendar-wrapper" role="grid" aria-label="appointment calendar">
          <button role="gridcell" data-date="2026-09-14">14</button>
          <button role="gridcell" data-date="2026-09-15">15</button>
          <button role="gridcell" data-date="2026-09-16">16</button>
          <button role="gridcell" data-date="2026-09-17">17</button>
          <button role="gridcell" data-date="2026-09-18">18</button>
          <button role="gridcell" data-date="2026-09-19">19</button>
        </div>
      </body>
    </html>
  `;

  server = http.createServer((req, res) => {
    if (req.url === "/formless") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlFormlessCustom);
    } else if (req.url === "/operating-hours") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlOperatingHoursFooter);
    } else if (req.url === "/calendar-grid") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlActualCalendar);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server!.listen(PORT, "127.0.0.1", resolve));

  const browser = await chromium.launch({
    headless: true,
    executablePath: await getChromiumExecutablePath()
  });

  const page = await browser.newPage();

  let passCount = 0;
  const totalCount = 3;

  try {
    // TEST 1: Formless custom container with <a data-form-submit>
    await page.goto(`http://127.0.0.1:${PORT}/formless`, { waitUntil: "domcontentloaded" });
    const submitResult = await findSubmitButtonWithDiagnostics(page);
    const candidate = submitResult.diagnostics.selectedCandidate;
    const count = await submitResult.locator?.count().catch(() => 0);
    if (candidate && count === 1 && candidate.score >= 80) {
      console.log(`[PASS] Test 1 (Formless Custom Action Anchor): Found submit button tag="${candidate.tagName}" text="${candidate.text}" score=${candidate.score}`);
      passCount++;
    } else {
      console.error(`[FAIL] Test 1: Submit button not discovered or scored below 80`, submitResult.diagnostics);
    }

    // TEST 2: Operating hours in footer must NOT trigger booking widget detection
    await page.goto(`http://127.0.0.1:${PORT}/operating-hours`, { waitUntil: "domcontentloaded" });
    const bookingResult = await detectBookingWidget(page, 3);
    if (!bookingResult.found && bookingResult.state === "BOOKING_NOT_FOUND") {
      console.log(`[PASS] Test 2 (Separation of Operating Hours from Booking): Correctly ignored footer hours link (state=${bookingResult.state})`);
      passCount++;
    } else {
      console.error(`[FAIL] Test 2: Footer operating hours falsely triggered booking widget!`, bookingResult);
    }

    // TEST 3: Genuine calendar grid with >= 5 numeric date buttons triggers BOOKING_READY
    await page.goto(`http://127.0.0.1:${PORT}/calendar-grid`, { waitUntil: "domcontentloaded" });
    const calendarResult = await detectBookingWidget(page, 0);
    if (calendarResult.found && (calendarResult.state === "BOOKING_READY" || calendarResult.state === "BOOKING_CONTAINER_FOUND")) {
      console.log(`[PASS] Test 3 (Genuine Calendar Grid Detection): Detected calendar grid (state=${calendarResult.state}, reason="${calendarResult.reason}")`);
      passCount++;
    } else {
      console.error(`[FAIL] Test 3: Failed to detect genuine calendar grid`, calendarResult);
    }

  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    server.close();
  }

  console.log("==================================================");
  console.log(`TECHNICAL CLASS RESULTS: ${passCount} / ${totalCount} PASS`);
  console.log("==================================================");

  if (passCount !== totalCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Technical class test error:", err);
  process.exit(1);
});
