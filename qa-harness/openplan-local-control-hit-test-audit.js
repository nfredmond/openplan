/**
 * IS ANYTHING SITTING ON TOP OF THIS BUTTON? — every control, every page,
 * at every scroll position a planner will actually leave the page in.
 *
 * ═══ THE DEFECT THIS EXISTS FOR ═══
 *
 * The dashboard gained a chart picker whose "Show all" / "Hide all" buttons
 * landed under the floating Planner Agent launcher. A real pointer press went
 * to the launcher; the buttons could not be operated. Nothing caught it and
 * nothing was going to: `el.click()` in a unit test dispatches the handler
 * directly, so it reports success on a control no human can press, and jsdom
 * loads no stylesheet and has no box model, so it cannot see an overlay, a
 * stacking context or a layout at all. This is a browser measurement or it is
 * nothing.
 *
 * ═══ WHY IT SCROLLS THE PAGE INSTEAD OF THE CONTROL ═══
 *
 * The obvious shape — walk the controls, `scrollIntoView` each one, hit-test
 * its centre — is worse than useless here, and that is not a guess: both
 * mutations of the shell's safe area (surface bottom back to 16px; the phone
 * rail back to a left strip) SURVIVED a run built that way. Centring a control
 * moves it to the middle of the window, and the floating chrome is at the
 * bottom of the window, so the collision is scrolled out of existence before it
 * is measured.
 *
 * So this sweeps the page's own scroll container top to bottom in steps and, at
 * each step, hit-tests every control that is on screen right then — which is
 * the only state a control is ever pressed in. A control counts as covered if
 * at ANY resting position the browser hands its centre to something else.
 *
 * ═══ TWO ARTEFACTS IT HAS TO AVOID, BOTH FOUND LIVE ═══
 *
 *  · `getBoundingClientRect` is NOT clipped by a scrolling ancestor. A row
 *    scrolled just past the bottom of the content panel still reports a box
 *    inside the window, sitting invisibly on whatever floats down there. Every
 *    such control read as "covered by the account card" while the panel was not
 *    showing it at all. The shared module clips every box to its scrolling
 *    ancestors before choosing an aim point, so a control is only ever judged
 *    where the page is actually showing it.
 *  · An inline link that WRAPS has a bounding box spanning both lines, whose
 *    centre is the gap between them — where the browser correctly reports the
 *    parent. A project link in a table read as "covered by its own <td>". The
 *    shared module aims at the largest line box for this reason.
 *
 * ═══ THE JUDGEMENT IS NOT HERE ═══
 *
 * `pointer-reachability.js` measures one element and judges it;
 * `pointer-reachability.test.js` proves that judgement can fail, with no
 * browser. This file decides which controls to ask about, on which routes, at
 * which sizes, and in which scroll states.
 *
 * ═══ WHAT IT CANNOT SEE ═══
 *
 *  · A control whose centre is clear but whose edges are covered — the centre
 *    is where Playwright and most people aim.
 *  · A control that only appears after an interaction this script does not
 *    perform. The `open` steps reach a couple of those; each is best-effort.
 *  · Whether a control that IS pressable does anything useful, and colour or
 *    contrast of any kind.
 *  · Horizontal collisions inside a horizontally-scrolling strip: the sweep is
 *    vertical, because the shell's chrome is.
 *
 * ═══ RUNNING IT ═══
 *
 *   OPENPLAN_BASE_URL=http://localhost:3200 \
 *   OPENPLAN_QA_EMAIL=mapaudit@openplan.test OPENPLAN_QA_PASSWORD=… \
 *   npm run local-control-hit-test-audit
 *
 * Exit code 1 when any control is covered, so a change to the shell can be
 * gated on it. It needs a signed-in session on a running local instance, so
 * like the other `local-*` scripts it is not part of the app's own gate.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const {
  assertLocalTargetUrl,
  buildBrowserContextOptions,
  getOutputDir,
  repoRoot,
} = require('./harness-env');
const { sampleControls, classify } = require('./pointer-reachability');

const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3200';
const email = process.env.OPENPLAN_QA_EMAIL || 'mapaudit@openplan.test';
const password = process.env.OPENPLAN_QA_PASSWORD || '';
const outputDir = getOutputDir(new Date().toISOString().slice(0, 10));

/**
 * The two shapes fail differently, which is why both run. The desktop width is
 * where bottom-corner floating chrome meets page controls; the phone width is
 * where the shell's nav meets the content column.
 */
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'phone-390x844', width: 390, height: 844 },
];

