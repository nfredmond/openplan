// Browser steps the proven-job journeys share: finding Chrome, clicking and
// typing the way a planner does, the health readback, sign-up with the
// emailed confirmation link, creating a project, picking its study place by
// the search's own label, retrieving crashes, and reading screens with axe.
// The first job's journey (first-job-journey.js) and the third's
// (atp-job-journey.js) call these. They were moved here from the first job's
// script unchanged in what they do; each takes what it used to read from that
// script's own variables as an argument.
//
// Browser only. No service-role key, no database write, no API call in place
// of a step a planner does on screen. Nothing here is unit-tested: a step is
// proved by a rehearsal journey on a local build (qa-harness/README.md).
const fs = require('fs');
const path = require('path');
const lib = require('./first-job-journey-lib');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Click the first visible element matching `selector` whose text matches. Fails loudly. */
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
    if (Date.now() > deadline) throw new Error(`No enabled ${selector} reading "${text}" on ${scope.url ? scope.url() : 'the page'}`);
    await sleep(500);
  }
}

/** A form control by the visible text of its label (wrapping label or label[for]). */
async function controlByLabel(page, labelText, { within = 'body', nth = 0 } = {}) {
  const handle = await page.evaluateHandle((scopeSel, wanted, index) => {
    const scope = typeof scopeSel === 'string' ? document.querySelector(scopeSel) : scopeSel;
    if (!scope) return null;
    const own = (label) => {
      const clone = label.cloneNode(true);
      clone.querySelectorAll('input,select,textarea,option,button').forEach((el) => el.remove());
      return clone.textContent.replace(/\s+/g, ' ').trim();
    };
    const hits = [];
    for (const label of scope.querySelectorAll('label')) {
      if (!own(label).startsWith(wanted)) continue;
      const control = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input,select,textarea');
      if (control && control.getBoundingClientRect().width > 0) hits.push(control);
    }
    return hits[index] || null;
  }, within, labelText, nth);
  const element = handle.asElement();
  if (!element) throw new Error(`No visible control labeled "${labelText}" in ${within}`);
  return element;
}

/** Replace a field's text the way a person does (select all, delete, type), then check it took. */
async function typeInto(element, value) {
  await element.focus();
  const page = element.frame.page();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  // Typing over the selection, not deleting first: some number fields turn an
  // empty value into 0, which would leave a leading zero.
  await element.type(String(value));
  const now = await element.evaluate((el) => el.value);
  const numeric = /^-?[0-9.]+$/.test(String(value)) && /^-?[0-9.]+$/.test(now);
  if (numeric ? Number(now) !== Number(value) : now !== String(value)) throw new Error(`A field reads "${now.slice(0, 60)}" after typing "${String(value).slice(0, 60)}".`);
}

/** A <select> option whose text includes `text`; selects it and returns its value. */
async function selectByText(element, text) {
  const value = await element.evaluate((select, wanted) => {
    const option = [...select.options].find((entry) => entry.text.includes(wanted) && !entry.disabled);
    return option ? option.value : null;
  }, text);
  if (value === null) throw new Error(`No option containing "${text}"`);
  await element.select(value);
  return value;
}

/**
 * The longest a step waits for a page's requests to finish before it goes
 * on: 60 seconds, as the journeys have always waited. A page that keeps a
 * request in flight uses all of it at every wait. OPENPLAN_JOURNEY_IDLE_TIMEOUT_MS
 * shortens it for a local rehearsal; a run says so in its file (idleTimeoutMs).
 */
const IDLE_TIMEOUT_MS = Number(process.env.OPENPLAN_JOURNEY_IDLE_TIMEOUT_MS) > 0 ? Number(process.env.OPENPLAN_JOURNEY_IDLE_TIMEOUT_MS) : 60000;

