#!/usr/bin/env node
/**
 * First proven job, one journey: a planner signs up, sets a study place,
 * retrieves crashes, saves a safety plan with countermeasures, saves a BCA,
 * runs a campaign with moderated public comments and an approved staff review,
 * exports the safety action plan report and an SS4A application, signs out,
 * and a second account then asks for the first account's work.
 *
 * Browser only. No service-role key, no database write, no API call in place
 * of a step a planner does on screen. Responses the app's own screens request
 * are read (never written) to record ids and counts.
 *
 * Modes:
 *   rehearsal  local origins only (localhost, 127.0.0.1); the local guard in
 *              harness-env.js refuses Vercel and Supabase cloud hosts.
 *   proof      the hosted proof origin only (PROOF_ORIGIN in
 *              openplan/scripts/ops/capability-evidence.mjs).
 *
 * Inputs: --inputs names a JSON file of the values a planner types, the six
 * SS4A section texts and the facts behind them, each fact with its source and
 * the date read. The script types each section's text into its "Final text"
 * box on screen and saves it as final; it refuses text that still holds a
 * [VERIFY] marker or an [OPERATOR: ...] placeholder. Rehearsal without
 * --inputs uses fixtures/first-job-rehearsal-inputs.json, labeled as
 * rehearsal text; proof mode refuses any file that carries that label.
 *
 * The campaign is a demonstration (lane 65). The inputs file carries its
 * title and invitation, each saying "Demonstration by an automated OpenPlan
 * proof run", and every comment says it was entered by an automated proof run
 * and represents no one; the validator refuses anything else, in both modes.
 * The template applies its own public description at creation. Before the
 * campaign goes live the journey replaces it with the invitation through the
 * Setup tab's "Public-facing description" field, then reads the portal and
 * its about page as an anonymous participant at 1440 and 390 px and stops
 * unless each shows the invitation and none shows the text the campaign was
 * created with. Whether the journey finishes or stops, it then sets the
 * campaign to Closed through the settings form and reads the portal, the
 * about page and the public portal data as a participant; the run file's
 * `close` says whether it tried and whether it worked, and a close that did
 * not work fails the run. The second job's journey does the same
 * (journey-campaign-lib.js holds what the two share).
 *
 * Email confirmation: the script never takes the confirmation link as an
 * argument. When sign-up asks for confirmation it waits for the file named by
 * --confirm-link-file, reads the link, opens it, and records only a SHA-256 of
 * the token. The link is never printed or written anywhere.
 *
 * Output (in --out): journey-<role>.json (the journey in the shape of
 * schemas/proven_job_record.v1.schema.json, plus cross-workspace checks,
 * findings, the step log, the mode, the harness checkout it ran from, the
 * SHA-256 of the inputs and budget files and the close), screenshots,
 * scrubbed console captures, the two PDFs and the rendered map pages. The
 * campaign's public address is written to public-address.txt beside the run
 * file and nowhere else; the operator reads it in a fresh session after the
 * run, then deletes it. Assemble three journey files into one
 * record with --assemble, then run the evidence checker on it.
 *
 * See qa-harness/README.md for the exact commands.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appRoot, repoRoot } = require('./harness-env');
const lib = require('./first-job-journey-lib');
const campaignLib = require('./journey-campaign-lib');

const puppeteer = require(require.resolve('puppeteer-core', { paths: [appRoot] }));
const AXE_SOURCE = path.join(appRoot, 'node_modules', 'axe-core', 'axe.min.js');

const STEPS = [
  'health-start', 'sign-up', 'confirm-email', 'create-project', 'set-study-place', 'retrieve-crashes',
  'rank-high-injury-network', 'create-safety-report', 'save-countermeasures', 'save-bca', 'create-campaign',
  'set-public-text', 'activate-campaign', 'read-portal-text', 'submit-public-comments', 'moderate-comments',
  'approve-staff-review', 'generate-report-pdf', 'track-ss4a', 'seed-application', 'finalize-sections',
  'attach-budget', 'export-ss4a-pdf', 'screens', 'sign-out', 'cross-workspace', 'close-campaign', 'health-end',
  'analyze-pdfs',
];

function log(message) {
  process.stdout.write(`[journey] ${message}\n`);
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

async function settle(page, ms = 1500) {
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 60000 }).catch(() => {});
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
 * planner's link. Used only for the cross-workspace check, where the point is
 * to show nothing comes back.
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--assemble') return assembleMain(argv.slice(1));
  const options = lib.parseJourneyArgs(argv);
  const proofOrigin = await lib.loadProofOrigin();
  const origin = lib.checkJourneyOrigin(options.mode, options.baseUrl, proofOrigin);
  if (options.mode === 'proof' && (!options.inputsFile || !options.budgetFile || !options.expectedCommit)) {
    throw new Error('A proof run needs --inputs, --budget-file and --expected-commit; rehearsal values never enter a proof.');
  }
  if (!fs.existsSync(AXE_SOURCE)) throw new Error(`axe-core not found at ${AXE_SOURCE}. Run npm ci in openplan/.`);
  // Rehearsal falls back to the labeled synthetic file; a proof refuses it.
  const loadedInputs = lib.loadJourneyInputs(options.mode, options.inputsFile);
  const inputs = loadedInputs.inputs;
  log(`inputs: ${path.basename(loadedInputs.file)} (sha256 ${loadedInputs.sha256.slice(0, 12)})`);
  // The checkout this script runs from, so a record names the harness that made it.
  const harness = campaignLib.harnessCheckout(repoRoot);
  log(`harness: ${harness.commit.slice(0, 12)}${harness.clean ? ', clean' : ', with uncommitted changes to tracked files'}`);
  if (options.mode === 'proof' && !harness.clean) throw new Error('A proof runs from a harness checkout with no uncommitted change to a tracked file.');

  const out = options.outDir;
  for (const dir of ['', 'screens', 'console', 'downloads', 'pdf-pages']) fs.mkdirSync(path.join(out, dir), { recursive: true });
  const downloads = path.join(out, 'downloads');

  const state = {
    role: options.role,
    executor: { agent: options.executorAgent, model: options.executorModel },
    health: [],
    screens: [],
    pdfs: [],
    engagement: { campaignId: null, approvedCommentIds: [], staffReviewIds: [] },
    bcaSaved: false,
    countermeasureCount: 0,
  };
  const ids = {};
  const findings = [];
  const steps = [];
  const secrets = [];
  const password = `Jr-${crypto.randomBytes(18).toString('base64url')}`;
  const secondPassword = `Jr-${crypto.randomBytes(18).toString('base64url')}`;
  secrets.push(password, secondPassword);
  const consoleErrors = [];
  const crossChecks = [];
  const demonstrationText = { publicTextSet: null, portal: [] };
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

  // Responses the screens request, read for ids. Never written, never replayed.
  const observed = { places: [], application: null };
  page.on('response', async (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname === '/api/geographies/places' && response.ok()) {
        const body = await readJson(response);
        if (body) observed.places.push({ query: url.searchParams.get('q'), body });
      }
      if (/^\/api\/funding-opportunities\/[^/]+\/application$/.test(url.pathname) && response.ok()) {
        const body = await readJson(response);
        if (body) observed.application = body;
      }
    } catch {
      // A response that cannot be read is not evidence of anything.
    }
  });

  const go = async (route) => {
    await page.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await settle(page);
  };

  async function step(name, fn) {
    const entry = { step: name, startedAt: lib.utcNow(), status: 'running' };
    steps.push(entry);
    log(`${name}...`);
    try {
      const detail = await fn();
      entry.status = 'passed';
      if (detail) entry.detail = detail;
      log(`${name}: passed${detail ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
    } catch (error) {
      entry.status = 'failed';
      entry.error = lib.scrubText(error && error.message ? error.message.split('\n')[0] : String(error), secrets);
      await page.screenshot({ path: path.join(out, 'screens', `failed-${name}.png`), fullPage: false }).catch(() => {});
      throw Object.assign(new Error(`Stopped at ${name}: ${entry.error}`), { journeyStep: name });
    } finally {
      entry.endedAt = lib.utcNow();
    }
  }

  async function health(point) {
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
  async function signUpAndConfirm(targetPage, email, accountPassword, confirmFile, label) {
    await targetPage.goto(new URL('/sign-up', origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await settle(targetPage);
    const names = lib.workspaceNames(inputs, options.placeQuery);
    const organization = label === 'journey' ? names.first : names.second;
    if (label === 'journey') ids.workspaceName = organization;
    await targetPage.type('#org-name', organization);
    await targetPage.type('#email', email);
    await targetPage.type('#password', accountPassword);
    const createdAt = lib.utcNow();
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
    const tokenSha256 = lib.confirmationTokenHash(link);
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
    lib.checkConfirmLinkOrigin(link, allowed);
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
   * Close the campaign through the settings form, then read its public
   * addresses as a participant. The journey signed the first account out
   * before the cross-workspace check, so the close signs it back in on the
   * sign-in screen when the app asks.
   */
  async function closeCampaign() {
    const staff = await context.newPage();
    let signedInAgain = false;
    try {
      await staff.goto(new URL(`/engagement/${ids.campaignId}?tab=setup`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await settle(staff);
      if (new URL(staff.url()).pathname.startsWith('/sign-in')) {
        await staff.type('#email', options.email);
        await staff.type('#password', password);
        await clickText(staff, 'button[type=submit]', 'Sign in');
        await staff.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 60000 });
        signedInAgain = true;
        await staff.goto(new URL(`/engagement/${ids.campaignId}?tab=setup`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await settle(staff);
      }
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
      await staff.goto(new URL(`/engagement/${ids.campaignId}?tab=setup`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await settle(staff);
      const statusAfter = await staff.$eval('#campaign-control-status', (el) => el.value).catch(() => 'unreadable');
      await staff.screenshot({ path: path.join(out, 'screens', 'campaign-closed-staff-1440.png') });
      const campaignStrings = [inputs.campaign.title, ...inputs.comments];
      const holdsCampaignText = (text) => campaignStrings.some((value) => campaignLib.textHolds(text, value));
      const addresses = [];
      // No public link was made if the journey stopped before activation.
      const neverPublic = !ids.portalPath;
      let api = { status: null, text: '' };
      if (!neverPublic) {
        const visitor = await browser.createBrowserContext();
        try {
          const reader = await visitor.newPage();
          for (const [name, route] of [['portal', ids.portalPath], ['about', `${ids.portalPath}/about`]]) {
            const response = await reader.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
            await settle(reader, 1500);
            const html = await reader.content();
            const text = await reader.evaluate(() => document.body.innerText);
            addresses.push({
              name,
              status: response.status(),
              endedNoticeShown: Boolean(await reader.$('[data-testid=closed-campaign-notice]')),
              campaignTextFound: holdsCampaignText(`${text}\n${html}`),
            });
            await reader.screenshot({ path: path.join(out, 'screens', `campaign-closed-${name}-1440.png`) });
          }
          // The share token in its own name, so the route-contract guard can read this call as /api/engage/[shareToken].
          const shareToken = ids.portalPath.split('/').pop();
          api = await appFetch(`/api/engage/${shareToken}`, null, 'GET', reader);
        } finally {
          await visitor.close().catch(() => {});
        }
      }
      // The public portal data after the close: a 200 that still carries the
      // campaign's title or a comment means the campaign is not offline.
      const publicRead = { status: api.status, campaignTextFound: holdsCampaignText(api.text) };
      const verdict = campaignLib.closeVerdict({ saveStatus, statusAfter, addresses, publicRead, neverPublic });
      closeReading = { signedInAgain, saveStatus, statusAfter, addresses, publicReadStatusAfter: api.status, publicReadCampaignTextFound: publicRead.campaignTextFound, ...verdict };
      return verdict;
    } catch (error) {
      await staff.screenshot({ path: path.join(out, 'screens', 'failed-close-campaign.png') }).catch(() => {});
      throw error;
    } finally {
      await staff.close().catch(() => {});
    }
  }

  async function mainSteps() {
    await step('health-start', () => health('start'));

    await step('sign-up', async () => {
      const result = await signUpAndConfirm(page, options.email, password, options.confirmLinkFile, 'journey');
      state.accountCreatedAt = result.createdAt;
      state.confirmationMethod = result.confirmationMethod;
      ids.tokenSha256 = result.tokenSha256;
      return `confirmation ${result.confirmationMethod}`;
    });

    await step('confirm-email', async () => {
      if (state.confirmationMethod === 'not_required') {
        findings.push({ id: 'confirmation-not-required', text: 'Sign-up returned a signed-in session. This installation does not require email confirmation, so the confirmation step was not exercised.' });
        if (options.mode === 'proof') throw new Error('The hosted installation did not ask for email confirmation.');
        return 'not required by this installation';
      }
      return `token sha256 ${ids.tokenSha256}`;
    });

    await step('create-project', async () => {
      await go('/projects');
      await clickText(page, 'button', 'New project', { exact: true });
      await page.waitForSelector('#create-project-projectName');
      ids.projectName = inputs.projectName || `${options.placeQuery} local roads`;
      await page.type('#create-project-projectName', ids.projectName);
      await page.type('#create-project-summary', inputs.projectSummary);
      await clickText(page, 'dialog[open] button', 'Next', { exact: true });
      await page.waitForSelector('#create-project-planType');
      await page.select('#create-project-planType', inputs.planType);
      const created = page.waitForResponse((r) => r.url().includes('/api/projects') && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'dialog[open] button', 'Start the project', { exact: true });
      const response = await created;
      if (response.status() !== 201) throw new Error(`Project create returned ${response.status()}`);
      await page.waitForFunction(() => /\/projects\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 60000 });
      ids.projectId = page.url().match(/projects\/([0-9a-f-]{36})/)[1];
      return ids.projectId;
    });

    await step('set-study-place', async () => {
      await go(`/projects/${ids.projectId}?tab=overview`);
      await clickText(page, 'button', 'Set study area');
      const search = await page.waitForSelector('input[aria-label="Search for a place"]');
      await search.type(options.placeQuery);
      const kindLabel = { county: 'County', city: 'City / town', cdp: 'Census-designated place', metro: 'Metro area', micro: 'Micropolitan area', aiannh: 'Tribal area', cousub: 'Town or township' }[options.placeKind];
      await page.waitForFunction((kind) => [...document.querySelectorAll('ul li button')].some((b) => b.innerText.includes(kind)), { timeout: 90000 }, kindLabel);
      const labels = await page.evaluate((kind) => {
        const buttons = [...document.querySelectorAll('ul li button')].filter((b) => b.innerText.includes(kind));
        return buttons.map((b) => b.querySelector('span span.font-medium, span.font-medium').innerText.trim());
      }, kindLabel);
      // The full label only (KI-2026-11-14-230): "Pyramid Lake Paiute Reservation, NV", not "Pyramid Lake".
      const choice = { labels, index: lib.choosePlaceResult(options.placeQuery, labels) };
      if (choice.index < 0) throw new Error(`Place search for "${options.placeQuery}" did not give one ${kindLabel} result named exactly that. Pass the full label the search shows. Results: ${choice.labels.join('; ')}`);
      const label = choice.labels[choice.index];
      await clickText(page, 'ul li button', label);
      await sleep(3000);
      await clickText(page, 'button', 'Save study area', { exact: true });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Change area/.test(b.innerText)), { timeout: 60000 });
      const result = observed.places.flatMap((entry) => (entry.body.items || [])).find((item) => item.label === label && item.kind === options.placeKind);
      if (!result) throw new Error('The place search response for the chosen place was not seen.');
      state.place = { kind: result.kind, geoid: result.geoid, stateFips: result.stateFips ? [result.stateFips] : [], label };
      if (!result.stateFips) findings.push({ id: 'place-without-state', text: `${label} has no single state code in the place search response; the record's stateFips is empty.` });
      return `${label} (${result.kind} ${result.geoid})`;
    });

    await step('retrieve-crashes', async () => {
      await go(`/safety?projectId=${ids.projectId}`);
      await page.waitForFunction((label) => document.body.innerText.includes(`Starting from the study area set on`) && document.body.innerText.includes(label), { timeout: 60000 }, state.place.label);
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
      ids.ingestId = body.ingestId;
      state.crashes = {
        sourceId: body.sourceId,
        severityCoverage: String(body.severityCompleteness || body.coverageState || 'not reported'),
        reportedCount: Number.isInteger(body.crashCount) ? body.crashCount : null,
        storedCount: body.storedCount,
      };
      if (body.truncated) findings.push({ id: 'crash-retrieval-truncated', text: 'The crash retrieval says it was truncated.' });
      await settle(page, 3000);
      return `${body.sourceId}: ${body.crashCount} reported, ${body.storedCount} stored`;
    });

    await step('rank-high-injury-network', async () => {
      await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.innerText.trim() === 'High-injury network'), { timeout: 60000 });
      const network = await page.evaluate(() => {
        const heading = [...document.querySelectorAll('h2')].find((h) => h.innerText.trim() === 'High-injury network');
        const section = heading.closest('section');
        const facts = section.querySelector('[data-testid=safety-hin-facts]');
        const method = facts ? [...facts.querySelectorAll('dt')].find((dt) => dt.innerText.trim() === 'Method') : null;
        const subtitle = [...section.querySelectorAll('p')].map((p) => p.innerText.trim()).find((text) => /per mile|crashes per|square/i.test(text));
        return {
          rows: section.querySelectorAll('[data-testid=safety-hin-row]').length,
          method: method ? method.nextElementSibling.innerText.trim() : null,
          subtitle: subtitle || null,
        };
      });
      if (!network.method) throw new Error('The high-injury network shows no method.');
      state.highInjuryNetwork = { method: network.subtitle ? `${network.subtitle}. ${network.method}` : network.method, segmentCount: network.rows };
      if (network.rows === 0) findings.push({ id: 'no-ranked-segments', text: 'The high-injury network ranks no segment for this place, so no map or countermeasure can be shown.' });
      return `${network.rows} segments`;
    });

    await step('create-safety-report', async () => {
      const created = page.waitForResponse((r) => r.url().includes('/api/reports') && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, '[data-testid=safety-hin-create-report] button', 'Create safety action plan report');
      const response = await created;
      const body = await readJson(response);
      if (response.status() !== 201 || !body) throw new Error(`Report create returned ${response.status()}`);
      ids.reportId = body.reportId || (body.report && body.report.id) || body.id;
      ids.reportTitle = body.report && body.report.title ? body.report.title : null;
      if (!ids.reportId) throw new Error('The report create response named no report.');
      await page.waitForSelector('[data-testid=safety-hin-save]', { timeout: 60000 });
      const status = await page.$eval('[data-testid=safety-hin-save]', (el) => el.innerText.replace(/\s+/g, ' '));
      if (!/Created /.test(status)) throw new Error(`Report created but the screen says: ${status.slice(0, 160)}`);
      return ids.reportId;
    });

    await step('save-countermeasures', async () => {
      const wanted = inputs.countermeasures;
      const rows = await page.$$('[data-testid=safety-hin-row]');
      const treated = Math.min(inputs.treatedSegments, rows.length);
      let checked = 0;
      for (let index = 0; index < treated; index += 1) {
        checked += await page.evaluate((rowIndex, names) => {
          const row = document.querySelectorAll('[data-testid=safety-hin-row]')[rowIndex];
          const details = row.querySelector('[data-testid=safety-hin-treatments]');
          details.open = true;
          let count = 0;
          for (const label of details.querySelectorAll('label')) {
            if (names.includes(label.textContent.trim())) {
              const box = label.querySelector('input[type=checkbox]');
              if (!box.checked) box.click();
              count += 1;
            }
          }
          return count;
        }, index, wanted);
        await sleep(300);
      }
      if (treated > 0 && checked !== treated * wanted.length) throw new Error(`Found ${checked} of ${treated * wanted.length} countermeasure boxes; check the names in the inputs.`);
      const saved = page.waitForResponse((r) => r.url().includes(`/api/reports/${ids.reportId}`) && r.request().method() === 'PATCH', { timeout: 60000 });
      await clickText(page, '[data-testid=safety-hin-save] button', 'Save');
      const response = await saved;
      if (!response.ok()) throw new Error(`Saving countermeasures returned ${response.status()}`);
      await page.waitForFunction(() => /Saved to /.test((document.querySelector('[data-testid=safety-hin-save] [role=status]') || {}).innerText || ''), { timeout: 30000 });
      state.countermeasureCount = checked;
      return `${checked} countermeasures on ${treated} segments`;
    });

    await step('save-bca', async () => {
      await go(`/safety?projectId=${ids.projectId}`);
      await clickText(page, 'a', 'Benefit-cost analysis', { exact: true });
      await page.waitForFunction(() => location.pathname.startsWith('/grants/bca/'), { timeout: 60000 });
      await settle(page, 2500);
      await typeInto(await controlByLabel(page, 'Analysis title'), inputs.bca.title);
      await selectByText(await controlByLabel(page, 'Grant program and edition'), 'USDOT discretionary grants, 2026');
      await sleep(500);
      const firstYear = await (await controlByLabel(page, 'First analysis year')).evaluate((el) => el.value);
      const costYear = inputs.bca.costYear || firstYear;
      await clickText(page, 'button', 'Evidence', { exact: true });
      await page.waitForSelector('section[aria-label="Crashes on treated segments"] fieldset', { timeout: 60000 });
      const S = 'section[aria-label="Crashes on treated segments"]';
      const choice = await page.$$eval(`${S} fieldset`, (sets) => sets.map((set) => ({
        killed: Number((set.innerText.match(/People killed: (\d+)/) || [])[1] || 0),
        serious: !set.querySelector('option[value="serious-injury"]').disabled,
      })));
      let index = choice.findIndex((entry) => entry.killed > 0);
      let outcome = 'fatality';
      if (index < 0) {
        index = choice.findIndex((entry) => entry.serious);
        outcome = 'serious-injury';
        if (index < 0 || !inputs.bca.seriousInjuryPersons) {
          throw new Error('No treated segment has a recorded fatality, and a serious-injury stream needs persons entered from crash reports (inputs.bca.seriousInjuryPersons).');
        }
      }
      const fieldset = (await page.$$(`${S} fieldset`))[index];
      const select = await fieldset.$('select');
      await select.select(outcome);
      await sleep(300);
      const scope = await fieldset.evaluateHandle((el) => el);
      const field = async (label) => {
        const handle = await page.evaluateHandle((root, wanted) => {
          for (const lab of root.querySelectorAll('label')) {
            const clone = lab.cloneNode(true);
            clone.querySelectorAll('input,select,textarea,option').forEach((el) => el.remove());
            if (clone.textContent.replace(/\s+/g, ' ').trim().startsWith(wanted)) return lab.querySelector('input,select,textarea');
          }
          return null;
        }, scope, label);
        if (!handle.asElement()) throw new Error(`No field "${label}" on the treated segment`);
        return handle.asElement();
      };
      if (outcome === 'serious-injury') await typeInto(await field('Serious injuries, persons'), inputs.bca.seriousInjuryPersons);
      await typeInto(await field('Crash modification factor'), inputs.bca.cmf);
      await typeInto(await field('CMF Clearinghouse ID'), inputs.bca.cmfClearinghouseId);
      const added = await fieldset.evaluate((set) => {
        const button = [...set.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Add safety stream for this segment');
        if (!button) return false;
        button.click();
        return true;
      });
      if (!added) throw new Error('The treated segment has no "Add safety stream for this segment" button.');
      await page.waitForFunction(() => /Added a safety stream/.test(document.body.innerText), { timeout: 15000 }).catch(async () => {
        const notice = await page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].map((el) => el.innerText).join(' | '));
        throw new Error(`The safety stream was not added: ${notice.slice(0, 200)}`);
      });
      await clickText(page, 'button', 'Benefits and costs', { exact: true });
      await settle(page, 1500);
      const usdot = await controlByLabel(page, 'Insert a published USDOT');
      await usdot.select(outcome === 'fatality' ? 'fatality' : 'serious-injury');
      await sleep(500);
      await selectByText(await controlByLabel(page, 'Monetization source'), 'USDOT 2026');
      await clickText(page, 'button', 'Add cost stream', { exact: true });
      await sleep(800);
      const costIndex = await page.evaluate(() => [...document.querySelectorAll('label')].filter((lab) => /^Stream name/.test(lab.textContent.trim())).length - 1);
      const costField = (label) => controlByLabel(page, label, { nth: costIndex });
      const unit = await costField('Quantity unit');
      if ((await unit.evaluate((el) => el.value)) !== 'dollar') await unit.select('dollar');
      await typeInto(await costField('First flow year'), costYear);
      await typeInto(await costField('Last flow year'), costYear);
      await typeInto(await costField('No Build quantity'), '0');
      await typeInto(await costField('Build quantity'), inputs.bca.capitalCost);
      await typeInto(await costField('Occurrences per year'), '1');
      await typeInto(await costField('Dollars per quantity unit'), '1');
      await clickText(page, 'button', 'Results and review', { exact: true });
      await settle(page, 1500);
      ids.bcaResult = await page.evaluate(() => {
        const match = document.querySelector('main').innerText.match(/benefit[- ]cost ratio[^0-9-]{0,40}(-?[0-9.,]+)/i);
        return match ? match[1] : null;
      });
      const documentErrors = await page.evaluate(() => {
        const box = [...document.querySelectorAll('main *')].find((el) => el.children.length < 30 && /^Correct these document errors/.test((el.innerText || '').trim()));
        return box ? box.innerText.replace(/\s+/g, ' ').trim() : null;
      });
      if (documentErrors) throw new Error(`The BCA cannot be saved: ${documentErrors.slice(0, 300)}`);
      const saved = page.waitForResponse((r) => r.url().includes(`/api/projects/${ids.projectId}/bca-analyses`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'button', 'Save a version', { exact: true });
      const response = await saved;
      if (!response.ok()) throw new Error(`BCA save returned ${response.status()}`);
      await page.waitForFunction(() => /Saved an immutable version/.test(document.body.innerText), { timeout: 30000 });
      state.bcaSaved = true;
      return `saved; ${outcome} stream; ratio on screen ${ids.bcaResult ?? 'not read'}`;
    });

    await step('create-campaign', async () => {
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
      if (response.status() !== 201) throw new Error(`Campaign create returned ${response.status()}`);
      await page.waitForFunction(() => /\/engagement\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 60000 });
      ids.campaignId = page.url().match(/engagement\/([0-9a-f-]{36})/)[1];
      state.engagement.campaignId = ids.campaignId;
      return ids.campaignId;
    });

    await step('set-public-text', async () => {
      const openField = async () => {
        await go(`/engagement/${ids.campaignId}?tab=setup`);
        await page.evaluate(() => {
          const field = document.querySelector('#public-description');
          for (let node = field; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
          if (field) field.scrollIntoView({ block: 'center' });
        });
        await sleep(800);
        return page.waitForSelector('#public-description', { visible: true, timeout: 30000 });
      };
      const field = await openField();
      const before = await field.evaluate((el) => el.value);
      ids.createdWithPublicText = before;
      await typeInto(field, inputs.campaign.invitation);
      const saved = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}`) && r.request().method() === 'PATCH', { timeout: 60000 });
      await clickText(page, '#public-share-controls button', 'Save share settings', { exact: true });
      const saveStatus = (await saved).status();
      if (saveStatus !== 200) throw new Error(`Saving the public description answered ${saveStatus}.`);
      await settle(page, 1500);
      const after = await (await openField()).evaluate((el) => el.value);
      demonstrationText.publicTextSet = {
        control: 'Setup tab, Public-facing description, Save share settings',
        saveStatus,
        templateTextBefore: campaignLib.readDemonstrationText({ surface: { name: 'the field before', text: before }, invitation: inputs.campaign.invitation, title: inputs.campaign.title }).templateSentenceFound,
        readsInvitationAfter: after.trim() === inputs.campaign.invitation.trim(),
      };
      if (!demonstrationText.publicTextSet.readsInvitationAfter) throw new Error(`After saving, the public description reads "${after.slice(0, 80)}".`);
      return `public description replaced${demonstrationText.publicTextSet.templateTextBefore ? " (it held the template's text)" : ''}`;
    });

    await step('activate-campaign', async () => {
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
    });

    await step('read-portal-text', async () => {
      const visitor = await browser.createBrowserContext();
      const pages = [];
      try {
        const reader = await visitor.newPage();
        for (const width of lib.SCREEN_WIDTHS) {
          await reader.setViewport({ width, height: width === 390 ? 844 : 1000 });
          for (const [name, route] of [['portal', ids.portalPath], ['about', `${ids.portalPath}/about`]]) {
            await reader.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
            await settle(reader);
            // At 390 px the portal's title and description sit in a bottom
            // sheet that is shut until the participant opens it.
            const sheet = await reader.$('#portal-sheet-toggle');
            const handle = sheet && !(await sheet.evaluate((el) => el.checked)) ? await reader.$('label[for=portal-sheet-toggle]') : null;
            const sheetOpened = Boolean(handle && (await handle.boundingBox()));
            if (sheetOpened) {
              await handle.click();
              await sleep(800);
            }
            const text = await reader.evaluate(() => document.body.innerText);
            const html = await reader.content();
            await reader.screenshot({ path: path.join(out, 'screens', `demonstration-${name}-${width}.png`), fullPage: false });
            pages.push({ name, width, text, html, sheetOpened });
          }
        }
      } finally {
        await visitor.close().catch(() => {});
      }
      demonstrationText.portal = lib.portalDemonstrationReadings({ pages, invitation: inputs.campaign.invitation, title: inputs.campaign.title, createdWith: ids.createdWithPublicText });
      lib.assertPortalReadsAsDemonstration(demonstrationText.portal);
      return `${demonstrationText.portal.length} readings show the invitation and not the text the campaign was created with`;
    });

    await step('submit-public-comments', async () => {
      ids.submissionIds = [];
      for (const text of inputs.comments) {
        const resident = await browser.createBrowserContext();
        const portal = await resident.newPage();
        await portal.setViewport({ width: 1440, height: 1000 });
        await portal.goto(new URL(ids.portalPath, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await settle(portal);
        await clickText(portal, 'button', '2. Say what you think');
        await portal.waitForSelector('#portal-body');
        await portal.type('#portal-body', text);
        await clickText(portal, 'button', '5. Send it');
        await sleep(800);
        const shareToken = ids.portalPath.split('/').pop();
        const sent = portal.waitForResponse((r) => r.url().includes(`/api/engage/${shareToken}/submit`) && r.request().method() === 'POST', { timeout: 60000 });
        await clickText(portal, 'button[type=submit]', 'Send');
        const response = await sent;
        const body = await readJson(response);
        if (response.status() !== 201 || !body || !body.submissionId) throw new Error(`Portal submission returned ${response.status()}`);
        await portal.waitForSelector('[data-testid=portal-sidebar-received]', { timeout: 30000 });
        ids.submissionIds.push(body.submissionId);
        await resident.close();
      }
      return `${ids.submissionIds.length} received, pending review`;
    });

    await step('moderate-comments', async () => {
      await go(`/engagement/${ids.campaignId}?tab=responses`);
      for (let index = 0; index < ids.submissionIds.length; index += 1) {
        const itemId = ids.submissionIds[index];
        await clickText(page, 'nav[aria-label="Contributions on this page"] button', inputs.comments[index].slice(0, 40));
        const reason = await page.waitForSelector(`#engagement-item-reason-${itemId}`, { timeout: 20000 });
        await reason.type(inputs.reviewReason);
        const approved = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}/items/${itemId}`) && r.request().method() === 'PATCH', { timeout: 60000 });
        await clickText(page, 'button', 'Approve', { exact: true });
        const response = await approved;
        if (response.status() !== 200) throw new Error(`Approving comment ${index + 1} returned ${response.status()}`);
        state.engagement.approvedCommentIds.push(itemId);
        await sleep(1500);
      }
      return `${state.engagement.approvedCommentIds.length} approved with a review reason`;
    });

    await step('approve-staff-review', async () => {
      await go(`/engagement/${ids.campaignId}?tab=analysis`);
      const sourceSaved = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}/synthesis/sources`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'button', 'Save selected sources', { exact: true });
      if ((await sourceSaved).status() !== 201) throw new Error('The source set was not saved.');
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Create staff review' && !b.disabled), { timeout: 60000 });
      const R = 'section[aria-label="Retained staff reviews"]';
      const created = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}/synthesis/reviews`) && r.request().method() === 'POST', { timeout: 60000 });
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
      await typeInto(await controlByLabel(page, 'Group label', { within: R }), inputs.staffReview.groupLabel);
      await typeInto(await controlByLabel(page, 'Staff group summary', { within: R }), inputs.staffReview.groupSummary);
      await typeInto(await controlByLabel(page, 'Reason for correction', { within: R }), inputs.staffReview.correctionReason);
      const corrected = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}/synthesis/reviews`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, `${R} button`, 'Save reasoned correction', { exact: true });
      if ((await corrected).status() !== 201) throw new Error('The staff review correction was not saved.');
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Approve revision 2/.test(b.innerText) && !b.disabled), { timeout: 60000 });
      await typeInto(await controlByLabel(page, 'Reason for approval or withdrawal', { within: R }), inputs.staffReview.approvalReason);
      const approved = page.waitForResponse((r) => r.url().includes(`/api/engagement/campaigns/${ids.campaignId}/synthesis/approvals`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'button', 'Approve revision 2', { exact: true });
      if ((await approved).status() !== 201) throw new Error('The staff review approval was not saved.');
      state.engagement.staffReviewIds.push(ids.reviewId);
      return `review ${ids.reviewId.slice(0, 8)} revision 2 approved`;
    });

    await step('generate-report-pdf', async () => {
      await go(`/reports/${ids.reportId}`);
      const chosen = await page.$eval('#report-safety-ingest', (el) => el.value);
      if (chosen !== ids.ingestId) throw new Error('The report does not have this crash retrieval selected as its crash evidence.');
      const unsaved = await page.evaluate(() => /Unsaved report edits/.test(document.body.innerText));
      if (unsaved) throw new Error('The report page says it has unsaved edits before generation.');
      const generated = page.waitForResponse((r) => r.url().includes(`/api/reports/${ids.reportId}/generate`) && r.request().method() === 'POST', { timeout: 300000 });
      await clickText(page, 'button', 'Generate PDF packet', { exact: true });
      const response = await generated;
      const body = await readJson(response);
      if (!response.ok() || !body || !body.artifactId) throw new Error(`Report generation returned ${response.status()}`);
      ids.artifactId = body.artifactId;
      if (Array.isArray(body.warnings) && body.warnings.length) findings.push({ id: 'report-generation-warnings', text: `Report generation warned: ${lib.scrubText(body.warnings.join('; '), secrets).slice(0, 300)}` });
      await settle(page, 2000);
      const before = new Set(fs.readdirSync(downloads));
      await clickText(page, 'a', 'Download PDF', { exact: true });
      const file = await waitForDownload(downloads, before);
      const target = path.join(downloads, `${options.role}-safety-action-plan.pdf`);
      fs.renameSync(file, target);
      ids.reportPdf = target;
      return `artifact ${ids.artifactId.slice(0, 8)}, ${fs.statSync(target).size} bytes`;
    });

    await step('track-ss4a', async () => {
      await go(`/grants?focusProjectId=${ids.projectId}&tab=opportunities`);
      await (await controlByLabel(page, 'Search program catalog')).type('SS4A');
      await sleep(1500);
      const tracked = page.waitForResponse((r) => r.url().includes('/api/funding-opportunities') && r.request().method() === 'POST', { timeout: 60000 });
      const clicked = await page.evaluate(() => {
        const isTrack = (b) => b.innerText.trim() === 'Track as opportunity';
        const buttons = [...document.querySelectorAll('button')].filter((b) => isTrack(b) && b.getBoundingClientRect().width);
        for (const button of buttons) {
          // The card is the largest container that holds this one Track button.
          let card = button;
          while (card.parentElement && [...card.parentElement.querySelectorAll('button')].filter(isTrack).length === 1) card = card.parentElement;
          if (card && /Safe Streets and Roads for All \(SS4A\)/.test(card.innerText)) {
            button.click();
            return true;
          }
        }
        return false;
      });
      if (!clicked) throw new Error('No catalog card for Safe Streets and Roads for All (SS4A).');
      const response = await tracked;
      const body = await readJson(response);
      if (response.status() !== 201 || !body || !body.opportunityId) throw new Error(`Tracking returned ${response.status()}`);
      ids.opportunityId = body.opportunityId;
      if (!body.opportunity || body.opportunity.project_id !== ids.projectId) throw new Error('The tracked opportunity is not linked to the project.');
      await page.waitForFunction(() => /Added to opportunities/.test(document.body.innerText), { timeout: 15000 });
      return ids.opportunityId;
    });

    const openApplication = async () => {
      await go(`/grants?focusProjectId=${ids.projectId}&tab=opportunities`);
      const loaded = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application`) && r.request().method() === 'GET', { timeout: 60000 });
      await clickText(page, 'button', 'Open application workspace', { exact: true });
      await loaded;
      await settle(page, 1500);
    };

    await step('seed-application', async () => {
      await openApplication();
      await selectByText(await page.waitForSelector('select[aria-label="Application template"]'), 'Safe Streets and Roads for All (SS4A)');
      const initialized = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'button', 'Initialize application', { exact: true });
      if ((await initialized).status() !== 201) throw new Error('The application was not initialized.');
      const P = '[data-testid=safety-plan-seed-panel]';
      await page.waitForFunction((sel, artifact) => {
        const select = document.querySelector(`${sel} select`);
        return select && [...select.options].some((option) => option.value === artifact);
      }, { timeout: 60000 }, P, ids.artifactId);
      await (await page.$(`${P} select`)).select(ids.artifactId);
      const previewed = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application/safety-seed`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, `${P} button`, 'Preview Safety seed', { exact: true });
      if (!(await previewed).ok()) throw new Error('The Safety seed preview failed.');
      const applied = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application/safety-seed`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, `${P} button`, 'Apply six working drafts', { exact: true });
      if (!(await applied).ok()) throw new Error('The Safety seed was not applied.');
      await page.waitForFunction((sel) => /Six working drafts added/.test(document.querySelector(sel).innerText), { timeout: 30000 }, P);
      return 'six working drafts';
    });

    await step('finalize-sections', async () => {
      await openApplication();
      const sections = ((observed.application && observed.application.sections) || []).map((row) => ({ id: row.id, key: row.section_key }));
      if (sections.length !== 6) throw new Error(`Expected six SS4A sections, the application lists ${sections.length}.`);
      const wanted = Object.keys(inputs.sections).sort();
      const listed = sections.map((section) => section.key).sort();
      if (JSON.stringify(wanted) !== JSON.stringify(listed)) throw new Error(`The inputs give text for ${wanted.join(', ')}; the application lists ${listed.join(', ')}.`);
      // Each section's text is typed into the "Final text" box on screen and
      // saved as final; nothing is written behind the screen. A section whose
      // box still holds a marker or placeholder after typing is not saved.
      ids.sectionEntries = [];
      for (const section of sections) {
        const S = `[data-testid="application-section-${section.key}"]`;
        const text = inputs.sections[section.key].text;
        await page.waitForSelector(S);
        if ((await page.$eval(`${S} button[aria-expanded]`, (b) => b.getAttribute('aria-expanded'))) !== 'true') {
          await page.click(`${S} button[aria-expanded]`);
          await sleep(1000);
        }
        const title = await page.$eval(`${S} button[aria-expanded]`, (b) => b.innerText.trim());
        await clickText(page, `${S} button`, 'Finalize edited text', { exact: true });
        const box = await page.waitForSelector(`${S} textarea[aria-label="Final text for ${title}"]`, { visible: true, timeout: 20000 });
        await typeInto(box, text);
        const entered = await box.evaluate((el) => el.value);
        const inBox = lib.countMarkers(entered);
        if (inBox.verify + inBox.placeholders > 0) throw new Error(`Section ${section.key} still holds ${inBox.verify} [VERIFY] marker(s) and ${inBox.placeholders} placeholder(s) after typing; not finalizing it.`);
        const patched = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/sections/${section.id}`) && r.request().method() === 'PATCH', { timeout: 60000 });
        await clickText(page, `${S} button`, 'Save as final', { exact: true });
        const response = await patched;
        if (response.status() !== 200) {
          const refusal = await page.$eval(`${S} [data-testid=finalize-refusal]`, (el) => el.innerText).catch(() => '');
          throw new Error(`Saving ${section.key} as final returned ${response.status()}: ${refusal.slice(0, 200)}`);
        }
        // The header's status badge reads Final; the warning badge PR 468 added
        // shows any unverified items left (no badge means none).
        await page.waitForFunction((sel) => {
          const header = document.querySelector(sel).firstElementChild;
          return header && /\bFinal\b/.test(header.innerText);
        }, { timeout: 30000 }, S);
        await sleep(500);
        const header = await page.$eval(S, (el) => el.firstElementChild.innerText.replace(/\s+/g, ' '));
        const onScreen = lib.parseUnverifiedBadge(header);
        ids.sectionEntries.push({ sectionKey: section.key, textSha256: lib.sha256(Buffer.from(entered, 'utf8')), characters: entered.length, unverifiedOnScreen: onScreen.verify + onScreen.placeholders });
        if (onScreen.verify + onScreen.placeholders > 0) throw new Error(`After saving, the screen counts ${onScreen.verify} unverified item(s) and ${onScreen.placeholders} placeholder(s) in ${section.key}.`);
      }
      return `${ids.sectionEntries.length} of ${sections.length} final from typed text, 0 unverified on screen`;
    });

    await step('attach-budget', async () => {
      await go(`/knowledge-base?projectId=${ids.projectId}`);
      const project = await controlByLabel(page, 'Project (optional');
      if ((await project.evaluate((el) => el.value)) !== ids.projectId) await project.select(ids.projectId);
      await typeInto(await controlByLabel(page, 'Title (optional'), inputs.budgetTitle);
      let budgetFile = options.budgetFile;
      if (!budgetFile) {
        budgetFile = path.join(out, 'rehearsal-budget.csv');
        fs.writeFileSync(budgetFile, 'Activity,Funding source,Amount (USD)\nREHEARSAL BUDGET. NOT A COST ESTIMATE.,,\nSafety action plan,SS4A planning grant,0\n');
      }
      ids.budgetSha256 = campaignLib.fileSha256(budgetFile);
      const started = page.waitForResponse((r) => r.url().includes('/api/knowledge-base/documents/upload/start') && r.request().method() === 'POST', { timeout: 120000 });
      const completed = page.waitForResponse((r) => r.url().includes('/api/knowledge-base/documents/upload/complete') && r.request().method() === 'POST', { timeout: 180000 });
      await (await page.$('input[type=file][aria-label="Upload a file"]')).uploadFile(budgetFile);
      if (!(await started).ok()) throw new Error('The budget upload did not start.');
      const completeResponse = await completed;
      await sleep(1500);
      const uploadMessage = await page.evaluate(() => {
        const text = document.querySelector('main').innerText;
        const line = text.split('\n').find((entry) => /^(Kept "|Stored "|Added "|That document is already)/.test(entry.trim()));
        const alert = [...document.querySelectorAll('main [role=alert]')].map((el) => el.innerText.trim()).filter(Boolean).join(' | ');
        return { line: line || null, alert: alert || null };
      });
      if (!completeResponse.ok() || uploadMessage.alert || !uploadMessage.line) {
        throw new Error(`The budget upload did not complete (${completeResponse.status()}): ${(uploadMessage.alert || uploadMessage.line || 'no confirmation on screen').slice(0, 200)}`);
      }
      // The application's document picker listing the budget is the check that
      // matters; the Documents file list below the form does not refresh.
      await openApplication();
      const attach = async (title, kind, value) => {
        const label = kind === 'kb' ? `Attach Knowledge Base document to ${title}` : `Attach report artifact to ${title}`;
        const select = await page.waitForSelector(`select[aria-label="${label}"]`);
        if (value) await select.select(value);
        else await selectByText(select, inputs.budgetTitle);
        const row = await select.evaluateHandle((el) => el.closest('[data-testid^=application-attachment-]'));
        const attachmentKey = await row.evaluate((el) => el.getAttribute('data-testid').replace('application-attachment-', ''));
        const attachment = ((observed.application && observed.application.attachments) || []).find((entry) => entry.attachment_key === attachmentKey);
        if (!attachment) throw new Error(`The application lists no attachment ${attachmentKey}.`);
        const patched = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/attachments/${attachment.id}`) && r.request().method() === 'PATCH', { timeout: 60000 });
        await clickText(page, `[data-testid="application-attachment-${attachmentKey}"] button`, kind === 'kb' ? 'Attach document' : 'Attach report artifact', { exact: true });
        if ((await patched).status() !== 200) throw new Error(`Attaching to ${title} failed.`);
        await page.waitForFunction((statusLabel) => {
          const status = document.querySelector(`select[aria-label="${statusLabel}"]`);
          return status && status.value === 'attached';
        }, { timeout: 30000 }, `Status for ${title}`);
      };
      await attach('Budget detail', 'kb');
      await attach('Safety action plan or self-certification worksheet', 'artifact', ids.artifactId);
      // A row's text always contains every status option, so read the status select itself.
      const outstanding = await page.$$eval('[data-testid^=application-attachment-]', (rows) => rows.filter((row) => {
        const required = [...row.querySelectorAll('*')].some((el) => el.children.length === 0 && el.textContent.trim() === 'Required');
        const status = row.querySelector('select[aria-label^="Status for "]');
        return required && (!status || !['attached', 'not_applicable'].includes(status.value));
      }).length);
      if (outstanding) throw new Error(`${outstanding} required attachment(s) still outstanding.`);
      return 'budget document and safety plan attached';
    });

    await step('export-ss4a-pdf', async () => {
      // What the export control says it will stamp, before export.
      ids.ss4aStampBefore = await page.$eval('[data-testid=export-draft-stamps]', (el) => el.innerText.replace(/\s+/g, ' ').trim()).catch(() => null);
      const exported = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application/export`) && r.request().method() === 'POST', { timeout: 300000 });
      await clickText(page, '[data-testid=application-export] button', 'Export application packet (PDF)');
      const response = await exported;
      const body = await readJson(response);
      if (response.status() !== 201 || !body) throw new Error(`Export returned ${response.status()}`);
      ids.exportId = body.exportId || (body.export && body.export.id);
      await page.waitForSelector('[data-testid=export-result], [data-testid=export-refusal]', { timeout: 60000 });
      const refusal = await page.$('[data-testid=export-refusal]');
      if (refusal) throw new Error(`Export refused: ${(await refusal.evaluate((el) => el.innerText)).slice(0, 200)}`);
      const result = await page.$eval('[data-testid=export-result]', (el) => el.innerText);
      ids.ss4aStampAfter = result.split('\n').map((line) => line.trim()).filter((line) => /DRAFT/.test(line));
      ids.ss4aDraftStamps = Array.isArray(body.draftStamps) ? body.draftStamps : null;
      if (ids.ss4aStampAfter.length) findings.push({ id: 'ss4a-draft-stamped', text: ids.ss4aStampAfter.join(' | ') });
      const before = new Set(fs.readdirSync(downloads));
      await clickText(page, '[data-testid=export-result] a', 'Download PDF', { exact: true });
      const file = await waitForDownload(downloads, before);
      const target = path.join(downloads, `${options.role}-ss4a-application.pdf`);
      fs.renameSync(file, target);
      ids.ss4aPdf = target;
      return `${fs.statSync(target).size} bytes`;
    });

    await step('screens', async () => {
      const axeSource = fs.readFileSync(AXE_SOURCE, 'utf8');
      const screens = [
        { slug: 'sign-up', route: '/sign-up', anonymous: true },
        { slug: 'portal', route: ids.portalPath, anonymous: true },
        { slug: 'dashboard', route: '/dashboard' },
        { slug: 'project', route: `/projects/${ids.projectId}` },
        { slug: 'safety', route: `/safety?projectId=${ids.projectId}` },
        { slug: 'bca', route: `/grants/bca/${ids.projectId}` },
        { slug: 'campaign-responses', route: `/engagement/${ids.campaignId}?tab=responses` },
        { slug: 'report', route: `/reports/${ids.reportId}` },
        { slug: 'grants-application', route: `/grants?focusProjectId=${ids.projectId}&tab=opportunities`, open: 'Open application workspace' },
      ];
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
    });

    await step('sign-out', async () => {
      await go('/dashboard');
      await clickText(page, 'button', 'Sign out', { exact: true });
      await page.waitForFunction(() => !/^\/(dashboard|projects|safety|grants|reports|engagement)/.test(location.pathname), { timeout: 30000 });
      await settle(page);
      return new URL(page.url()).pathname;
    });

    await step('cross-workspace', async () => {
      const other = await browser.createBrowserContext();
      const second = await other.newPage();
      await signUpAndConfirm(second, options.secondEmail, secondPassword, options.secondConfirmLinkFile, 'second account');
      // The first account's identifying strings. A page check answering 200
      // counts only if none of them is anywhere in the page text or HTML
      // (KI-2026-11-14-060, the lead's decision); the record keeps hashes only.
      const identifying = lib.identifyingStrings({ reportTitle: ids.reportTitle, projectName: ids.projectName, workspaceName: ids.workspaceName, campaignTitle: ids.campaignTitle });
      const checks = [
        { target: 'safety-action-plan', request: 'report-page', kind: 'page', run: async () => {
          const response = await second.goto(new URL(`/reports/${ids.reportId}`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await settle(second, 2500);
          const reading = lib.readPageForRecord({
            text: await second.evaluate(() => document.body.innerText),
            html: await second.content(),
            strings: identifying,
          });
          const reportTools = /Generate PDF packet|Section narrative drafts/.test(reading.textForTools);
          return {
            status: response.status(),
            contentReturned: reading.recordTextFound || reportTools,
            notFoundRendered: reading.notFoundRendered,
            recordTextFound: reading.recordTextFound,
            searchedStringSha256: reading.searchedStringSha256,
            searchedStringCount: reading.searchedStringSha256.length,
          };
        } },
        { target: 'safety-action-plan', request: 'report-pdf-download', kind: 'data', run: async () => {
          const result = await appFetch(`/api/reports/${ids.reportId}/artifacts/${ids.artifactId}/download`, null, 'GET', second);
          return { status: result.status, contentReturned: result.isPdf || result.text.includes(ids.projectName) };
        } },
        { target: 'ss4a-application', request: 'application-read', kind: 'data', run: async () => {
          const result = await appFetch(`/api/funding-opportunities/${ids.opportunityId}/application`, null, 'GET', second);
          return { status: result.status, contentReturned: result.status < 400 && /section_key|final_markdown/.test(result.text) };
        } },
        { target: 'ss4a-application', request: 'application-pdf-download', kind: 'data', run: async () => {
          const result = await appFetch(`/api/funding-opportunities/${ids.opportunityId}/application/export/${ids.exportId}/download`, null, 'GET', second);
          return { status: result.status, contentReturned: result.isPdf };
        } },
      ];
      const detail = [];
      for (const check of checks) {
        const result = await check.run();
        crossChecks.push({ target: check.target, request: check.request, kind: check.kind, ...result, contentReturned: Boolean(result.contentReturned) });
        const page = check.kind === 'page' ? ` (not-found screen ${result.notFoundRendered ? 'shown' : 'NOT shown'}, ${result.searchedStringCount} strings searched, ${result.recordTextFound ? 'RECORD TEXT FOUND' : 'none found'})` : '';
        detail.push(`${check.request} ${result.status}${page}${result.contentReturned ? ' CONTENT RETURNED' : ''}`);
      }
      await other.close();
      if (crossChecks.some((check) => check.contentReturned)) {
        findings.push({ id: 'cross-workspace-returned-content', text: `A second account received the first account's content: ${detail.join('; ')}` });
      }
      const inconclusive = crossChecks.filter((check) => ![403, 404].includes(check.status) && !(check.kind === 'page' && check.status === 200 && check.notFoundRendered && check.recordTextFound === false && check.searchedStringCount >= 3));
      if (inconclusive.length) {
        findings.push({ id: 'cross-workspace-inconclusive-status', text: `The record checker will refuse these cross-workspace answers: ${inconclusive.map((check) => `${check.request} ${check.status}`).join('; ')}` });
      }
      if (crossChecks.some((check) => check.kind === 'page' && check.status === 200)) {
        findings.push({ id: 'report-page-answers-200-with-not-found-screen', text: 'Another workspace\'s report page answered HTTP 200 with the not-found screen (it streams); the record must state this limit (KI-2026-11-14-060).' });
      }
      return detail.join('; ');
    });
  }

  async function afterSteps() {
    await step('health-end', () => health('end'));

    await step('analyze-pdfs', async () => {
      const results = [];
      for (const [kind, file] of [['safety-action-plan', ids.reportPdf], ['ss4a-application', ids.ss4aPdf]]) {
        const described = lib.describePdf(kind, file, path.relative(out, file).split(path.sep).join('/'), path.join(out, 'pdf-pages'));
        state.pdfs.push(described.pdf);
        results.push({ kind, ...described.findings });
        for (const missing of described.findings.missingItems) findings.push({ id: `${kind}-missing-${missing.item}`, text: `${kind} PDF: ${missing.item} ${missing.reason}${missing.page ? ` (page ${missing.page})` : ''}.` });
        if (described.findings.emailLocations.length) {
          findings.push({ id: `${kind}-prints-email`, text: `${kind} PDF prints an email address at ${described.findings.emailLocations.map((entry) => `page ${entry.page} line ${entry.line}`).join(', ')}.`, locations: described.findings.emailLocations });
        }
        if (described.findings.draftPages.length) findings.push({ id: `${kind}-draft-stamp`, text: `${kind} PDF carries DRAFT on pages ${described.findings.draftPages.join(', ')}.` });
      }
      ids.pdfFindings = results;
      // The SS4A provenance table names each finalizer by workspace role and
      // never by email address (KI-2026-11-14-200).
      const cells = lib.finalizerCells(lib.pdfPages(ids.ss4aPdf));
      ids.finalizerCells = cells;
      const finalCount = (ids.sectionEntries || []).length;
      if (!cells.provenancePages.length) throw new Error('The SS4A PDF has no "Provenance appendix".');
      if (cells.emailLines.length) throw new Error(`The SS4A provenance table prints an email address at ${cells.emailLines.map((entry) => `page ${entry.page} line ${entry.line}`).join(', ')}.`);
      if (cells.roleCells < finalCount) throw new Error(`The SS4A provenance table names a workspace role in ${cells.roleCells} "Finalized by" cell(s), fewer than the ${finalCount} sections finalized.`);
      return results.map((entry) => `${entry.kind}: ${5 - entry.missingItems.length} of 5 items`).join('; ');
    });
  }

  // The steps run until one stops; then, finished or stopped, the campaign
  // is closed if one was made, and the end readback and PDF reading run only
  // when everything before them passed (journey-campaign-lib.js, runJourney).
  const finished = await campaignLib.runJourney({
    steps: [mainSteps],
    campaignId: () => ids.campaignId,
    close: async () => {
      const entry = { step: 'close-campaign', startedAt: lib.utcNow(), status: 'running' };
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
        entry.error = lib.scrubText(error && error.message ? error.message.split('\n')[0] : String(error), secrets);
        log(`close-campaign: failed (${entry.error})`);
        throw error;
      } finally {
        entry.endedAt = lib.utcNow();
      }
    },
    after: [afterSteps],
  });
  await browser.close().catch(() => {});
  const failure = finished.failure;

  const furthest = [...steps].reverse().find((entry) => entry.status === 'passed');
  const journey = lib.buildJourney(state);
  const result = {
    schema: 'openplan.first_job_journey_run.v1',
    mode: options.mode,
    baseUrl: origin,
    recordedOn: lib.utcNow().slice(0, 10),
    expectedCommit: options.expectedCommit,
    harness,
    inputsLabel: inputs.label,
    inputsSha256: loadedInputs.sha256,
    budgetSha256: ids.budgetSha256 || null,
    inputFacts: inputs.facts.map((fact) => ({ id: fact.id, source: fact.source, readOn: fact.readOn })),
    sections: ids.sectionEntries || [],
    ss4aStamp: { beforeExport: ids.ss4aStampBefore ?? null, afterExport: ids.ss4aStampAfter || [], exportResponse: ids.ss4aDraftStamps ?? null },
    finalizerCells: ids.finalizerCells || null,
    pdfItemSearches: (ids.pdfFindings || []).map((entry) => ({ kind: entry.kind, searches: entry.itemSearches })),
    confirmationTokenSha256: ids.tokenSha256 || null,
    furthestStep: furthest ? furthest.step : null,
    stoppedAt: failure ? failure.journeyStep || 'setup' : null,
    stepsDefined: STEPS,
    steps,
    journey,
    crossWorkspace: { checks: crossChecks },
    close: { ...finished.close, reading: closeReading },
    demonstrationText,
    findings,
    axeRules: ids.axeRules || [],
    consoleErrorsDuringJourney: consoleErrors.length,
    ids: {
      projectId: ids.projectId || null,
      reportId: ids.reportId || null,
      artifactId: ids.artifactId || null,
      campaignId: ids.campaignId || null,
      opportunityId: ids.opportunityId || null,
      exportId: ids.exportId || null,
    },
  };
  const written = campaignLib.writeRunFiles({
    outDir: out,
    runFileName: `journey-${options.role}.json`,
    result,
    scrub: (text) => lib.scrubText(text, secrets),
    origin,
    portalPath: ids.portalPath,
  });
  fs.writeFileSync(path.join(out, 'console', 'journey.txt'), consoleErrors.map((line) => lib.scrubText(line, secrets)).join('\n'));
  log(`wrote ${written.runFile}`);
  if (written.addressFile) log(`wrote the campaign's public address to ${written.addressFile}; read it in a fresh session, then delete it`);
  log(`campaign closed at the end: ${finished.close.attempted ? (finished.close.closed ? 'yes' : 'NO') : 'no campaign was created'}`);
  log(`furthest step passed: ${result.furthestStep}${failure ? `; ${lib.scrubText(failure.message, secrets)}` : '; journey complete'}`);
  if (failure) process.exitCode = 1;
}