const ROUTES = [
  {
    name: 'dashboard',
    path: '/dashboard',
    // The figures view is behind a switch that remembers itself per browser, so
    // a cold run would never see the chart picker — which is where the reported
    // defect lived.
    open: [
      { label: 'insights view', selector: '[data-testid="dashboard-view-insights"]' },
      { label: 'chart picker', selector: '[data-testid="dashboard-chart-picker-toggle"]' },
    ],
  },
  { name: 'safety', path: '/safety' },
  { name: 'projects', path: '/projects' },
];

/**
 * Wider than the shared module's default (`a[href], button, …`): a select, a
 * text field and a checkbox are all things a person has to be able to hit.
 */
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
].join(',');

/**
 * `<nextjs-portal>` is the `next dev` overlay. It does not exist in a build, and
 * reporting it would teach a reader to skim the report.
 */
function isDevOverlay(sample) {
  return `${sample.hitTopDescription || ''} ${sample.hitTopRoot || ''}`.includes('nextjs-portal');
}

/**
 * The page's scroll positions, as a person moves through them. Returns the
 * scrollTop values applied to the tallest scroller (the content panel in this
 * shell, the document elsewhere).
 */
function sweepInPage(step) {
  const candidates = [document.scrollingElement, ...document.querySelectorAll('*')].filter((node) => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight - node.clientHeight > 8;
  });
  if (!candidates.length) return { scroller: null, applied: 0, remaining: 0 };
  const scroller = candidates.reduce((best, node) =>
    node.scrollHeight - node.clientHeight > best.scrollHeight - best.clientHeight ? node : best);
  const max = scroller.scrollHeight - scroller.clientHeight;
  // Two thirds of a screen per step: enough overlap that no band of the page is
  // only ever seen at the very top or the very bottom of the panel.
  const stride = Math.max(120, Math.round(scroller.clientHeight * 0.66));
  const applied = Math.min(max, step * stride);
  scroller.scrollTop = applied;
  return {
    scroller: scroller.className || scroller.tagName.toLowerCase(),
    applied,
    remaining: Math.max(0, max - applied),
  };
}

/**
 * DOES THE SHELL'S FLOATING CHROME SIT ON TOP OF THE PAGE AT ALL?
 *
 * The hit test above only sees a collision where a CONTROL happens to be, and
 * most of what a rail covers is prose: at 390x844 the left rail sliced the word
 * "Safety", the sentence under it and the label above the project select, and
 * not one of those is a button. The same defect, one layer up: the shell's
 * fixed chrome and the content panel should be disjoint boxes, and if they
 * overlap by more than a hairline something is being covered whether or not it
 * can be clicked.
 *
 * The inspector dock is excluded: it is a detail bar that deliberately slides
 * OVER the map surface when a feature is selected, and it hides itself again.
 */
