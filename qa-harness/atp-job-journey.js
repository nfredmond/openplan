#!/usr/bin/env node
/**
 * Third proven job, one journey: a planner signs up, sets a project's study
 * place, retrieves crashes, runs the corridor analysis, tracks the California
 * Active Transportation Program (ATP) from the grants catalog, sets the
 * application up from the 2027 template, types each of its ten sections and
 * makes it final, gives every checklist row a disposition, exports the
 * application PDF and downloads it. A second account then asks for the first
 * account's application, its PDF and its project page.
 *
 * Browser only. No service-role key, no database write, no API call in place
 * of a step a planner does on screen, and no AI drafting. Responses the app's
 * own screens request are read (never written) to record ids and counts. The
 * one request the script sends itself is the read a planner could make by
 * pasting a link: the owner's own application and PDF (the control), and the
 * same two addresses from the second account (the refusal).
 *
 * Modes:
 *   rehearsal  local origins only (localhost, 127.0.0.1); the local guard in
 *              harness-env.js refuses Vercel and Supabase cloud hosts.
 *   proof      the hosted proof origin only (PROOF_ORIGIN in
 *              openplan/scripts/ops/capability-evidence.mjs).
 *
 * The journey's place is one of the job's three roles (county, city,
 * tribal-area), each held to the rule the job's definition gives it. For the
 * tribal area the journey records the Census states the place search answer
 * listed and stops unless the list is exactly California: OpenPlan reads a
 * state's crash file inside a tribal area only then. Every journey stops
 * unless its crashes come from California's crash file with at least one
 * stored.
 *
 * Inputs: --inputs names a JSON file with the project's demonstration name
 * and summary, the two workspace names, the text of each of the ten sections
 * (each opening with "Demonstration by an automated OpenPlan proof run" and a
 * sentence that the named agency or tribe did not prepare it), a disposition
 * for each of the template's 26 checklist rows, the count of required
 * attachments those dispositions leave outstanding, and the facts behind the
 * text with their sources and the dates read. Rehearsal without --inputs uses
 * fixtures/atp-job-rehearsal-inputs.json, labeled as rehearsal text; a proof
 * refuses any file that carries that label.
 *
 * Nothing is attached. An agent cannot honestly produce a signature page or
 * an engineer's checklist, so every checklist row is left outstanding or
 * marked not applicable with its reason, and the PDF must be stamped DRAFT
 * with the count of required attachments outstanding. The journey reads that
 * count from the inputs, the rows on screen, the export panel, the export's
 * answer and the PDF, and stops unless all five agree.
 *
 * The job opens no public page: it makes no engagement campaign and mints no
 * share link. If the browser sends a request that would, the journey stops.
 *
 * Email confirmation: the script never takes the confirmation link as an
 * argument. When sign-up asks for confirmation it waits for the file named by
 * --confirm-link-file, reads the link, opens it, and records only a SHA-256 of
 * the token. The link is never printed or written anywhere.
 *
 * Output (in --out): journey-<role>.json (the journey in the shape of
 * $defs/applicationJourney in schemas/proven_job_record.v1.schema.json, the
 * cross-workspace checks with the owner's control and the second account's
 * own read, what the PDF read-back found, the step log, the mode, the
 * harness checkout it ran from, the SHA-256 of the inputs file and what the
 * journey leaves on the site), screenshots, scrubbed console captures and the
 * PDF. The run file never holds an address, a token or a password. Assemble
 * three journey files into one record with --assemble, then run the evidence
 * checker on it.
 *
 * See qa-harness/README.md for the exact commands.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appRoot, repoRoot } = require('./harness-env');
const first = require('./first-job-journey-lib');
const campaign = require('./journey-campaign-lib');
const lib = require('./atp-job-journey-lib');
const { IDLE_TIMEOUT_MS, appFetch, chromePath, clickText, controlByLabel, createProject, pickStudyPlace, readHealth, readJson, retrieveCrashes, scanScreens, settle, signUpAndConfirm, sleep, typeInto, waitForDownload } = require('./journey-browser-lib');

const puppeteer = require(require.resolve('puppeteer-core', { paths: [appRoot] }));
const AXE_SOURCE = path.join(appRoot, 'node_modules', 'axe-core', 'axe.min.js');

const STEPS = [
  'health-start', 'sign-up', 'confirm-email', 'create-project', 'set-study-place', 'retrieve-crashes',
  'run-corridor-analysis', 'track-atp', 'set-up-application', 'finalize-sections', 'set-checklist-dispositions',
  'export-application-pdf', 'read-application-pdf', 'screens', 'owner-control', 'cross-workspace', 'health-end',
];

function log(message) {
  process.stdout.write(`[journey] ${message}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--assemble') return assembleMain(argv.slice(1));
  const job = lib.loadJobDefinition();
  const options = lib.parseAtpArgs(argv, job);
  const proofOrigin = await first.loadProofOrigin();
  const origin = first.checkJourneyOrigin(options.mode, options.baseUrl, proofOrigin);
  if (!fs.existsSync(AXE_SOURCE)) throw new Error(`axe-core not found at ${AXE_SOURCE}. Run npm ci in openplan/.`);
  // Rehearsal falls back to the labeled fixture; a proof refuses it.
  const loadedInputs = lib.loadAtpInputs(options.mode, options.inputsFile, { job, run: options });
  const inputs = loadedInputs.inputs;
  log(`inputs: ${path.basename(loadedInputs.file)} (sha256 ${loadedInputs.sha256.slice(0, 12)})`);
  const plan = lib.checklistPlan(inputs, job);
  const expectedOutstanding = lib.outstandingRequiredCount(plan, job);
  // The checkout this script runs from, so a record names the harness that made it.
  const harness = campaign.harnessCheckout(repoRoot);
  log(`harness: ${harness.commit.slice(0, 12)}${harness.clean ? ', clean' : ', with uncommitted changes to tracked files'}`);
  if (options.mode === 'proof' && !harness.clean) throw new Error('A proof runs from a harness checkout with no uncommitted change to a tracked file.');

  const out = options.outDir;
  for (const dir of ['', 'screens', 'console', 'downloads']) fs.mkdirSync(path.join(out, dir), { recursive: true });
  const downloads = path.join(out, 'downloads');
  const names = first.workspaceNames(inputs, options.placeQuery);
  const rule = job.application;

  const state = {
    role: options.role,
    executor: { agent: options.executorAgent, model: options.executorModel },
    health: [],
    // Trimmed, as typed and as searched for on the second account's page: the checker hashes these two.
    projectName: inputs.projectName.trim(),
    workspaceName: names.first,
    application: { aiDraftingUsed: false },
    pdfs: [],
    screens: [],
  };
  const ids = {};
  const findings = [];
  const steps = [];
  const password = `Jr-${crypto.randomBytes(18).toString('base64url')}`;
  const secondPassword = `Jr-${crypto.randomBytes(18).toString('base64url')}`;
  const secrets = [password, secondPassword, options.email, options.secondEmail];
  const consoleErrors = [];
  const crossChecks = [];
  const ownerChecks = [];
  const secondAccounts = [];
  const publicRequests = [];
  let draftRequests = 0;
  let pdfReading = null;

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

  // What the screens request, read for ids and counts. Never written, never replayed.
  const observed = { places: [], application: null };
  // Requests the first account's page has sent and not yet had answered, so a
  // step that waited out the whole idle limit can say what it waited on.
  const inFlight = new Map();
  for (const done of ['requestfinished', 'requestfailed']) page.on(done, (request) => inFlight.delete(request));
  page.on('request', (request) => {
    const url = request.url();
    inFlight.set(request, `${request.method()} ${request.resourceType()} ${url.replace(/[?#].*$/, '').slice(0, 120)}`);
    if (!url.startsWith(origin)) return;
    if (lib.isPublicPageRequest(url, request.method())) publicRequests.push(`${request.method()} ${new URL(url).pathname.split('/').slice(0, 4).join('/')}`);
    if (request.method() === 'POST' && /\/api\/funding-opportunities\/[^/]+\/sections\/[^/]+\/draft/.test(url)) draftRequests += 1;
  });
  page.on('response', async (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname === '/api/geographies/places' && response.ok()) {
        const body = await readJson(response);
        if (body) observed.places.push({ query: url.searchParams.get('q'), body });
      }
      if (/^\/api\/funding-opportunities\/[^/]+\/application$/.test(url.pathname) && response.ok() && response.request().method() === 'GET') {
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
    const entry = { step: name, startedAt: first.utcNow(), status: 'running' };
    steps.push(entry);
    log(`${name}...`);
    try {
      const detail = await fn();
      // The job opens no public page. A request that would is a stop, whatever step sent it.
      if (publicRequests.length) throw new Error(`The browser sent a request that opens or reads a public page (${[...new Set(publicRequests)].join(', ')}); this job opens none.`);
      entry.status = 'passed';
      if (detail) entry.detail = detail;
      const waiting = [...new Set(inFlight.values())];
      if (waiting.length) entry.requestsInFlightAtEnd = waiting.slice(0, 6).map((line) => first.scrubText(line, secrets));
      log(`${name}: passed${detail ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
    } catch (error) {
      entry.status = 'failed';
      entry.error = first.scrubText(error && error.message ? error.message.split('\n')[0] : String(error), secrets);
      await page.screenshot({ path: path.join(out, 'screens', `failed-${name}.png`), fullPage: false }).catch(() => {});
      throw Object.assign(new Error(`Stopped at ${name}: ${entry.error}`), { journeyStep: name });
    } finally {
      entry.endedAt = first.utcNow();
    }
  }

  /**
   * Hold the journey so far to the definition's per-journey rules, as the
   * record checker will. A proof stops on a refusal. A rehearsal records it
   * as a finding and goes on, so everything after it is still rehearsed; the
   * run file lists every such refusal at the end.
   */
  const holdToDefinition = (only) => {
    const refusals = lib.definitionRefusals(state, job, { only });
    if (!refusals.length) return '';
    if (options.mode === 'proof') throw new Error(`This journey ${refusals.join('; ')}.`);
    for (const refusal of refusals) findings.push({ id: `definition-refuses:${only.replace(/\.$/, '')}`, text: `The record checker will refuse this journey: it ${refusal}.` });
    return `; THE DEFINITION REFUSES: ${refusals.join('; ')}`;
  };

  const health = (point) => readHealth({ origin, point, mode: options.mode, expectedCommit: options.expectedCommit, readings: state.health, findings });

  /** Open the grants screen on the project and the application workspace under the tracked opportunity; returns the application the screen loaded. */
  const openApplication = async (target = page) => {
    await target.goto(new URL(`/grants?focusProjectId=${ids.projectId}&tab=opportunities`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await settle(target);
    const loaded = target.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application`) && r.request().method() === 'GET', { timeout: 60000 });
    await clickText(target, 'button', 'Open application workspace', { exact: true });
    const body = await readJson(await loaded);
    await settle(target, 1500);
    return body;
  };

  /**
   * The two requests the owner makes as a control and the second account is
   * refused, sent the same way for both. The download answers its owner with
   * a redirect to a signed Storage address, so the session is sent to the
   * app only (journey-browser-lib.js, appFetch).
   */
  const SAME_ORIGIN = { credentials: 'same-origin' };
  const readApplicationAs = (target) => appFetch(`/api/funding-opportunities/${ids.opportunityId}/application`, null, 'GET', target, SAME_ORIGIN);
  const downloadPdfAs = (target) => appFetch(`/api/funding-opportunities/${ids.opportunityId}/application/export/${ids.exportId}/download`, null, 'GET', target, SAME_ORIGIN);

  /** The checklist as the application screen shows it: each row's key, status, note and whether a document is attached. */
  const readChecklistRows = () => page.$$eval('[data-testid^=application-attachment-]', (rows) => rows.map((row) => ({
    key: row.getAttribute('data-testid').replace('application-attachment-', ''),
    status: (row.querySelector('select[aria-label^="Status for "]') || {}).value || null,
    note: (row.querySelector('input[aria-label^="Note for "]') || {}).value || '',
    attached: /Fulfilled by (Knowledge Base document|report artifact)/.test(row.innerText),
  })));

  async function mainSteps() {
    await step('health-start', () => health('start'));

    await step('sign-up', async () => {
      const result = await signUpAndConfirm({ page, origin, mode: options.mode, email: options.email, password, organization: names.first, confirmFile: options.confirmLinkFile, confirmTimeoutMinutes: options.confirmTimeoutMinutes, secrets, log });
      state.accountCreatedAt = result.createdAt;
      state.confirmationMethod = result.confirmationMethod;
      ids.tokenSha256 = result.tokenSha256;
      return `confirmation ${result.confirmationMethod}`;
    });

    await step('confirm-email', async () => {
      // The emailed link only, in both modes: a sign-up that needs no confirmation does not exercise it.
      if (state.confirmationMethod !== 'email_link') throw new Error(`Sign-up was confirmed by ${state.confirmationMethod}; this job's journey confirms only by the emailed link.`);
      return `token sha256 ${ids.tokenSha256}${holdToDefinition('confirmationMethod')}`;
    });

    await step('create-project', async () => {
      ids.projectId = await createProject({ page, go, name: state.projectName, summary: inputs.projectSummary, planType: inputs.planType });
      return ids.projectId;
    });

    await step('set-study-place', async () => {
      const { label, result } = await pickStudyPlace({ page, go, projectId: ids.projectId, placeQuery: options.placeQuery, placeKind: options.placeKind, observedPlaces: observed.places });
      // What the search answer listed, kept whether or not the journey goes on.
      ids.placeStatesListed = lib.placeStatesListed(result);
      if (inputs.placeGeoid !== undefined && inputs.placeGeoid !== result.geoid) throw new Error(`The inputs are written for the place with Census id ${inputs.placeGeoid}; the search gave ${result.geoid} for ${label}.`);
      const stateFips = lib.assertPlaceForRole(result, options.role, job);
      state.place = { kind: result.kind, geoid: result.geoid, stateFips, label };
      return `${label} (${result.kind} ${result.geoid}); the search lists it in ${stateFips.join(', ')}`;
    });

    await step('retrieve-crashes', async () => {
      const { body, request } = await retrieveCrashes({ page, go, projectId: ids.projectId, placeLabel: state.place.label, findings });
      ids.ingestId = body.ingestId;
      ids.crashRetrieval = { sourceLabel: body.sourceLabel ?? null, severityCoverage: String(body.severityCompleteness || body.coverageState || 'not reported'), truncated: body.truncated === true, yearsRequested: request && request.years ? request.years : null };
      state.crashes = lib.crashesForRecord(body, request);
      lib.assertCaliforniaCrashFile(body, state.crashes, job);
      return `${body.sourceLabel} (${body.sourceId}): ${body.crashCount} reported, ${body.storedCount} stored, years ${state.crashes.years}${holdToDefinition('crashes.')}`;
    });

    await step('run-corridor-analysis', async () => {
      await go(`/explore?projectId=${ids.projectId}`);
      await settle(page, 2500);
      await clickText(page, 'button', 'Set up the analysis', { exact: true });
      await page.waitForSelector('#corridor-analysis-brief-queryText', { visible: true });
      await page.type('#corridor-analysis-brief-queryText', inputs.analysisQuestion || lib.DEFAULT_ANALYSIS_QUESTION);
      await clickText(page, 'dialog[open] button', 'Next', { exact: true });
      await page.waitForSelector('#corridor-analysis-brief-projectId', { visible: true });
      await page.select('#corridor-analysis-brief-projectId', ids.projectId);
      await clickText(page, 'dialog[open] button', 'Next', { exact: true });
      await page.waitForSelector('#corridor-analysis-brief-reportTemplate', { visible: true });
      ids.analysisReportStyle = await page.$eval('#corridor-analysis-brief-reportTemplate', (el) => el.value);
      const answered = page.waitForResponse((r) => r.url().includes('/api/analysis') && !r.url().includes('/api/analysis/') && r.request().method() === 'POST', { timeout: options.analysisTimeoutMinutes * 60000 });
      await clickText(page, 'dialog[open] button', 'Run the analysis', { exact: true });
      const response = await answered;
      const body = await readJson(response);
      if (response.status() !== 200 || !body || !body.runId) throw new Error(`The corridor analysis returned ${response.status()}${body && body.error ? `: ${String(body.error).slice(0, 160)}` : ''}`);
      ids.analysisRunId = body.runId;
      ids.tractData = lib.tractDataReading(body.metrics);
      state.application.tractData = ids.tractData.state;
      await settle(page, 3000);
      await page.screenshot({ path: path.join(out, 'screens', 'analysis-result-1440.png') });
      return `run ${body.runId.slice(0, 8)}; tract data ${ids.tractData.state}`;
    });

    await step('track-atp', async () => {
      await go(`/grants?focusProjectId=${ids.projectId}&tab=opportunities`);
      await (await controlByLabel(page, 'Search program catalog')).type('Active Transportation Program');
      await sleep(1500);
      const tracked = page.waitForResponse((r) => r.url().includes('/api/funding-opportunities') && r.request().method() === 'POST', { timeout: 60000 });
      const clicked = await page.evaluate(() => {
        const isTrack = (b) => b.innerText.trim() === 'Track as opportunity';
        const buttons = [...document.querySelectorAll('button')].filter((b) => isTrack(b) && b.getBoundingClientRect().width);
        for (const button of buttons) {
          // The card is the largest container that holds this one Track button.
          let card = button;
          while (card.parentElement && [...card.parentElement.querySelectorAll('button')].filter(isTrack).length === 1) card = card.parentElement;
          if (/^Active Transportation Program \(ATP\)/m.test(card.innerText)) {
            button.click();
            return true;
          }
        }
        return false;
      });
      if (!clicked) throw new Error('No catalog card for the Active Transportation Program (ATP).');
      const response = await tracked;
      const body = await readJson(response);
      if (response.status() !== 201 || !body || !body.opportunityId) throw new Error(`Tracking returned ${response.status()}`);
      ids.opportunityId = body.opportunityId;
      if (!body.opportunity || body.opportunity.project_id !== ids.projectId) throw new Error('The tracked opportunity is not linked to the project.');
      await page.waitForFunction(() => /Added to opportunities/.test(document.body.innerText), { timeout: 15000 });
      return ids.opportunityId;
    });

    await step('set-up-application', async () => {
      await openApplication();
      // The picker must start on the program the opportunity was tracked from; the journey does not choose it.
      const picker = await page.waitForSelector('select[aria-label="Application template"]', { visible: true });
      const startsOn = await picker.evaluate((el) => ({ value: el.value, text: el.options[el.selectedIndex] ? el.options[el.selectedIndex].text.trim() : '' }));
      ids.templatePickerStartsOn = startsOn;
      const wantedKey = (job.journeyFields.find((entry) => entry.field === 'application.catalogKey') || {}).equals;
      if (startsOn.value !== wantedKey) throw new Error(`The template picker starts on "${startsOn.text || startsOn.value || 'nothing'}", not the program the opportunity was tracked from (${wantedKey}).`);
      const initialized = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application`) && r.request().method() === 'POST', { timeout: 60000 });
      await clickText(page, 'button', 'Initialize application', { exact: true });
      const response = await initialized;
      const seeded = await readJson(response);
      if (response.status() !== 201 || !seeded) throw new Error(`Setting the application up returned ${response.status()}.`);
      let sent = null;
      try {
        sent = JSON.parse(response.request().postData() || 'null');
      } catch {
        // Read below as a missing catalog key.
      }
      state.application.catalogKey = sent && typeof sent.catalogKey === 'string' ? sent.catalogKey : 'none';
      // The application is identified by its seeded sections: exactly the 2027 template's ten keys, in order, each seeded from the catalog.
      const wantedSections = rule.sections.list.map((section) => section.key);
      const seededSections = (seeded.sections || []).map((row) => ({ key: row.section_key, source: row.source }));
      const isTemplate = seededSections.length === wantedSections.length && seededSections.every((row, index) => row.key === wantedSections[index] && row.source === 'catalog');
      const wantedTemplate = (job.journeyFields.find((entry) => entry.field === 'application.templateKey') || {}).equals;
      state.application.templateKey = isTemplate ? wantedTemplate : 'unidentified';
      ids.seededSectionKeys = seededSections.map((row) => row.key);
      ids.seededRowKeys = (seeded.attachments || []).map((row) => row.attachment_key);
      if (state.application.catalogKey !== wantedKey) throw new Error(`The application was set up from catalog key ${state.application.catalogKey}, not ${wantedKey}.`);
      if (!isTemplate) throw new Error(`The application's sections are not the 2027 template's ten (it lists ${ids.seededSectionKeys.join(', ') || 'none'}).`);
      const wantedRows = rule.rows.list.map((row) => row.key);
      if (JSON.stringify(ids.seededRowKeys) !== JSON.stringify(wantedRows)) throw new Error(`The application's checklist is not the 2027 template's 26 rows in order (it lists ${ids.seededRowKeys.length}).`);
      await settle(page, 1500);
      return `catalog key ${state.application.catalogKey}, template ${state.application.templateKey}, ${seededSections.length} sections, ${ids.seededRowKeys.length} checklist rows`;
    });

    await step('finalize-sections', async () => {
      const application = await openApplication();
      const sections = ((application && application.sections) || []).map((row) => ({ id: row.id, key: row.section_key }));
      const wanted = rule.sections.list.map((section) => section.key);
      if (JSON.stringify(sections.map((section) => section.key)) !== JSON.stringify(wanted)) throw new Error(`The application lists ${sections.map((section) => section.key).join(', ')}; the 2027 template has ${wanted.join(', ')}.`);
      // Each section's text is typed into its "Final text" box on screen and
      // saved as final; nothing is written behind the screen and no draft is asked for.
      ids.sectionEntries = [];
      for (const section of sections) {
        const S = `[data-testid="application-section-${section.key}"]`;
        const text = inputs.sections[section.key].text;
        await page.waitForSelector(S);
        if ((await page.$eval(`${S} button[aria-expanded]`, (b) => b.getAttribute('aria-expanded'))) !== 'true') {
          await page.click(`${S} button[aria-expanded]`);
          await sleep(1000);
        }
        await clickText(page, `${S} button`, 'Finalize edited text', { exact: true });
        const box = await page.waitForSelector(`${S} textarea[aria-label^="Final text for "]`, { visible: true, timeout: 20000 });
        await typeInto(box, text);
        const entered = await box.evaluate((el) => el.value);
        const patched = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/sections/${section.id}`) && r.request().method() === 'PATCH', { timeout: 60000 });
        await clickText(page, `${S} button`, 'Save as final', { exact: true });
        const response = await patched;
        if (response.status() !== 200) {
          const refusal = await page.$eval(`${S} [data-testid=finalize-refusal]`, (el) => el.innerText).catch(() => '');
          throw new Error(`Saving ${section.key} as final returned ${response.status()}: ${refusal.slice(0, 200)}`);
        }
        await page.waitForFunction((sel) => {
          const header = document.querySelector(sel).firstElementChild;
          return header && /\bFinal\b/.test(header.innerText);
        }, { timeout: 30000 }, S);
        await sleep(400);
        const header = await page.$eval(S, (el) => el.firstElementChild.innerText.replace(/\s+/g, ' '));
        const onScreen = first.parseUnverifiedBadge(header);
        if (onScreen.verify + onScreen.placeholders > 0) throw new Error(`After saving, the screen counts ${onScreen.verify} unverified item(s) and ${onScreen.placeholders} placeholder(s) in ${section.key}.`);
        ids.sectionEntries.push({ sectionKey: section.key, textSha256: first.sha256(Buffer.from(entered, 'utf8')), characters: entered.length });
      }
      // Read the application again: every section final, none finalized from a draft, and no draft stored.
      const after = await openApplication();
      const rows = (after && after.sections) || [];
      const notFinal = rows.filter((row) => row.status !== 'final').map((row) => row.section_key);
      if (rows.length !== wanted.length || notFinal.length) throw new Error(`After saving, ${notFinal.length ? notFinal.join(', ') : 'a section'} is not final.`);
      const drafts = Object.keys((after && after.latestDraftsBySectionId) || {}).length;
      const fromDraft = rows.filter((row) => row.finalized_from_draft_id).length;
      state.application.aiDraftingUsed = draftRequests > 0 || drafts > 0 || fromDraft > 0;
      if (state.application.aiDraftingUsed) throw new Error(`A draft was asked for or stored (${draftRequests} request(s), ${drafts} stored, ${fromDraft} section(s) finalized from one); every section of this job is typed text.`);
      state.application.sections = rule.sections.list.map((section) => ({ key: section.key, disposition: section.disposition }));
      return `${ids.sectionEntries.length} of ${wanted.length} final from typed text; no draft asked for or stored`;
    });

    await step('set-checklist-dispositions', async () => {
      await openApplication();
      for (const row of plan.filter((entry) => entry.disposition === 'not-applicable')) {
        const R = `[data-testid="application-attachment-${row.key}"]`;
        const attachment = ((observed.application && observed.application.attachments) || []).find((entry) => entry.attachment_key === row.key);
        if (!attachment) throw new Error(`The application lists no checklist row ${row.key}.`);
        const select = await page.waitForSelector(`${R} select[aria-label^="Status for "]`, { visible: true });
        await select.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const statusSaved = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/attachments/${attachment.id}`) && r.request().method() === 'PATCH', { timeout: 60000 });
        await select.select('not_applicable');
        if ((await statusSaved).status() !== 200) throw new Error(`Marking ${row.key} not applicable failed.`);
        await page.waitForFunction((sel) => (document.querySelector(`${sel} select[aria-label^="Status for "]`) || {}).value === 'not_applicable', { timeout: 30000 }, R);
        await typeInto(await page.waitForSelector(`${R} input[aria-label^="Note for "]`, { visible: true }), row.reason);
        const noteSaved = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/attachments/${attachment.id}`) && r.request().method() === 'PATCH', { timeout: 60000 });
        await clickText(page, `${R} button`, 'Save note', { exact: true });
        if ((await noteSaved).status() !== 200) throw new Error(`Saving the reason for ${row.key} failed.`);
        await sleep(300);
      }
      // Read every row back from a fresh load of the screen; the record states what it shows.
      await openApplication();
      state.application.rows = lib.rowsFromScreen(await readChecklistRows(), plan);
      state.application.outstandingRequiredCount = lib.outstandingRequiredCount(state.application.rows, job);
      ids.stampOnScreenBefore = await page.$eval('[data-testid=export-draft-stamps]', (el) => el.innerText.replace(/\s+/g, ' ').trim()).catch(() => null);
      lib.assertDraftCountAgrees(expectedOutstanding, {
        'the inputs file': inputs.requiredAttachmentsOutstanding,
        'the checklist rows on screen': state.application.outstandingRequiredCount,
        'the export panel': lib.draftStampCount(ids.stampOnScreenBefore, job),
      });
      const notApplicable = state.application.rows.filter((row) => row.disposition === 'not-applicable').length;
      return `${notApplicable} not applicable with a reason, ${state.application.rows.length - notApplicable} outstanding, nothing attached; ${state.application.outstandingRequiredCount} required outstanding`;
    });

    await step('export-application-pdf', async () => {
      const exported = page.waitForResponse((r) => r.url().includes(`/api/funding-opportunities/${ids.opportunityId}/application/export`) && r.request().method() === 'POST', { timeout: 300000 });
      await clickText(page, '[data-testid=application-export] button', 'Export application packet (PDF)');
      const response = await exported;
      const body = await readJson(response);
      state.application.exportedAt = first.utcNow();
      await page.waitForSelector('[data-testid=export-result], [data-testid=export-refusal]', { timeout: 60000 });
      const refusal = await page.$('[data-testid=export-refusal]');
      if (refusal) throw new Error(`Export refused: ${(await refusal.evaluate((el) => el.innerText)).slice(0, 200)}`);
      if (response.status() !== 201 || !body) throw new Error(`Export returned ${response.status()}`);
      ids.exportId = body.exportId || (body.export && body.export.id);
      if (!ids.exportId) throw new Error('The export answer named no export.');
      const result = await page.$eval('[data-testid=export-result]', (el) => el.innerText);
      ids.stampOnScreenAfter = result.split('\n').map((line) => line.trim()).filter((line) => /DRAFT/.test(line));
      ids.exportDraftStamps = Array.isArray(body.draftStamps) ? body.draftStamps : null;
      ids.exportEngineDisclosure = typeof body.engineDisclosure === 'string' ? body.engineDisclosure : null;
      lib.assertDraftCountAgrees(expectedOutstanding, {
        'the export\'s answer': lib.draftStampCount((ids.exportDraftStamps || []).join('\n'), job),
        'the export result on screen': lib.draftStampCount(ids.stampOnScreenAfter.join('\n'), job),
      });
      const before = new Set(fs.readdirSync(downloads));
      await clickText(page, '[data-testid=export-result] a', 'Download PDF', { exact: true });
      const file = await waitForDownload(downloads, before);
      const target = path.join(downloads, `${options.role}-atp-application.pdf`);
      fs.renameSync(file, target);
      ids.applicationPdf = target;
      return `${fs.statSync(target).size} bytes; stamped for ${expectedOutstanding} required attachment(s) outstanding`;
    });

    await step('read-application-pdf', async () => {
      const described = lib.describeApplicationPdf({ pdfPath: ids.applicationPdf, recordPath: path.relative(out, ids.applicationPdf).split(path.sep).join('/'), job, journey: state });
      state.pdfs = [described.pdf];
      pdfReading = { readings: described.reading.readings, stampCount: described.reading.stampCount, emailLocations: described.emailLocations };
      if (described.emailLocations.length) throw new Error(`The application PDF prints an email address at ${described.emailLocations.map((entry) => `page ${entry.page} line ${entry.line}`).join(', ')}.`);
      lib.assertDraftCountAgrees(expectedOutstanding, { 'the PDF': described.reading.stampCount });
      if (described.reading.problems.length) throw new Error(`The application PDF does not read as the job requires: not true that ${described.reading.problems.slice(0, 4).join('; not true that ')}${described.reading.problems.length > 4 ? `; and ${described.reading.problems.length - 4} more` : ''}.`);
      return `${described.pdf.pages} pages, ${described.reading.readings.length} readings, all as required; stamp count ${described.reading.stampCount}`;
    });

    await step('screens', async () => {
      const axeSource = fs.readFileSync(AXE_SOURCE, 'utf8');
      const routes = {
        project: { route: `/projects/${ids.projectId}` },
        safety: { route: `/safety?projectId=${ids.projectId}` },
        'corridor-analysis': { route: `/explore?projectId=${ids.projectId}` },
        'grants-application': { route: `/grants?focusProjectId=${ids.projectId}&tab=opportunities`, open: 'Open application workspace' },
      };
      const screens = job.screens.required.map((slug) => {
        if (!routes[slug]) throw new Error(`The job's definition requires the screen ${slug}, which this journey does not know how to open.`);
        return { slug, ...routes[slug] };
      });
      const rules = await scanScreens({ browser, context, origin, screens, out, secrets, axeSource, rows: state.screens });
      ids.axeRules = rules;
      const serious = state.screens.reduce((sum, row) => sum + row.axe.serious + row.axe.critical, 0);
      const withErrors = state.screens.filter((row) => row.consoleErrors > 0);
      const scrolling = state.screens.filter((row) => row.horizontalScroll && job.screens.noSidewaysScrollWidths.includes(row.width));
      const describe = (row) => `${row.screen} at ${row.width} px ${row.mode}`;
      if (serious) findings.push({ id: 'screens-serious-or-critical', text: `The record checker will refuse these screens: ${rules.map((entry) => `${describe(entry)} (${entry.rules.map((found) => `${found.id}, ${found.impact}, ${found.nodes}`).join('; ')})`).join('; ')}` });
      if (withErrors.length) findings.push({ id: 'screens-console-errors', text: `The record checker will refuse these screens for console errors: ${withErrors.map((row) => `${describe(row)} (${row.consoleErrors})`).join('; ')}` });
      if (scrolling.length) findings.push({ id: 'screens-sideways-scroll', text: `The record checker will refuse these screens for sideways scroll: ${scrolling.map(describe).join('; ')}` });
      return `${state.screens.length} checks, ${serious} serious or critical axe nodes, ${withErrors.length} with console errors, ${scrolling.length} scrolling sideways at ${job.screens.noSidewaysScrollWidths.join(', ')} px`;
    });

    await step('owner-control', async () => {
      // In the same run, the owner asks for the same two addresses the second account will be refused.
      const read = await readApplicationAs(page);
      ownerChecks.push({ request: 'application-read', status: read.status });
      const download = await downloadPdfAs(page);
      ownerChecks.push({ request: 'application-pdf-download', status: download.status });
      ids.ownerDownload = { redirected: download.redirected === true, isPdf: download.isPdf };
      if (read.status !== 200 || !/section_key/.test(read.text)) throw new Error(`The owner's own application read answered ${read.status}; a refusal means nothing beside it.`);
      if (download.status !== 200 || !download.isPdf) throw new Error(`The owner's own PDF download answered ${download.status}; a refusal means nothing beside it.`);
      return `application read ${read.status}, PDF download ${download.status}${download.redirected ? ' after the redirect to the signed file' : ''}`;
    });

    await step('cross-workspace', async () => {
      const other = await browser.createBrowserContext();
      const second = await other.newPage();
      const account = await signUpAndConfirm({ page: second, origin, mode: options.mode, email: options.secondEmail, password: secondPassword, organization: names.second, confirmFile: options.secondConfirmLinkFile, confirmTimeoutMinutes: options.confirmTimeoutMinutes, secrets, log });
      // The second account reads its own record first: a refusal from an account that is not signed in shows nothing.
      const own = await appFetch('/api/workspaces/current', null, 'GET', second);
      secondAccounts.push({ confirmed: account.confirmationMethod === 'email_link', ownRequest: job.crossWorkspace.secondAccount.ownRequest, ownStatus: own.status });
      if (account.confirmationMethod !== 'email_link' || own.status !== job.crossWorkspace.secondAccount.status) {
        throw new Error(`The second account was confirmed by ${account.confirmationMethod} and its own workspace read answered ${own.status}; its refusals would show nothing.`);
      }
      // The first account's identifying strings; the record keeps hashes only.
      const identifying = lib.identifyingStrings({ projectName: state.projectName, workspaceName: state.workspaceName, projectSummary: inputs.projectSummary });
      const checks = [
        { target: 'atp-application', request: 'application-read', kind: 'data', run: async () => {
          const result = await readApplicationAs(second);
          return { status: result.status, contentReturned: result.status < 400 && /section_key|final_markdown/.test(result.text) };
        } },
        { target: 'atp-application-pdf', request: 'application-pdf-download', kind: 'data', run: async () => {
          const result = await downloadPdfAs(second);
          return { status: result.status, contentReturned: result.isPdf };
        } },
        { target: 'atp-application', request: 'project-page', kind: 'page', run: async () => {
          const response = await second.goto(new URL(`/projects/${ids.projectId}`, origin).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await settle(second, 2500);
          const reading = first.readPageForRecord({ text: await second.evaluate(() => document.body.innerText), html: await second.content(), strings: identifying });
          return {
            status: response.status(),
            contentReturned: reading.recordTextFound,
            notFoundRendered: reading.notFoundRendered,
            recordTextFound: reading.recordTextFound,
            searchedStringSha256: reading.searchedStringSha256,
            searchedStringCount: reading.searchedStringSha256.length,
          };
        } },
      ];
      const detail = [];
      for (const check of checks) {
        const result = await check.run();
        crossChecks.push({ target: check.target, request: check.request, kind: check.kind, ...result, contentReturned: Boolean(result.contentReturned) });
        const pageNote = check.kind === 'page' ? ` (not-found screen ${result.notFoundRendered ? 'shown' : 'NOT shown'}, ${result.searchedStringCount} strings searched, ${result.recordTextFound ? 'RECORD TEXT FOUND' : 'none found'})` : '';
        detail.push(`${check.request} ${result.status}${pageNote}${result.contentReturned ? ' CONTENT RETURNED' : ''}`);
      }
      await other.close();
      if (crossChecks.some((check) => check.contentReturned)) throw new Error(`A second account received the first account's content: ${detail.join('; ')}`);
      const inconclusive = crossChecks.filter((check) => ![403, 404].includes(check.status) && !(check.kind === 'page' && check.status === 200 && check.notFoundRendered && check.recordTextFound === false && check.searchedStringCount >= job.crossWorkspace.minSearchedStrings));
      if (inconclusive.length) throw new Error(`These answers do not show a refusal: ${inconclusive.map((check) => `${check.request} ${check.status}`).join('; ')}`);
      if (crossChecks.some((check) => check.kind === 'page' && check.status === 200)) {
        findings.push({ id: job.crossWorkspace.pageAnsweredOkLimit, text: 'Another workspace\'s project page answered HTTP 200 with the not-found screen (it streams); the record states this as a limit.' });
      }
      return detail.join('; ');
    });

    await step('health-end', () => health('end'));
  }

  // The steps run until one stops. There is no campaign to close, so nothing runs afterward.
  const finished = await campaign.runJourney({ steps: [mainSteps], campaignId: () => null, close: async () => ({ closed: true, problems: [] }) });
  await browser.close().catch(() => {});
  const failure = finished.failure;

  const furthest = [...steps].reverse().find((entry) => entry.status === 'passed');
  const journey = lib.buildAtpJourney(state);
  // What the record checker would refuse in this journey beyond its mode: said in the run file, not left for the checker to find.
  const refusals = failure ? [] : lib.definitionRefusals({ ...journey, mode: options.mode, harness }, job);
  const result = {
    schema: 'openplan.atp_job_journey_run.v1',
    jobId: lib.JOB_ID,
    mode: options.mode,
    baseUrl: origin,
    recordedOn: first.utcNow().slice(0, 10),
    expectedCommit: options.expectedCommit,
    harness,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    inputsLabel: inputs.label || null,
    inputsSha256: loadedInputs.sha256,
    inputFacts: inputs.facts.map((fact) => ({ id: fact.id, source: fact.source, readOn: fact.readOn })),
    furthestStep: furthest ? furthest.step : null,
    stoppedAt: failure ? failure.journeyStep || 'setup' : null,
    stepsDefined: STEPS,
    steps,
    journey,
    crossWorkspace: { checks: crossChecks, ownerChecks, secondAccounts },
    ownerDownload: ids.ownerDownload || null,
    placeStatesListed: ids.placeStatesListed || null,
    crashRetrieval: ids.crashRetrieval || null,
    corridorAnalysis: { runId: ids.analysisRunId || null, reportStyle: ids.analysisReportStyle || null, tractData: ids.tractData || null },
    application: {
      templatePickerStartsOn: ids.templatePickerStartsOn || null,
      seededSectionKeys: ids.seededSectionKeys || [],
      seededRowKeys: ids.seededRowKeys || [],
      sections: ids.sectionEntries || [],
      draftRequestsSeen: draftRequests,
      expectedOutstandingRequiredCount: expectedOutstanding,
      stamp: { exportPanelBefore: ids.stampOnScreenBefore ?? null, exportAnswer: ids.exportDraftStamps ?? null, exportResultOnScreen: ids.stampOnScreenAfter || [], engineDisclosure: ids.exportEngineDisclosure ?? null },
    },
    pdfReading,
    publicPageRequests: [...new Set(publicRequests)],
    leftOnSite: lib.LEFT_ON_SITE,
    definitionRefusals: refusals,
    confirmationTokenSha256: ids.tokenSha256 || null,
    findings,
    axeRules: ids.axeRules || [],
    consoleErrorsDuringJourney: consoleErrors.length,
    ids: {
      projectId: ids.projectId || null,
      ingestId: ids.ingestId || null,
      opportunityId: ids.opportunityId || null,
      exportId: ids.exportId || null,
    },
  };
  const written = lib.writeAtpRunFile({ outDir: out, role: options.role, result, scrub: (text) => first.scrubText(text, secrets), secrets });
  fs.writeFileSync(path.join(out, 'console', 'journey.txt'), consoleErrors.map((line) => first.scrubText(line, secrets)).join('\n'));
  log(`wrote ${written.runFile}`);
  if (refusals.length) log(`the record checker would refuse this journey: it ${refusals.join('; ')}`);
  log(`furthest step passed: ${result.furthestStep}${failure ? `; ${first.scrubText(failure.message, secrets)}` : '; journey complete'}`);
  if (failure) process.exitCode = 1;
}

/** --assemble --journeys a.json,b.json,c.json --commit <40 hex> --base-url <origin> --out record.json [--root <folder the PDF paths are relative to>] */
async function assembleMain(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  const record = lib.assembleAtpRecord({
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
  // A wait that was set up before a step failed rejects once the browser
  // closes. The failure is already recorded; do not let it end the process
  // before the journey file is written.
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
