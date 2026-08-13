/**
 * DOES A PLANNER ACTUALLY SEE THEIR MAP? — measured in a real browser.
 *
 * ═══ WHY THIS EXISTS ALONGSIDE THE UNIT TESTS ═══
 *
 * The app's suite runs in jsdom, which has no box model: every
 * `getBoundingClientRect()` there returns zeros. So no test in `openplan/src/test`
 * can see that the page panel covers ~87% of the window, and none of them can
 * see that map-reading mode uncovers it. They prove the MECHANISM — the control
 * is reachable, the panel goes inert, the stylesheet rule that removes it exists
 * and is scoped so no other page can be affected. This proves the OUTCOME.
 *
 * The arithmetic it applies is `map-reading-geometry.js`, which is verified on
 * its own by `map-reading-geometry.test.js` with no browser and no server — so
 * when this script reports a percentage, only the rectangles depend on the live
 * run, not the maths.
 *
 * ═══ WHAT IT CANNOT PROVE ═══
 *
 * Not compositing. "The layer is legible" is not a measurement this makes; it
 * measures that the map is UNCOVERED and that the page is inert while it is. A
 * screenshot comparison would add pixel evidence and is a reasonable follow-up.
 *
 * ═══ RUNNING IT ═══
 *
 *   OPENPLAN_BASE_URL=http://localhost:3000 \
 *   OPENPLAN_MAP_READING_EMAIL=you@example.test \
 *   OPENPLAN_MAP_READING_PASSWORD=… \
 *   node openplan-local-map-reading-audit.js
 *
 * It needs a signed-in session on a running local instance, so it is a
 * `local-*` script and is not part of any automated gate. It writes a JSON
 * record and two screenshots into the dated output directory.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const {
  buildBrowserContextOptions,
  getOpenplanBaseUrl,
  getOutputDir,
} = require('./harness-env');
const { uncoveredMapFraction } = require('./map-reading-geometry');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);

/** The route the map-reading control lives on. Overridable for /aerial. */
const MAP_SURFACE = process.env.OPENPLAN_MAP_SURFACE || '/safety';

/**
 * The floor the mode has to clear. The design target is most of the window;
 * 60% leaves room for the rail, the header, the dock and a workspace carrying
 * several coverage notes, and is still far above the ~13% measured with the
 * page panel in place.
 */
const UNCOVERED_FLOOR = Number(process.env.OPENPLAN_MAP_UNCOVERED_FLOOR || 0.6);

const VIEWPORT = {
  width: Number(process.env.OPENPLAN_AUDIT_WIDTH || 1920),
  height: Number(process.env.OPENPLAN_AUDIT_HEIGHT || 1080),
};

function absoluteUrl(baseUrl, target) {
  return new URL(target, baseUrl).toString();
}

async function signIn(page, baseUrl) {
  const email = process.env.OPENPLAN_MAP_READING_EMAIL;
  const password = process.env.OPENPLAN_MAP_READING_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'OPENPLAN_MAP_READING_EMAIL and OPENPLAN_MAP_READING_PASSWORD are required — this audit ' +
        'measures a signed-in page and there is no anonymous equivalent of it.',
    );
  }

  await page.goto(absoluteUrl(baseUrl, '/sign-in'), { waitUntil: 'networkidle' });
  await page.getByLabel(/work email|email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForFunction(
    () =>
      !window.location.pathname.startsWith('/sign-in') ||
      Boolean(document.querySelector('[role="alert"]')),
    { timeout: 15_000 },
  );
  if (page.url().includes('/sign-in')) {
    const alert = await page.locator('[role="alert"]').first().innerText().catch(() => null);
    throw new Error(`Sign-in did not complete${alert ? `: ${alert}` : '.'}`);
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/**
 * Every element currently painting over the map, as viewport rectangles.
 *
 * COMPUTED STYLE DECIDES, NOT THE SELECTOR LIST. A panel that is
 * `visibility: hidden` or `display: none` covers nothing, and the whole point of
 * map-reading mode is that the surface becomes exactly that. Reading the class
 * list alone would report the panel as covering the map in both states and this
 * audit would never be able to tell them apart.
 */
async function measure(page) {
  return page.evaluate(() => {
    const SELECTORS = [
      '.op-cart-surface',
      '.op-cart-rail',
      '.op-cart-hdr',
      '.op-cart-layers',
      '.op-cart-legend',
      '.op-cart-mapread',
      '.op-cart-account',
      '.op-cart-inspector',
    ];

    const covering = [];
    const seen = [];
    for (const selector of SELECTORS) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const paints =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.05 &&
          rect.width > 0 &&
          rect.height > 0;
        seen.push({
          selector,
          paints,
          opacity: style.opacity,
          visibility: style.visibility,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        });
        if (paints) {
          covering.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        }
      }
    }

    const surface = document.querySelector('.op-cart-surface');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      covering,
      elements: seen,
      surfaceInert: surface ? surface.hasAttribute('inert') : null,
      surfaceAriaHidden: surface ? surface.getAttribute('aria-hidden') : null,
      bodyMapReading: document.body.dataset.mapReading ?? null,
      layersPanelPresent: Boolean(document.querySelector('.op-cart-layers')),
    };
  });
}

