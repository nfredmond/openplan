#!/usr/bin/env node
/**
 * Fourth proven job, one journey: a planner signs up, sets the workspace's
 * place and time zone, makes a project with its study place, tracks Safe
 * Streets and Roads for All (SS4A) from the grants catalog, records the award
 * on the project's Funding tab with the fixed demonstration figures and its
 * obligation date, invites a member, logs three reimbursement requests and
 * moves them on the register's own controls (INV-1 paid, INV-2 rejected with
 * a reason, INV-2A made with Resubmit and paid), reads every money figure on
 * four screens and downloads the reimbursement worksheet while a request is
 * outstanding, closes the award out with its balance released, reads and
 * downloads again, and records what the member, a second workspace and a
 * direct database write were refused.
 *
 * Browser first. Every planner step is a screen and a control. The requests
 * the script sends itself are the refusals no screen offers (the member's
 * writes, a paid move before approval, a claim above the ceiling with no
 * note), the direct database writes (with each account's own session and the
 * public key the page itself sent, never a service key), and the reads a
 * second planner could make by pasting a link. Responses the screens request
 * are read (never written) for ids, statuses and amounts.
 *
 * Modes:
 *   rehearsal  local origins only (localhost, 127.0.0.1); the local guard in
 *              harness-env.js refuses Vercel and Supabase cloud hosts.
 *   proof      the hosted proof origin only (PROOF_ORIGIN in
 *              openplan/scripts/ops/capability-evidence.mjs).
 *
 * The definition's fixed request paths are held to what the product's own
 * controls offer before anything starts (award-job-journey-lib.js,
 * pathGaps). The register's control moves a request one status at a time; a
 * path that skips one (draft straight to submitted) cannot be made on screen.
 * A proof stops before it touches the site; a rehearsal says so in its run
 * file and follows the product's path, so every other step is rehearsed.
 *
 * Inputs: --inputs names a JSON file with the three workspace names, the
 * project's demonstration name, summary and study place query, the award
 * title, the fixed figures and dates, the rejection reason, the close-out
 * note and the over-ceiling probe's number (fixtures/award-job-rehearsal-
 * inputs.json shows the shape; a proof refuses that file).
 *
 * Email confirmation: no link is an argument. Each account's link is read
 * from its own file (--confirm-link-file, --member-confirm-link-file,
 * --second-confirm-link-file); only a SHA-256 of each token is recorded. The
 * invitation link the owner's screen shows is used once by the member and
 * never written anywhere.
 *
 * Output (in --out): journey-<role>.json (the journey in the shape of
 * $defs/awardJourney, the cross-workspace checks, the step log, the mode, the
 * harness checkout, the inputs' SHA-256, what the journey leaves on the site
 * and every finding), the two worksheet PDFs with their Poppler text,
 * screenshots and scrubbed console captures. The run file never holds an
 * address, a token, a key or a password. Assemble three journey files into
 * one record with --assemble, then run the evidence checker on it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appRoot, repoRoot } = require('./harness-env');
const first = require('./first-job-journey-lib');
const campaign = require('./journey-campaign-lib');
const atp = require('./atp-job-journey-lib');
const lib = require('./award-job-journey-lib');
const { assertPopplerTool } = require('../openplan/scripts/lib/poppler-text.mjs');
const B = require('./journey-browser-lib');

const puppeteer = require(require.resolve('puppeteer-core', { paths: [appRoot] }));
const AXE_SOURCE = path.join(appRoot, 'node_modules', 'axe-core', 'axe.min.js');

const STEPS = [
  'health-start', 'sign-up', 'confirm-email', 'set-workspace-place', 'create-project', 'set-study-place', 'track-ss4a',
  'record-award', 'invite-member', 'log-first-request', 'move-first-request', 'custody', 'log-rejected-request',
  'move-rejected-request', 'reject-request', 'resubmit-request', 'move-resubmission', 'member-refusals-open',
  'product-refusals', 'read-open-screens', 'download-open-worksheet', 'approve-resubmission', 'member-refusal-paid',
  'pay-resubmission', 'member-refusal-close-out', 'close-out', 'read-closed-screens', 'download-closed-worksheet',
  'screens', 'owner-control', 'cross-workspace', 'health-end',
];

/** The catalog entry the award is recorded against, by its key, and the name its card shows (openplan/src/lib/grants/programs/us-federal.ts). */
const CATALOG_NAMES = { ss4a: 'Safe Streets and Roads for All (SS4A)' };

