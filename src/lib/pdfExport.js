// Server-side PDF export for inspection reports.
//
// Why headless Chrome instead of a pure-Node PDF library (pdfkit etc.): about half of every
// report's content is Arabic (item text, category names, hotel names), and this app already has
// correct RTL/Arabic rendering in the browser via ordinary HTML/CSS. Hand-building Arabic text in
// a low-level PDF library means reimplementing bidi + glyph shaping from scratch, which is easy
// to get subtly wrong (reversed/disconnected letters) and hard to catch without native-reader
// review of every PDF. Driving a real Chromium instance to print the exact same page the person
// already sees on screen sidesteps that risk entirely, at the cost of a heavier server process.
//
// The service this runs on is a modest single instance, so: launch a fresh browser per export
// (never keep one idling in memory), never run two exports concurrently (a simple in-process
// queue below), and use the launch flags that keep Chromium from tripping over a constrained
// container (no sandbox, no /dev/shm dependency).
// puppeteer-core + @sparticuz/chromium instead of the full "puppeteer" package: full puppeteer
// downloads its bundled Chromium from Google's Chrome-for-Testing CDN as a postinstall step,
// which is blocked outbound from some hosting network setups and hard-fails the entire `npm
// install` (and therefore the whole deploy) when it can't reach that host. @sparticuz/chromium
// ships its (compressed) browser as a normal npm package instead, so it installs whever the npm
// registry itself is reachable -- which every Node host already needs anyway.
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

const LOGO_DATA_URI = (() => {
  try {
    const buf = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'logo-black.png'));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (e) {
    return '';
  }
})();

// Exports never overlap -- each one is queued behind the last so a burst of clicks can't spin up
// several concurrent Chromium processes on a box that only comfortably fits one.
let queue = Promise.resolve();

function footerTemplate() {
  const logoImg = LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" style="height:14px;margin-inline-end:6px;vertical-align:middle;">` : '';
  return `
  <div style="width:100%;font-size:8.5px;color:#666;padding:0 24px;display:flex;align-items:center;justify-content:space-between;font-family:Arial,sans-serif;">
    <span style="display:flex;align-items:center;">${logoImg}THE HOTELIER OFFICE — THO Mystery Guest</span>
    <span class="pageNumber"></span>&nbsp;/&nbsp;<span class="totalPages"></span>
  </div>`;
}

async function renderInspectionPdf({ origin, cookieName, cookieValue, inspectionId }) {
  const run = async () => {
    const executablePath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      executablePath,
      args: chromium.args,
      headless: chromium.headless
    });
    try {
      const page = await browser.newPage();
      const url = new URL(origin);
      await page.setCookie({
        name: cookieName,
        value: cookieValue,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: url.protocol === 'https:'
      });
      await page.setViewport({ width: 1000, height: 1400 });
      // Switch to print media BEFORE the page loads, not after. Chart.js sizes each canvas
      // responsively off its container's actual box size, and the print stylesheet caps that
      // box to a much shorter height than the on-screen layout. Flipping media type only after
      // the charts had already been created/laid out at the larger on-screen size meant Chart.js
      // had to redo that layout via its ResizeObserver right before the PDF snapshot -- a race
      // that sometimes finished in time (full, legible axis labels) and sometimes didn't (most
      // labels silently dropped by Chart.js's tick auto-skip, mid-relayout). Emulating print
      // first means the charts are only ever created once, already at their final print size.
      await page.emulateMediaType('print');
      await page.goto(`${origin}/?printReport=${encodeURIComponent(inspectionId)}`, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });
      // Set by boot() in app.js once the report markup and its Chart.js canvases have had time
      // to actually paint (see the print-only branch there).
      await page.waitForFunction('window.__printReady === true', { timeout: 15000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: footerTemplate(),
        margin: { top: '14mm', bottom: '16mm', left: '10mm', right: '10mm' }
      });
      return pdf;
    } finally {
      await browser.close();
    }
  };

  const result = queue.then(run, run);
  // Keep the queue alive even if this particular export fails, so the next one isn't stuck
  // behind a rejected promise forever.
  queue = result.catch(() => {});
  return result;
}

module.exports = { renderInspectionPdf };
