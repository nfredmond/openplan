#!/usr/bin/env node
/**
 * Second proven job, one journey: a staff account signs up, makes a project,
 * sets its place, records a proposed decision, and runs a public comment
 * campaign labeled as a demonstration. Anonymous participants, each in their
 * own browser context, send a map point, a comment with no map point, a
 * contribution made at 390 px with the keyboard only, and a comment that is
 * then rejected. Staff approve three and reject one with a reason, write and
 * approve a staff review, publish a response linked to the comments and to
 * the decision, and request the internal and public review files. The
 * journey reads the counts from every file and from the public response page
 * and refuses to pass when they disagree; searches every public surface for
 * the rejected comment; runs axe; asks for staff-only records as an anonymous
 * participant and as a second account; and closes the campaign at the end.
 *
 * Browser only, as the first job's journey is: no service-role key, no
 * database write, no API call in place of a screen step. Responses the screens
 * request are read for ids. The anonymous and second-account checks are
 * requests a person could make by pasting a link; they exist to show nothing
 * comes back.
 *
 * Modes: rehearsal (local origins only) and proof (the hosted proof origin
 * only), with the first job's guards (first-job-journey-lib.js).
 *
 * Inputs: --inputs names a JSON file of every string the journey types
 * (engagement-job-journey-lib.js, validateEngagementInputs). The campaign's
 * title and invitation must say "Demonstration by an automated OpenPlan proof
 * run" in both modes, and every comment must say it was entered by an
 * automated proof run and represents no one. Rehearsal without --inputs uses
 * fixtures/engagement-job-rehearsal-inputs.json; a proof refuses that file.
 * No AI feature is used: no translation, AI moderation, AI synthesis or AI
 * drafting control is pressed.
 *
 * Email confirmation: never an argument. The script waits for the file named
 * by --confirm-link-file (and --second-confirm-link-file), opens the link and
 * records only a SHA-256 of its token.
 *
 * Close at the end: whether the journey finishes or stops early, it sets the
 * campaign's status to Closed through the campaign settings form and checks
 * that the public address shows only the ended notice. The run file says
 * whether it tried and whether it worked.
 *
 * Output (in --out): engagement-journey-<role>.json, screenshots, scrubbed
 * console captures and the downloaded review files. Assemble three journey
 * files into one record with --assemble, then run the evidence checker on it.
 * See qa-harness/README.md.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appRoot } = require('./harness-env');
const first = require('./first-job-journey-lib');
const lib = require('./engagement-job-journey-lib');

const puppeteer = require(require.resolve('puppeteer-core', { paths: [appRoot] }));
const XLSX = require(require.resolve('xlsx', { paths: [appRoot] }));
const AXE_SOURCE = path.join(appRoot, 'node_modules', 'axe-core', 'axe.min.js');

const STEPS = [
  'health-start', 'sign-up', 'confirm-email', 'create-project', 'set-study-place', 'record-decision',
  'create-campaign', 'activate-campaign', 'contribute-map-point', 'contribute-no-map-point',
  'contribute-keyboard-390', 'contribute-to-reject', 'moderate', 'staff-review', 'publish-response',
  'link-decision', 'request-review-files', 'download-review-files', 'read-counts', 'search-rejected-text',
  'screens', 'participant-checks', 'cross-workspace', 'close-campaign', 'health-end',
];
const PLACE_KIND_LABELS = { county: 'County', city: 'City / town', cdp: 'Census-designated place', aiannh: 'Tribal area', cousub: 'Town or township' };
const STAFF_SCREENS = [
  { slug: 'staff-campaign', tab: null },
  { slug: 'staff-campaign-responses', tab: 'responses' },
  { slug: 'staff-campaign-analysis', tab: 'analysis' },
  { slug: 'staff-campaign-record', tab: 'record' },
];

function log(message) {
  process.stdout.write(`[engagement-journey] ${message}\n`);
}

function chromePath() {
  const candidates = [
    process.env.OPENPLAN_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No Chrome found. Set OPENPLAN_CHROME_PATH.');
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Click the first visible, enabled element matching `selector` whose text matches. Fails loudly. */
async function clickText(scope, selector, text, { exact = false, timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const clicked = await scope.evaluate((sel, wanted, isExact) => {
      const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const candidates = [...document.querySelectorAll(sel)].filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !el.disabled;
      });
      const match = candidates.find((el) => {
        const label = norm(el.innerText || el.getAttribute('aria-label'));
        return isExact ? label === wanted : label.includes(wanted);
      });
      if (!match) return false;
      match.scrollIntoView({ block: 'center' });
      match.click();
      return true;
    }, selector, text, exact);
    if (clicked) return;
    if (Date.now() > deadline) throw new Error(`No enabled ${selector} reading "${text}" on ${scope.url ? new URL(scope.url()).pathname : 'the page'}`);
    await sleep(500);
  }
}

/** A form control by the visible text of its label (wrapping label or label[for]). */
async function controlByLabel(page, labelText, { within = 'body', nth = 0, exact = false } = {}) {
  const handle = await page.evaluateHandle((scopeSel, wanted, index, isExact) => {
    const scope = document.querySelector(scopeSel);
    if (!scope) return null;
    const own = (label) => {
      const clone = label.cloneNode(true);
      clone.querySelectorAll('input,select,textarea,option,button').forEach((el) => el.remove());
      return clone.textContent.replace(/\s+/g, ' ').trim();
    };
    const hits = [];
    for (const label of scope.querySelectorAll('label')) {
      const text = own(label);
      if (isExact ? text !== wanted : !text.startsWith(wanted)) continue;
      const control = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input,select,textarea');
      if (control && control.getBoundingClientRect().width > 0) hits.push(control);
    }
    return hits[index] || null;
  }, within, labelText, nth, exact);
  const element = handle.asElement();
  if (!element) throw new Error(`No visible control labeled "${labelText}" in ${within}`);
  return element;
}

/** Replace a field's text the way a person does (select all, type over it), then check it took. */
async function typeInto(element, value) {
  await element.focus();
  const page = element.frame.page();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await element.type(String(value));
  const now = await element.evaluate((el) => el.value);
  if (now !== String(value)) throw new Error(`A field reads "${now.slice(0, 60)}" after typing "${String(value).slice(0, 60)}".`);
}

/** Select the option whose text includes `text`; returns its value. */
async function selectByText(element, text) {
  const value = await element.evaluate((select, wanted) => {
    const option = [...select.options].find((entry) => entry.text.includes(wanted) && !entry.disabled);
    return option ? option.value : null;
  }, text);
  if (value === null) throw new Error(`No option containing "${text.slice(0, 60)}"`);
  await element.select(value);
  return value;
}

/**
 * Let a page finish loading. The review files panel polls every 3 seconds, so
 * some campaign pages never go idle; every step that needs a result waits for
 * that result explicitly, so this wait is capped at 15 seconds.
 */
async function settle(page, ms = 1500) {
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {});
  await sleep(ms);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** A request in `page`'s session (or none), as a pasted link would make it. Returns the status and enough of the body to judge it. */
async function pageFetch(page, route) {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'include' });
    const buffer = new Uint8Array(await response.arrayBuffer());
    const head = String.fromCharCode(...buffer.slice(0, 5));
    return { status: response.status, head, text: new TextDecoder().decode(buffer.slice(0, 400000)) };
  }, route);
}

async function waitForDownload(dir, before, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = fs.readdirSync(dir).filter((file) => !before.has(file) && !file.endsWith('.crdownload') && !file.endsWith('.tmp'));
    if (fresh.length) {
      await sleep(500);
      return path.join(dir, fresh[0]);
    }
    await sleep(500);
  }
  throw new Error('The download did not arrive.');
}

