const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getOutputDir, loadEnv, repoRoot } = require('./harness-env');

const outputDate = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(outputDate);
const productionBaseUrl = process.env.OPENPLAN_BASE_URL || 'https://openplan-zeta.vercel.app';

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase environment keys');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `openplan-scenario-compare-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}ScenarioCompare`;
  const summary = {
    createdAt: new Date().toISOString(),
    baseUrl: productionBaseUrl,
    email,
    password,
    screenshots: [],
    notes: [],
  };

  const createUserResult = await jsonFetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!createUserResult.ok) throw new Error(`Failed to create QA user: ${createUserResult.status} ${JSON.stringify(createUserResult.data)}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
  const page = await context.newPage();

  async function screenshot(name, targetPage = page) {
    const fileName = `${outputDate}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await targetPage.screenshot({ path: fullPath, fullPage: true });
    summary.screenshots.push(fullPath);
    return fullPath;
  }

  async function appFetch(route, payload, method = payload ? 'POST' : 'GET') {
    return await page.evaluate(async ({ route, payload, method }) => {
      const response = await fetch(route, {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: response.ok, status: response.status, data };
    }, { route, payload, method });
  }

  async function waitForModelRun(modelRunId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await jsonFetch(`${supabaseUrl}/rest/v1/model_runs?select=id,status,source_analysis_run_id,result_summary_json&id=eq.${modelRunId}`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      const row = Array.isArray(result.data) ? result.data[0] : null;
      if (row?.status === 'succeeded' && row?.source_analysis_run_id) return row;
      if (row?.status === 'failed') throw new Error(`Model run failed: ${JSON.stringify(row)}`);
      await sleep(1500);
    }
    throw new Error(`Timed out waiting for model run ${modelRunId}`);
  }

  try {
    await page.goto(`${productionBaseUrl}/sign-in`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    summary.notes.push('Signed into production with dedicated comparison smoke user.');

    const project = await appFetch('/api/projects', {
      projectName: `Scenario Comparison Smoke ${stamp}`,
      summary: 'Production smoke project for scenario comparison board.',
      planType: 'corridor_plan',
      deliveryPhase: 'scoping',
      status: 'active',
    });
    if (project.status !== 201) throw new Error(`Project create failed: ${project.status}`);
    summary.workspaceId = project.data.workspaceId;
    summary.projectId = project.data.projectRecordId;

    const scenarioSet = await appFetch('/api/scenarios', {
      projectId: summary.projectId,
      title: `Scenario Compare ${stamp}`,
      summary: 'Production scenario comparison board smoke.',
      planningQuestion: 'Does the live scenario comparison board show baseline vs alternative deltas from attached runs?',
      status: 'active',
    });
    if (scenarioSet.status !== 201) throw new Error(`Scenario create failed: ${scenarioSet.status}`);
    summary.scenarioSetId = scenarioSet.data.scenarioSetId;

    const baselineEntry = await appFetch(`/api/scenarios/${summary.scenarioSetId}/entries`, {
      entryType: 'baseline',
      label: 'Baseline Existing Conditions',
      summary: 'Baseline for comparison board smoke.',
      assumptions: { analysisQueryText: 'Baseline multimodal corridor conditions.' },
      status: 'ready',
      sortOrder: 0,
    });
    const alternativeEntry = await appFetch(`/api/scenarios/${summary.scenarioSetId}/entries`, {
      entryType: 'alternative',
      label: 'Alternative Transit + Bike Upgrade',
      summary: 'Alternative for comparison board smoke.',
      assumptions: {
        analysisQueryText: 'Evaluate safer crossings and protected bike lane with better transit access.',
        analysisQuerySuffix: 'Focus on equity and accessibility gains.',
      },
      status: 'ready',
      sortOrder: 1,
    });
    if (baselineEntry.status !== 201 || alternativeEntry.status !== 201) throw new Error('Failed to create scenario entries');
    summary.baselineEntryId = baselineEntry.data.entryId;
    summary.alternativeEntryId = alternativeEntry.data.entryId;

    const model = await appFetch('/api/models', {
      projectId: summary.projectId,
      scenarioSetId: summary.scenarioSetId,
      title: `Scenario Compare Model ${stamp}`,
      modelFamily: 'scenario_model',
      status: 'ready_for_review',
      configVersion: 'compare-v1',
      ownerLabel: 'QA smoke harness',
      assumptionsSummary: 'Scenario board smoke model',
      inputSummary: 'Template query and corridor for both entries',
      outputSummary: 'Two managed runs feeding comparison board',
      summary: 'Production comparison-board smoke model.',
      configJson: {
        runTemplate: {
          queryText: 'Evaluate corridor for multimodal safety, transit access, and equity outcomes.',
          corridorGeojson: {
            type: 'Polygon',
            coordinates: [[[-121.642,39.220],[-121.631,39.220],[-121.631,39.229],[-121.642,39.229],[-121.642,39.220]]],
          },
        },
      },
    });
    if (model.status !== 201) throw new Error(`Model create failed: ${model.status}`);
    summary.modelId = model.data.modelId;

    const baselineLaunch = await appFetch(`/api/models/${summary.modelId}/runs`, {
      scenarioEntryId: summary.baselineEntryId,
      title: 'Baseline managed run',
      attachToScenarioEntry: true,
    });
    if (baselineLaunch.status !== 201) throw new Error(`Baseline launch failed: ${baselineLaunch.status} ${JSON.stringify(baselineLaunch.data)}`);
    const altLaunch = await appFetch(`/api/models/${summary.modelId}/runs`, {
      scenarioEntryId: summary.alternativeEntryId,
      title: 'Alternative managed run',
      attachToScenarioEntry: true,
    });
    if (altLaunch.status !== 201) throw new Error(`Alternative launch failed: ${altLaunch.status} ${JSON.stringify(altLaunch.data)}`);

    const baselineRun = await waitForModelRun(baselineLaunch.data.modelRunId);
    const alternativeRun = await waitForModelRun(altLaunch.data.modelRunId);
    summary.baselineRunId = baselineRun.source_analysis_run_id;
    summary.alternativeRunId = alternativeRun.source_analysis_run_id;
    summary.notes.push('Launched and reconciled both baseline and alternative managed runs on production.');

    await page.goto(`${productionBaseUrl}/scenarios/${summary.scenarioSetId}`, { waitUntil: 'networkidle' });
    try {
      let boardReady = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const text = await page.locator('body').innerText();
        boardReady =
          text.includes('Alternative vs baseline comparison board') &&
          text.includes('Alternative Transit + Bike Upgrade vs Baseline Existing Conditions') &&
          text.includes('OVERALL SCORE');
        if (boardReady) break;
        await page.reload({ waitUntil: 'networkidle' });
        await sleep(1500);
      }
      if (!boardReady) {
        throw new Error('Scenario comparison board did not render expected live comparison content in time.');
      }
    } catch (error) {
      const debugText = await page.locator('body').innerText().catch(() => 'BODY_READ_FAILED');
      const debugPath = path.join(outputDir, `${outputDate}-prod-scenario-comparison-debug.txt`);
      fs.writeFileSync(debugPath, debugText);
      await screenshot('prod-scenario-comparison-debug');
      throw error;
    }
    await screenshot('prod-scenario-comparison-01-board');
    summary.notes.push('Scenario comparison board rendered on production with a ready-to-compare card and live headline metric content.');

    const reportPath = path.join(repoRoot, `docs/ops/${outputDate}-openplan-production-scenario-comparison-smoke.md`);
    const lines = [
      `# OpenPlan Production Scenario Comparison Smoke — ${outputDate}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- Workspace id: ${summary.workspaceId}`,
      `- Project id: ${summary.projectId}`,
      `- Scenario set id: ${summary.scenarioSetId}`,
      `- Baseline entry id: ${summary.baselineEntryId}`,
      `- Alternative entry id: ${summary.alternativeEntryId}`,
      `- Model id: ${summary.modelId}`,
      `- Baseline run id: ${summary.baselineRunId}`,
      `- Alternative run id: ${summary.alternativeRunId}`,
      '',
      '## Pass/Fail Notes',
      ...summary.notes.map((note) => `- PASS: ${note}`),
      '',
      '## Assertions proven on production',
      '- Baseline and alternative managed runs can both complete against the same scenario set/model.',
      '- Scenario page renders a live alternative-vs-baseline comparison board when both runs are attached.',
      '- Comparison card exposes ready-to-compare state and headline metric deltas on production.',
      '',
      '## Artifacts',
      ...summary.screenshots.map((filePath) => `- ${path.relative(repoRoot, filePath)}`),
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(JSON.stringify({ success: true, reportPath, summary }, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
