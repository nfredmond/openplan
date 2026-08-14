/**
 * THE FIRST-WEEK HARNESS — REGRESSION LAYER.
 *
 * WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT.
 * The discovery layer finds dead ends nobody had thought of. It cannot be run
 * on every change: it costs an agent session per job, it takes half an hour, and
 * it is not deterministic — the same job run twice can take two different routes
 * through the product and report two different things. That variability is the
 * source of its value and the reason it can never be a gate.
 *
 * This is the other half. Every dead end the discovery layer CONFIRMS gets one
 * short deterministic script here: sign in, go there, click that, assert you
 * land where a planner needs to land. It runs in seconds and it fails loudly.
 *
 * A script only ever tests what somebody already thought of. That is why it
 * cannot do discovery's job — and it is exactly why it can do this one. A fixed
 * problem stays fixed only if something cheap notices when it comes back, and
 * the fixes this catalogues are UX fixes, which are the kind that quietly rot
 * when a component two lanes away gets restyled.
 *
 * A SCRIPT IN HERE MUST NAME ITS ORIGIN. The `finding` field is the run and job
 * the dead end came from. A regression with no origin is somebody's guess about
 * what might break, and guesses belong in the unit tests, not here.
 *
 * `status` — AND WHY IT GATES IN BOTH DIRECTIONS.
 * Discovery confirms dead ends faster than anybody fixes them, and the person
 * who confirms one is often not the person who may touch that code. So a script
 * can be written before the fix exists:
 *
 *   status: 'fixed'  the dead end is closed. The script asserts the good
 *                    behaviour and MUST PASS. Failing means it came back.
 *   status: 'open'   the dead end is confirmed and still there. The script
 *                    asserts the behaviour a planner needs and is EXPECTED TO
 *                    FAIL. Passing means somebody fixed it.
 *
 * BOTH directions exit non-zero, and that is the point. An `open` script that
 * starts passing fails the run with "somebody fixed this — change status to
 * 'fixed' in that commit", because a fix nobody records is a fix nothing
 * protects. This is the same equality-not-ceiling rule the card-nesting budget
 * uses: getting better is also a change, and a change that is not written down
 * gets undone by the next lane.
 *
 * `status: 'open'` is NOT a snooze button. It is a work item that shouts every
 * time the suite runs, and it stops shouting only when the behaviour changes.
 *
 * WRITING ONE
 *   module.exports = {
 *     id: 'short-kebab-id',
 *     status: 'open',
 *     finding: '<run stamp> / <job id> — the confirmed finding, in one line',
 *     why: 'What a planner could not do, in plain words.',
 *     async run({ page, baseUrl, expect }) {
 *       await page.goto(`${baseUrl}/somewhere`, { waitUntil: 'domcontentloaded' });
 *       expect(await page.getByRole('link', { name: /…/i }).count() > 0, 'why it matters');
 *     },
 *   };
 *
 * ASSERT ON WHAT A PLANNER CAN REACH, not on markup. `getByRole` and visible
 * text survive a restyle; a class name does not, and a regression that fails
 * every time somebody changes a colour gets deleted within a month.
 *
 * USAGE
 *   OPENPLAN_BASE_URL=http://localhost:3200 \
 *   OPENPLAN_FIRST_WEEK_EMAIL=… OPENPLAN_FIRST_WEEK_PASSWORD=… \
 *   npm run first-week-regression
 *   ... npm run first-week-regression -- --only <id>
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { assertLocalTargetUrl, buildBrowserContextOptions } = require('./harness-env');

const REGRESSIONS_DIR = path.join(__dirname, 'first-week-regressions');
const SCREENSHOT_DIR = path.join(__dirname, 'first-week-runs', 'regression-failures');

/** `dir` is a parameter only so the refusals below can be tested on fixtures. */
function loadRegressions(dir = REGRESSIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.regression.js'))
    .sort()
    .map((name) => {
      const mod = require(path.join(dir, name));
      for (const field of ['id', 'finding', 'why', 'run']) {
        if (!mod[field]) throw new Error(`${name} is missing "${field}". A regression must name the finding it came from.`);
      }
      if (mod.status !== 'open' && mod.status !== 'fixed') {
        throw new Error(`${name} must declare status: 'open' or 'fixed'. Without it nobody knows whether a pass is good news.`);
      }
      // An `open` script is expected to fail, so a failure is not evidence on
      // its own — a broken selector, a missing fixture or a timeout all fail
      // too, and all three would read as "still broken, as reported". The
      // pattern pins WHICH failure counts.
      if (mod.status === 'open' && !(mod.expectedFailure instanceof RegExp)) {
        throw new Error(
          `${name} is 'open' and must declare expectedFailure: /…/ — the message that proves it failed for the reported reason, not because the script broke.`,
        );
      }
      return mod;
    });
}

class RegressionFailure extends Error {}

function expect(condition, message) {
  if (!condition) throw new RegressionFailure(message);
}