async function settle(page, ms = 1500) {
  await page.waitForNetworkIdle({ idleTime: 800, timeout: IDLE_TIMEOUT_MS }).catch(() => {});
  await sleep(ms);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * A signed-in request a second planner could make by pasting the first
 * planner's link. Used for the cross-workspace check, where the point is to
 * show nothing comes back, and for its control, where the owner asks for the
 * same address.
 */
async function appFetch(route, payload, method, page) {
  return page.evaluate(async (url, verb) => {
    const response = await fetch(url, { method: verb, redirect: 'follow', credentials: 'include' });
    const buffer = new Uint8Array(await response.arrayBuffer());
    const head = String.fromCharCode(...buffer.slice(0, 5));
    const text = new TextDecoder().decode(buffer.slice(0, 200000));
    return { status: response.status, isPdf: head === '%PDF-', text };
  }, route, method || (payload ? 'POST' : 'GET'));
}

async function waitForDownload(dir, before, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = fs.readdirSync(dir).filter((file) => !before.has(file) && !file.endsWith('.crdownload') && !file.endsWith('.tmp'));
    if (fresh.length) return path.join(dir, fresh[0]);
    await sleep(500);
  }
  throw new Error('The download did not arrive.');
}

/**
 * Read /api/health and add the reading to `readings` (a journey's health
 * list). A build that reports no commit is a finding in rehearsal and stops a
 * proof; a commit other than the expected one stops either. Returns the line
 * the step logs.
 */
async function readHealth({ origin, point, mode, expectedCommit, readings, findings }) {
  const response = await fetch(new URL('/api/health', origin), { headers: { accept: 'application/json' } });
  const body = await response.json();
  const commit = body && body.deployment ? String(body.deployment.commit) : 'missing';
  const reading = {
    point,
    checkedAt: lib.utcNow(),
    status: String(body.status || response.status),
    commit,
    version: String(body.deployment ? body.deployment.version : 'missing'),
    migrationsExpected: body.deployment && body.deployment.migrations ? body.deployment.migrations.expected ?? null : null,
    migrationsLatest: body.deployment && body.deployment.migrations ? body.deployment.migrations.latest ?? null : null,
  };
  readings.push(reading);
  if (!/^[0-9a-f]{7,40}$/.test(commit)) {
    findings.push({ id: 'health-commit-not-reported', text: `/api/health reports commit "${commit}" at the ${point}, so the run cannot name the build it tested.` });
    if (mode === 'proof') throw new Error(`/api/health reports commit "${commit}"`);
  } else if (expectedCommit && !expectedCommit.startsWith(commit) && !commit.startsWith(expectedCommit)) {
    throw new Error(`/api/health reports commit ${commit}, not ${expectedCommit}`);
  }
  return `${reading.status}, commit ${commit}, version ${reading.version}`;
}

/**
 * Sign up through the screen with the workspace name `organization`, then
 * confirm by the emailed link when the installation asks for one. The link is
 * read from `confirmFile`, never taken as an argument; it and its token go
 * into `secrets` so nothing written afterward can hold them. Returns when the
 * account was made, how it was confirmed and the SHA-256 of the link's token.
 */
async function signUpAndConfirm({ page, origin, mode, email, password, organization, confirmFile, confirmTimeoutMinutes, secrets, log }) {
  await page.goto(new URL('/sign-up', origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await settle(page);
  await page.type('#org-name', organization);
  await page.type('#email', email);
  await page.type('#password', password);
  const createdAt = lib.utcNow();
  await clickText(page, 'button[type=submit]', 'Create account', { exact: true });
  const outcome = await page.waitForFunction(() => {
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
  log(`waiting for the confirmation link in ${confirmFile} (up to ${confirmTimeoutMinutes} minutes)`);
  const deadline = Date.now() + confirmTimeoutMinutes * 60000;
  let link = '';
  while (Date.now() < deadline) {
    if (fs.existsSync(confirmFile)) {
      link = fs.readFileSync(confirmFile, 'utf8').trim();
      if (link) break;
    }
    await sleep(2000);
  }
  if (!link) throw new Error('No confirmation link arrived in the file before the timeout.');
  const tokenSha256 = lib.confirmationTokenHash(link);
  secrets.push(link);
  const linkUrl = new URL(link);
  for (const key of ['token', 'token_hash', 'code']) if (linkUrl.searchParams.get(key)) secrets.push(linkUrl.searchParams.get(key));
  const allowed = [origin];
  if (mode === 'rehearsal') {
    if (!['localhost', '127.0.0.1'].includes(linkUrl.hostname)) throw new Error('A rehearsal confirmation link must be local.');
    allowed.push(linkUrl.origin);
  } else if (linkUrl.hostname.endsWith('.supabase.co')) {
    allowed.push(linkUrl.origin);
  }
  lib.checkConfirmLinkOrigin(link, allowed);
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 120000 });
  link = '';
  await settle(page, 2500);
  if (page.url().includes('/sign-in')) {
    await page.type('#email', email);
    await page.type('#password', password);
    await clickText(page, 'button[type=submit]', 'Sign in');
    await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 60000 });
  }
  if (!/\/dashboard|\/workspace|\/projects/.test(page.url())) throw new Error(`After confirmation the browser is at ${new URL(page.url()).pathname}, not the app.`);
  return { createdAt, confirmationMethod: 'email_link', tokenSha256 };
}

