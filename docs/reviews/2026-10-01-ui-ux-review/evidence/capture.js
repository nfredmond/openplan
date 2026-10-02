const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:3000';
const OUT = '/tmp/openplan-uiux/shots';
const INDEX = ['dashboard','my-work','command-center','workspace','projects','plans','land-use-plans','rtp','programs','engagement','reports','models','county-runs','scenarios','explore','safety','aerial','grants','invoicing','data-hub','knowledge-base','help','assistant-activity','billing'];
const PUBLIC = ['', 'examples','contact','legal','privacy','terms','sign-in','sign-up','forgot-password','this-route-does-not-exist'];
const metricsFn = () => {
  const all = [...document.querySelectorAll('body *')];
  const vis = all.filter(e => e.getClientRects().length);
  const sizes = {};
  let small = 0, textEls = 0;
  for (const e of vis) {
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    textEls++;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    sizes[fs] = (sizes[fs] || 0) + 1;
    if (fs < 12) small++;
  }
  const bordered = vis.filter(e => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return r.width > 150 && r.height > 60 && parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderLeftWidth) > 0 && s.borderTopStyle !== 'none';
  });
  let maxDepth = 0;
  for (const e of bordered) { let d = 0, p = e.parentElement; while (p) { if (bordered.includes(p)) d++; p = p.parentElement; } if (d > maxDepth) maxDepth = d; }
  const upper = vis.filter(e => getComputedStyle(e).textTransform === 'uppercase' && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).length;
  const words = (document.body.innerText || '').split(/\s+/).filter(Boolean).length;
  const controls = vis.filter(e => ['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(e.tagName));
  const tiny = controls.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 24 || r.width < 24); }).length;
  const unnamed = controls.filter(e => e.tagName === 'BUTTON' && !(e.innerText || '').trim() && !e.getAttribute('aria-label') && !e.getAttribute('title') && !e.getAttribute('aria-labelledby')).length;
  return {
    title: document.title, h1: document.querySelectorAll('h1').length, h1text: (document.querySelector('h1')?.innerText || '').slice(0, 80),
    headings: document.querySelectorAll('h1,h2,h3,h4').length,
    docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    boxes: bordered.length, maxBoxDepth: maxDepth, uppercaseLabels: upper, words, textEls, smallText: small,
    fontSizes: Object.entries(sizes).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}px:${v}`).join(' '),
    controls: controls.length, tinyControls: tiny, unnamedButtons: unnamed,
    buttons: vis.filter(e => e.tagName === 'BUTTON').length,
  };
};
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  const run = async (ctxOpts, tag, routes, login) => {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    let errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
    if (login) {
      await page.goto(BASE + '/sign-in', { waitUntil: 'networkidle' });
      await page.fill('input[type=email]', 'mapaudit@openplan.test');
      await page.fill('input[type=password]', 'MapAudit!2026');
      await page.click('button[type=submit]');
      await page.waitForURL(u => !String(u).includes('sign-in'), { timeout: 30000 }).catch(() => {});
      console.log(tag, 'after login:', page.url());
    }
    const visit = async (route, name) => {
      errs = [];
      try {
        const resp = await page.goto(BASE + '/' + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const m = await page.evaluate(metricsFn);
        await page.screenshot({ path: `${OUT}/${tag}-${name}-fold.png` });
        await page.screenshot({ path: `${OUT}/${tag}-${name}-full.png`, fullPage: true }).catch(() => {});
        const r = { tag, route, name, status: resp && resp.status(), finalUrl: page.url().replace(BASE, ''), ...m, consoleErrors: errs.length, errSample: errs.slice(0, 3) };
        results.push(r);
        console.log(tag, route, r.status, 'h=' + m.docH, 'boxes=' + m.boxes, 'depth=' + m.maxBoxDepth, 'words=' + m.words, 'ovf=' + m.overflowX, 'err=' + errs.length);
        return r;
      } catch (e) { console.log(tag, route, 'FAILED', String(e).slice(0, 150)); results.push({ tag, route, name, failed: String(e).slice(0, 200) }); }
    };
    const details = {};
    for (const r of routes) {
      const name = r === '' ? 'home' : r.replace(/\//g, '_');
      await visit(r, name);
      if (login && tag === 'desktop') {
        const href = await page.evaluate((r) => {
          const a = [...document.querySelectorAll('main a[href], a[href]')].map(a => a.getAttribute('href')).find(h => h && new RegExp('^/' + r + '/[0-9a-f-]{8,}').test(h));
          return a || null;
        }, r);
        if (href) details[r] = href.replace(/^\//, '').split('?')[0];
      }
    }
    return { ctx, page, visit, details };
  };
  const d = await run({ viewport: { width: 1440, height: 1000 } }, 'desktop', INDEX, true);
  console.log('details', JSON.stringify(d.details));
  for (const [k, href] of Object.entries(d.details)) await d.visit(href, k + '_detail');
  fs.writeFileSync('/tmp/openplan-uiux/details.json', JSON.stringify(d.details));
  const state = await d.ctx.storageState();
  await d.ctx.close();
  const m = await run({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: state }, 'mobile', INDEX, false);
  for (const [k, href] of Object.entries(d.details)) await m.visit(href, k + '_detail');
  await m.ctx.close();
  const p = await run({ viewport: { width: 1440, height: 1000 } }, 'desktop-public', PUBLIC, false); await p.ctx.close();
  const pm = await run({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'mobile-public', PUBLIC, false); await pm.ctx.close();
  fs.writeFileSync('/tmp/openplan-uiux/metrics.json', JSON.stringify(results, null, 1));
  await browser.close();
})();