async function main() {
  const baseUrl = getOpenplanBaseUrl();
  const browser = await chromium.launch();
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: VIEWPORT }));
  const page = await context.newPage();
  const failures = [];
  const record = { generatedAt: new Date().toISOString(), baseUrl, mapSurface: MAP_SURFACE };

  try {
    await signIn(page, baseUrl);
    await page.goto(absoluteUrl(baseUrl, MAP_SURFACE), { waitUntil: 'networkidle' });

    const before = await measure(page);
    record.before = {
      ...before,
      uncoveredFraction: uncoveredMapFraction({
        viewport: before.viewport,
        covering: before.covering,
      }),
    };

    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, `${datePart}-map-reading-off.png`) });

    const toggle = page.getByRole('button', { name: /read the map/i });
    if ((await toggle.count()) === 0) {
      throw new Error(
        `No "Read the map" control on ${MAP_SURFACE}. Either the route is not in ` +
          'MAP_SURFACE_ROUTES or the control was removed from the map dock — in both cases a ' +
          'planner on this page cannot see their own layers.',
      );
    }

    // Keyboard, not mouse. A control a planner cannot reach with Tab is not a
    // control; asserting the state changed after a real key press is the only
    // way this audit can say so.
    await toggle.first().focus();
    const focusVisible = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return null;
      const style = window.getComputedStyle(active);
      return {
        isTheToggle: active.classList.contains('op-cart-mapread__btn'),
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
      };
    });
    record.focus = focusVisible;
    if (!focusVisible || !focusVisible.isTheToggle) {
      failures.push('The map-reading control did not accept keyboard focus.');
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400); // the fade is 180ms; this clears it

    const after = await measure(page);
    const uncovered = uncoveredMapFraction({
      viewport: after.viewport,
      covering: after.covering,
    });
    record.after = { ...after, uncoveredFraction: uncovered };

    await page.screenshot({ path: path.join(outputDir, `${datePart}-map-reading-on.png`) });

    if (uncovered < UNCOVERED_FLOOR) {
      failures.push(
        `Only ${(uncovered * 100).toFixed(1)}% of the viewport is map in map-reading mode, ` +
          `under the ${(UNCOVERED_FLOOR * 100).toFixed(0)}% floor. The page panel is still ` +
          'covering the map a planner asked to read.',
      );
    }
    if (after.surfaceInert !== true) {
      failures.push('The page panel is off screen but still in the tab order (no `inert`).');
    }
    if (!after.layersPanelPresent) {
      failures.push(
        'The layers panel went away with the page. A planner can now see the map and can no ' +
          'longer choose what is on it.',
      );
    }
    if (record.before.uncoveredFraction >= uncovered) {
      failures.push(
        'Map-reading mode did not uncover any more map than the ordinary page did — the mode ' +
          'is not doing anything.',
      );
    }

    // And back again, by the keyboard route that does not involve the button.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const restored = await measure(page);
    record.restored = restored;
    if (restored.surfaceInert !== false || restored.bodyMapReading !== null) {
      failures.push('Escape did not bring the page back.');
    }
  } finally {
    await context.close();
    await browser.close();
  }

  record.failures = failures;
  fs.mkdirSync(outputDir, { recursive: true });
  const recordPath = path.join(outputDir, `${datePart}-map-reading-audit.json`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));

  console.log(`Map with the page showing : ${(record.before.uncoveredFraction * 100).toFixed(1)}%`);
  console.log(`Map in map-reading mode   : ${(record.after.uncoveredFraction * 100).toFixed(1)}%`);
  console.log(`Record: ${recordPath}`);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log('Map-reading audit passed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
