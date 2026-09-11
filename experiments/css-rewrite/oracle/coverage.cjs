/* Does the fixture actually produce every element the style files target? */
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
const fs = require('fs'); const path = require('path');
const TARGETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));
(async () => {
  const md = fs.readFileSync(path.join(__dirname, 'site/experiments/css-rewrite/fixture.md'), 'utf8');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  await p.goto('http://127.0.0.1:8811/index.html?mode=read');
  await p.waitForFunction(() => window.markdownReady === true);
  const res = await p.evaluate(async ({ source, targets }) => {
    await window.LightMDRenderer.ready;
    const r = document.getElementById('reader');
    r.innerHTML = window.renderMarkdown(source, {});
    r.hidden = false;
    window.dispatchEvent(new Event('beforeprint'));   // so .pdf-title-page exists
    const out = {};
    for (const sel of targets) {
      try { out[sel] = r.querySelectorAll(sel).length; } catch { out[sel] = 'invalid'; }
    }
    window.dispatchEvent(new Event('afterprint'));
    return out;
  }, { source: md, targets: TARGETS });
  const missing = Object.entries(res).filter(([, n]) => n === 0).map(([s]) => s);
  const present = Object.entries(res).filter(([, n]) => typeof n === 'number' && n > 0);
  console.log(`targets checked: ${TARGETS.length}`);
  console.log(`  present in the fixture: ${present.length}`);
  console.log(`  absent                : ${missing.length}`);
  if (missing.length) console.log('  ' + missing.join('\n  '));
  await b.close();
})();