function chromeOverlapInPage() {
  const surface = document.querySelector('.op-cart-surface');
  if (!surface) return [];
  // THE ONE PLACE THE CHROME IS SUPPOSED TO FLOAT OVER THE PAGE. On a route
  // whose content IS a map, the surface goes full-bleed and the rail, the
  // account card and the launcher sit on top of it deliberately — the map is
  // the scarce resource and pushing it aside for a nav column was the thing
  // that decision reversed. Flagging it here would be a permanent false alarm,
  // and a report with a permanent false alarm in it stops being read. The hit
  // test above still covers that route: it asks whether any CONTROL is under
  // the chrome, which is the part the exemption does not license.
  if (document.body.dataset.mapFillsSurface === 'true') return [];
  const page = surface.getBoundingClientRect();
  const chrome = ['.op-cart-rail', '.op-cart-account', '.op-cart-copilot-launch', '.op-cart-mapdock', '.op-cart-zoom'];
  const findings = [];
  for (const selector of chrome) {
    for (const node of document.querySelectorAll(selector)) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = node.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const width = Math.min(box.right, page.right) - Math.max(box.left, page.left);
      const height = Math.min(box.bottom, page.bottom) - Math.max(box.top, page.top);
      if (width > 1 && height > 1) {
        findings.push({
          chrome: selector,
          overlap: { width: Math.round(width), height: Math.round(height) },
          chromeBox: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
          pageBox: { x: Math.round(page.x), y: Math.round(page.y), w: Math.round(page.width), h: Math.round(page.height) },
        });
      }
    }
  }
  return findings;
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'networkidle' });
  if (!page.url().includes('/sign-in')) return;
  if (!password) {
    throw new Error('OPENPLAN_QA_PASSWORD is required — this audit signs in the way a planner does.');
  }
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30000 }),
    page.getByRole('button', { name: /^sign in$/i }).click(),
  ]);
  await page.waitForLoadState('networkidle');
}

const MAX_STEPS = 12;

/**
 * One reading of every control at the page's current resting position. The
 * shared module clips each box to its scrolling ancestors before aiming, so a
 * control the panel is only half showing is judged where it can be pressed —
 * `visibleFraction === 0` is its word for "the panel is not showing this at
 * all", which is not a defect, just somewhere else on the page.
 */
async function measurePass(page) {
  const samples = await sampleControls(page, { selector: INTERACTIVE_SELECTOR, scrollIntoView: false });
  return { samples };
}

async function auditRoute(page, route, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const openNotes = [];
  for (const step of route.open || []) {
    const locator = page.locator(step.selector).first();
    if ((await locator.count()) === 0) {
      openNotes.push(`${step.label}: not present on this page at this size`);
      continue;
    }
    try {
      // A REAL click. If the trigger is itself covered this throws, which is a
      // finding rather than a harness failure.
      await locator.click({ timeout: 6000 });
      openNotes.push(`${step.label}: opened`);
      await page.waitForTimeout(500);
    } catch (error) {
      openNotes.push(`${step.label}: COULD NOT CLICK — ${(error.message || '').split('\n')[0]}`);
    }
  }

  const covered = new Map();
  let scanned = 0;
  let devOverlayCount = 0;
  let scrollerName = null;
  let stepsRun = 0;

  for (let step = 0; step <= MAX_STEPS; step += 1) {
    const sweep = await page.evaluate(sweepInPage, step);
    scrollerName = sweep.scroller;
    await page.waitForTimeout(120);
    stepsRun = step + 1;

    // TWICE, AND A CONTROL HAS TO FAIL BOTH TIMES. The measurement is spread
    // over two `evaluate` calls, and this page is alive between them — charts
    // mount, a figure re-renders, a row arrives. A single reading caught
    // controls mid-relayout and named the map canvas as the culprit for a
    // control the panel was about to move. Insisting the same control is
    // covered in two independent readings of the same resting position drops
    // the transient ones and keeps the structural ones.
    const first = await measurePass(page);
    await page.waitForTimeout(250);
    const second = await measurePass(page);
    const samples = second.samples;
    scanned = Math.max(scanned, samples.length);

    samples.forEach((sample, index) => {
      if (sample.disabled || sample.ariaHidden) return;
      if (sample.visibleFraction <= 0) return;
      const before = first.samples[index];
      const stable =
        before &&
        before.visibleFraction > 0 &&
        before.hitTopIsSelfOrDescendant === false &&
        before.selector === sample.selector;
      if (!stable) return;
      const verdict = classify(sample);
      if (verdict.hitTestable || sample.hitTopIsSelfOrDescendant !== false) return;
      if (isDevOverlay(sample)) {
        devOverlayCount += 1;
        return;
      }
      const key = `${sample.selector}::${sample.text}::${sample.hitTopDescription}`;
      if (!covered.has(key)) {
        covered.set(key, {
          control: sample.ariaLabel || sample.text || sample.selector,
          tag: sample.tag,
          aim: sample.aim,
          scrollTop: sweep.applied,
          coveredBy: sample.hitTopDescription,
          insideTopLevel: sample.hitTopRoot,
        });
      }
    });

    if (sweep.remaining <= 0) break;
  }

  const chromeOverlaps = await page.evaluate(chromeOverlapInPage);

  const screenshot = path.join(outputDir, `hit-test-${route.name}-${viewport.name}.png`);
  await page.screenshot({ path: screenshot });

  return {
    route: route.name,
    viewport: viewport.name,
    controlsScanned: scanned,
    scrollPositions: stepsRun,
    scroller: scrollerName,
    coveredCount: covered.size,
    covered: [...covered.values()],
    chromeOverlaps,
    devOverlayCount,
    openNotes,
    screenshot: path.relative(repoRoot, screenshot),
  };
}

