const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
  buildBrowserContextOptions,
  getOutputDir,
  guardLocalMutationTargets,
  loadEnv,
} = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3001';

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

function firstRow(result, label) {
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!result.ok || !row) {
    throw new Error(`No ${label} row returned: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return row;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing local Supabase environment keys.');
  const localGuard = guardLocalMutationTargets({
    appUrl: baseUrl,
    supabaseUrl,
    scriptName: 'local dual-demand report-to-grant smoke',
  });
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

  async function select(table, params) {
    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return jsonFetch(url, { headers });
  }

  const artifactRows = await select('model_run_artifacts', {
    select: 'id,run_id,artifact_type,metadata_json,created_at',
    artifact_type: 'eq.demand_model_agreement',
    order: 'created_at.desc',
    limit: '50',
  });
  if (!artifactRows.ok) throw new Error(`Could not discover agreement artifacts: ${artifactRows.status}`);

  let fixture = null;
  for (const artifact of artifactRows.data) {
    if (artifact.metadata_json?.kind !== 'dual_demand_model_agreement') continue;
    const run = firstRow(await select('model_runs', {
      select: 'id,run_title,model_id,workspace_id,project_id,status,query_text,corridor_geojson',
      id: `eq.${artifact.run_id}`,
      status: 'eq.succeeded',
      limit: '1',
    }), 'succeeded dual-demand run');
    const reports = await select('reports', {
      select: 'id,title,status,project_id,metadata_json',
      workspace_id: `eq.${run.workspace_id}`,
      project_id: `eq.${run.project_id}`,
      order: 'updated_at.desc',
      limit: '10',
    });
    const opportunities = await select('funding_opportunities', {
      select: 'id,title,opportunity_status,decision_state,project_id',
      workspace_id: `eq.${run.workspace_id}`,
      project_id: `eq.${run.project_id}`,
      opportunity_status: 'neq.awarded',
      order: 'updated_at.desc',
      limit: '10',
    });
    if (reports.ok && reports.data[0] && opportunities.ok && opportunities.data[0]) {
      fixture = { artifact, run, report: reports.data[0], opportunity: opportunities.data[0] };
      break;
    }
  }
  if (!fixture) {
    throw new Error('No local project has a succeeded agreement artifact, a report, and a draftable funding opportunity.');
  }

  const evidence = {
    baseUrl,
    localGuard,
    runId: fixture.run.id,
    reportId: fixture.report.id,
    opportunityId: fixture.opportunity.id,
    observations: [],
    screenshots: [],
    consoleErrors: [],
    failedResponses: [],
  };
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.OPENPLAN_QA_CHROME || undefined,
  });
  const context = await browser.newContext(buildBrowserContextOptions({
    viewport: { width: 1440, height: 1500 },
  }));
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => evidence.consoleErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) evidence.failedResponses.push({ status: response.status(), url: response.url() });
  });

  async function screenshotLocator(locator, name) {
    const target = path.join(outputDir, `${datePart}-${name}.png`);
    await locator.screenshot({ path: target });
    evidence.screenshots.push(target);
  }

  async function waitForMutation(method, routePart, action, timeout = 120000) {
    const responsePromise = page.waitForResponse(
      (response) => response.request().method() === method && response.url().includes(routePart),
      { timeout },
    );
    const [response] = await Promise.all([responsePromise, action()]);
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok()) {
      throw new Error(`${method} ${routePart} failed: ${response.status()} ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  try {
    // The server-rendered fields can be replaced during hydration. Filling at
    // DOMContentLoaded intermittently submits empty credentials.
    await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'load' });
    await page.getByLabel('Work email').fill(process.env.OPENPLAN_AUDIT_EMAIL || 'mapaudit@openplan.test');
    await page.getByLabel('Password').fill(process.env.OPENPLAN_AUDIT_PASSWORD || 'MapAudit!2026');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30000 });
    } catch (error) {
      throw new Error(`Visible sign-in did not leave the sign-in page: ${(await page.locator('body').innerText()).slice(0, 2000)}`, { cause: error });
    }
    evidence.observations.push('Signed in through the visible local planner UI.');

    const originalRun = fixture.run;
    const agreementProbe = await page.request.get(
      `${baseUrl}/api/models/${fixture.run.model_id}/runs/${fixture.run.id}/agreement`,
    );
    if (!agreementProbe.ok()) {
      await page.goto(`${baseUrl}/models/${fixture.run.model_id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('#managed-run-engine').selectOption('behavioral_demand');
      const freshTitle = `Current-custody dual-demand proof ${new Date().toISOString()}`;
      await page.locator('#managed-run-title').fill(freshTitle);
      await page.locator('#managed-run-query').fill(fixture.run.query_text || 'Compare both demand methods on the same retained network.');
      const corridorEditor = page.locator('#managed-run-corridor');
      if (!(await corridorEditor.isVisible())) {
        await page.getByText('Advanced: edit raw corridor GeoJSON', { exact: true }).click();
      }
      await corridorEditor.fill(JSON.stringify(fixture.run.corridor_geojson));
      const workerAcknowledgement = page.getByText(/A modeling worker has been started on this OpenPlan installation/).locator('..').getByRole('checkbox');
      if ((await workerAcknowledgement.count()) > 0 && !(await workerAcknowledgement.isChecked())) {
        await workerAcknowledgement.check();
      }
      const launchButton = page.getByRole('button', { name: /^(Launch run|Run readiness check)$/ }).first();
      const launchLabel = await launchButton.innerText();
      if (!/^(Launch run|Run readiness check)$/.test(launchLabel)) {
        throw new Error(`The visible model form refused the current run: ${launchLabel}`);
      }
      const launchPayload = await waitForMutation(
        'POST',
        `/api/models/${fixture.run.model_id}/runs`,
        () => launchButton.click(),
      );
      if (!launchPayload?.modelRunId) throw new Error('The visible run launch returned no model-run identity.');
      evidence.observations.push(`Launched replacement run ${launchPayload.modelRunId} because the existing artifact predates custody records.`);
      const deadline = Date.now() + 45 * 60 * 1000;
      let lastProgressAt = 0;
      while (Date.now() < deadline) {
        const runResult = await select('model_runs', {
          select: 'id,run_title,model_id,workspace_id,project_id,status,query_text,corridor_geojson,last_failure_message',
          id: `eq.${launchPayload.modelRunId}`,
          limit: '1',
        });
        const currentRun = firstRow(runResult, 'launched replacement run');
        if (currentRun.status === 'succeeded') {
          fixture.run = currentRun;
          evidence.runId = currentRun.id;
          break;
        }
        if (currentRun.status === 'failed' || currentRun.status === 'abandoned') {
          throw new Error(`Replacement dual-demand run ${currentRun.status}: ${currentRun.last_failure_message || 'no failure detail'}`);
        }
        if (Date.now() - lastProgressAt > 60000) {
          console.log(`Replacement dual-demand run ${currentRun.id} is ${currentRun.status}.`);
          lastProgressAt = Date.now();
        }
        await page.waitForTimeout(10000);
      }
      if (fixture.run.id === originalRun.id) throw new Error('Timed out waiting for the replacement dual-demand run.');
      const freshAgreement = await page.request.get(
        `${baseUrl}/api/models/${fixture.run.model_id}/runs/${fixture.run.id}/agreement`,
      );
      if (!freshAgreement.ok()) {
        throw new Error(`The replacement run failed shared agreement verification: ${freshAgreement.status()} ${await freshAgreement.text()}`);
      }
    }

    await page.goto(`${baseUrl}/reports/${fixture.report.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Cited model runs', { exact: true }).waitFor({ timeout: 30000 });
    const runLabel = page.locator('label').filter({ hasText: fixture.run.run_title }).first();
    const runCheckbox = runLabel.getByRole('checkbox');
    let citationChanged = false;
    if (!(await runCheckbox.isChecked())) {
      await runLabel.click();
      citationChanged = true;
    }
    if (fixture.run.id !== originalRun.id) {
      const originalRunLabel = page.locator('label').filter({ hasText: originalRun.run_title }).first();
      if ((await originalRunLabel.count()) > 0 && await originalRunLabel.getByRole('checkbox').isChecked()) {
        await originalRunLabel.click();
        citationChanged = true;
      }
    }
    if (citationChanged) {
      await waitForMutation('PATCH', `/api/reports/${fixture.report.id}`, () =>
        page.getByRole('button', { name: 'Save metadata' }).click(),
      );
    }
    await page.reload({ waitUntil: 'load' });
    await page.getByText('Dual-model agreement evidence', { exact: true }).waitFor({ timeout: 30000 });
    const agreementPanel = page.getByTestId('dual-demand-agreement-panel');
    const agreementText = await agreementPanel.innerText();
    if (!/methodological sensitivity, not accuracy/i.test(agreementText) || !/never averaged/i.test(agreementText)) {
      throw new Error(`The report agreement panel omitted its required sensitivity or no-average caveat: ${agreementText}`);
    }
    const corridorCheckboxes = agreementPanel.getByRole('checkbox');
    if ((await corridorCheckboxes.count()) === 0) throw new Error('The verified artifact has no named corridor choices.');
    if (!(await corridorCheckboxes.first().isChecked())) {
      const checkedBefore = await corridorCheckboxes.evaluateAll((boxes) => boxes.filter((box) => box.checked).length);
      if (checkedBefore !== 0) throw new Error('The smoke fixture unexpectedly had a different saved corridor selection.');
      await corridorCheckboxes.first().click();
      await waitForMutation('PATCH', `/api/reports/${fixture.report.id}`, () =>
        page.getByRole('button', { name: 'Save metadata' }).click(),
      );
    }
    evidence.observations.push('Attached the dual-model run and explicitly selected one named corridor.');
    await screenshotLocator(agreementPanel, 'dual-demand-report-selection');

    await page.getByLabel('Packet format').selectOption('html');
    await waitForMutation('POST', `/api/reports/${fixture.report.id}/generate`, () =>
      page.getByRole('button', { name: /Generate HTML packet|Regenerate HTML packet/ }).click(),
    );
    // The fixture may open with a pre-fix inline artifact. Clear its console
    // record before loading the packet generated by this run.
    evidence.consoleErrors = [];
    evidence.failedResponses = [];
    // Wait for the tab links to hydrate before activating one; clicking the
    // server-rendered link during replacement can be lost without navigation.
    await page.reload({ waitUntil: 'load' });
    const evidenceTab = page.locator(
      'nav[aria-label="Report sections"] a[data-page-tab="evidence"]',
    );
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('tab') === 'evidence', { timeout: 30000 }),
      evidenceTab.click(),
    ]);
    const evidencePanel = page.locator(
      '[data-page-tab-panel="evidence"][data-page-tab-panel-state="open"]',
    );
    const generatedArtifacts = evidencePanel.getByText('Generated artifacts', { exact: true });
    await generatedArtifacts.waitFor({ timeout: 30000 });
    evidence.observations.push('Generated the report packet through the visible report controls.');
    await screenshotLocator(
      generatedArtifacts.locator('xpath=ancestor::article[1]'),
      'dual-demand-report-generated',
    );

    const artifactResult = await select('report_artifacts', {
      select: 'id,metadata_json,generated_at',
      report_id: `eq.${fixture.report.id}`,
      order: 'generated_at.desc',
      limit: '1',
    });
    const reportArtifact = firstRow(artifactResult, 'generated report artifact');
    const snapshots = reportArtifact.metadata_json?.dualDemandAgreementSnapshotsV1;
    if (!Array.isArray(snapshots) || snapshots.length !== 1 || snapshots[0]?.selectedCorridors?.length !== 1) {
      throw new Error('The generated packet did not freeze exactly one verified agreement snapshot and selected corridor.');
    }
    if (snapshots[0].isAverage !== false) throw new Error('The frozen report snapshot permits averaged model output.');

    const grantUrl = `${baseUrl}/grants?focusProjectId=${fixture.run.project_id}&focusOpportunityId=${fixture.opportunity.id}#funding-opportunity-${fixture.opportunity.id}`;
    await page.goto(grantUrl, { waitUntil: 'domcontentloaded' });
    const opportunityCard = page.locator(`#funding-opportunity-${fixture.opportunity.id}`);
    await opportunityCard.getByText('Frozen dual-model agreement evidence', { exact: true }).waitFor({ timeout: 30000 });
    if (!/1 selected corridor/i.test(await opportunityCard.innerText())) {
      throw new Error('The linked grant did not show the frozen selected-corridor evidence.');
    }
    evidence.observations.push('Opened the linked project opportunity and saw the frozen agreement evidence panel.');
    await screenshotLocator(
      opportunityCard.getByText('Frozen dual-model agreement evidence', { exact: true }).locator('..'),
      'dual-demand-linked-grant',
    );

    const draftPayload = await waitForMutation(
      'POST',
      `/api/funding-opportunities/${fixture.opportunity.id}/narrative-draft`,
      () => opportunityCard.getByRole('button', { name: /^(Draft narrative|Regenerate draft)$/ }).click(),
      180000,
    );
    const facts = draftPayload?.draft?.grounding_json?.facts;
    const agreementFacts = Array.isArray(facts)
      ? facts.filter((fact) => /dual-model agreement|Planner-selected corridor/.test(fact.claim_text || ''))
      : [];
    if (agreementFacts.length !== 2) {
      throw new Error(`The grounded grant draft received ${agreementFacts.length} agreement facts instead of two.`);
    }
    if (!agreementFacts.every((fact) => /never averaged/i.test(fact.claim_text))) {
      throw new Error('The grant fact list omitted the required no-average statement.');
    }
    if (!draftPayload?.draft?.grounding_json?.faithfulness_checked) {
      throw new Error('The generated grant draft did not pass through deterministic faithfulness checking.');
    }
    await opportunityCard.getByTestId('narrative-draft-panel').waitFor({ timeout: 30000 });
    evidence.observations.push('Generated a grant narrative with the frozen aggregate and selected corridor in its citable fact list.');
    await screenshot('dual-demand-grounded-grant-draft');

    const seriousConsoleErrors = evidence.consoleErrors.filter(
      (message) => !/favicon|mapbox.*token|Failed to load resource.*404/i.test(message),
    );
    if (seriousConsoleErrors.length > 0 || evidence.failedResponses.length > 0) {
      throw new Error(`Browser errors: ${JSON.stringify({ seriousConsoleErrors, failedResponses: evidence.failedResponses })}`);
    }
  } finally {
    evidence.finishedAt = new Date().toISOString();
    const evidencePath = path.join(outputDir, `${datePart}-dual-demand-report-grant-smoke.json`);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await browser.close();
  }

  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
