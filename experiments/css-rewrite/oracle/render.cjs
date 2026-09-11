/*
 * The screenshot oracle for the CSS rewrite.
 *
 * Renders the fixture through the app's own render path in every combination
 * the style layer can produce, and writes one PNG per combination. Run it once
 * against the committed code to make a baseline, then again after any change:
 * identical pixels means the restructure changed nothing a reader can see.
 *
 * Traps this works around, all previously paid for in this project:
 *   - emulateMedia('screen') persists and silently overrides a later print pass,
 *     so the media is set explicitly for every capture.
 *   - CDP does not fire beforeprint/afterprint, so title pages never appear
 *     unless the events are dispatched by hand.
 *   - Hiding .sidebar leaves its 280px grid column behind and squeezes the
 *     render to half width, so .layout has to become a block too.
 *   - Fonts are system stacks the container does not have. Both sides of the
 *     diff therefore render the same fallback, which is fine for before/after
 *     but proves nothing about the real face.
 */
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const STYLES = ['signature', 'standard', 'studio', 'editorial', 'refined', 'graphite'];
const THEMES = ['dark', 'light', 'brown'];
const WIDTHS = { wide: 1100, narrow: 640 };   // narrow crosses the 700px mobile block
const FIXTURES = { doc: 'fixture.md', print: 'fixture-print.md' };

(async () => {
  const sources = Object.fromEntries(Object.entries(FIXTURES).map(([k, f]) =>
    [k, fs.readFileSync(path.join(__dirname, 'site/experiments/css-rewrite/' + f), 'utf8')]));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const problems = [];
  let n = 0;

  for (const [fixName, md] of Object.entries(sources)) {
  for (const [widthName, width] of Object.entries(WIDTHS)) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(`${widthName}: ${e.message}`));

    await page.goto('http://127.0.0.1:8811/index.html?mode=read');
    await page.waitForFunction(() => window.LightMDRenderer && window.markdownReady === true, { timeout: 10000 });

    // Render the fixture through the app's own path, then strip the chrome so the
    // capture is the document and nothing else.
    await page.evaluate(async (source) => {
      await window.LightMDRenderer.ready;
      const reader = document.getElementById('reader');
      reader.innerHTML = window.renderMarkdown(source, {});
      reader.hidden = false;
      document.getElementById('emptyState').hidden = true;
      document.querySelector('.topbar').style.display = 'none';
      document.querySelector('.sidebar').style.display = 'none';
      document.querySelector('.layout').style.display = 'block';   // or the grid column stays
      const rt = document.querySelector('.return-top-btn');
      if (rt) rt.style.display = 'none';
    }, md);

    for (const media of ['screen', 'print']) {
      for (const theme of THEMES) {
        for (const style of STYLES) {
          await page.emulateMedia({ media });
          await page.evaluate(({ t, s, isPrint }) => {
            document.documentElement.setAttribute('data-theme', t);
            document.documentElement.setAttribute('data-document-style', s);
            document.querySelectorAll('.pdf-title-page').forEach((w) => w.replaceWith(...w.childNodes));
            if (isPrint) window.dispatchEvent(new Event('beforeprint'));
          }, { t: theme, s: style, isPrint: media === 'print' });
          await page.waitForTimeout(60);

          const name = `${fixName}-${media}-${theme}-${style}-${widthName}.png`;
          await page.screenshot({ path: path.join(OUT, name), fullPage: true });
          n += 1;

          if (media === 'print') {
            await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
          }
        }
      }
    }
    await page.close();
  }
  }

  await browser.close();
  console.log(`captured ${n} renders into ${OUT}`);
  if (problems.length) console.log('page errors:\n  ' + problems.join('\n  '));
  else console.log('page errors: none');
})();