/** Every sheet as rows of cell values, the way the evidence checker reads a workbook. */
function workbookSheets(file) {
  const workbook = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  return Object.fromEntries(workbook.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' })]));
}

function workbookText(sheets) {
  return Object.entries(sheets).map(([name, rows]) => `${name}\n${rows.map((row) => row.join('\t')).join('\n')}`).join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--assemble') return assembleMain(argv.slice(1));
  const job = lib.loadJobDefinition();
  const options = lib.parseEngagementArgs(argv, job);
  const proofOrigin = await first.loadProofOrigin();
  const origin = first.checkJourneyOrigin(options.mode, options.baseUrl, proofOrigin);
  if (!fs.existsSync(AXE_SOURCE)) throw new Error(`axe-core not found at ${AXE_SOURCE}. Run npm ci in openplan/.`);
  const loadedInputs = lib.loadEngagementInputs(options.mode, options.inputsFile);
  const inputs = loadedInputs.inputs;
  const names = first.workspaceNames(inputs, options.placeQuery);
  log(`inputs: ${path.basename(loadedInputs.file)} (sha256 ${loadedInputs.sha256.slice(0, 12)})`);

  const out = options.outDir;
  for (const dir of ['', 'screens', 'console', 'downloads', 'files', 'net']) fs.mkdirSync(path.join(out, dir), { recursive: true });
  const downloads = path.join(out, 'downloads');

  const executors = [
    { role: 'staff', agent: options.executorAgent, model: options.executorModel },
    { role: 'public-participant', agent: options.executorAgent, model: options.executorModel },
  ];
  const state = {
    role: options.role,
    executors,
    health: [],
    screens: [],
    pdfs: [],
    workbooks: [],
    publicPage: { readings: [] },
    campaign: {
      campaignId: null,
      projectId: null,
      portalAddressKind: 'share-token',
      aiFeaturesUsed: false,
      contributions: [],
      moderation: [],
      rejectedTextSha256: [],
      rejectedTexts: [],
      staffReview: null,
      response: null,
    },
  };
  const ids = { submissions: {} };
  const findings = [];
  const steps = [];
  const secrets = [];
  const password = `Ej-${crypto.randomBytes(18).toString('base64url')}`;
  const secondPassword = `Ej-${crypto.randomBytes(18).toString('base64url')}`;
  secrets.push(password, secondPassword);
  const consoleErrors = [];
  const crossChecks = [];
  const participantChecks = { refusals: [], publicRead: null };
  const countTable = [];
  let rejectedSearch = null;
  let closeReading = null;

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: !options.headed,
    args: ['--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error && error.message)));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(downloads), browserContextId: context.id, eventsEnabled: true });

  const observed = { places: [], records: [] };
  page.on('response', async (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname === '/api/geographies/places' && response.ok()) {
        const body = await readJson(response);
        if (body) observed.places.push(body);
      }
      if (/^\/api\/projects\/[^/]+\/records$/.test(url.pathname) && response.request().method() === 'POST') {
        observed.records.push({ status: response.status(), body: await readJson(response) });
      }
    } catch {
      // A response that cannot be read is not evidence of anything.
    }
  });

  const go = async (route, target = page) => {
    await target.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await settle(target);
  };
  const tokenOf = () => (ids.portalPath ? ids.portalPath.split('/').pop() : null);
  const hideToken = (text) => (tokenOf() ? String(text).split(tokenOf()).join('<token>') : String(text));

  function step(name, fn) {
    return async () => {
      const entry = { step: name, startedAt: first.utcNow(), status: 'running' };
      steps.push(entry);
      log(`${name}...`);
      try {
        const detail = await fn();
        entry.status = 'passed';
        if (detail) entry.detail = first.scrubText(hideToken(typeof detail === 'string' ? detail : JSON.stringify(detail)), secrets);
        log(`${name}: passed${entry.detail ? ` (${entry.detail})` : ''}`);
      } catch (error) {
        entry.status = 'failed';
        entry.error = first.scrubText(hideToken(error && error.message ? error.message.split('\n')[0] : String(error)), secrets);
        await page.screenshot({ path: path.join(out, 'screens', `failed-${name}.png`), fullPage: false }).catch(() => {});
        throw Object.assign(new Error(`Stopped at ${name}: ${entry.error}`), { journeyStep: name });
      } finally {
        entry.endedAt = first.utcNow();
      }
    };
  }

  async function health(point) {
    const response = await fetch(new URL('/api/health', origin), { headers: { accept: 'application/json' } });
    const body = await response.json();
    const commit = body && body.deployment ? String(body.deployment.commit) : 'missing';
    const reading = {
      point,
      checkedAt: first.utcNow(),
      status: String(body.status || response.status),
      commit,
      version: String(body.deployment ? body.deployment.version : 'missing'),
      migrationsExpected: body.deployment && body.deployment.migrations ? body.deployment.migrations.expected ?? null : null,
      migrationsLatest: body.deployment && body.deployment.migrations ? body.deployment.migrations.latest ?? null : null,
    };
    state.health.push(reading);
    if (!/^[0-9a-f]{7,40}$/.test(commit)) {
      findings.push({ id: 'health-commit-not-reported', text: `/api/health reports commit "${commit}" at the ${point}, so the run cannot name the build it tested.` });
      if (options.mode === 'proof') throw new Error(`/api/health reports commit "${commit}"`);
    } else if (options.expectedCommit && !options.expectedCommit.startsWith(commit) && !commit.startsWith(options.expectedCommit)) {
      throw new Error(`/api/health reports commit ${commit}, not ${options.expectedCommit}`);
    }
    return `${reading.status}, commit ${commit}, version ${reading.version}`;
  }

  /** Sign up through the screen, then confirm by the emailed link when the installation asks for one. */
  async function signUpAndConfirm(targetPage, email, accountPassword, confirmFile, organization) {
    await go('/sign-up', targetPage);
    await targetPage.type('#org-name', organization);
    await targetPage.type('#email', email);
    await targetPage.type('#password', accountPassword);
    const createdAt = first.utcNow();
    await clickText(targetPage, 'button[type=submit]', 'Create account', { exact: true });
    const outcome = await targetPage.waitForFunction(() => {
      if (!location.pathname.startsWith('/sign-up')) return 'session';
      const status = document.querySelector('[role=status]');
      if (status && /Confirm your email/.test(status.innerText)) return 'confirm';
      const alert = document.querySelector('[role=alert]');
      if (alert && alert.innerText.trim()) return `error:${alert.innerText.trim()}`;
      return false;
    }, { timeout: 60000, polling: 500 }).then((handle) => handle.jsonValue());
    if (String(outcome).startsWith('error:')) throw new Error(`Sign-up refused: ${String(outcome).slice(6)}`);
    if (outcome === 'session') return { createdAt, confirmationMethod: 'not_required', tokenSha256: null };
    if (!confirmFile) throw new Error('Sign-up asks for email confirmation; pass --confirm-link-file (or --second-confirm-link-file) and write the link there.');
    log(`waiting for the confirmation link in ${confirmFile} (up to ${options.confirmTimeoutMinutes} minutes)`);
    const deadline = Date.now() + options.confirmTimeoutMinutes * 60000;
    let link = '';
    while (Date.now() < deadline) {
      if (fs.existsSync(confirmFile)) {
        link = fs.readFileSync(confirmFile, 'utf8').trim();
        if (link) break;
      }
      await sleep(2000);
    }
    if (!link) throw new Error('No confirmation link arrived in the file before the timeout.');
    const tokenSha256 = first.confirmationTokenHash(link);
    secrets.push(link);
    const linkUrl = new URL(link);
    for (const key of ['token', 'token_hash', 'code']) if (linkUrl.searchParams.get(key)) secrets.push(linkUrl.searchParams.get(key));
    const allowed = [origin];
    if (options.mode === 'rehearsal') {
      if (!['localhost', '127.0.0.1'].includes(linkUrl.hostname)) throw new Error('A rehearsal confirmation link must be local.');
      allowed.push(linkUrl.origin);
    } else if (linkUrl.hostname.endsWith('.supabase.co')) {
      allowed.push(linkUrl.origin);
    }
    first.checkConfirmLinkOrigin(link, allowed);
    await targetPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 120000 });
    link = '';
    await settle(targetPage, 2500);
    if (targetPage.url().includes('/sign-in')) {
      await targetPage.type('#email', email);
      await targetPage.type('#password', accountPassword);
      await clickText(targetPage, 'button[type=submit]', 'Sign in');
      await targetPage.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 60000 });
    }
    if (!/\/dashboard|\/workspace|\/projects/.test(targetPage.url())) throw new Error(`After confirmation the browser is at ${new URL(targetPage.url()).pathname}, not the app.`);
    return { createdAt, confirmationMethod: 'email_link', tokenSha256 };
  }

  /**
   * One anonymous participant in a fresh browser context. `how` is pointer at
   * 1440 px (with or without a map point) or keyboard-only at 390 px. The kind
   * recorded is what the portal sent: a point or none.
   */
  async function contribute(key, how) {
    const resident = await browser.createBrowserContext();
    const portal = await resident.newPage();
    const width = how === 'keyboard' ? 390 : 1440;
    await portal.setViewport({ width, height: how === 'keyboard' ? 844 : 1000 });
    const shareToken = tokenOf();
    let sentBody = null;
    portal.on('request', (request) => {
      if (request.url().includes(`/api/engage/${shareToken}/submit`) && request.method() === 'POST') {
        try { sentBody = JSON.parse(request.postData() || '{}'); } catch { sentBody = {}; }
      }
    });
    const text = inputs.comments[key];
    const trail = [];
    try {
      await go(ids.portalPath, portal);
      await sleep(2500);
      if (key === 'mapPoint') {
        const shown = await portal.evaluate(() => document.body.innerText);
        if (!shown.toLowerCase().includes(lib.DEMONSTRATION_LABEL.toLowerCase())) throw new Error('The public portal does not show the demonstration label.');
      }
      if (how === 'pointer-map') {
        const canvas = await portal.waitForSelector('canvas', { visible: true, timeout: 60000 });
        const box = await canvas.boundingBox();
        await portal.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.42);
        await sleep(1200);
        await portal.screenshot({ path: path.join(out, 'screens', `contribution-${key}-marked-${width}.png`) });
        await clickText(portal, 'button', 'Next', { exact: true });
        await portal.waitForSelector('#portal-body', { visible: true });
        await portal.type('#portal-body', text);
        await clickText(portal, 'button', '5. Send it');
      } else if (how === 'pointer') {
        await clickText(portal, 'button', '2. Say what you think');
        await portal.waitForSelector('#portal-body', { visible: true });
        await portal.type('#portal-body', text);
        await clickText(portal, 'button', '5. Send it');
      } else {
        // Keyboard only: Tab, arrow keys, Enter and Space; no pointer event.
        const active = () => portal.evaluate(() => {
          const a = document.activeElement;
          return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''} ${(a.getAttribute('aria-label') || a.innerText || a.value || '').replace(/\s+/g, ' ').trim().slice(0, 60)}`;
        });
        const tabTo = async (pattern, max = 80) => {
          for (let i = 0; i < max; i += 1) {
            await portal.keyboard.press('Tab');
            const now = await active();
            trail.push(`Tab: ${now}`);
            if (pattern.test(now)) return true;
          }
          return false;
        };
        if (!(await tabTo(/^div Map of this project/))) throw new Error('The keyboard could not reach the map.');
        await portal.keyboard.press('Enter');
        trail.push('Enter on the map: marks the spot in the middle of the map');
        await sleep(1200);
        await portal.screenshot({ path: path.join(out, 'screens', `contribution-${key}-marked-${width}.png`) });
        if (!(await tabTo(/#portal-sheet-toggle/))) throw new Error('The keyboard could not reach the comment sheet toggle.');
        await portal.keyboard.press('Space');
        trail.push('Space on the comment sheet toggle');
        await sleep(1200);
        if (!(await tabTo(/^button Next$/))) throw new Error('The keyboard could not reach Next.');
        await portal.keyboard.press('Enter');
        trail.push(`Enter on Next; focus now ${await active()}`);
        await sleep(1000);
        if (!(await tabTo(/^textarea#portal-body/))) throw new Error('The keyboard could not reach the comment box.');
        await portal.keyboard.type(text);
        trail.push('typed the comment');
        let sent = false;
        for (let i = 0; i < 80 && !sent; i += 1) {
          await portal.keyboard.press('Tab');
          const now = await active();
          trail.push(`Tab: ${now}`);
          if (/^button Send(?: what I wrote)?$/.test(now)) {
            await portal.keyboard.press('Enter');
            trail.push('Enter on Send');
            sent = true;
          } else if (/^button Next$/.test(now)) {
            await portal.keyboard.press('Enter');
            trail.push(`Enter on Next; focus now ${await active()}`);
            await sleep(800);
          }
        }
        if (!sent) throw new Error('The keyboard could not reach Send.');
      }
      const submitted = portal.waitForResponse((r) => r.url().includes(`/api/engage/${shareToken}/submit`) && r.request().method() === 'POST', { timeout: 60000 });
      if (how !== 'keyboard') {
        await sleep(800);
        await clickText(portal, 'button[type=submit]', 'Send');
      }
      const response = await submitted;
      const body = await readJson(response);
      if (response.status() !== 201 || !body || !body.submissionId) throw new Error(`The portal submission answered ${response.status()}.`);
      await sleep(1500);
      await portal.screenshot({ path: path.join(out, 'screens', `contribution-${key}-sent-${width}.png`) });
      const pointSent = Boolean(sentBody && ((typeof sentBody.latitude === 'number' && typeof sentBody.longitude === 'number') || sentBody.geometry));
      const typed = sentBody && typeof sentBody.body === 'string' ? sentBody.body : null;
      if (typed !== null && typed.trim() !== text.trim()) throw new Error(`The portal sent text that differs from what was typed (${typed.length} of ${text.length} characters).`);
      const contribution = { commentId: body.submissionId, kind: pointSent ? 'map-point' : 'no-map-point', viewportWidth: width, input: how === 'keyboard' ? 'keyboard-only' : 'pointer' };
      if (how === 'pointer-map' && !pointSent) throw new Error('The map contribution was sent without a point.');
      if (how === 'pointer' && pointSent) throw new Error('The comment with no map point was sent with a point.');
      state.campaign.contributions.push(contribution);
      ids.submissions[key] = { id: body.submissionId, text };
      return `${contribution.kind}, ${contribution.input} at ${width} px, ${body.submissionId.slice(0, 8)}`;
    } finally {
      if (trail.length) fs.writeFileSync(path.join(out, `keyboard-trail-${options.role}.txt`), `${trail.join('\n')}\n`);
      await resident.close().catch(() => {});
    }
  }

  /** Approve or reject one contribution on the Responses tab, with a review reason. */
  async function moderateOne(key, outcome) {
    const item = ids.submissions[key];
    const opened = await page.evaluate((id) => {
      const button = [...document.querySelectorAll('nav[aria-label="Contributions on this page"] button')].find((b) => b.closest('[data-item-id]')?.getAttribute('data-item-id') === id);
      if (!button) return false;
      button.click();
      return true;
    }, item.id);
    if (!opened) await clickText(page, 'nav[aria-label="Contributions on this page"] button', item.text.slice(0, 40));
    const reasonBox = await page.waitForSelector(`#engagement-item-reason-${item.id}`, { timeout: 20000 });
    const reason = outcome === 'approved' ? inputs.reviewReasons.approve : inputs.reviewReasons.reject;
    await reasonBox.type(reason);
    let sent = null;
    const watch = (request) => {
      if (request.url().includes(`/items/${item.id}`) && request.method() === 'PATCH') {
        try { sent = JSON.parse(request.postData() || '{}'); } catch { sent = {}; }
      }
    };
    page.on('request', watch);
    const patched = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}/items/${item.id}`) && r.request().method() === 'PATCH', { timeout: 60000 });
    if (outcome === 'approved') {
      await clickText(page, 'button', 'Approve', { exact: true });
    } else {
      await page.select(`#engagement-item-status-${item.id}`, 'rejected');
      await clickText(page, 'button', 'Save item', { exact: true });
    }
    const response = await patched;
    page.off('request', watch);
    if (response.status() !== 200) throw new Error(`${outcome === 'approved' ? 'Approving' : 'Rejecting'} ${key} answered ${response.status()}.`);
    const reasonSent = Boolean(sent && [sent.reviewReason, sent.moderationNotes].some((value) => typeof value === 'string' && value.trim() === reason.trim()));
    state.campaign.moderation.push({ commentId: item.id, outcome, reasonRecorded: reasonSent });
    await sleep(1500);
    return `${key} ${outcome}${reasonSent ? ' with its reason' : ' WITHOUT the reason in the request'}`;
  }

  const R = 'section[aria-label="Retained staff reviews"]';
  const D = 'section[aria-label="Decision link editor"]';
  const waitPost = (fragment, timeout = 60000) => page.waitForResponse((r) => r.url().includes(fragment) && r.request().method() === 'POST', { timeout });
  const themeKeys = ['mapPoint', 'noMapPoint'];
  const approveKeys = ['mapPoint', 'noMapPoint', 'keyboard'];

  /** The public response page in an anonymous context, at one width and mode. */
  async function readPublicPage(visitor, width, mode, captured) {
    const tab = await visitor.newPage();
    tab.on('response', async (response) => {
      try {
        const url = new URL(response.url());
        if (url.origin !== origin || /\/_next\/static|\.(js|css|woff2?|png|svg|ico|jpg|webp)$/.test(url.pathname)) return;
        captured.push({ url: hideToken(url.pathname + url.search), method: response.request().method(), status: response.status(), text: await response.text() });
      } catch {
        // Not every response has a body to read.
      }
    });
    await tab.setViewport({ width, height: width === 390 ? 844 : 1000 });
    await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]);
    await go(`${ids.portalPath}/about`, tab);
    const applied = await tab.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
    if (applied !== mode) throw new Error(`The public response page at ${width} px rendered ${applied}, not ${mode}.`);
    const labels = await tab.$$eval('button[aria-pressed]', (buttons) => buttons.map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
    const commentsTab = labels.find((label) => /^Comments\b/.test(label)) || null;
    const responsesTab = labels.find((label) => /^You said \/ We did\b/.test(label)) || null;
    if (!commentsTab || !responsesTab) throw new Error(`The public response page at ${width} px ${mode} shows tabs ${labels.join(' | ')}.`);
    await clickText(tab, 'button[aria-pressed]', 'You said / We did');
    await tab.waitForSelector('[data-testid=close-loop-sources] a', { timeout: 20000 });
    const answerHrefs = await tab.$$eval('[data-testid=close-loop-sources] a', (links) => links.map((a) => a.getAttribute('href')));
    const responsesText = await tab.evaluate(() => document.body.innerText);
    const responsesHtml = await tab.content();
    await clickText(tab, 'button[aria-pressed]', 'Comments');
    await sleep(1000);
    const commentsText = await tab.evaluate(() => document.body.innerText);
    const commentsHtml = await tab.content();
    await tab.screenshot({ path: path.join(out, 'screens', `public-response-reading-${width}-${mode}.png`), fullPage: true });
    await tab.close();
    const counts = lib.readPublicPageCounts({ commentsTab, responsesTab, answerHrefs });
    return { counts, labels: { commentsTab, responsesTab }, surfaces: [
      { name: `public response page "You said / We did" at ${width} px ${mode} (text)`, text: responsesText },
      { name: `public response page "You said / We did" at ${width} px ${mode} (HTML)`, text: responsesHtml },
      { name: `public response page Comments at ${width} px ${mode} (text)`, text: commentsText },
      { name: `public response page Comments at ${width} px ${mode} (HTML)`, text: commentsHtml },
    ] };
  }

  /** Close the campaign through the settings form, then read the public address as a participant. */
  async function closeCampaign() {
    const staff = await context.newPage();
    try {
      await go(`/engagement/${ids.campaignId}?tab=setup`, staff);
      await staff.evaluate(() => {
        const select = document.querySelector('#campaign-control-status');
        for (let node = select; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
        if (select) select.scrollIntoView({ block: 'center' });
      });
      await sleep(800);
      const status = await staff.waitForSelector('#campaign-control-status', { visible: true, timeout: 30000 });
      await status.select('closed');
      const saved = staff.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}`) && r.request().method() === 'PATCH', { timeout: 60000 });
      await staff.evaluate(() => {
        const form = document.querySelector('#campaign-control-status').closest('form');
        const button = [...form.querySelectorAll('button[type=submit]')].find((b) => b.innerText.trim() === 'Save campaign');
        button.click();
      });
      const saveStatus = (await saved).status();
      await settle(staff, 2000);
      await go(`/engagement/${ids.campaignId}?tab=setup`, staff);
      const statusAfter = await staff.$eval('#campaign-control-status', (el) => el.value).catch(() => 'unreadable');
      await staff.screenshot({ path: path.join(out, 'screens', 'campaign-closed-staff-1440.png') });
      const visitor = await browser.createBrowserContext();
      const reader = await visitor.newPage();
      const campaignStrings = [inputs.campaign.title, ...approveKeys.map((key) => inputs.comments[key])];
      const addresses = [];
      for (const [name, route] of [['portal', ids.portalPath], ['about', `${ids.portalPath}/about`]]) {
        const response = await reader.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await settle(reader, 1500);
        const html = await reader.content();
        const text = await reader.evaluate(() => document.body.innerText);
        addresses.push({
          name,
          status: response.status(),
          endedNoticeShown: Boolean(await reader.$('[data-testid=closed-campaign-notice]')),
          campaignTextFound: campaignStrings.some((value) => lib.searchRejected({ texts: [value], surfaces: [{ name, text: `${text}\n${html}` }] }).hits.length > 0),
        });
        await reader.screenshot({ path: path.join(out, 'screens', `campaign-closed-${name}-1440.png`) });
      }
      const api = await pageFetch(reader, `/api/engage/${tokenOf()}`);
      await visitor.close();
      const verdict = lib.closeVerdict({ saveStatus, statusAfter, addresses });
      closeReading = { saveStatus, statusAfter, addresses, publicReadStatusAfter: api.status, ...verdict };
      return verdict;
    } finally {
      await staff.close().catch(() => {});
    }
  }

  const journeySteps = [
    step('health-start', () => health('start')),

    step('sign-up', async () => {
      const result = await signUpAndConfirm(page, options.email, password, options.confirmLinkFile, names.first);
      ids.workspaceName = names.first;
      state.accountCreatedAt = result.createdAt;
      state.confirmationMethod = result.confirmationMethod;
      ids.tokenSha256 = result.tokenSha256;
      return `confirmation ${result.confirmationMethod}`;
    }),

    step('confirm-email', async () => {
      if (state.confirmationMethod === 'not_required') {
        findings.push({ id: 'confirmation-not-required', text: 'Sign-up returned a signed-in session, so the confirmation step was not exercised.' });
        if (options.mode === 'proof') throw new Error('The hosted installation did not ask for email confirmation.');
        return 'not required by this installation';
      }
      return `token sha256 ${ids.tokenSha256}`;
    }),

    step('create-project', async () => {
      await go('/projects');
      await clickText(page, 'button', 'New project', { exact: true });
      await page.waitForSelector('#create-project-projectName');
      ids.projectName = inputs.projectName || `${options.placeQuery} engagement demonstration`;
      await page.type('#create-project-projectName', ids.projectName);
      await page.type('#create-project-summary', inputs.projectSummary);
      await clickText(page, 'dialog[open] button', 'Next', { exact: true });
      await page.waitForSelector('#create-project-planType');
      await page.select('#create-project-planType', inputs.planType);
      const created = page.waitForResponse((r) => r.url().includes('/api/projects') && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'dialog[open] button', 'Start the project', { exact: true });
      const response = await created;
      if (response.status() !== 201) throw new Error(`Project create answered ${response.status()}.`);
      await page.waitForFunction(() => /\/projects\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 60000 });
      ids.projectId = page.url().match(/projects\/([0-9a-f-]{36})/)[1];
      state.campaign.projectId = ids.projectId;
      return ids.projectId;
    }),

    step('set-study-place', async () => {
      await go(`/projects/${ids.projectId}?tab=overview`);
      await clickText(page, 'button', 'Set study area');
      const search = await page.waitForSelector('input[aria-label="Search for a place"]');
      await search.type(options.placeQuery);
      const kindLabel = PLACE_KIND_LABELS[options.placeKind];
      await page.waitForFunction((kind) => [...document.querySelectorAll('ul li button')].some((b) => b.innerText.includes(kind)), { timeout: 90000 }, kindLabel);
      const labels = await page.evaluate((kind) => [...document.querySelectorAll('ul li button')]
        .filter((b) => b.innerText.includes(kind))
        .map((b) => b.querySelector('span span.font-medium, span.font-medium').innerText.trim()), kindLabel);
      const index = first.choosePlaceResult(options.placeQuery, labels);
      if (index < 0) throw new Error(`Place search for "${options.placeQuery}" did not give one ${kindLabel} result named exactly that. Results: ${labels.join('; ')}`);
      const label = labels[index];
      await clickText(page, 'ul li button', label);
      await sleep(3000);
      await clickText(page, 'button', 'Save study area', { exact: true });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Change area/.test(b.innerText)), { timeout: 60000 });
      const result = observed.places.flatMap((body) => body.items || []).find((item) => item.label === label && item.kind === options.placeKind);
      if (!result) throw new Error('The place search response for the chosen place was not seen.');
      state.place = { kind: result.kind, geoid: result.geoid, stateFips: result.stateFips ? [result.stateFips] : [], label };
      if (!result.stateFips) findings.push({ id: 'place-without-state', text: `${label} has no single state code in the place search response; the record's stateFips is empty.` });
      const saved = await page.evaluate(() => {
        const text = (document.querySelector('#project-identity') || document.body).innerText;
        const at = text.indexOf('Change area');
        return at >= 0 ? text.slice(at + 12, at + 90).split('\n')[0].trim() : null;
      });
      if (saved && saved !== label) findings.push({ id: 'saved-place-label-differs', text: `The search showed "${label}"; the saved study area reads "${saved}".` });
      return `${label} (${result.kind} ${result.geoid})`;
    }),

    step('record-decision', async () => {
      await go(`/projects/${ids.projectId}?tab=record`);
      await page.click('#decision-add');
      await page.waitForSelector('#project-record-decision-decisionTitle', { visible: true });
      await page.type('#project-record-decision-decisionTitle', inputs.decision.title);
      await page.type('#project-record-decision-decisionRationale', inputs.decision.rationale);
      await clickText(page, 'dialog[open] button', 'Next', { exact: true });
      await page.waitForSelector('#project-record-decision-decisionStatus', { visible: true });
      await page.select('#project-record-decision-decisionStatus', 'proposed');
      await page.type('#project-record-decision-decisionImpact', inputs.decision.impact);
      const recorded = page.waitForResponse((r) => r.url().includes(`/api/projects/${ids.projectId}/records`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'dialog[open] button', 'Record the decision', { exact: true });
      const response = await recorded;
      if (![200, 201].includes(response.status())) throw new Error(`Recording the decision answered ${response.status()}.`);
      await settle(page, 2000);
      return 'proposed decision recorded';
    }),

    step('create-campaign', async () => {
      await go(`/engagement?projectId=${ids.projectId}`);
      await clickText(page, 'button', 'New campaign', { exact: true });
      await page.waitForSelector('#engagement-campaign-creator-templateId');
      await page.select('#engagement-campaign-creator-templateId', 'corridor-safety-study');
      await clickText(page, 'dialog[open] button', 'Next', { exact: true });
      await page.waitForSelector('#engagement-campaign-creator-title');
      ids.campaignTitle = inputs.campaign.title;
      await page.type('#engagement-campaign-creator-title', ids.campaignTitle);
      await clickText(page, 'dialog[open] button', 'Next', { exact: true });
      await page.waitForSelector('#engagement-campaign-creator-projectId');
      const linked = await page.$eval('#engagement-campaign-creator-projectId', (el) => el.value);
      if (linked !== ids.projectId) throw new Error('The new campaign is not linked to the project.');
      await typeInto(await page.$('#engagement-campaign-creator-summary'), inputs.campaign.invitation);
      const created = page.waitForResponse((r) => r.url().includes('/api/engagement/campaigns') && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'dialog[open] button', 'Create campaign', { exact: true });
      const response = await created;
      if (response.status() !== 201) throw new Error(`Campaign create answered ${response.status()}.`);
      await page.waitForFunction(() => /\/engagement\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 60000 });
      ids.campaignId = page.url().match(/engagement\/([0-9a-f-]{36})/)[1];
      state.campaign.campaignId = ids.campaignId;
      return ids.campaignId;
    }),

    step('activate-campaign', async () => {
      await settle(page);
      const minted = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}/share-token`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'button', 'Generate link', { exact: true });
      if (!(await minted).ok()) throw new Error('The share link was not minted.');
      await settle(page, 1500);
      const box = await page.waitForSelector('#publish-flow-allow-comments', { visible: true, timeout: 60000 });
      if (!(await box.evaluate((el) => el.checked))) {
        const allowed = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}`) && r.request().method() === 'PATCH', { timeout: 60000 });
        await box.click();
        await allowed;
      }
      const activated = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}`) && r.request().method() === 'PATCH', { timeout: 60000 });
      await clickText(page, 'button', 'Set to Active', { exact: true });
      if (!(await activated).ok()) throw new Error('The campaign was not set to Active.');
      await settle(page, 2000);
      await go(`/engagement/${ids.campaignId}?tab=setup`);
      const portal = await page.$$eval('a', (links) => links.map((a) => a.getAttribute('href')).find((href) => href && /^\/engage\/[a-z0-9-]+$/.test(href)));
      if (!portal) throw new Error('No public portal link is shown after activation.');
      ids.portalPath = portal;
      secrets.push(portal.split('/').pop());
      const live = await page.evaluate(() => /Live · accepting submissions/.test(document.body.innerText));
      if (!live) throw new Error('The portal status does not read "Live · accepting submissions".');
      return 'live';
    }),

    step('contribute-map-point', () => contribute('mapPoint', 'pointer-map')),
    step('contribute-no-map-point', () => contribute('noMapPoint', 'pointer')),
    step('contribute-keyboard-390', () => contribute('keyboard', 'keyboard')),
    step('contribute-to-reject', () => contribute('rejected', 'pointer')),

    step('moderate', async () => {
      await go(`/engagement/${ids.campaignId}?tab=responses`);
      const done = [];
      for (const key of approveKeys) done.push(await moderateOne(key, 'approved'));
      done.push(await moderateOne('rejected', 'rejected'));
      if (state.campaign.moderation.some((entry) => !entry.reasonRecorded)) throw new Error(`A review reason did not reach the request: ${done.join('; ')}`);
      return done.join('; ');
    }),

    step('staff-review', async () => {
      await go(`/engagement/${ids.campaignId}?tab=analysis`);
      const sourceSaved = waitPost(`/api/engagement/campaigns/${ids.campaignId}/synthesis/sources`);
      await clickText(page, 'button', 'Save selected sources', { exact: true });
      if ((await sourceSaved).status() !== 201) throw new Error('The source set was not saved.');
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Create staff review' && !b.disabled), { timeout: 60000 });
      const created = waitPost(`/api/engagement/campaigns/${ids.campaignId}/synthesis/reviews`);
      await clickText(page, `${R} button`, 'Create staff review', { exact: true });
      const createdResponse = await created;
      const createdBody = await readJson(createdResponse);
      if (createdResponse.status() !== 201 || !createdBody || !createdBody.reviewId) throw new Error('The staff review was not created.');
      ids.reviewId = createdBody.reviewId;
      await page.waitForFunction(() => /revision 1/.test((document.querySelector('article[aria-label="Saved staff review"]') || {}).innerText || ''), { timeout: 60000 });
      await sleep(1000);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await (await controlByLabel(page, 'Correction type', { within: R })).select('group_update');
        await sleep(800);
        const ready = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} label`)].some((l) => l.textContent.trim().startsWith('Staff group summary')), R);
        if (ready) break;
      }
      const groupSelect = await controlByLabel(page, 'Review group', { within: R });
      const groupOptions = await groupSelect.evaluate((s) => [...s.options].map((o) => ({ id: o.value, text: o.text })));
      const themeTexts = themeKeys.map((key) => ids.submissions[key].text.slice(0, 40));
      let chosen = null;
      for (const option of groupOptions) {
        await groupSelect.select(option.id);
        await sleep(700);
        const holds = await page.evaluate((sel, wanted) => [...document.querySelectorAll(`${sel} input[type=checkbox]`)].some((box) => box.checked && wanted.some((text) => box.parentElement.innerText.includes(text))), R, themeTexts);
        if (holds) { chosen = option.id; break; }
      }
      if (!chosen) { chosen = groupOptions[0].id; await groupSelect.select(chosen); await sleep(700); }
      await typeInto(await controlByLabel(page, 'Group label', { within: R }), inputs.staffReview.groupLabel);
      await typeInto(await controlByLabel(page, 'Staff group summary', { within: R }), inputs.staffReview.groupSummary);
      const allTexts = Object.values(ids.submissions).map((entry) => entry.text.slice(0, 40));
      for (const box of await page.$$(`${R} input[type=checkbox]`)) {
        const label = await box.evaluate((el) => el.parentElement.innerText.replace(/\s+/g, ' '));
        if (!allTexts.some((text) => label.includes(text))) continue;
        const want = themeTexts.some((text) => label.includes(text));
        if (want !== (await box.evaluate((el) => el.checked))) await box.click();
      }
      await typeInto(await controlByLabel(page, 'Reason for correction', { within: R }), inputs.staffReview.correctionReason);
      const corrected = waitPost(`/api/engagement/campaigns/${ids.campaignId}/synthesis/reviews`);
      await clickText(page, `${R} button`, 'Save reasoned correction', { exact: true });
      if ((await corrected).status() !== 201) throw new Error('The staff review correction was not saved.');
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Approve revision 2/.test(b.innerText) && !b.disabled), { timeout: 60000 });
      await typeInto(await controlByLabel(page, 'Reason for approval or withdrawal', { within: R }), inputs.staffReview.approvalReason);
      const approved = waitPost(`/api/engagement/campaigns/${ids.campaignId}/synthesis/approvals`);
      await clickText(page, 'button', 'Approve revision 2', { exact: true });
      if ((await approved).status() !== 201) throw new Error('The staff review approval was not saved.');
      await settle(page, 2000);
      // The approved revision's groups, as the saved review shows them: each
      // group's label and its member ids ("item:<uuid>").
      const shown = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} article[aria-label="Saved staff review"] details`)].map((d) => ({
        // textContent: a closed <details> renders nothing, so innerText reads empty.
        summary: ((d.querySelector('summary') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        members: ((d.querySelector('pre') || {}).textContent || '').split('\n').map((line) => line.trim()).filter(Boolean),
      })), R);
      const uuid = /^item:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
      const themes = [];
      for (const group of shown) {
        const label = group.summary.split(' · ')[0].trim();
        const option = label === inputs.staffReview.groupLabel ? { id: chosen } : groupOptions.find((entry) => entry.text.replace(/^\d+\.\s*/, '').split(' · ')[0].trim() === label);
        const commentIds = group.members.map((line) => (line.match(uuid) || [])[1]).filter(Boolean);
        if (!option || !commentIds.length) continue;
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(option.id)) throw new Error(`Group id "${option.id.slice(0, 40)}" is not in the record's form.`);
        themes.push({ groupId: option.id, commentIds });
      }
      const edited = themes.find((theme) => theme.groupId === chosen);
      const wanted = themeKeys.map((key) => ids.submissions[key].id).sort();
      if (!edited || JSON.stringify([...edited.commentIds].sort()) !== JSON.stringify(wanted)) {
        const seen = shown.map((group) => `${group.summary.slice(0, 60)} [${group.members.length} member lines]`).join('; ');
        throw new Error(`The approved group "${inputs.staffReview.groupLabel}" does not hold exactly the theme comments. Groups shown: ${seen || 'none'}.`);
      }
      state.campaign.staffReview = { reviewId: ids.reviewId, revision: 2, approved: true, themes };
      ids.themeGroupId = chosen;
      await page.screenshot({ path: path.join(out, 'screens', 'staff-review-approved-1440.png') });
      return `review ${ids.reviewId.slice(0, 8)} revision 2 approved; ${themes.length} group(s)`;
    }),

    step('publish-response', async () => {
      await go(`/engagement/${ids.campaignId}?tab=responses`);
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll('h2')].find((h) => h.innerText.includes('You said / We did'));
        let box = heading.parentElement;
        while (box && box.querySelectorAll('textarea,select').length < 2) box = box.parentElement;
        box.id = 'engagement-journey-closeloop';
        box.scrollIntoView();
      });
      const C = '#engagement-journey-closeloop';
      await (await controlByLabel(page, 'Theme', { within: C, exact: true })).type(inputs.response.theme);
      await (await controlByLabel(page, 'You said', { within: C })).type(inputs.response.youSaid);
      await (await controlByLabel(page, 'We did', { within: C })).type(inputs.response.weDid);
      const sources = themeKeys.map((key) => ids.submissions[key].id);
      await page.$eval(`${C} select[aria-label="Contributions addressed"]`, (select, list) => {
        for (const option of select.options) option.selected = list.includes(option.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, sources);
      await sleep(500);
      const added = waitPost('/closeloop');
      await clickText(page, `${C} button`, 'Add entry', { exact: true });
      const addedResponse = await added;
      const addedBody = await readJson(addedResponse);
      if (![200, 201].includes(addedResponse.status()) || !addedBody || !addedBody.entry || !addedBody.entry.id) throw new Error(`Adding the response answered ${addedResponse.status()}.`);
      ids.responseId = addedBody.entry.id;
      await settle(page, 2000);
      await (await controlByLabel(page, 'Reason for this change', { within: C })).type(inputs.response.publishReason);
      const published = page.waitForResponse((r) => r.url().includes('/closeloop/') && ['PATCH', 'POST', 'PUT'].includes(r.request().method()), { timeout: 60000 });
      await clickText(page, `${C} button`, 'Publish', { exact: true });
      const publishedResponse = await published;
      if (!publishedResponse.ok()) throw new Error(`Publishing the response answered ${publishedResponse.status()}.`);
      state.campaign.response = { responseId: ids.responseId, status: 'published', aiAssisted: false, sourceCommentIds: sources, decisionLinkId: null, decisionId: null, projectId: null };
      await settle(page, 2000);
      return `response ${ids.responseId.slice(0, 8)} published, answering ${sources.length}`;
    }),

    step('link-decision', async () => {
      await clickText(page, 'button', 'Connect responses to decisions', { exact: true });
      await page.waitForSelector(D);
      await settle(page, 2000);
      const selects = await page.$$(`${D} select`);
      await selects[0].select(ids.responseId);
      ids.decisionId = await selectByText(selects[1], inputs.decision.title);
      await clickText(page, `${D} button`, 'Review current sources', { exact: true });
      await settle(page, 2000);
      await (await controlByLabel(page, 'Reason for this link or change', { within: D })).type(inputs.links.decisionReason);
      const linked = waitPost('/decision-links');
      await clickText(page, `${D} button`, 'Save decision link', { exact: true });
      const linkedResponse = await linked;
      const receipt = await readJson(linkedResponse);
      if (![200, 201].includes(linkedResponse.status()) || !receipt || !receipt.link) throw new Error(`Saving the decision link answered ${linkedResponse.status()}.`);
      if (receipt.link.decision_id !== ids.decisionId || receipt.link.response_id !== ids.responseId) throw new Error('The saved decision link names another response or decision.');
      Object.assign(state.campaign.response, { decisionLinkId: receipt.link.id, decisionId: receipt.link.decision_id, projectId: receipt.link.project_id });
      await settle(page, 2000);
      // The group the response answers, linked on the staff review, and the
      // decision link refreshed so it carries that group.
      await go(`/engagement/${ids.campaignId}?tab=analysis`);
      await clickText(page, 'button', 'Open saved source');
      await settle(page, 2000);
      await clickText(page, `${R} button`, 'Open staff review');
      await settle(page, 2000);
      await clickText(page, `${R} button`, 'Refresh response choices and links', { exact: true });
      await settle(page, 1500);
      await (await controlByLabel(page, 'Response to link', { within: R })).select(ids.responseId);
      await (await controlByLabel(page, 'Reviewed group', { within: R })).select(ids.themeGroupId);
      await clickText(page, `${R} button`, 'Inspect response link', { exact: true });
      await settle(page, 1500);
      await (await controlByLabel(page, 'Reason for this response link', { within: R })).type(inputs.links.themeReason);
      const themed = waitPost('/synthesis/response-links');
      await clickText(page, `${R} button`, 'Save response link', { exact: true });
      if (![200, 201].includes((await themed).status())) throw new Error('The group was not linked to the response.');
      await go(`/engagement/${ids.campaignId}?tab=responses`);
      await clickText(page, 'button', 'Connect responses to decisions', { exact: true });
      await page.waitForSelector(D);
      await settle(page, 2000);
      await clickText(page, `${D} button`, 'Select this link', { exact: true });
      await sleep(500);
      await clickText(page, `${D} button`, 'Review current sources', { exact: true });
      await settle(page, 2000);
      await (await controlByLabel(page, 'Reason for this link or change', { within: D })).type(inputs.links.refreshReason);
      const refreshed = waitPost('/decision-links');
      await clickText(page, `${D} button`, 'Save reviewed correction', { exact: true });
      const refreshedResponse = await refreshed;
      const refreshedReceipt = await readJson(refreshedResponse);
      if (![200, 201].includes(refreshedResponse.status()) || !refreshedReceipt || !refreshedReceipt.link) throw new Error('The decision link was not refreshed.');
      // The latest link in the chain is the one the record names.
      Object.assign(state.campaign.response, { decisionLinkId: refreshedReceipt.link.id, decisionId: refreshedReceipt.link.decision_id, projectId: refreshedReceipt.link.project_id });
      return `decision ${ids.decisionId.slice(0, 8)}; link ${refreshedReceipt.link.id.slice(0, 8)}`;
    }),

    step('request-review-files', async () => {
      await go(`/engagement/${ids.campaignId}?tab=record`);
      ids.jobs = {};
      for (const scope of ['internal', 'public']) {
        const select = await controlByLabel(page, 'Disclosure scope');
        await select.select(scope);
        await sleep(500);
        const queued = waitPost(`/api/engagement/campaigns/${ids.campaignId}/reports`);
        await clickText(page, 'button', 'Prepare PDF, XLSX and ZIP', { exact: true });
        const response = await queued;
        const body = await readJson(response);
        if (response.status() !== 202 || !body || !body.jobId) throw new Error(`Queuing the ${scope} review files answered ${response.status()}.`);
        ids.jobs[scope] = body.jobId;
        await settle(page, 2000);
      }
      return `internal ${ids.jobs.internal.slice(0, 8)}, public ${ids.jobs.public.slice(0, 8)}`;
    }),

    step('download-review-files', async () => {
      const deadline = Date.now() + options.exportTimeoutMinutes * 60000;
      const href = (scope, format) => `/api/engagement/campaigns/${ids.campaignId}/reports/${ids.jobs[scope]}/download?format=${format}`;
      for (;;) {
        const ready = await page.evaluate((wanted) => wanted.every((value) => document.querySelector(`a[href="${value}"]`)), [href('internal', 'pdf'), href('internal', 'xlsx'), href('public', 'pdf'), href('public', 'xlsx')]);
        if (ready) break;
        const failed = await page.evaluate(() => [...document.querySelectorAll('#campaign-review-files [role=alert]')].map((el) => el.innerText.trim()).filter(Boolean));
        if (failed.length) throw new Error(`The export worker reported: ${failed.join(' | ').slice(0, 200)}`);
        if (Date.now() > deadline) throw new Error(`The review files were not ready within ${options.exportTimeoutMinutes} minutes. Is the document-export worker running?`);
        await sleep(3000);
      }
      ids.files = {};
      for (const scope of ['internal', 'public']) {
        for (const format of ['pdf', 'xlsx']) {
          const before = new Set(fs.readdirSync(downloads));
          await page.evaluate((value) => document.querySelector(`a[href="${value}"]`).click(), href(scope, format));
          const file = await waitForDownload(downloads, before);
          const target = path.join(out, 'files', `${options.role}-${scope}-campaign-review.${format}`);
          fs.renameSync(file, target);
          ids.files[`${scope}-${format}`] = target;
        }
      }
      return Object.entries(ids.files).map(([key, file]) => `${key} ${fs.statSync(file).size} bytes`).join('; ');
    }),

    step('read-counts', async () => {
      const expected = lib.journeyCounts({ contributions: state.campaign.contributions, moderation: state.campaign.moderation, responses: [state.campaign.response] });
      ids.expectedCounts = expected;
      const rel = (file) => path.relative(out, file).split(path.sep).join('/');
      // Internal review PDF: the record's PDF.
      const internalPdf = ids.files['internal-pdf'];
      const internalBytes = fs.readFileSync(internalPdf);
      if (internalBytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('The internal review download is not a PDF.');
      const internalPages = first.pdfPages(internalPdf);
      ids.internalPages = internalPages;
      const internalRead = lib.readReviewPdfCounts(internalPages);
      const { items, missing } = lib.reviewPdfItems(internalPages, expected, job.campaign);
      const draft = first.draftPages(internalPages);
      const emails = first.locateEmails(internalPages);
      state.pdfs.push({ kind: job.campaign.reviewPdf, path: rel(internalPdf), sha256: first.sha256(internalBytes), bytes: internalBytes.length, pages: internalPages.length, draftStamp: draft.length > 0, items });
      if (draft.length) findings.push({ id: 'review-pdf-draft-stamp', text: `The internal review PDF carries DRAFT on pages ${draft.join(', ')}.` });
      if (emails.length) findings.push({ id: 'review-pdf-prints-email', text: `The internal review PDF prints an email address at ${emails.map((entry) => `page ${entry.page} line ${entry.line}`).join(', ')}.` });
      // Public review PDF: recorded beside the internal one, so the checker
      // can read it again (KI-2026-11-14-371).
      const publicPdf = ids.files['public-pdf'];
      const publicPdfBytes = fs.readFileSync(publicPdf);
      if (publicPdfBytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('The public review download is not a PDF.');
      const publicPages = first.pdfPages(publicPdf);
      ids.publicPages = publicPages;
      const publicRead = lib.readReviewPdfCounts(publicPages);
      const publicItems = lib.publicReviewPdfItems(publicPages, job.campaign.publicCopy);
      const publicDraft = first.draftPages(publicPages);
      state.pdfs.push({ kind: job.campaign.publicCopy.pdf, path: rel(publicPdf), sha256: first.sha256(publicPdfBytes), bytes: publicPdfBytes.length, pages: publicPages.length, draftStamp: publicDraft.length > 0, items: publicItems.items });
      if (publicDraft.length) findings.push({ id: 'public-review-pdf-draft-stamp', text: `The public review PDF carries DRAFT on pages ${publicDraft.join(', ')}.` });
      missing.push(...publicItems.missing.map((entry) => ({ ...entry, item: `public ${entry.item}` })));
      const internalBook = workbookSheets(ids.files['internal-xlsx']);
      const publicBook = workbookSheets(ids.files['public-xlsx']);
      ids.internalBookText = workbookText(internalBook);
      ids.publicBookText = workbookText(publicBook);
      const internalBookBytes = fs.readFileSync(ids.files['internal-xlsx']);
      state.workbooks.push({ kind: job.campaign.workbook.kind, path: rel(ids.files['internal-xlsx']), sha256: first.sha256(internalBookBytes), bytes: internalBookBytes.length });
      const publicBookBytes = fs.readFileSync(ids.files['public-xlsx']);
      state.workbooks.push({ kind: job.campaign.publicCopy.workbook, path: rel(ids.files['public-xlsx']), sha256: first.sha256(publicBookBytes), bytes: publicBookBytes.length });
      const scopeRow = (internalBook[job.campaign.workbook.scopeCell.sheet] || []).find((row) => row[0] === job.campaign.workbook.scopeCell.field);
      if (!scopeRow || scopeRow[1] !== job.campaign.workbook.scopeCell.value) throw new Error('The internal workbook does not say its scope is internal.');
      const internalCells = lib.readReviewWorkbookCounts(internalBook);
      const publicCells = lib.readReviewWorkbookCounts(publicBook);
      // The public response page, at both widths and modes.
      const visitor = await browser.createBrowserContext();
      const captured = [];
      ids.publicSurfaces = [];
      for (const width of job.screens.widths) {
        for (const mode of job.screens.modes) {
          const reading = await readPublicPage(visitor, width, mode, captured);
          const search = lib.searchRejected({ texts: [inputs.comments.rejected], ids: [ids.submissions.rejected.id], surfaces: reading.surfaces });
          ids.publicSurfaces.push(...reading.surfaces);
          state.publicPage.readings.push({
            width,
            mode,
            approvedShown: reading.counts.approved ?? -1,
            respondedShown: reading.counts.answered,
            rejectedTextSearched: 1,
            rejectedTextFound: search.hits.length > 0,
          });
          countTable.push({ surface: `public response page ${width} px ${mode}`, counts: reading.counts, labels: reading.labels });
        }
      }
      ids.publicCaptured = captured;
      await visitor.close();
      const pick = (counts, keys) => Object.fromEntries(keys.map((key) => [key, counts[key]]));
      const all = lib.COUNT_NAMES;
      const publicKeys = ['approved', 'publishedResponses', 'answered'];
      const surfaces = [
        { surface: 'internal review PDF', counts: pick(internalRead.counts, all), required: all },
        { surface: 'public review PDF', counts: { ...pick(publicRead.counts, publicKeys), ...(publicRead.counts.rejected !== undefined ? { rejected: publicRead.counts.rejected } : {}) }, required: publicKeys },
        { surface: 'internal workbook Summary rows', counts: pick(internalCells.summary, all), required: all },
        { surface: 'internal workbook cells', counts: pick(internalCells.cells, all), required: all },
        { surface: 'public workbook Summary rows', counts: pick(publicCells.summary, publicKeys), required: publicKeys },
        { surface: 'public workbook cells', counts: pick(publicCells.cells, publicKeys), required: publicKeys },
        ...countTable.map((row) => ({ surface: row.surface, counts: pick(row.counts, publicKeys), required: publicKeys })),
      ];
      countTable.unshift(...surfaces.slice(0, 6).map((row) => ({ surface: row.surface, counts: row.counts })));
      countTable.unshift({ surface: 'journey (moderation outcomes and the published response)', counts: expected });
      ids.countPages = { internal: internalRead.pages, public: publicRead.pages };
      if (missing.length) throw new Error(`The review PDFs are missing ${missing.map((entry) => `${entry.item} (${entry.reason})`).join('; ')}.`);
      lib.assertCountsAgree(expected, surfaces);
      return `received ${expected.received}, approved ${expected.approved}, rejected ${expected.rejected}, published ${expected.publishedResponses}, answered ${expected.answered}: ${surfaces.length} surfaces agree`;
    }),

    step('search-rejected-text', async () => {
      // The portal as a participant sees it after moderation, with its data requests.
      const visitor = await browser.createBrowserContext();
      const tab = await visitor.newPage();
      const captured = [...(ids.publicCaptured || [])];
      tab.on('response', async (response) => {
        try {
          const url = new URL(response.url());
          if (url.origin !== origin || /\/_next\/static|\.(js|css|woff2?|png|svg|ico|jpg|webp)$/.test(url.pathname)) return;
          captured.push({ url: hideToken(url.pathname + url.search), method: response.request().method(), status: response.status(), text: await response.text() });
        } catch {
          // Not every response has a body to read.
        }
      });
      await go(ids.portalPath, tab);
      await sleep(2500);
      await clickText(tab, 'button[aria-pressed]', 'Comments').catch(() => {});
      await settle(tab, 1500);
      const portalSurfaces = [
        { name: 'portal page (text)', text: await tab.evaluate(() => document.body.innerText) },
        { name: 'portal page (HTML)', text: await tab.content() },
      ];
      const apiRead = await pageFetch(tab, `/api/engage/${tokenOf()}`);
      captured.push({ url: '/api/engage/<token>', method: 'GET', status: apiRead.status, text: apiRead.text });
      await visitor.close();
      fs.writeFileSync(path.join(out, 'net', 'public-requests.json'), first.scrubText(hideToken(JSON.stringify(captured.map((entry) => ({ ...entry, text: entry.text.slice(0, 200000) })), null, 1)), secrets));
      const publicSurfaces = [
        { name: 'public review PDF', pages: ids.publicPages },
        { name: 'public review workbook (every cell)', text: ids.publicBookText },
        ...portalSurfaces,
        ...(ids.publicSurfaces || []),
        ...captured.map((entry) => ({ name: `${entry.method} ${entry.status} ${entry.url}`, text: entry.text })),
      ];
      const controlSurfaces = [
        { name: 'internal review PDF', pages: ids.internalPages },
        { name: 'internal review workbook (every cell)', text: ids.internalBookText },
      ];
      rejectedSearch = { searched: publicSurfaces.map((surface) => surface.name), controls: controlSurfaces.map((surface) => surface.name) };
      const result = lib.assertRejectedTextAbsent({ texts: [inputs.comments.rejected], ids: [ids.submissions.rejected.id], publicSurfaces, controlSurfaces });
      rejectedSearch = { searchedSha256: result.searchedSha256, searched: result.searched, controls: result.controls, hits: result.hits };
      state.campaign.rejectedTextSha256 = result.searchedSha256;
      // The text itself, so the checker can search the review files for it.
      // It is a test entry this journey typed and represents no one.
      state.campaign.rejectedTexts = [inputs.comments.rejected];
      return `${publicSurfaces.length} public surfaces searched, none holds the rejected text or id; found in ${controlSurfaces.length} internal controls`;
    }),

    step('screens', async () => {
      const axeSource = fs.readFileSync(AXE_SOURCE, 'utf8');
      const screens = [
        { slug: 'portal', route: ids.portalPath, anonymous: true },
        { slug: 'public-response', route: `${ids.portalPath}/about`, anonymous: true },
        ...STAFF_SCREENS.map((screen) => ({ slug: screen.slug, route: `/engagement/${ids.campaignId}${screen.tab ? `?tab=${screen.tab}` : ''}` })),
      ];
      const anonymous = await browser.createBrowserContext();
      const rules = [];
      for (const screen of screens) {
        for (const width of first.SCREEN_WIDTHS) {
          for (const mode of first.SCREEN_MODES) {
            const owner = screen.anonymous ? anonymous : context;
            const tab = await owner.newPage();
            const errors = [];
            tab.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
            tab.on('pageerror', (error) => errors.push(String(error && error.message)));
            await tab.setViewport({ width, height: 900 });
            await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]);
            await go(screen.route, tab);
            await sleep(1500);
            const applied = await tab.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
            if (applied !== mode) throw new Error(`${screen.slug} at ${width} px rendered ${applied}, not ${mode}.`);
            await tab.evaluate(axeSource);
            const results = await tab.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), first.AXE_TAGS);
            const summary = first.summarizeAxe(results);
            const horizontalScroll = await tab.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
            const name = `${screen.slug}-${width}-${mode}`;
            await tab.screenshot({ path: path.join(out, 'screens', `${name}.png`), fullPage: true });
            fs.writeFileSync(path.join(out, 'console', `${name}.txt`), errors.map((line) => first.scrubText(hideToken(line), secrets)).join('\n'));
            state.screens.push({ screen: screen.slug, width, mode, axe: summary.axe, consoleErrors: errors.length, horizontalScroll });
            if (summary.rules.length) rules.push({ screen: screen.slug, width, mode, rules: summary.rules });
            await tab.close();
          }
        }
      }
      await anonymous.close();
      ids.axeRules = rules;
      const serious = state.screens.reduce((sum, row) => sum + row.axe.serious + row.axe.critical, 0);
      return `${state.screens.length} checks, ${serious} serious or critical axe nodes, ${state.screens.filter((row) => row.horizontalScroll).length} with page scroll`;
    }),

    step('participant-checks', async () => {
      const visitor = await browser.createBrowserContext();
      const tab = await visitor.newPage();
      await go(ids.portalPath, tab);
      const base = `/api/engagement/campaigns/${ids.campaignId}`;
      // Staff reads only (KI-2026-11-14-370): the export holds every
      // contribution with its moderation notes, and the history holds the
      // rejected comment's moderation record.
      const requests = {
        'campaign-read': `${base}`,
        'campaign-export-read': `${base}/export`,
        'rejected-item-history-read': `${base}/items/${ids.submissions.rejected.id}/history`,
        'review-pdf-download': `${base}/reports/${ids.jobs.internal}/download?format=pdf`,
        'review-xlsx-download': `${base}/reports/${ids.jobs.internal}/download?format=xlsx`,
      };
      for (const request of job.participantChecks.requiredRequests) {
        const result = await pageFetch(tab, requests[request]);
        const contentReturned = result.head === '%PDF-' || result.head.startsWith('PK') || result.text.includes(inputs.campaign.title) || result.text.includes(ids.submissions.rejected.id) || result.text.includes(inputs.comments.rejected);
        participantChecks.refusals.push({ request, status: result.status, contentReturned });
      }
      const read = await pageFetch(tab, `/api/engage/${tokenOf()}`);
      let parsed = null;
      try { parsed = JSON.parse(read.text); } catch { parsed = null; }
      const fields = job.participantChecks.publicRead.staffOnlyFields;
      const found = parsed ? lib.staffFieldsIn(parsed, fields) : fields;
      participantChecks.publicRead = { request: job.participantChecks.publicRead.request, status: read.status, staffFieldsSearched: [...fields], staffFieldsFound: found.length > 0 };
      await visitor.close();
      const refused = participantChecks.refusals.filter((check) => [401, 403, 404].includes(check.status) && !check.contentReturned).length;
      if (refused !== participantChecks.refusals.length) findings.push({ id: 'participant-not-refused', text: `An anonymous participant was not refused: ${participantChecks.refusals.map((check) => `${check.request} ${check.status}`).join('; ')}` });
      if (found.length) findings.push({ id: 'public-read-staff-fields', text: `The public portal read carried ${found.join(', ')}.` });
      return `${participantChecks.refusals.map((check) => `${check.request} ${check.status}`).join('; ')}; public read ${read.status}, staff fields ${found.length ? found.join(', ') : 'none'}`;
    }),

    step('cross-workspace', async () => {
      const other = await browser.createBrowserContext();
      const second = await other.newPage();
      await signUpAndConfirm(second, options.secondEmail, secondPassword, options.secondConfirmLinkFile, names.second);
      const identifying = first.identifyingStrings({ reportTitle: inputs.decision.title, projectName: ids.projectName, workspaceName: ids.workspaceName, campaignTitle: ids.campaignTitle });
      const base = `/api/engagement/campaigns/${ids.campaignId}`;
      const dataChecks = [
        ['campaign-review-pdf', 'review-pdf-download', `${base}/reports/${ids.jobs.internal}/download?format=pdf`],
        ['campaign-review-workbook', 'review-xlsx-download', `${base}/reports/${ids.jobs.internal}/download?format=xlsx`],
        ['staff-campaign', 'campaign-read', base],
        ['campaign-export', 'campaign-export-read', `${base}/export`],
        ['rejected-item-history', 'rejected-item-history-read', `${base}/items/${ids.submissions.rejected.id}/history`],
      ];
      const detail = [];
      for (const [target, request, route] of dataChecks) {
        const result = await pageFetch(second, route);
        const contentReturned = result.head === '%PDF-' || result.head.startsWith('PK') || result.text.includes(ids.campaignTitle) || result.text.includes(ids.submissions.rejected.id) || result.text.includes(inputs.comments.rejected);
        crossChecks.push({ journey: options.role, target, request, kind: 'data', status: result.status, contentReturned });
        detail.push(`${request} ${result.status}${contentReturned ? ' CONTENT RETURNED' : ''}`);
      }
      const response = await second.goto(new URL(`/engagement/${ids.campaignId}`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await settle(second, 2500);
      const reading = first.readPageForRecord({ text: await second.evaluate(() => document.body.innerText), html: await second.content(), strings: identifying });
      const tools = /Settings and public access|Campaign metadata|Engagement review files/.test(reading.textForTools);
      await second.screenshot({ path: path.join(out, 'screens', 'cross-workspace-campaign-page-1440.png') });
      crossChecks.push({
        journey: options.role,
        target: 'staff-campaign',
        request: 'campaign-page',
        kind: 'page',
        status: response.status(),
        contentReturned: reading.recordTextFound || tools,
        notFoundRendered: reading.notFoundRendered,
        recordTextFound: reading.recordTextFound,
        searchedStringSha256: reading.searchedStringSha256,
        searchedStringCount: reading.searchedStringSha256.length,
      });
      detail.push(`campaign-page ${response.status()} (not-found screen ${reading.notFoundRendered ? 'shown' : 'NOT shown'}, ${reading.searchedStringSha256.length} strings searched, ${reading.recordTextFound ? 'RECORD TEXT FOUND' : 'none found'})`);
      await other.close();
      if (crossChecks.some((check) => check.contentReturned)) findings.push({ id: 'cross-workspace-returned-content', text: `A second account received the first account's content: ${detail.join('; ')}` });
      if (crossChecks.some((check) => check.kind === 'page' && check.status === 200)) {
        findings.push({ id: job.crossWorkspace.pageAnsweredOkLimit, text: 'Another workspace\'s campaign page answered HTTP 200 with the not-found screen; the record must state this limit (KI-2026-11-14-060 class).' });
      }
      return detail.join('; ');
    }),
  ];

  const finished = await lib.runJourney({
    steps: journeySteps,
    campaignId: () => ids.campaignId,
    close: async () => {
      const entry = { step: 'close-campaign', startedAt: first.utcNow(), status: 'running' };
      steps.push(entry);
      log('close-campaign...');
      try {
        const verdict = await closeCampaign();
        entry.status = verdict.closed ? 'passed' : 'failed';
        entry.detail = verdict.closed ? 'closed; the portal and about page show only the ended notice' : verdict.problems.join('; ');
        log(`close-campaign: ${entry.status} (${entry.detail})`);
        return verdict;
      } catch (error) {
        entry.status = 'failed';
        entry.error = first.scrubText(hideToken(error && error.message ? error.message.split('\n')[0] : String(error)), secrets);
        log(`close-campaign: failed (${entry.error})`);
        throw error;
      } finally {
        entry.endedAt = first.utcNow();
      }
    },
    after: [step('health-end', () => health('end'))],
  });
  await browser.close().catch(() => {});
  const failure = finished.failure;

  const furthest = [...steps].reverse().find((entry) => entry.status === 'passed');
  const journey = lib.buildEngagementJourney(state);
  const result = {
    schema: 'openplan.engagement_job_journey_run.v1',
    jobId: lib.JOB_ID,
    mode: options.mode,
    baseUrl: origin,
    recordedOn: first.utcNow().slice(0, 10),
    expectedCommit: options.expectedCommit,
    inputsLabel: inputs.label,
    inputsSha256: loadedInputs.sha256,
    aiFeaturesUsed: false,
    aiStatement: 'No AI feature was used: no translation, AI moderation, AI synthesis or AI drafting control was pressed. The staff review groups come from the app\'s own grouping, corrected and approved by the staff account.',
    confirmationTokenSha256: ids.tokenSha256 || null,
    furthestStep: furthest ? furthest.step : null,
    stoppedAt: failure ? failure.journeyStep || 'setup' : null,
    stepsDefined: STEPS,
    steps,
    journey,
    crossWorkspace: { checks: crossChecks },
    participantChecks: { refusals: participantChecks.refusals, publicRead: participantChecks.publicRead },
    close: { ...finished.close, reading: closeReading },
    counts: countTable,
    countPages: ids.countPages || null,
    rejectedTextSearch: rejectedSearch,
    findings,
    axeRules: ids.axeRules || [],
    consoleErrorsDuringJourney: consoleErrors.length,
    ids: {
      projectId: ids.projectId || null,
      decisionId: ids.decisionId || null,
      campaignId: ids.campaignId || null,
      reviewId: ids.reviewId || null,
      responseId: ids.responseId || null,
      reviewJobs: ids.jobs || null,
      contributions: Object.fromEntries(Object.entries(ids.submissions).map(([key, entry]) => [key, entry.id])),
    },
  };
  const serialized = first.scrubText(hideToken(JSON.stringify(result, null, 2)), secrets);
  fs.writeFileSync(path.join(out, `engagement-journey-${options.role}.json`), `${serialized}\n`);
  fs.writeFileSync(path.join(out, 'console', 'journey.txt'), consoleErrors.map((line) => first.scrubText(hideToken(line), secrets)).join('\n'));
  log(`wrote ${path.join(out, `engagement-journey-${options.role}.json`)}`);
  log(`campaign closed at the end: ${finished.close.attempted ? (finished.close.closed ? 'yes' : 'NO') : 'no campaign was created'}`);
  log(`furthest step passed: ${result.furthestStep}${failure ? `; ${first.scrubText(hideToken(failure.message), secrets)}` : '; journey complete'}`);
  if (failure) process.exitCode = 1;
}

/** --assemble --journeys a.json,b.json,c.json --commit <40 hex> --base-url <origin> --out record.json [--root <folder the record's paths start from; default the record's folder>] */
async function assembleMain(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!/^[0-9a-f]{40}$/.test(String(args.commit || ''))) throw new Error('--assemble needs --commit, a 40-character commit.');
  const record = lib.assembleEngagementRecord({
    journeyFiles: String(args.journeys || '').split(',').filter(Boolean),
    commit: args.commit,
    baseUrl: args['base-url'],
    recordedOn: first.utcNow().slice(0, 10),
    root: args.root ? path.resolve(args.root) : path.dirname(path.resolve(args.out)),
  });
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(record, null, 2)}\n`);
  log(`wrote ${path.resolve(args.out)}; check it with validateProvenJobRecord`);
}

if (require.main === module) {
  process.on('unhandledRejection', (reason) => {
    const message = reason && reason.message ? reason.message : String(reason);
    if (!/Target closed|Page closed|Session closed|Protocol error|Connection closed/i.test(message)) {
      process.stderr.write(`[engagement-journey] unhandled: ${first.scrubText(message)}\n`);
      process.exitCode = 1;
    }
  });
  main().catch((error) => {
    process.stderr.write(`[engagement-journey] ${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
