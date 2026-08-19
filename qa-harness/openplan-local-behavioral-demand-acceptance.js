const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3200';
const placeQuery = process.env.OPENPLAN_ACCEPTANCE_PLACE_QUERY;
const placeResultPattern = process.env.OPENPLAN_ACCEPTANCE_PLACE_RESULT_PATTERN;
const expectedRuntime = process.env.OPENPLAN_ACCEPTANCE_RUNTIME || 'activitysim_cli';
if (!placeQuery || !placeResultPattern) {
  throw new Error('Set OPENPLAN_ACCEPTANCE_PLACE_QUERY and OPENPLAN_ACCEPTANCE_PLACE_RESULT_PATTERN. The acceptance harness has no default study geography.');
}
if (!['activitysim_cli', 'preflight_only'].includes(expectedRuntime)) {
  throw new Error(`Unsupported OPENPLAN_ACCEPTANCE_RUNTIME: ${expectedRuntime}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(__dirname, 'output', new Date().toISOString().slice(0, 10), `behavioral-demand-${stamp}`);
const email = `behavioral-demand-${stamp}@example.test`;
const password = `OpenPlan!${Date.now()}Planner`;

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const evidence = { baseUrl, email, placeQuery, expectedRuntime, startedAt: new Date().toISOString(), screenshots: [], observations: [], consoleErrors: [], failedResponses: [] };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.OPENPLAN_QA_CHROME || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) evidence.failedResponses.push({ status: response.status(), url: response.url() });
  });
  const shot = async (name) => {
    const target = path.join(outputDir, `${name}.png`);
    await page.screenshot({ path: target, fullPage: true });
    evidence.screenshots.push(target);
  };

  try {
    await page.goto(`${baseUrl}/sign-up?intent=modeling`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Organization').waitFor();
    await page.waitForTimeout(1000);
    await page.getByLabel('Organization').fill('Fresh Planner Acceptance Workspace');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await shot('01-sign-up-ready');
    await page.getByRole('button', { name: 'Create account' }).click();

    if (await page.getByText('Confirm your email to finish.').isVisible().catch(() => false)) {
      throw new Error('Local sign-up requires email confirmation; complete it in Mailpit before rerunning.');
    }
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-up'), { timeout: 30000 });
    if (page.url().includes('/sign-in')) {
      await page.getByLabel('Work email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: /^Sign in$/ }).click();
    }
    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    evidence.observations.push('Created and authenticated a brand-new planner account through the visible sign-up and sign-in UI.');
    await shot('02-first-dashboard');

    const projectName = `Behavioral demand acceptance project ${stamp}`;
    await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Project name').waitFor();
    await page.waitForTimeout(1000);
    await page.getByLabel('Project name').fill(projectName);
    await page.getByLabel('Summary').fill('A fresh-planner project created to exercise the complete behavioral demand run.');
    const projectResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/projects'),
      { timeout: 30000 },
    );
    await page.getByRole('button', { name: 'Create project' }).click();
    const projectResponse = await projectResponsePromise;
    const projectPayload = await projectResponse.json();
    if (!projectResponse.ok()) {
      throw new Error(`Project creation failed: ${projectResponse.status()} request=${projectResponse.request().postData()} response=${JSON.stringify(projectPayload)}`);
    }
    await page.waitForURL((url) => /^\/projects\/[0-9a-f-]+$/.test(url.pathname), { timeout: 30000 });
    evidence.projectId = new URL(page.url()).pathname.split('/').pop();
    evidence.observations.push('Created the required project through the visible Projects UI.');

    await page.goto(`${baseUrl}/models`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('model-creator-open').waitFor();
    await page.waitForTimeout(1000);
    await page.getByTestId('model-creator-open').click();
    await page.getByLabel('Name').waitFor();
    await page.getByLabel('Name').fill(`Behavioral demand acceptance ${stamp}`);
    await page.getByLabel('What is it for?').fill('Verify the complete dual-demand production handoff from a planner-facing model run.');
    await page.getByRole('button', { name: /^Next$/ }).click();
    await page.getByLabel('Primary project').selectOption({ label: projectName });
    await page.getByRole('button', { name: /^Next$/ }).click();
    await page.getByRole('button', { name: /^Next$/ }).click();
    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/models'),
      { timeout: 30000 },
    );
    await page.getByRole('button', { name: 'Create the model record' }).click();
    const createResponse = await createResponsePromise;
    const createPayload = await createResponse.json();
    if (!createResponse.ok()) throw new Error(`Model creation failed: ${createResponse.status()} ${JSON.stringify(createPayload)}`);
    await page.waitForURL((url) => /^\/models\/[0-9a-f-]+$/.test(url.pathname), { timeout: 30000 });
    const modelId = new URL(page.url()).pathname.split('/').pop();
    evidence.modelId = modelId;

    await page.locator('#managed-run-engine').selectOption('behavioral_demand');
    await page.locator('#managed-run-title').fill(`Six-stage behavioral demand ${stamp}`);
    await page.getByLabel('Search for a place').fill(placeQuery);
    const place = page.getByRole('button', { name: new RegExp(placeResultPattern, 'i') }).first();
    await place.waitFor({ timeout: 30000 });
    await place.click();
    await page.getByRole('button', { name: 'Clear' }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const control = document.querySelector('#managed-run-corridor');
      return control instanceof HTMLTextAreaElement && control.value.includes('coordinates');
    }, { timeout: 30000 });
    await shot('03-run-configured');

    const launchResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes(`/api/models/${modelId}/runs`),
      { timeout: 60000 },
    );
    await page.getByRole('button', { name: /^(Launch run|Run readiness check)$/ }).click();
    const launchResponse = await launchResponsePromise;
    const launchPayload = await launchResponse.json();
    if (!launchResponse.ok()) throw new Error(`Launch failed: ${launchResponse.status()} ${JSON.stringify(launchPayload)}`);
    evidence.modelRunId = launchPayload.modelRunId;
    evidence.sourceRunId = launchPayload.runId;
    evidence.observations.push('Launched behavioral_demand from the model detail UI.');
    await shot('04-run-launched');

    const deadline = Date.now() + 45 * 60 * 1000;
    while (Date.now() < deadline) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const body = await page.locator('body').innerText();
      if (/LATEST STATUS\s+succeeded/i.test(body) && /Demand Model Agreement/i.test(body)) break;
      if (/LATEST STATUS\s+failed/i.test(body)) throw new Error(`Run detail reports failure:\n${body.slice(0, 5000)}`);
      await page.waitForTimeout(10000);
    }
    const body = await page.locator('body').innerText();
    if (!/Demand Model Agreement/i.test(body) || !/LATEST STATUS\s+succeeded/i.test(body)) throw new Error('Timed out waiting for all six stages.');
    const requiredProof = expectedRuntime === 'activitysim_cli' ? [
      ['real ActivitySim execution', /behavioral_runtime_succeeded \(runtime mode: activitysim_cli\)/i],
      ['vehicle-demand packaging', /assignment demand package written/i],
      ['retained-network assignment', /ActivitySim Network Assignment[\s\S]*Graph: \d+ links, \d+ nodes/i],
      ['two convergence records', /Converged:[\s\S]*Converged:/i],
      ['agreement JSON', /Demand Model Agreement\s+[\d.]+ [KM]?B/i],
      ['agreement Markdown', /Demand Model Agreement Report/i],
      ['agreement GeoJSON', /Demand Model Agreement Geojson/i],
      ['no averaging', /The two demand models were not averaged/i],
    ] : [
      ['preflight-only runtime', /preflight_only/i],
      ['no fabricated second assignment', /no second network assignment to run/i],
      ['no fabricated agreement', /there are no two demand models to compare/i],
    ];
    for (const [label, pattern] of requiredProof) {
      if (!pattern.test(body)) throw new Error(`Completed run detail is missing proof of ${label}.`);
      evidence.observations.push(`Run detail proves ${label}.`);
    }
    if (expectedRuntime === 'activitysim_cli') {
      const graphRecords = [...body.matchAll(/Graph: ([\d,]+) links, ([\d,]+) nodes/g)];
      if (graphRecords.length < 2 || graphRecords[0][1] !== graphRecords[1][1] || graphRecords[0][2] !== graphRecords[1][2]) {
        throw new Error('The two assignments do not report the same retained network dimensions.');
      }
      const agreementResponse = await page.request.get(`${baseUrl}/api/models/${modelId}/runs/${evidence.modelRunId}/agreement`);
      if (!agreementResponse.ok()) throw new Error(`Authenticated agreement retrieval failed: ${agreementResponse.status()}`);
      const agreement = await agreementResponse.json();
      if (!Array.isArray(agreement.features) || agreement.features.length === 0) throw new Error('Authenticated agreement retrieval returned no features.');
      const properties = agreement.features[0]?.properties || {};
      for (const field of ['agreement', 'first_volume', 'second_volume']) {
        if (!(field in properties)) throw new Error(`Agreement GeoJSON is missing ${field}.`);
      }
      evidence.agreementFeatureCount = agreement.features.length;
      evidence.observations.push('Retrieved non-empty agreement GeoJSON through the authenticated run-detail API.');
      const map = page.getByTestId('demand-agreement-map');
      await map.waitFor({ timeout: 30000 });
      const mapShot = path.join(outputDir, '06-agreement-map.png');
      await map.screenshot({ path: mapShot });
      evidence.screenshots.push(mapShot);
    }
    evidence.runDetailText = body;
    evidence.observations.push('Retrieved the completed run through the authenticated run-detail page.');
    await shot('05-run-detail-complete');
    const appFailures = evidence.failedResponses.filter(({ url }) => url.startsWith(baseUrl));
    if (evidence.consoleErrors.length) {
      evidence.observations.push(`Browser console recorded ${evidence.consoleErrors.length} error message(s); inspect consoleErrors in evidence.json.`);
    }
    if (appFailures.length) throw new Error(`OpenPlan requests failed: ${JSON.stringify(appFailures)}`);
  } catch (error) {
    evidence.error = error instanceof Error ? error.stack : String(error);
    evidence.lastUrl = page.url();
    evidence.lastPageText = await page.locator('body').innerText().catch(() => null);
    await shot('failure').catch(() => {});
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