/**
 * What one script's outcome MEANS. Pulled out of the loop so it can be tested
 * without a browser — this is the part that decides whether the run gates, and
 * a gate whose logic is only exercised by running it is a gate nobody has
 * checked. See `first-week-regression.test.js`.
 *
 * Returns one of:
 *   'still-fixed'      a 'fixed' script passed. Good news.
 *   'still-open'       an 'open' script failed for its recorded reason. Known
 *                      work, not a run failure.
 *   'regressed'        a 'fixed' script failed. The dead end came back.
 *   'unrecorded-fix'   an 'open' script passed. Somebody fixed it and did not
 *                      say so, and nothing protects the fix.
 *   'wrong-failure'    an 'open' script failed for some OTHER reason. The
 *                      script is broken and proves nothing.
 */
function classifyResult(regression, error) {
  const passed = error === null || error === undefined;
  if (regression.status === 'fixed') return passed ? 'still-fixed' : 'regressed';
  if (passed) return 'unrecorded-fix';
  return regression.expectedFailure.test(String(error.message)) ? 'still-open' : 'wrong-failure';
}

const GATING_OUTCOMES = new Set(['regressed', 'unrecorded-fix', 'wrong-failure']);

async function signIn(page, { baseUrl, email, password }) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  // `waitUntil: 'commit'` because the default waits for the whole landing page
  // to finish loading, and this signs in against a dev server that may be
  // serving other work at the same time. Leaving /sign-in is the thing being
  // waited for; each script then waits for what it actually needs.
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 90000, waitUntil: 'commit' }),
    page.getByRole('button', { name: /^sign in$/i }).click(),
  ]);
}

async function main() {
  const only = (() => {
    const idx = process.argv.indexOf('--only');
    return idx === -1 ? null : process.argv[idx + 1];
  })();

  const baseUrl = (process.env.OPENPLAN_BASE_URL || '').trim();
  if (!baseUrl) {
    console.error('OPENPLAN_BASE_URL is required — a regression run always names the deployment it checked.');
    process.exit(2);
  }
  // These scripts sign in and click through a real workspace. Local only, for
  // the same reason the mutating smokes are.
  assertLocalTargetUrl(baseUrl, 'First-week regression base URL');

  const email = (process.env.OPENPLAN_FIRST_WEEK_EMAIL || '').trim();
  const password = (process.env.OPENPLAN_FIRST_WEEK_PASSWORD || '').trim();
  if (!email || !password) {
    console.error('OPENPLAN_FIRST_WEEK_EMAIL and OPENPLAN_FIRST_WEEK_PASSWORD are required.');
    process.exit(2);
  }

  const regressions = loadRegressions().filter((r) => !only || r.id === only);
  if (!regressions.length) {
    console.error(only ? `No regression with id ${only}.` : 'No regressions are recorded yet.');
    process.exit(2);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 900 } }));
  const page = await context.newPage();
  await signIn(page, { baseUrl, email, password });

  console.log(`first-week regressions against ${baseUrl}\n`);
  const failures = [];

  for (const regression of regressions) {
    const scoped = await context.newPage();
    let error = null;
    try {
      await regression.run({ page: scoped, context, baseUrl, expect, email, password });
    } catch (thrown) {
      error = thrown;
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const shot = path.join(SCREENSHOT_DIR, `${regression.id}.png`);
      await scoped.screenshot({ path: shot, fullPage: true }).catch(() => {});
      error.screenshot = shot;
    } finally {
      await scoped.close().catch(() => {});
    }

    const outcome = classifyResult(regression, error);
    if (GATING_OUTCOMES.has(outcome)) failures.push({ regression, error, outcome });

    if (outcome === 'still-fixed') {
      console.log(`  ok    ${regression.id} — still fixed`);
    } else if (outcome === 'still-open') {
      // An open dead end behaving exactly as reported. Not a failure of this
      // run, but it is not "ok" either, and it should read that way.
      console.log(`  OPEN  ${regression.id} — still broken, as reported`);
      console.log(`        ${regression.why}`);
      console.log(`        ${error.message}`);
    } else if (outcome === 'regressed') {
      console.error(`  FAIL  ${regression.id} — this was fixed and has come back`);
      console.error(`        ${error.message}`);
      console.error(`        came from: ${regression.finding}`);
      console.error(`        screenshot: ${error.screenshot}`);
    } else if (outcome === 'unrecorded-fix') {
      console.error(`  FAIL  ${regression.id} — this now PASSES, so somebody fixed it`);
      console.error(`        Set status: 'fixed' in first-week-regressions/${regression.id}.regression.js`);
      console.error(`        in the same commit as the fix, or nothing protects it.`);
    } else {
      console.error(`  FAIL  ${regression.id} — failed, but not for the reported reason`);
      console.error(`        expected a message matching ${regression.expectedFailure}`);
      console.error(`        got: ${error.message}`);
      console.error(`        The script itself is probably broken. Fix it, or this tells you nothing.`);
    }
  }

  await browser.close();

  const open = regressions.filter((r) => r.status === 'open').length;
  if (failures.length) {
    const count = (kind) => failures.filter((f) => f.outcome === kind).length;
    console.error(
      `\n${count('regressed')} came back, ${count('unrecorded-fix')} were fixed without being recorded, ` +
        `${count('wrong-failure')} script(s) are themselves broken.`,
    );
    process.exit(1);
  }
  console.log(
    `\n${regressions.length - open} confirmed dead end(s) still fixed; ${open} still open and waiting for somebody.`,
  );
}

module.exports = { GATING_OUTCOMES, classifyResult, loadRegressions };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