/**
 * Create a project from the Projects screen's "New project" dialog and return
 * its id. `planType`, when given, is chosen in the dialog's second step; left
 * out, the dialog's own choice stands.
 */
async function createProject({ page, go, name, summary, planType }) {
  await go('/projects');
  await clickText(page, 'button', 'New project', { exact: true });
  await page.waitForSelector('#create-project-projectName');
  await page.type('#create-project-projectName', name);
  await page.type('#create-project-summary', summary);
  await clickText(page, 'dialog[open] button', 'Next', { exact: true });
  await page.waitForSelector('#create-project-planType');
  if (planType !== undefined) await page.select('#create-project-planType', planType);
  const created = page.waitForResponse((r) => r.url().includes('/api/projects') && r.request().method() === 'POST', { timeout: 60000 });
  await clickText(page, 'dialog[open] button', 'Start the project', { exact: true });
  const response = await created;
  if (response.status() !== 201) throw new Error(`Project create returned ${response.status()}`);
  await page.waitForFunction(() => /\/projects\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 60000 });
  return page.url().match(/projects\/([0-9a-f-]{36})/)[1];
}

/** What the place search calls each kind on its result buttons. */
const PLACE_KIND_LABELS = { county: 'County', city: 'City / town', cdp: 'Census-designated place', metro: 'Metro area', micro: 'Micropolitan area', aiannh: 'Tribal area', cousub: 'Town or township' };

/**
 * Set the project's study area to the one search result whose label is
 * exactly `placeQuery` (KI-2026-11-14-230: "Pyramid Lake Paiute Reservation,
 * NV", not "Pyramid Lake"). `observedPlaces` holds the search answers the
 * screen requested; the chosen place's entry is returned with its label.
 */
async function pickStudyPlace({ page, go, projectId, placeQuery, placeKind, observedPlaces }) {
  await go(`/projects/${projectId}?tab=overview`);
  await clickText(page, 'button', 'Set study area');
  const search = await page.waitForSelector('input[aria-label="Search for a place"]');
  await search.type(placeQuery);
  const kindLabel = PLACE_KIND_LABELS[placeKind];
  await page.waitForFunction((kind) => [...document.querySelectorAll('ul li button')].some((b) => b.innerText.includes(kind)), { timeout: 90000 }, kindLabel);
  const labels = await page.evaluate((kind) => {
    const buttons = [...document.querySelectorAll('ul li button')].filter((b) => b.innerText.includes(kind));
    return buttons.map((b) => b.querySelector('span span.font-medium, span.font-medium').innerText.trim());
  }, kindLabel);
  const choice = { labels, index: lib.choosePlaceResult(placeQuery, labels) };
  if (choice.index < 0) throw new Error(`Place search for "${placeQuery}" did not give one ${kindLabel} result named exactly that. Pass the full label the search shows. Results: ${choice.labels.join('; ')}`);
  const label = choice.labels[choice.index];
  await clickText(page, 'ul li button', label);
  await sleep(3000);
  await clickText(page, 'button', 'Save study area', { exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Change area/.test(b.innerText)), { timeout: 60000 });
  const result = observedPlaces.flatMap((entry) => (entry.body.items || [])).find((item) => item.label === label && item.kind === placeKind);
  if (!result) throw new Error('The place search response for the chosen place was not seen.');
  return { label, result };
}

/**
 * Retrieve crash data from the Safety screen for the project's study area and
 * return the retrieval's answer with the request the screen sent (`request`,
 * parsed, or null). A first click that sends nothing is a finding, and a
 * second click is tried once.
 */
