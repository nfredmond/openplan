/**
 * IS THERE A DOOR OUT OF THIS ROOM? — measured in a real browser.
 *
 * ═══ WHAT THIS REPLACES ═══
 *
 * `src/test/safety-map-runs-to-the-edge.test.ts` used to assert that /safety's
 * full-screen map keeps its navigation rail, by forbidding two spellings in the
 * stylesheet: `display: none` and `visibility: hidden`. Adding
 * `opacity: 0; pointer-events: none` to the rail left all 26 of its tests green
 * and left /safety a full-screen map with no visible way off it. A guard that
 * enumerates spellings loses to the next spelling, every time.
 *
 * This asks the PROPERTY instead, and it can only be asked here: from the
 * rendered page, is there at least one control that a person can both SEE and
 * PRESS which takes them somewhere else? `getBoundingClientRect` plus computed
 * opacity answers the seeing; `document.elementFromPoint` at the control's own
 * centre answers the pressing; and then Playwright performs a REAL click and
 * the URL has to change. jsdom has no box model, no stylesheet and no
 * `elementFromPoint` — it cannot see any of this, which is why this is not a
 * vitest file. `el.click()` in page script would be no better: it dispatches an
 * event and bypasses hit-testing, so it reports success on a button no human
 * could press. The click below is a real one and is allowed to fail.
 *
 * The judgement itself is `pointer-reachability.js`, verified without a browser
 * by `pointer-reachability.test.js`. When this script says "no way out", the
 * meaning of that verdict has already been shown able to fail; only the
 * measurements come from the live run.
 *
 * ═══ THE TWO ROOMS ═══
 *
 *   /safety          a planner's full-screen map. The door is the nav rail —
 *                    they came from another module and are going to another.
 *   /engage/<token>  a resident's public map. The door is a single link, and
 *                    there is no rail behind it to fall back on.
 *
 * ═══ WHAT IT CANNOT PROVE ═══
 *
 * Contrast. A link painted background-on-background passes every check here.
 * And it cannot say a door is DISCOVERABLE — only that it exists, is visible,
 * and works.
 *
 * ═══ RUNNING IT ═══
 *
 *   OPENPLAN_BASE_URL=http://localhost:3200 \
 *   OPENPLAN_ESCAPE_EMAIL=mapaudit@openplan.test \
 *   OPENPLAN_ESCAPE_PASSWORD=… \
 *   OPENPLAN_ENGAGE_TOKENS=localengage041754,localengage042045 \
 *   OPENPLAN_BROWSER_CHANNEL=chrome \
 *   node openplan-local-escape-hatch-audit.js
 *
 * It needs a signed-in session on a running local instance, so it is a
 * `local-*` script and is not part of any automated gate. It writes a JSON
 * record and a screenshot per route into the dated output directory.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { buildBrowserContextOptions, getOpenplanBaseUrl, getOutputDir } = require('./harness-env');
const { findWaysOut, describeSample } = require('./pointer-reachability');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);

const VIEWPORT = {
  width: Number(process.env.OPENPLAN_AUDIT_WIDTH || 1600),
  height: Number(process.env.OPENPLAN_AUDIT_HEIGHT || 900),
};

/**
 * Signed-in routes to check. /safety is the one this was written for; the list
 * is an env var because every full-bleed map route has the same failure mode
 * and adding one should not need a code change.
 */