function log(message) {
  process.stdout.write(`[journey] ${message}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--assemble') return assembleMain(argv.slice(1));
  const job = lib.loadJobDefinition();
  const options = lib.parseAwardArgs(argv, job);
  const proofOrigin = await first.loadProofOrigin();
  const origin = first.checkJourneyOrigin(options.mode, options.baseUrl, proofOrigin);
  if (!fs.existsSync(AXE_SOURCE)) throw new Error(`axe-core not found at ${AXE_SOURCE}. Run npm ci in openplan/.`);
  assertPopplerTool('pdftotext');
  atp.assertNoStaleLinkFiles({ confirmLinkFile: options.confirmLinkFile, secondConfirmLinkFile: options.secondConfirmLinkFile });
  atp.assertNoStaleLinkFiles({ confirmLinkFile: options.memberConfirmLinkFile });
  const loadedInputs = lib.loadAwardInputs(options.mode, options.inputsFile, { job, run: options });
  const inputs = loadedInputs.inputs;
  log(`inputs: ${path.basename(loadedInputs.file)} (sha256 ${loadedInputs.sha256.slice(0, 12)})`);
  const harness = campaign.harnessCheckout(repoRoot);
  log(`harness: ${harness.commit.slice(0, 12)}${harness.clean ? ', clean' : ', with uncommitted changes to tracked files'}`);
  if (options.mode === 'proof' && !harness.clean) throw new Error('A proof runs from a harness checkout with no uncommitted change to a tracked file.');

  const findings = [];
  // The definition's paths against the product's one-step control, before anything is typed.
  const gaps = lib.pathGaps(job);
  if (gaps.length) {
    const said = `The definition's fixed path moves ${gaps.map((gap) => `${gap.number} from ${gap.from} straight to ${gap.to}`).join(' and ')}, but the product's control offers only the next status (${gaps.map((gap) => `${gap.from} to ${gap.product.join(' to ')}`).join('; ')}). No journey can make that path on screen, and the record checker refuses any other.`;
    if (options.mode === 'proof') throw new Error(`${said} A proof stops before it touches the site.`);
    findings.push({ id: 'definition-path-not-on-screen', text: `${said} This rehearsal follows the product's controls.` });
    log(`FINDING: ${said}`);
  }

  const out = options.outDir;
  for (const dir of ['', 'screens', 'console', 'downloads', 'pages']) fs.mkdirSync(path.join(out, dir), { recursive: true });
  const downloads = path.join(out, 'downloads');

  const state = {
    role: options.role,
    executor: { agent: options.executorAgent, model: options.executorModel },
    health: [],
    projectName: inputs.projectName.trim(),
    workspaceName: inputs.organization.trim(),
    requests: [],
    downloads: [],
    costEntryCount: 0,
    screenReadings: [],
    refusals: [],
    custody: [],
    pdfs: [],
    screens: [],
  };
  const ids = { worksheetText: {} };
  const steps = [];
  const passwords = [0, 1, 2].map(() => `Jr-${crypto.randomBytes(18).toString('base64url')}`);
  const secrets = [...passwords, options.email, options.memberEmail, options.secondEmail];
  const consoleErrors = [];
  const crossChecks = [];
  const ownerChecks = [];
  const secondAccounts = [];
  const publicRequests = [];
  const today = () => lib.dayIn(inputs.timeZone);

  const browser = await puppeteer.launch({
    executablePath: B.chromePath(),
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

  // What the screens request, read for ids. Never written, never replayed.
  const observed = { places: [] };
  // The database API's origin and public key, as the browser's own sign-up request sent them.
  const api = { origin: null, key: null };
  const inFlight = new Map();
  for (const done of ['requestfinished', 'requestfailed']) page.on(done, (request) => inFlight.delete(request));
  const watchRequests = (target) => target.on('request', (request) => {
    const url = request.url();
    if (target === page) inFlight.set(request, `${request.method()} ${request.resourceType()} ${url.replace(/[?#].*$/, '').slice(0, 120)}`);
    try {
      const parsed = new URL(url);
      if (/\/auth\/v1\/signup$/.test(parsed.pathname) && request.method() === 'POST') {
        const key = request.headers().apikey;
        if (key && !secrets.includes(key)) secrets.push(key);
        if (key && !api.key) {
          api.origin = parsed.origin;
          api.key = key;
        }
      }
    } catch {
      // Not a web address; nothing to read.
    }
    if (url.startsWith(origin) && atp.isPublicPageRequest(url, request.method())) publicRequests.push(`${request.method()} ${new URL(url).pathname.split('/').slice(0, 4).join('/')}`);
  });
  watchRequests(page);
  page.on('response', async (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname === '/api/geographies/places' && response.ok()) {
        const body = await B.readJson(response);
        if (body) observed.places.push({ query: url.searchParams.get('q'), body });
      }
    } catch {
      // A response that cannot be read is not evidence of anything.
    }
  });

  const go = async (route, target = page) => {
    await target.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await B.settle(target);
  };

  async function step(name, fn) {
    const entry = { step: name, startedAt: first.utcNow(), status: 'running' };
    steps.push(entry);
    log(`${name}...`);
    try {
      const detail = await fn();
      if (publicRequests.length) throw new Error(`The browser sent a request that opens or reads a public page (${[...new Set(publicRequests)].join(', ')}); this job opens none.`);
      entry.status = 'passed';
      if (detail) entry.detail = first.scrubText(typeof detail === 'string' ? detail : JSON.stringify(detail), secrets);
      const waiting = [...new Set(inFlight.values())];
      if (waiting.length) entry.requestsInFlightAtEnd = waiting.slice(0, 6).map((line) => first.scrubText(line, secrets));
      log(`${name}: passed${entry.detail ? ` (${entry.detail})` : ''}`);
    } catch (error) {
      entry.status = 'failed';
      entry.error = first.scrubText(error && error.message ? error.message.split('\n')[0] : String(error), secrets);
      await page.screenshot({ path: path.join(out, 'screens', `failed-${name}.png`), fullPage: false }).catch(() => {});
      throw Object.assign(new Error(`Stopped at ${name}: ${entry.error}`), { journeyStep: name });
    } finally {
      entry.endedAt = first.utcNow();
    }
  }

  /** A rehearsal records what the checker will refuse and goes on; a proof stops. */
  const refusedBy = (id, text) => {
    if (options.mode === 'proof') throw new Error(text);
    findings.push({ id, text: `The record checker will refuse this journey: ${text}` });
    return `; THE CHECKER WILL REFUSE: ${text}`;
  };

  const health = (point) => B.readHealth({ origin, point, mode: options.mode, expectedCommit: options.expectedCommit, readings: state.health, findings });

  // ---- helpers for the register's rows and its controls ----

  const requestByKey = (key) => state.requests.find((request) => request.key === key);
  const fixedRequest = (key) => job.award.fixed.requests.find((request) => request.key === key);
  const inputRequest = (key) => inputs.requests.find((request) => request.key === key);

  /** The register row of one request (li[id^=invoice-record-] whose first number is the request's). */
  async function rowSelector(number) {
    await go('/invoicing');
    const rowId = await page.evaluate((wanted) => {
      for (const li of document.querySelectorAll('li[id^="invoice-record-"]')) {
        const numbers = li.innerText.match(/\b[A-Z][A-Z0-9]*-[0-9A-Z-]+\b/g) || [];
        if (numbers[0] === wanted) return li.id;
      }
      return null;
    }, number);
    if (!rowId) throw new Error(`The register shows no row for ${number}.`);
    return `[id="${rowId}"]`;
  }

  async function clickInRow(row, label, { selector = 'button, a' } = {}) {
    const clicked = await page.evaluate((sel, wanted, inner) => {
      const root = document.querySelector(sel);
      const target = root && [...root.querySelectorAll(inner)].find((el) => el.innerText.trim() === wanted && el.getBoundingClientRect().width > 0 && !el.disabled);
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    }, row, label, selector);
    if (!clicked) throw new Error(`The row has no "${label}" control.`);
  }

  const patchResponse = (invoiceId) => page.waitForResponse((r) => r.url().includes(`/api/invoicing/invoices/${invoiceId}`) && r.request().method() === 'PATCH', { timeout: 60000 });

  /** One move on the register's own control, recorded with the control the product showed and the status the route answered. */
  async function moveOnScreen(key, move, { reason } = {}) {
    const request = requestByKey(key);
    const row = await rowSelector(request.number);
    let answered;
    if (move.status === 'paid') {
      await clickInRow(row, job.award.controls.moves.paid);
      const dateInput = await page.waitForSelector(`#paid-date-${request.invoiceId}`, { visible: true });
      const prefilled = await dateInput.evaluate((el) => el.value);
      if (!lib.isCalendarDate(prefilled)) throw new Error(`Mark paid prefilled "${prefilled}", not a date.`);
      answered = patchResponse(request.invoiceId);
      await page.evaluate((sel, wanted) => {
        const button = [...document.querySelector(sel).querySelectorAll('form button[type=submit]')].find((el) => el.innerText.trim() === wanted);
        button.click();
      }, row, job.award.controls.moves.paid);
    } else if (move.status === 'rejected') {
      await clickInRow(row, job.award.controls.moves.rejected);
      const box = await page.waitForSelector(`#reject-reason-${request.invoiceId}`, { visible: true });
      await B.typeInto(box, reason);
      answered = patchResponse(request.invoiceId);
      await page.evaluate((sel, wanted) => {
        const button = [...document.querySelector(sel).querySelectorAll('form button[type=submit]')].find((el) => el.innerText.trim() === wanted);
        button.click();
      }, row, job.award.controls.moves.rejected);
    } else {
      answered = patchResponse(request.invoiceId);
      await clickInRow(row, move.control, { selector: 'button' });
    }
    const response = await answered;
    const at = first.utcNow();
    const body = await B.readJson(response);
    const invoice = body && body.invoice;
    request.history.push({ status: invoice ? invoice.status : move.status, control: move.control, responseStatus: response.status(), at });
    if (response.status() !== job.award.controls.moveStatus || !invoice || invoice.status !== move.status) {
      throw new Error(`${move.control} on ${request.number} answered ${response.status()}${body && body.error ? `: ${String(body.error).slice(0, 160)}` : ''}${body && body.code ? ` (${body.code})` : ''}.`);
    }
    if (move.status === 'paid') request.paidDate = invoice.paid_date;
    if (move.status === 'rejected') request.rejectionReason = invoice.rejection_reason;
    await B.settle(page, 800);
    return `${request.number} ${move.status} ${response.status()}`;
  }

  /** Move a request on screen until it reaches `target`, one offered step at a time. */
  async function moveTo(key, target) {
    const request = requestByKey(key);
    const from = request.history.at(-1).status;
    const moves = lib.productPathTo(from, target, job);
    const done = [];
    for (const move of moves) done.push(await moveOnScreen(key, move));
    return done.join(', ');
  }

  /** Type a date into an input[type=date] the way a person does, then check it took. */
  async function typeDate(selector, value) {
    const input = await page.waitForSelector(selector, { visible: true });
    const [year, month, day] = value.split('-');
    await input.focus();
    await page.keyboard.type(`${month}${day}${year}`);
    const now = await input.evaluate((el) => el.value);
    if (now !== value) throw new Error(`${selector} reads "${now}" after typing ${value}.`);
  }

  /** Walk the register's composer (already open) and save it; returns the route's answer. */
  async function finishComposer({ number, amount, periodStart, periodEnd, invoiceDate, prefilled = false }) {
    const D = 'dialog[open]';
    await page.waitForSelector('#log-invoice-record-invoiceNumber', { visible: true });
    const shownNumber = await page.$eval('#log-invoice-record-invoiceNumber', (el) => el.value);
    if (prefilled) {
      if (shownNumber !== number) throw new Error(`Resubmit prefilled the number "${shownNumber}", not ${number}.`);
    } else {
      await B.typeInto(await page.$('#log-invoice-record-invoiceNumber'), number);
    }
    await B.typeInto(await page.$('#log-invoice-record-consultantName'), inputs.consultantName);
    await B.clickText(page, `${D} button`, 'Next', { exact: true });
    await page.waitForSelector('#log-invoice-record-projectId', { visible: true });
    if (number !== inputs.overCeilingProbe.number) {
      if (prefilled) {
        const linked = await page.evaluate(() => ({ project: document.querySelector('#log-invoice-record-projectId').value, award: document.querySelector('#log-invoice-record-fundingAwardId').value }));
        if (linked.project !== ids.projectId || linked.award !== state.award.awardId) throw new Error('Resubmit did not prefill the project and award of the request it replaces.');
      } else {
        await page.select('#log-invoice-record-projectId', ids.projectId);
        await B.sleep(500);
        await page.select('#log-invoice-record-fundingAwardId', state.award.awardId);
      }
      await B.settle(page, 1200);
    }
    await B.clickText(page, `${D} button`, 'Next', { exact: true });
    await page.waitForSelector('#log-invoice-record-amount', { visible: true });
    const shownAmount = await page.$eval('#log-invoice-record-amount', (el) => el.value);
    if (prefilled) {
      if (lib.cents(Number(shownAmount).toFixed(2)) !== lib.cents(amount)) throw new Error(`Resubmit prefilled the amount ${shownAmount}, not ${amount}.`);
    } else {
      await B.typeInto(await page.$('#log-invoice-record-amount'), amount);
    }
    const retention = await page.$eval('#log-invoice-record-retentionPercent', (el) => el.value);
    if (Number(retention) !== 0) throw new Error(`The retention field reads ${retention}; this job enters none.`);
    await B.clickText(page, `${D} button`, 'Next', { exact: true });
    await page.waitForSelector('#log-invoice-record-periodStart', { visible: true });
    if (periodStart) await typeDate('#log-invoice-record-periodStart', periodStart);
    if (periodEnd) await typeDate('#log-invoice-record-periodEnd', periodEnd);
    const shownDate = await page.$eval('#log-invoice-record-invoiceDate', (el) => el.value);
    if (invoiceDate === lib.PREFILLED) {
      if (!lib.isCalendarDate(shownDate)) throw new Error(`Resubmit prefilled the invoice date "${shownDate}", not a date.`);
    } else if (invoiceDate) {
      await typeDate('#log-invoice-record-invoiceDate', invoiceDate);
    }
    const created = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/invoicing/invoices' && r.request().method() === 'POST', { timeout: 60000 });
    await B.clickText(page, `${D} button`, 'Save the invoice record', { exact: true });
    const response = await created;
    const at = first.utcNow();
    const body = await B.readJson(response);
    await B.settle(page, 1500);
    return { response, body, at };
  }

  /** Log one fixed request with the register's composer and record it. */
  async function logRequest(key) {
    const wanted = fixedRequest(key);
    const given = inputRequest(key);
    await go('/invoicing');
    await page.click('[data-testid="invoice-record-composer-open"]');
    const { response, body, at } = await finishComposer({ number: wanted.number, amount: wanted.gross, periodStart: given.periodStart, periodEnd: given.periodEnd, invoiceDate: given.invoiceDate });
    return recordCreated(key, { response, body, at, control: job.award.controls.create });
  }

  /** The record's request from the create answer: every field as the product echoed it. */
  function recordCreated(key, { response, body, at, control }) {
    const invoice = body && body.invoice;
    if (response.status() !== job.award.controls.createStatus || !invoice) throw new Error(`Saving the request answered ${response.status()}${body && (body.details || body.error) ? `: ${String(body.details || body.error).slice(0, 200)}` : ''}.`);
    const asMoney = (value) => lib.money(Math.round(Number(value) * 100));
    const request = {
      key,
      invoiceId: invoice.id,
      number: invoice.invoice_number,
      gross: asMoney(invoice.amount),
      retention: asMoney(invoice.retention_amount ?? 0),
      periodStart: invoice.period_start ?? null,
      periodEnd: invoice.period_end ?? null,
      invoiceDate: invoice.invoice_date ?? null,
      dueDate: invoice.due_date ?? null,
      paidDate: invoice.paid_date ?? null,
      rejectionReason: invoice.rejection_reason ?? null,
      resubmitsInvoiceId: invoice.resubmits_invoice_id ?? null,
      profileId: invoice.reimbursement_profile_id ?? null,
      history: [{ status: invoice.status, control, responseStatus: response.status(), at }],
    };
    state.requests.push(request);
    ids.profileSelections = ids.profileSelections || {};
    ids.profileSelections[request.number] = invoice.reimbursement_profile_selection ?? null;
    if (!state.reimbursementProfile) state.reimbursementProfile = { profileId: request.profileId, selection: invoice.reimbursement_profile_selection ?? null };
    if (invoice.funding_award_id !== state.award.awardId) throw new Error(`${request.number} was not saved on the award.`);
    return `${request.number} ${invoice.status} ${response.status()}, profile ${request.profileId} (${invoice.reimbursement_profile_selection})`;
  }

  // ---- reading the screens' money ----

  /** The screen's text, scrubbed, kept beside the run when a reading finds nothing to read. */
  async function dumpScreen(screen) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    fs.writeFileSync(path.join(out, 'pages', `screen-${screen}-unread.txt`), first.scrubText(text, secrets));
  }

  async function readScreen(screen) {
    let figures;
    if (screen === 'funding-tab') {
      await go(`/projects/${ids.projectId}?tab=funding`);
      await page.waitForFunction(() => /Claim progress/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
      const text = await page.evaluate((title) => {
        const rows = [...document.querySelectorAll('.module-record-row')].filter((el) => el.innerText.includes(title) && /Claim progress/.test(el.innerText));
        rows.sort((a, b) => a.innerText.length - b.innerText.length);
        return rows[0] ? rows[0].innerText : null;
      }, state.award.title);
      if (!text) await dumpScreen(screen);
      if (!text) throw new Error('The Funding tab shows no row for the award.');
      figures = lib.readFundingTabFigures(text);
    } else if (screen === 'grants-awards') {
      await go(`/grants?tab=awards&focusProjectId=${ids.projectId}`);
      const text = await page.evaluate((name) => {
        const chip = [...document.querySelectorAll('.module-record-chip')].find((el) => /^Recorded award ceilings/.test(el.innerText.trim()));
        let node = chip;
        while (node && !node.innerText.includes(name)) node = node.parentElement;
        return node ? node.innerText : null;
      }, state.projectName);
      if (!text) await dumpScreen(screen);
      if (!text) throw new Error('Grants, Awards shows no entry for the project.');
      figures = lib.readGrantsAwardsFigures(text);
    } else if (screen === 'invoices-register') {
      await go('/invoicing');
      const text = await page.evaluate(() => {
        const label = [...document.querySelectorAll('p')].find((el) => el.innerText.trim() === 'Net requested');
        let node = label;
        while (node && !(/\bPaid\b/.test(node.innerText) && /\bOutstanding\b/.test(node.innerText))) node = node.parentElement;
        return node ? node.innerText : null;
      });
      if (!text) await dumpScreen(screen);
      if (!text) throw new Error('The Invoices register shows no summary.');
      figures = lib.readRegisterFigures(text);
    } else if (screen === 'dashboard') {
      await go('/dashboard');
      const text = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll('a, div, section, li')].filter((el) => /^\s*Awarded\b/.test(el.innerText) && /% drawn/.test(el.innerText));
        candidates.sort((a, b) => a.innerText.length - b.innerText.length);
        return candidates[0] ? candidates[0].innerText : null;
      });
      if (!text) await dumpScreen(screen);
      if (!text) throw new Error('The dashboard shows no Awarded figure with its share drawn.');
      figures = lib.readDashboardFigures(text);
    }
    const at = first.utcNow();
    const wanted = job.award.screenFigures.byScreen[screen];
    const reading = { screen, at, figures: Object.fromEntries(wanted.map((figure) => [figure, figures[figure]])) };
    const missing = wanted.filter((figure) => figures[figure] === null);
    if (missing.length) await dumpScreen(screen);
    if (missing.length) throw new Error(`The ${screen} screen does not print ${missing.join(', ')}.`);
    state.screenReadings.push(reading);
    await page.screenshot({ path: path.join(out, 'screens', `reading-${screen}-${state.screenReadings.length}.png`), fullPage: false });
    const differences = lib.screenFigureDifferences(reading, lib.positionAt(state, at, job), job);
    if (differences.length) return refusedBy(`screen-figures:${screen}`, `the ${screen} screen reads ${differences.map((entry) => `${entry.figure} ${entry.read} where the record recomputes ${entry.expected}`).join('; ')}`);
    return '';
  }

  async function readScreens(point) {
    const said = [];
    for (const screen of job.screens.required) said.push(`${screen}${await readScreen(screen)}`);
    return `${point}: ${said.join(', ')}`;
  }

  // ---- the worksheet ----

  async function downloadWorksheet(kind) {
    await go(`/projects/${ids.projectId}?tab=funding`);
    const before = new Set(fs.readdirSync(downloads));
    const answered = page.waitForResponse((r) => r.url().includes(`/api/funding-awards/${state.award.awardId}/drawdown-worksheet`), { timeout: 300000 });
    await B.clickText(page, 'button, a', 'Download worksheet (PDF)', { exact: true });
    const response = await answered;
    const at = first.utcNow();
    const engine = response.headers()['x-openplan-pdf-engine'] || 'not named';
    state.downloads.push({ pdf: kind, at, status: response.status(), engine });
    if (response.status() !== job.award.downloads.status) throw new Error(`The worksheet answered ${response.status()}.`);
    const file = await B.waitForDownload(downloads, before);
    const target = path.join(downloads, `${options.role}-${kind}.pdf`);
    fs.renameSync(file, target);
    const described = lib.describeWorksheetPdf({ pdfPath: target, recordPath: path.relative(out, target).split(path.sep).join('/'), kind, job });
    state.pdfs.push(described.pdf);
    described.pages.forEach((text, index) => fs.writeFileSync(path.join(out, 'pages', `${kind}-page-${index + 1}.txt`), text));
    ids.worksheetText[kind] = { pages: described.pdf.pages, emailLocations: described.emailLocations.length, fallback: described.fallback };
    if (described.emailLocations.length) throw new Error(`The ${kind} worksheet prints an email address.`);
    let note = '';
    if (engine !== job.award.downloads.engine || described.fallback) note = refusedBy(`worksheet-engine:${kind}`, `the ${kind} worksheet was printed by the ${engine} engine${described.fallback ? ' and carries the fallback writer\'s notice' : ''}`);
    return `${described.pdf.pages} pages, ${described.pdf.bytes} bytes, engine ${engine}, sha256 ${described.pdf.sha256.slice(0, 12)}${note}`;
  }

  // ---- the member, the custody checks and the refusals ----

  let member = null;
  const ownerWorkspace = async () => {
    if (ids.workspaceId) return ids.workspaceId;
    const read = await B.appRequest(page, '/api/workspaces/current');
    let body = null;
    try {
      body = JSON.parse(read.text);
    } catch {
      body = null;
    }
    const id = body && ((body.workspace && body.workspace.id) || body.workspaceId || body.id);
    if (read.status !== 200 || !id) throw new Error(`The owner's workspace read answered ${read.status}.`);
    ids.workspaceId = id;
    return id;
  };
  const worksheetRoute = () => `/api/funding-awards/${state.award.awardId}/drawdown-worksheet?workspaceId=${encodeURIComponent(ids.workspaceId)}`;
  const historyRoute = () => `/api/funding-awards/${state.award.awardId}/closure-history`;

  async function memberTries(action) {
    const inv2a = requestByKey('resubmission') || requestByKey('rejected');
    const tries = {
      'log-request': () => B.appRequest(member.page, '/api/invoicing/invoices', { method: 'POST', body: { workspaceId: ids.workspaceId, projectId: ids.projectId, fundingAwardId: state.award.awardId, invoiceNumber: 'MEMBER-PROBE', consultantName: inputs.consultantName, billingBasis: 'time_and_materials', status: 'draft', amount: '1000.00', retentionPercent: '0', supportingDocsStatus: 'pending', submittedTo: '', notes: '' } }),
      'approve-request': () => B.appRequest(member.page, `/api/invoicing/invoices/${inv2a.invoiceId}`, { method: 'PATCH', body: { workspaceId: ids.workspaceId, status: 'approved_for_payment' } }),
      'mark-paid': () => B.appRequest(member.page, `/api/invoicing/invoices/${inv2a.invoiceId}`, { method: 'PATCH', body: { workspaceId: ids.workspaceId, status: 'paid', paidDate: today() } }),
      'close-out': () => B.appRequest(member.page, `/api/funding-awards/${state.award.awardId}/closeout`, { method: 'POST', body: { basis: job.award.fixed.closeBasis, notes: inputs.closeOutNote } }),
    };
    const answer = await tries[action]();
    let code = null;
    try {
      const body = JSON.parse(answer.text);
      code = body && typeof body.code === 'string' ? body.code : null;
    } catch {
      code = null;
    }
    state.refusals.push({ account: 'member', action, status: answer.status, code });
    if (!job.award.member.statuses.includes(answer.status)) throw new Error(`The member's ${action} answered ${answer.status}; the product did not refuse a member.`);
    return `${action} ${answer.status}`;
  }

  /** One direct write to the database's API with an account's own session and the page's public key. */
  async function directWrite(account, target) {
    const token = B.sessionTokenFromCookies(await (account === 'owner' ? page : member.page).cookies());
    if (!token) throw new Error(`The ${account}'s page holds no session to send.`);
    if (!secrets.includes(token)) secrets.push(token);
    const ownerToken = B.sessionTokenFromCookies(await page.cookies());
    if (ownerToken && !secrets.includes(ownerToken)) secrets.push(ownerToken);
    const headers = (bearer) => ({ apikey: api.key, authorization: `Bearer ${bearer}`, prefer: 'return=representation' });
    const table = target === 'award-closure-columns' ? 'funding_awards' : 'billing_invoice_records';
    const rowId = target === 'award-closure-columns' ? state.award.awardId : requestByKey('first').invoiceId;
    const body = target === 'award-closure-columns' ? { spending_status: 'fully_spent', closure_basis: 'earned_coverage' } : { amount: 1 };
    const read = async () => {
      const answer = await B.appRequest(page, `${api.origin}/rest/v1/${table}?id=eq.${rowId}&select=*`, { headers: headers(ownerToken), credentials: 'omit' });
      if (answer.status !== 200) throw new Error(`Reading the ${table} row back answered ${answer.status}.`);
      return JSON.parse(answer.text);
    };
    const before = await read();
    if (before.length !== 1) throw new Error(`The owner reads ${before.length} ${table} rows for the target; the read-back would show nothing.`);
    const response = await B.appRequest(account === 'owner' ? page : member.page, `${api.origin}/rest/v1/${table}?id=eq.${rowId}`, { method: 'PATCH', body, headers: headers(token), credentials: 'omit' });
    const after = await read();
    const row = lib.custodyRow({ account, target, response, before, after });
    state.custody.push(row);
    const refused = lib.custodyRefused(row, job) && row.unchangedOnReadBack;
    if (!refused) throw new Error(`The ${account}'s direct write of ${target} answered ${row.status}${row.code ? ` (${row.code})` : ''} with ${row.rowsChanged} row(s) changed${row.unchangedOnReadBack ? '' : ' and the row read back changed'}; the database did not hold the award's facts.`);
    return `${account} ${target} ${row.status}${row.code ? ` ${row.code}` : ''}`;
  }

  async function mainSteps() {
    await step('health-start', () => health('start'));

    await step('sign-up', async () => {
      const result = await B.signUpAndConfirm({ page, origin, mode: options.mode, email: options.email, password: passwords[0], organization: state.workspaceName, confirmFile: options.confirmLinkFile, confirmTimeoutMinutes: options.confirmTimeoutMinutes, secrets, log });
      state.accountCreatedAt = result.createdAt;
      state.confirmationMethod = result.confirmationMethod;
      ids.tokenSha256 = result.tokenSha256;
      if (!api.key || !B.isPublicApiKey(api.key)) throw new Error('The sign-up request the page sent carried no public key for the database\'s API; the direct writes need one, and never a service key.');
      return `confirmation ${result.confirmationMethod}`;
    });

    await step('confirm-email', async () => {
      if (state.confirmationMethod !== 'email_link') throw new Error(`Sign-up was confirmed by ${state.confirmationMethod}; this job's journey confirms only by the emailed link.`);
      return `token sha256 ${ids.tokenSha256}`;
    });

    await step('set-workspace-place', async () => {
      await go('/workspace');
      const S = 'section[aria-label="Workspace geography"]';
      await B.clickText(page, `${S} button`, 'Set workspace geography', { exact: true });
      const search = await page.waitForSelector(`${S} input[aria-label="Search for a place"]`, { visible: true });
      await search.type(options.placeQuery);
      const kindLabel = B.PLACE_KIND_LABELS[options.placeKind];
      await page.waitForFunction((sel, kind) => [...document.querySelectorAll(`${sel} ul li button`)].some((b) => b.innerText.includes(kind)), { timeout: 90000 }, S, kindLabel);
      const labels = await page.evaluate((sel, kind) => [...document.querySelectorAll(`${sel} ul li button`)].filter((b) => b.innerText.includes(kind)).map((b) => (b.querySelector('span span.font-medium, span.font-medium') || b).innerText.trim()), S, kindLabel);
      const index = first.choosePlaceResult(options.placeQuery, labels);
      if (index < 0) throw new Error(`The workspace place search for "${options.placeQuery}" gave no one ${kindLabel} result named exactly that (${labels.join('; ')}).`);
      await B.clickText(page, `${S} ul li button`, labels[index]);
      await B.sleep(2000);
      const saved = page.waitForResponse((r) => r.url().includes('/api/workspaces/home-geography') && ['PUT', 'PATCH', 'POST'].includes(r.request().method()), { timeout: 60000 });
      await B.clickText(page, `${S} button`, `Use ${labels[index]}`, { exact: true });
      const placeAnswer = await saved;
      if (placeAnswer.status() !== 200) throw new Error(`Saving the workspace place answered ${placeAnswer.status()}.`);
      await B.settle(page, 2500);
      const T = 'section[aria-label="Time zone"]';
      const zone = await page.waitForSelector(`${T} select`, { visible: true });
      await zone.select(inputs.timeZone);
      const zoneSaved = page.waitForResponse((r) => r.url().includes('/api/workspaces/home-geography') && r.request().method() === 'PUT', { timeout: 60000 });
      await B.clickText(page, `${T} button`, 'Save', { exact: true });
      const zoneAnswer = await zoneSaved;
      if (zoneAnswer.status() !== 200) throw new Error(`Saving the time zone answered ${zoneAnswer.status()}.`);
      ids.workspacePlace = { label: labels[index], status: placeAnswer.status(), timeZone: inputs.timeZone, timeZoneStatus: zoneAnswer.status() };
      await ownerWorkspace();
      return `${labels[index]} ${placeAnswer.status()}; ${inputs.timeZone} ${zoneAnswer.status()}`;
    });

    await step('create-project', async () => {
      ids.projectId = await B.createProject({ page, go, name: state.projectName, summary: inputs.projectSummary });
      return ids.projectId;
    });

    await step('set-study-place', async () => {
      const { label, result } = await B.pickStudyPlace({ page, go, projectId: ids.projectId, placeQuery: options.placeQuery, placeKind: options.placeKind, observedPlaces: observed.places });
      ids.placeStatesListed = atp.placeStatesListed(result);
      const stateFips = lib.assertAwardPlaceForRole(result, options.role, job);
      state.place = { kind: result.kind, geoid: result.geoid, stateFips, label };
      if (ids.workspacePlace.label !== label) throw new Error(`The study place ${label} is not the workspace's place ${ids.workspacePlace.label}.`);
      return `${label} (${result.kind} ${result.geoid}); states ${stateFips.join(', ')}`;
    });

    await step('track-ss4a', async () => {
      const catalogKey = (job.journeyFields.find((entry) => entry.field === 'award.catalogKey') || {}).equals;
      const name = CATALOG_NAMES[catalogKey];
      await go(`/grants?focusProjectId=${ids.projectId}&tab=opportunities`);
      await (await B.controlByLabel(page, 'Search program catalog')).type('Safe Streets');
      await B.sleep(1500);
      const tracked = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/funding-opportunities' && r.request().method() === 'POST', { timeout: 60000 });
      const clicked = await page.evaluate((wanted) => {
        const isTrack = (b) => b.innerText.trim() === 'Track as opportunity';
        for (const button of [...document.querySelectorAll('button')].filter((b) => isTrack(b) && b.getBoundingClientRect().width)) {
          let card = button;
          while (card.parentElement && [...card.parentElement.querySelectorAll('button')].filter(isTrack).length === 1) card = card.parentElement;
          if (card.innerText.split('\n').some((line) => line.trim() === wanted)) {
            button.scrollIntoView({ block: 'center' });
            button.click();
            return true;
          }
        }
        return false;
      }, name);
      if (!clicked) throw new Error(`No catalog card for ${name}.`);
      const response = await tracked;
      const body = await B.readJson(response);
      let sent = null;
      try {
        sent = JSON.parse(response.request().postData() || 'null');
      } catch {
        sent = null;
      }
      if (response.status() !== 201 || !body || !body.opportunityId) throw new Error(`Tracking returned ${response.status()}.`);
      if (!sent || sent.title !== name) throw new Error('The tracked opportunity was not sent with the catalog entry\'s name.');
      if (!body.opportunity || body.opportunity.project_id !== ids.projectId) throw new Error('The tracked opportunity is not linked to the project.');
      ids.opportunityId = body.opportunityId;
      ids.catalogKey = catalogKey;
      return `${name} ${response.status()}`;
    });

    await step('record-award', async () => {
      const D = 'dialog[open]';
      await go(`/projects/${ids.projectId}?tab=funding`);
      await page.click('[data-testid="funding-award-creator-open"]');
      await page.waitForSelector('#record-funding-award-title', { visible: true });
      await page.type('#record-funding-award-title', inputs.awardTitle);
      await B.selectByText(await page.$('#record-funding-award-opportunityId'), CATALOG_NAMES[ids.catalogKey]);
      await page.type('#record-funding-award-awardedAmount', inputs.award.ceiling);
      await page.type('#record-funding-award-matchAmount', inputs.award.match);
      await page.select('#record-funding-award-matchPosture', inputs.award.matchPosture);
      await B.clickText(page, `${D} button`, 'Next', { exact: true });
      await page.waitForSelector('#record-funding-award-spendingStatus', { visible: true });
      const statuses = await page.$$eval('#record-funding-award-spendingStatus option', (options) => options.map((option) => option.value));
      if (statuses.includes('active')) await page.select('#record-funding-award-spendingStatus', 'active');
      await B.clickText(page, `${D} button`, 'Next', { exact: true });
      await typeDate('#record-funding-award-obligatedOn', inputs.award.obligatedOn);
      const saved = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/funding-awards' && r.request().method() === 'POST', { timeout: 60000 });
      await B.clickText(page, `${D} button`, 'Save the award', { exact: true });
      const response = await saved;
      const body = await B.readJson(response);
      const award = body && body.award;
      if (response.status() !== 201 || !award) throw new Error(`Saving the award answered ${response.status()}${body && body.error ? `: ${String(body.error).slice(0, 200)}` : ''}.`);
      const asMoney = (value) => (value === null || value === undefined ? null : lib.money(Math.round(Number(value) * 100)));
      state.award = {
        awardId: award.id,
        projectId: award.project_id,
        catalogKey: ids.catalogKey,
        title: award.title,
        createStatus: response.status(),
        ceiling: asMoney(award.awarded_amount),
        match: asMoney(award.match_amount),
        matchPosture: award.match_posture ?? null,
        obligatedOn: award.obligated_on ?? null,
      };
      if (award.funding_opportunity_id !== undefined && award.funding_opportunity_id !== ids.opportunityId) throw new Error('The award is not recorded against the tracked opportunity.');
      await B.settle(page, 2000);
      return `${award.id} ${response.status()}, ceiling ${state.award.ceiling}, match ${state.award.match} ${state.award.matchPosture}, obligated ${state.award.obligatedOn}`;
    });

    await step('invite-member', async () => {
      await go('/workspace');
      const S = 'section[aria-label="Workspace team"]';
      await page.waitForSelector(`${S} #invite-email`, { visible: true });
      await page.type(`${S} #invite-email`, options.memberEmail);
      await page.select(`${S} #invite-role`, 'member');
      const created = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspaces/invitations' && r.request().method() === 'POST', { timeout: 60000 });
      await B.clickText(page, `${S} button`, 'Create invitation', { exact: true });
      const response = await created;
      const body = await B.readJson(response);
      const invitation = body && body.invitationUrl;
      if (!response.ok() || !invitation) throw new Error(`Creating the invitation answered ${response.status()}.`);
      secrets.push(invitation, invitation.split('/').pop());
      // The member signs up in a context of its own, confirms by its emailed link, and accepts.
      const memberContext = await browser.createBrowserContext();
      const memberPage = await memberContext.newPage();
      watchRequests(memberPage);
      const account = await B.signUpAndConfirm({ page: memberPage, origin, mode: options.mode, email: options.memberEmail, password: passwords[1], organization: inputs.memberOrganization.trim(), confirmFile: options.memberConfirmLinkFile, confirmTimeoutMinutes: options.confirmTimeoutMinutes, secrets, log });
      member = { context: memberContext, page: memberPage, confirmationMethod: account.confirmationMethod };
      await memberPage.goto(new URL(new URL(invitation).pathname, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await B.settle(memberPage, 2000);
      const accepted = memberPage.waitForResponse((r) => /\/api\/workspaces\/invitations\/accept/.test(new URL(r.url()).pathname), { timeout: 60000 });
      await B.clickText(memberPage, 'button', 'Accept and join', { exact: true });
      const acceptAnswer = await accepted;
      if (!acceptAnswer.ok()) throw new Error(`Accepting the invitation answered ${acceptAnswer.status()}.`);
      await B.settle(memberPage, 2000);
      // Signed in and a member: the worksheet download answers the member 200.
      const own = await B.appFetch(worksheetRoute(), null, 'GET', memberPage, { credentials: 'same-origin' });
      state.memberAccount = { confirmed: account.confirmationMethod === 'email_link', ownRequest: job.award.member.control.ownRequest, ownStatus: own.status };
      if (!state.memberAccount.confirmed || own.status !== job.award.member.control.status || !own.isPdf) throw new Error(`The member was confirmed by ${account.confirmationMethod} and its worksheet download answered ${own.status}; its refusals would show nothing.`);
      return `invitation ${response.status()}, member confirmed by ${account.confirmationMethod}, accepted ${acceptAnswer.status()}, member worksheet ${own.status}`;
    });

    await step('log-first-request', () => logRequest('first'));
    await step('move-first-request', () => moveTo('first', 'paid'));

    await step('custody', async () => {
      const said = [];
      for (const check of job.award.custody.checks) said.push(await directWrite(check.account, check.target));
      return said.join('; ');
    });

    await step('log-rejected-request', () => logRequest('rejected'));
    await step('move-rejected-request', () => moveTo('rejected', 'submitted'));
    await step('reject-request', () => moveOnScreen('rejected', { status: 'rejected', control: job.award.controls.moves.rejected }, { reason: inputs.rejectionReason }));

    await step('resubmit-request', async () => {
      const rejected = requestByKey('rejected');
      const row = await rowSelector(rejected.number);
      await clickInRow(row, job.award.controls.resubmit, { selector: 'a' });
      await page.waitForFunction(() => /[?&]resubmit=/.test(location.search), { timeout: 30000 });
      await B.settle(page, 2500);
      const wanted = fixedRequest('resubmission');
      const given = inputRequest('resubmission');
      const { response, body, at } = await finishComposer({ number: wanted.number, amount: wanted.gross, periodStart: given.periodStart, periodEnd: given.periodEnd, invoiceDate: given.invoiceDate, prefilled: true });
      const said = recordCreated('resubmission', { response, body, at, control: job.award.controls.resubmit });
      if (requestByKey('resubmission').resubmitsInvoiceId !== rejected.invoiceId) throw new Error('The resubmission does not carry the link to the rejected request.');
      return said;
    });

    await step('move-resubmission', () => moveTo('resubmission', 'submitted'));

    await step('member-refusals-open', async () => [await memberTries('log-request'), await memberTries('approve-request')].join('; '));

    await step('product-refusals', async () => {
      const resubmission = requestByKey('resubmission');
      const paid = await B.appRequest(page, `/api/invoicing/invoices/${resubmission.invoiceId}`, { method: 'PATCH', body: { workspaceId: ids.workspaceId, status: 'paid', paidDate: today() } });
      let paidCode = null;
      try {
        paidCode = JSON.parse(paid.text).code ?? null;
      } catch {
        paidCode = null;
      }
      state.refusals.push({ account: 'owner', action: 'paid-before-approval', status: paid.status, code: typeof paidCode === 'string' ? paidCode : null });
      if (!job.award.productRefusals.list[0].statuses.includes(paid.status)) throw new Error(`Marking ${resubmission.number} paid before approval answered ${paid.status}.`);
      // The claim above the ceiling: a workspace-level draft on no award, linked to the award in the move that would claim it.
      await go('/invoicing');
      await page.click('[data-testid="invoice-record-composer-open"]');
      const probe = await finishComposer({ number: inputs.overCeilingProbe.number, amount: inputs.overCeilingProbe.gross });
      const draft = probe.body && probe.body.invoice;
      if (probe.response.status() !== 201 || !draft) throw new Error(`Saving the over-ceiling probe's draft answered ${probe.response.status()}.`);
      ids.overCeilingDraftId = draft.id;
      const over = await B.appRequest(page, `/api/invoicing/invoices/${draft.id}`, { method: 'PATCH', body: { workspaceId: ids.workspaceId, status: 'internal_review', fundingAwardId: state.award.awardId } });
      let overBody = null;
      try {
        overBody = JSON.parse(over.text);
      } catch {
        overBody = null;
      }
      const overCode = overBody && typeof overBody.code === 'string' ? overBody.code : null;
      state.refusals.push({ account: 'owner', action: 'over-ceiling-claim-without-note', status: over.status, code: overCode });
      const rule = job.award.productRefusals.list[1];
      if (!rule.statuses.includes(over.status) || overCode !== rule.code) throw new Error(`The claim above the ceiling answered ${over.status} ${overCode || ''}.`);
      return `paid before approval ${paid.status}; over the ceiling with no note ${over.status} ${overCode}`;
    });

    await step('read-open-screens', () => readScreens('open'));
    await step('download-open-worksheet', () => downloadWorksheet('worksheet-open'));
    await step('approve-resubmission', () => moveTo('resubmission', 'approved_for_payment'));
    await step('member-refusal-paid', () => memberTries('mark-paid'));
    await step('pay-resubmission', () => moveTo('resubmission', 'paid'));
    await step('member-refusal-close-out', () => memberTries('close-out'));

    await step('close-out', async () => {
      await go(`/grants?tab=awards&focusProjectId=${ids.projectId}`);
      const found = await page.evaluate((title) => {
        for (const button of document.querySelectorAll('button')) {
          if (button.innerText.trim() !== 'Close out award' || !button.getBoundingClientRect().width) continue;
          const item = button.closest('li');
          if (item && item.innerText.includes(title)) {
            button.setAttribute('data-journey', 'close-out');
            return true;
          }
        }
        return false;
      }, state.award.title);
      if (!found) throw new Error(`Grants, Awards shows no "${job.award.controls.closeOut}" control for the award.`);
      await page.click('[data-journey="close-out"]');
      await B.sleep(800);
      await page.evaluate((id) => {
        const radio = [...document.querySelectorAll(`input[type=radio][name="closeout-basis-${id}"]`)].find((input) => /Under the ceiling/.test(input.parentElement.innerText));
        radio.click();
      }, state.award.awardId);
      const note = await page.waitForSelector(`#closeout-note-${state.award.awardId}`, { visible: true });
      await B.typeInto(note, inputs.closeOutNote);
      const answered = page.waitForResponse((r) => r.url().includes(`/api/funding-awards/${state.award.awardId}/closeout`) && r.request().method() === 'POST', { timeout: 60000 });
      await B.clickText(page, 'button', 'Confirm close-out', { exact: true });
      const response = await answered;
      const body = await B.readJson(response);
      let sent = null;
      try {
        sent = JSON.parse(response.request().postData() || 'null');
      } catch {
        sent = null;
      }
      const closedAt = (body && body.closedAt) || first.utcNow();
      state.closeOut = {
        control: job.award.controls.closeOut,
        basis: sent && sent.basis ? sent.basis : 'not sent',
        note: inputs.closeOutNote.trim(),
        responseStatus: response.status(),
        releasedAmount: body && typeof body.releasedAmount === 'number' ? lib.money(Math.round(body.releasedAmount * 100)) : null,
        closedAt: new Date(closedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        closedOn: lib.dayIn(inputs.timeZone, new Date(closedAt)),
      };
      if (response.status() !== 200) throw new Error(`The close-out answered ${response.status()}${body && body.error ? `: ${String(body.error).slice(0, 200)}` : ''}.`);
      await B.settle(page, 2000);
      await page.screenshot({ path: path.join(out, 'screens', 'close-out-result.png'), fullPage: false });
      return `${state.closeOut.basis} ${response.status()}, released ${state.closeOut.releasedAmount}, closed on ${state.closeOut.closedOn}`;
    });

    await step('read-closed-screens', () => readScreens('closed'));
    await step('download-closed-worksheet', () => downloadWorksheet('worksheet-closed'));

    await step('screens', async () => {
      const axeSource = fs.readFileSync(AXE_SOURCE, 'utf8');
      const routes = {
        'funding-tab': { route: `/projects/${ids.projectId}?tab=funding` },
        'grants-awards': { route: `/grants?tab=awards&focusProjectId=${ids.projectId}` },
        'invoices-register': { route: '/invoicing' },
        dashboard: { route: '/dashboard' },
      };
      const screens = job.screens.required.map((slug) => {
        if (!routes[slug]) throw new Error(`The job's definition requires the screen ${slug}, which this journey does not know how to open.`);
        return { slug, ...routes[slug] };
      });
      const rules = await B.scanScreens({ browser, context, origin, screens, out, secrets, axeSource, rows: state.screens, markPaneUnrolled: true });
      ids.axeRules = rules;
      const serious = state.screens.reduce((sum, row) => sum + row.axe.serious + row.axe.critical, 0);
      const withErrors = state.screens.filter((row) => row.consoleErrors > 0);
      const scrolling = state.screens.filter((row) => row.horizontalScroll && job.screens.noSidewaysScrollWidths.includes(row.width));
      const describe = (row) => `${row.screen} at ${row.width} px ${row.mode}`;
      if (serious) findings.push({ id: 'screens-serious-or-critical', text: `The record checker will refuse these screens: ${rules.map((entry) => `${describe(entry)} (${entry.rules.map((found) => `${found.id}, ${found.impact}, ${found.nodes}`).join('; ')})`).join('; ')}` });
      if (withErrors.length) findings.push({ id: 'screens-console-errors', text: `The record checker will refuse these screens for console errors: ${withErrors.map((row) => `${describe(row)} (${row.consoleErrors})`).join('; ')}` });
      if (scrolling.length) findings.push({ id: 'screens-sideways-scroll', text: `The record checker will refuse these screens for sideways scroll: ${scrolling.map(describe).join('; ')}` });
      const stop = atp.screensStop(options.mode, { serious, consoleErrorScreens: withErrors.length, scrollingScreens: scrolling.length });
      if (stop) throw new Error(stop);
      return `${state.screens.length} checks, ${serious} serious or critical axe nodes, ${withErrors.length} with console errors, ${scrolling.length} scrolling sideways at ${job.screens.noSidewaysScrollWidths.join(', ')} px`;
    });

    await step('owner-control', async () => {
      const history = await B.appFetch(historyRoute(), null, 'GET', page, { credentials: 'same-origin' });
      ownerChecks.push({ request: 'award-history-read', status: history.status });
      const worksheet = await B.appFetch(worksheetRoute(), null, 'GET', page, { credentials: 'same-origin' });
      ownerChecks.push({ request: 'worksheet-download', status: worksheet.status });
      if (history.status !== 200) throw new Error(`The owner's own award history read answered ${history.status}; a refusal means nothing beside it.`);
      if (worksheet.status !== 200 || !worksheet.isPdf) throw new Error(`The owner's own worksheet download answered ${worksheet.status}; a refusal means nothing beside it.`);
      return `award history ${history.status}, worksheet ${worksheet.status}`;
    });

    await step('cross-workspace', async () => {
      const other = await browser.createBrowserContext();
      const second = await other.newPage();
      const account = await B.signUpAndConfirm({ page: second, origin, mode: options.mode, email: options.secondEmail, password: passwords[2], organization: inputs.secondOrganization.trim(), confirmFile: options.secondConfirmLinkFile, confirmTimeoutMinutes: options.confirmTimeoutMinutes, secrets, log });
      const own = await B.appFetch('/api/workspaces/current', null, 'GET', second);
      secondAccounts.push({ confirmed: account.confirmationMethod === 'email_link', ownRequest: job.crossWorkspace.secondAccount.ownRequest, ownStatus: own.status });
      if (account.confirmationMethod !== 'email_link' || own.status !== job.crossWorkspace.secondAccount.status) throw new Error(`The second account was confirmed by ${account.confirmationMethod} and its own workspace read answered ${own.status}; its refusals would show nothing.`);
      const identifying = atp.identifyingStrings({ projectName: state.projectName, workspaceName: state.workspaceName, projectSummary: inputs.projectSummary });
      const checks = [
        { target: 'award', request: 'award-history-read', kind: 'data', run: async () => {
          const result = await B.appFetch(historyRoute(), null, 'GET', second, { credentials: 'same-origin' });
          return { status: result.status, contentReturned: result.status < 400 && result.text.includes(state.award.awardId) };
        } },
        { target: 'worksheet', request: 'worksheet-download', kind: 'data', run: async () => {
          const result = await B.appFetch(worksheetRoute(), null, 'GET', second, { credentials: 'same-origin' });
          return { status: result.status, contentReturned: result.isPdf };
        } },
        { target: 'award', request: 'funding-tab-page', kind: 'page', run: async () => {
          const response = await second.goto(new URL(`/projects/${ids.projectId}?tab=funding`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await B.settle(second, 2500);
          const reading = first.readPageForRecord({ text: await second.evaluate(() => document.body.innerText), html: await second.content(), strings: [...identifying, state.award.title] });
          return { status: response.status(), contentReturned: reading.recordTextFound, notFoundRendered: reading.notFoundRendered, recordTextFound: reading.recordTextFound, searchedStringSha256: reading.searchedStringSha256, searchedStringCount: reading.searchedStringSha256.length };
        } },
      ];
      const detail = [];
      for (const check of checks) {
        const result = await check.run();
        crossChecks.push({ target: check.target, request: check.request, kind: check.kind, ...result, contentReturned: Boolean(result.contentReturned) });
        detail.push(`${check.request} ${result.status}${check.kind === 'page' ? ` (not-found screen ${result.notFoundRendered ? 'shown' : 'NOT shown'}, ${result.searchedStringCount} strings searched, ${result.recordTextFound ? 'RECORD TEXT FOUND' : 'none found'})` : ''}${result.contentReturned ? ' CONTENT RETURNED' : ''}`);
      }
      await other.close();
      if (crossChecks.some((check) => check.contentReturned)) throw new Error(`A second account received the first account's content: ${detail.join('; ')}`);
      const inconclusive = crossChecks.filter((check) => ![403, 404].includes(check.status) && !(check.kind === 'page' && check.status === 200 && check.notFoundRendered && check.recordTextFound === false && check.searchedStringCount >= job.crossWorkspace.minSearchedStrings));
      if (inconclusive.length) throw new Error(`These answers do not show a refusal: ${inconclusive.map((check) => `${check.request} ${check.status}`).join('; ')}`);
      if (crossChecks.some((check) => check.kind === 'page' && check.status === 200)) findings.push({ id: job.crossWorkspace.pageAnsweredOkLimit, text: 'Another workspace\'s Funding tab answered HTTP 200 with the not-found screen (it streams); the record states this as a limit.' });
      return detail.join('; ');
    });

    await step('health-end', () => health('end'));
  }

  const finished = await campaign.runJourney({ steps: [mainSteps], campaignId: () => null, close: async () => ({ closed: true, problems: [] }) });
  if (member) await member.context.close().catch(() => {});
  await browser.close().catch(() => {});
  const failure = finished.failure;

  const furthest = [...steps].reverse().find((entry) => entry.status === 'passed');
  const journey = lib.buildAwardJourney(state);
  const refusals = failure ? [] : atp.definitionRefusals({ ...journey, mode: options.mode, harness }, job);
  const result = {
    schema: 'openplan.award_job_journey_run.v1',
    jobId: lib.JOB_ID,
    mode: options.mode,
    baseUrl: origin,
    recordedOn: first.utcNow().slice(0, 10),
    expectedCommit: options.expectedCommit,
    harness,
    idleTimeoutMs: B.IDLE_TIMEOUT_MS,
    inputsLabel: inputs.label || null,
    inputsSha256: loadedInputs.sha256,
    furthestStep: furthest ? furthest.step : null,
    stoppedAt: failure ? failure.journeyStep || 'setup' : null,
    stepsDefined: STEPS,
    steps,
    journey,
    crossWorkspace: { checks: crossChecks, ownerChecks, secondAccounts },
    placeStatesListed: ids.placeStatesListed || null,
    workspacePlace: ids.workspacePlace || null,
    profileSelections: ids.profileSelections || null,
    worksheetReadings: ids.worksheetText,
    publicPageRequests: [...new Set(publicRequests)],
    leftOnSite: lib.LEFT_ON_SITE,
    definitionRefusals: refusals,
    confirmationTokenSha256: ids.tokenSha256 || null,
    findings,
    axeRules: ids.axeRules || [],
    consoleErrorsDuringJourney: consoleErrors.length,
    ids: {
      projectId: ids.projectId || null,
      opportunityId: ids.opportunityId || null,
      awardId: state.award ? state.award.awardId : null,
      overCeilingDraftId: ids.overCeilingDraftId || null,
    },
  };
  const written = lib.writeAwardRunFile({ outDir: out, role: options.role, result, scrub: (text) => first.scrubText(text, secrets), secrets });
  fs.writeFileSync(path.join(out, 'console', 'journey.txt'), consoleErrors.map((line) => first.scrubText(line, secrets)).join('\n'));
  log(`wrote ${written.runFile}`);
  if (refusals.length) log(`the record checker would refuse this journey: it ${refusals.join('; ')}`);
  for (const finding of findings) log(`finding ${finding.id}: ${first.scrubText(finding.text, secrets)}`);
  log(`furthest step passed: ${result.furthestStep}${failure ? `; ${first.scrubText(failure.message, secrets)}` : '; journey complete'}`);
  if (failure) process.exitCode = 1;
}

/** --assemble --journeys a.json,b.json,c.json --commit <40 hex> --base-url <origin> --out record.json [--root <folder the PDF paths are relative to>] */
async function assembleMain(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  const record = lib.assembleAwardRecord({
    journeyFiles: String(args.journeys || '').split(',').filter(Boolean).map((file) => path.resolve(file)),
    commit: args.commit,
    baseUrl: args['base-url'],
    proofOrigin: await first.loadProofOrigin(),
    recordedOn: first.utcNow().slice(0, 10),
    root: args.root ? path.resolve(args.root) : null,
  });
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(record, null, 2)}\n`);
  log(`wrote ${path.resolve(args.out)}; check it with validateProvenJobRecord`);
}

if (require.main === module) {
  process.on('unhandledRejection', (reason) => {
    const message = reason && reason.message ? reason.message : String(reason);
    if (!/Target closed|Page closed|Session closed|Protocol error|Connection closed/i.test(message)) {
      process.stderr.write(`[journey] unhandled: ${first.scrubText(message)}\n`);
      process.exitCode = 1;
    }
  });
  main().catch((error) => {
    process.stderr.write(`[journey] ${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