async function retrieveCrashes({ page, go, projectId, placeLabel, findings }) {
  await go(`/safety?projectId=${projectId}`);
  await page.waitForFunction((label) => document.body.innerText.includes(`Starting from the study area set on`) && document.body.innerText.includes(label), { timeout: 60000 }, placeLabel);
  await settle(page, 2000);
  const ingest = page.waitForResponse((r) => r.url().includes('/api/safety/crashes/ingest') && r.request().method() === 'POST', { timeout: 600000 });
  let sent = page.waitForRequest((request) => request.url().includes('/api/safety/crashes/ingest') && request.method() === 'POST', { timeout: 20000 }).then(() => true, () => false);
  await clickText(page, 'button', 'Retrieve crash data', { exact: true });
  if (!(await sent)) {
    findings.push({ id: 'retrieve-first-click-did-nothing', text: 'The first click on "Retrieve crash data" sent no request within 20 seconds; a second click did.' });
    sent = page.waitForRequest((request) => request.url().includes('/api/safety/crashes/ingest') && request.method() === 'POST', { timeout: 20000 }).then(() => true, () => false);
    await clickText(page, 'button', 'Retrieve crash data', { exact: true });
    if (!(await sent)) throw new Error('Two clicks on "Retrieve crash data" sent no request.');
  }
  const response = await ingest;
  const body = await readJson(response);
  if (!response.ok() || !body || body.status !== 'ready') throw new Error(`Crash retrieval returned ${response.status()} ${body ? body.status || body.error : ''}`);
  if (body.truncated) findings.push({ id: 'crash-retrieval-truncated', text: 'The crash retrieval says it was truncated.' });
  let request = null;
  try {
    request = JSON.parse(response.request().postData() || 'null');
  } catch {
    // The request the screen sent could not be read back; the caller says what it needs from it.
  }
  await settle(page, 3000);
  return { body, request };
}

/**
 * Read each screen at every width and colour mode with axe, and add one row
 * per reading to `rows` (a journey's screens list): serious and critical
 * findings by node, console errors and whether the page scrolls sideways. A
 * screen marked `anonymous` is read with no session; `open` names a button
 * to press first. Screenshots go to <out>/screens and scrubbed console text
 * to <out>/console. Returns the serious and critical rules found.
 */
async function scanScreens({ browser, context, origin, screens, out, secrets, axeSource, rows }) {
  const anonymous = await browser.createBrowserContext();
  const rules = [];
  for (const screen of screens) {
    for (const width of lib.SCREEN_WIDTHS) {
      for (const mode of lib.SCREEN_MODES) {
        const owner = screen.anonymous ? anonymous : context;
        const tab = await owner.newPage();
        const errors = [];
        tab.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        tab.on('pageerror', (error) => errors.push(String(error && error.message)));
        await tab.setViewport({ width, height: 900 });
        await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]);
        await tab.goto(new URL(screen.route, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await settle(tab, 2500);
        if (screen.open) {
          await clickText(tab, 'button', screen.open, { exact: true });
          await settle(tab, 2000);
        }
        const applied = await tab.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
        if (applied !== mode) throw new Error(`${screen.slug} at ${width} px rendered ${applied}, not ${mode}.`);
        await tab.evaluate(axeSource);
        const results = await tab.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), lib.AXE_TAGS);
        const summary = lib.summarizeAxe(results);
        const horizontalScroll = await tab.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        const name = `${screen.slug}-${width}-${mode}`;
        await tab.screenshot({ path: path.join(out, 'screens', `${name}.png`), fullPage: true });
        fs.writeFileSync(path.join(out, 'console', `${name}.txt`), errors.map((line) => lib.scrubText(line, secrets)).join('\n'));
        rows.push({ screen: screen.slug, width, mode, axe: summary.axe, consoleErrors: errors.length, horizontalScroll });
        if (summary.rules.length) rules.push({ screen: screen.slug, width, mode, rules: summary.rules });
        await tab.close();
      }
    }
  }
  await anonymous.close();
  return rules;
}

module.exports = {
  IDLE_TIMEOUT_MS,
  PLACE_KIND_LABELS,
  appFetch,
  chromePath,
  clickText,
  controlByLabel,
  createProject,
  pickStudyPlace,
  readHealth,
  readJson,
  retrieveCrashes,
  scanScreens,
  selectByText,
  settle,
  signUpAndConfirm,
  sleep,
  typeInto,
  waitForDownload,
};