/** --assemble --journeys a.json,b.json,c.json --commit <40 hex> --base-url <origin> --out record.json */
async function assembleMain(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  const record = lib.assembleRecord({
    journeyFiles: String(args.journeys || '').split(',').filter(Boolean),
    jobId: args.job || 'safety-action-plan-and-ss4a-in-three-places',
    commit: args.commit,
    baseUrl: args['base-url'],
    proofOrigin: await lib.loadProofOrigin(),
    recordedOn: lib.utcNow().slice(0, 10),
    sourceCheck: { status: 'not-run', checkedOn: null, url: null, note: 'Crash counts were not compared with the source query tool.' },
    // The words come from the job's definition, which the checker reads too (KI-2026-11-16-020).
    limits: lib.definitionLimits({ sourceConfirmed: false }),
  });
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(record, null, 2)}\n`);
  log(`wrote ${path.resolve(args.out)}; check it with validateProvenJobRecord`);
}

if (require.main === module) {
  // A wait that was set up before a step failed rejects once the browser
  // closes. The failure is already recorded; do not let it end the process
  // before the journey file is written.
  process.on('unhandledRejection', (reason) => {
    const message = reason && reason.message ? reason.message : String(reason);
    if (!/Target closed|Page closed|Session closed|Protocol error|Connection closed/i.test(message)) {
      process.stderr.write(`[journey] unhandled: ${lib.scrubText(message)}\n`);
      process.exitCode = 1;
    }
  });
  main().catch((error) => {
    process.stderr.write(`[journey] ${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