async function main() {
  assertLocalTargetUrl(baseUrl, 'control hit-test audit app URL');
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.OPENPLAN_QA_HEADED !== '1',
    channel: process.env.OPENPLAN_BROWSER_CHANNEL || 'chrome',
  });
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 900 } }));
  const page = await context.newPage();

  const audits = [];
  try {
    await signIn(page);
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        audits.push(await auditRoute(page, route, viewport));
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const totalCovered = audits.reduce((sum, audit) => sum + audit.coveredCount, 0);
  const totalChromeOverlaps = audits.reduce((sum, audit) => sum + audit.chromeOverlaps.length, 0);
  const reportPath = path.join(outputDir, 'openplan-local-control-hit-test-audit.md');
  fs.writeFileSync(
    reportPath,
    [
      '# Control hit-test audit (local)',
      '',
      `- Target: ${baseUrl}`,
      `- Run: ${new Date().toISOString()}`,
      `- Controls a person cannot press because something is on top of them: **${totalCovered}**`,
      `- Places the shell's floating chrome sits on top of the content panel: **${totalChromeOverlaps}**`,
      '',
      ...audits.flatMap((audit) => [
        `## ${audit.route} @ ${audit.viewport}`,
        `- ${audit.controlsScanned} controls · ${audit.scrollPositions} scroll positions of \`${audit.scroller}\` · ${audit.coveredCount} covered · ${audit.devOverlayCount} readings under the \`next dev\` overlay (dev-only, not reported)`,
        ...audit.openNotes.map((note) => `- ${note}`),
        ...audit.covered.map(
          (entry) =>
            `- COVERED: <${entry.tag}> "${entry.control}" at (${Math.round(entry.aim.x)},${Math.round(entry.aim.y)}) with the panel scrolled to ${entry.scrollTop}px — the browser delivers that point to \`${entry.coveredBy}\` (inside \`${entry.insideTopLevel}\`)`,
        ),
        ...audit.chromeOverlaps.map(
          (entry) =>
            `- CHROME OVER CONTENT: \`${entry.chrome}\` at ${entry.chromeBox.x},${entry.chromeBox.y} ${entry.chromeBox.w}x${entry.chromeBox.h} covers ${entry.overlap.width}x${entry.overlap.height}px of the content panel (${entry.pageBox.w}x${entry.pageBox.h} at ${entry.pageBox.x},${entry.pageBox.y})`,
        ),
        `- Screenshot: ${audit.screenshot}`,
        '',
      ]),
    ].join('\n'),
  );

  console.log(
    JSON.stringify(
      { success: totalCovered === 0 && totalChromeOverlaps === 0, totalCovered, totalChromeOverlaps, reportPath: path.relative(repoRoot, reportPath), audits },
      null,
      2,
    ),
  );
  if (totalCovered > 0 || totalChromeOverlaps > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