const SIGNED_IN_ROUTES = (process.env.OPENPLAN_ESCAPE_ROUTES || '/safety')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const ENGAGE_TOKENS = (process.env.OPENPLAN_ENGAGE_TOKENS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

/**
 * Links that leave the route but not the room. Signing out is not a way to
 * reach another module, and a link back into the same public map with a
 * different query is not a door either.
 */
const NOT_A_DOOR = ['/sign-out', '/api/'];

function absoluteUrl(baseUrl, target) {
  return new URL(target, baseUrl).toString();
}

async function signIn(page, baseUrl) {
  const email = process.env.OPENPLAN_ESCAPE_EMAIL;
  const password = process.env.OPENPLAN_ESCAPE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'OPENPLAN_ESCAPE_EMAIL and OPENPLAN_ESCAPE_PASSWORD are required — the signed-in half of ' +
        'this audit measures a planner’s page and there is no anonymous equivalent of it.',
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
    { timeout: 20_000 },
  );
  if (page.url().includes('/sign-in')) {
    const alert = await page.locator('[role="alert"]').first().innerText().catch(() => null);
    throw new Error(`Sign-in did not complete${alert ? `: ${alert}` : '.'}`);
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/**
 * One room, one verdict.
 *
 * The check has two halves and both must hold. The measurement finds a control
 * that is painted, big enough, inside the window and not covered. The real
 * click then proves the browser agrees: Playwright's click performs its own hit
 * test against the point it is about to press and refuses rather than
 * pretending. A measurement that says "reachable" and a click that times out
 * would be a bug in this module and is worth knowing about.
 */
async function auditRoute(page, { baseUrl, route, label, screenshotName }) {
  await page.goto(absoluteUrl(baseUrl, route), { waitUntil: 'networkidle' });
  // Map routes paint their chrome after the style loads; a rail measured mid
  // transition reads as half-transparent and this check would flap.
  await page.waitForTimeout(1200);

  const here = new URL(page.url()).pathname;
  const candidates = await findWaysOut(page, { currentPath: here, ignorePathPrefixes: NOT_A_DOOR });
  const reachable = candidates.filter((candidate) => candidate.reachable);

  fs.mkdirSync(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `${datePart}-escape-${screenshotName}.png`);
  await page.screenshot({ path: screenshotPath });

  const result = {
    label,
    route,
    landedOn: here,
    viewport: VIEWPORT,
    candidateCount: candidates.length,
    reachableCount: reachable.length,
    candidates: candidates.map((candidate) => ({
      label: candidate.ariaLabel || candidate.text || candidate.selector,
      href: candidate.href,
      rect: candidate.rect,
      effectiveOpacity: candidate.effectiveOpacity,
      display: candidate.display,
      visibility: candidate.visibility,
      pointerEvents: candidate.pointerEvents,
      hitTop: candidate.hitTopDescription,
      reachable: candidate.reachable,
      reason: candidate.reason,
    })),
    screenshot: screenshotPath,
    failures: [],
  };

  if (candidates.length === 0) {
    result.failures.push(
      `${label}: ${here} has no link to any other route at all. Whatever a planner came here to ` +
        'do, the only way on is the browser’s own back button.',
    );
    return result;
  }

  if (reachable.length === 0) {
    const why = candidates.slice(0, 6).map((candidate) => `    · ${describeSample(candidate)}`);
    result.failures.push(
      `${label}: ${here} has ${candidates.length} link(s) to other routes and NOT ONE of them is ` +
        'both visible and pressable. This is a room with no door:\n' + why.join('\n'),
    );
    return result;
  }

  // THE REAL CLICK. Not `el.click()` — that dispatches an event and would
  // succeed on a link under an overlay. This is the pointer.
  const chosen = reachable[0];
  const target = new URL(chosen.resolvedHref).pathname;
  result.clicked = { label: chosen.ariaLabel || chosen.text || chosen.selector, href: chosen.href, target };
  try {
    await page
      .locator('a[href]')
      .nth(chosen.index)
      .click({ timeout: 8_000 });
    await page.waitForURL((url) => new URL(url).pathname !== here, { timeout: 15_000 });
    result.clickedTo = new URL(page.url()).pathname;
  } catch (error) {
    result.failures.push(
      `${label}: the way out measured as reachable (${describeSample(chosen)}) but a real click ` +
        `on it did not leave ${here}: ${error.message.split('\n')[0]}`,
    );
  }

  return result;
}

async function main() {
  const baseUrl = getOpenplanBaseUrl();
  const channel = process.env.OPENPLAN_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch(channel ? { channel } : {});
  const record = { generatedAt: new Date().toISOString(), baseUrl, viewport: VIEWPORT, routes: [] };
  const failures = [];

  try {
    // The planner's rooms, signed in.
    const context = await browser.newContext(buildBrowserContextOptions({ viewport: VIEWPORT }));
    const page = await context.newPage();
    try {
      await signIn(page, baseUrl);
      for (const route of SIGNED_IN_ROUTES) {
        const result = await auditRoute(page, {
          baseUrl,
          route,
          label: 'planner',
          screenshotName: route.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'root',
        });
        record.routes.push(result);
        failures.push(...result.failures);
      }
    } finally {
      await context.close();
    }

    // The resident's room — a fresh, never-signed-in context, because a public
    // page that only has a door when a planner happens to be logged in is not a
    // public page with a door.
    if (ENGAGE_TOKENS.length > 0) {
      const publicContext = await browser.newContext(buildBrowserContextOptions({ viewport: VIEWPORT }));
      const publicPage = await publicContext.newPage();
      try {
        for (const token of ENGAGE_TOKENS) {
          const result = await auditRoute(publicPage, {
            baseUrl,
            route: `/engage/${token}`,
            label: 'resident',
            screenshotName: `engage-${token}`,
          });
          record.routes.push(result);
          failures.push(...result.failures);
        }
      } finally {
        await publicContext.close();
      }
    } else {
      record.engageSkipped =
        'OPENPLAN_ENGAGE_TOKENS was empty — the public map half of this audit did not run.';
    }
  } finally {
    await browser.close();
  }

  record.failures = failures;
  fs.mkdirSync(outputDir, { recursive: true });
  const recordPath = path.join(outputDir, `${datePart}-escape-hatch-audit.json`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));

  for (const result of record.routes) {
    const clicked = result.clickedTo ? ` · clicked out to ${result.clickedTo}` : '';
    console.log(
      `${result.label.padEnd(9)} ${result.route.padEnd(28)} ` +
        `${result.reachableCount}/${result.candidateCount} ways out reachable${clicked}`,
    );
  }
  if (record.engageSkipped) console.log(record.engageSkipped);
  console.log(`Record: ${recordPath}`);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log('Every audited route has a visible, pressable way out.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
