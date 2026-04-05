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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data, headers: Object.fromEntries(response.headers.entries()) };
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
  const email = `openplan-managed-run-smoke-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}ManagedRun`;
  const summary = {
    createdAt: new Date().toISOString(),
    baseUrl: productionBaseUrl,
    email,
    password,
    projectId: null,
    workspaceId: null,
    scenarioSetId: null,
    baselineEntryId: null,
    alternativeEntryId: null,
    modelId: null,
    modelRunId: null,
    sourceAnalysisRunId: null,
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
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        purpose: 'openplan-production-managed-run-smoke',
        created_by: 'bartholomew',
        created_at: new Date().toISOString(),
      },
    }),
  });
  if (!createUserResult.ok) throw new Error(`Failed to create QA user: ${createUserResult.status} ${JSON.stringify(createUserResult.data)}`);
  summary.userId = createUserResult.data.user?.id ?? null;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const page = await context.newPage();

  async function screenshot(name, targetPage = page) {
    const fileName = `${outputDate}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await targetPage.screenshot({ path: fullPath, fullPage: true });
    summary.screenshots.push(fullPath);
    return fullPath;
  }

  async function appFetch(route, payload, method = payload ? 'POST' : 'GET') {
    return await page.evaluate(
      async ({ route, payload, method }) => {
        const response = await fetch(route, {
          method,
          headers: payload ? { 'Content-Type': 'application/json' } : undefined,
          body: payload ? JSON.stringify(payload) : undefined,
        });
        const text = await response.text();
        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        return { ok: response.ok, status: response.status, data };
      },
      { route, payload, method }
    );
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
    summary.notes.push('Signed into production with dedicated smoke user.');

    const projectName = `Managed Run Smoke Project ${stamp}`;
    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production smoke project for managed model run orchestration.',
      planType: 'corridor_plan',
      deliveryPhase: 'scoping',
      status: 'active',
    });
    if (projectResult.status !== 201) throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    summary.workspaceId = projectResult.data.workspaceId;
    summary.projectId = projectResult.data.projectRecordId;
    summary.notes.push('Created project/workspace via production API.');

    const scenarioResult = await appFetch('/api/scenarios', {
      projectId: summary.projectId,
      title: `Managed Run Smoke Scenario ${stamp}`,
      summary: 'Scenario set used to prove managed model-run orchestration on production.',
      planningQuestion: 'Can a managed model run launch from production UI and attach back to a scenario entry?',
      status: 'active',
    });
    if (scenarioResult.status !== 201) throw new Error(`Scenario set creation failed: ${scenarioResult.status} ${JSON.stringify(scenarioResult.data)}`);
    summary.scenarioSetId = scenarioResult.data.scenarioSetId;
    summary.notes.push('Created scenario set via production API.');

    const baselineEntryResult = await appFetch(`/api/scenarios/${summary.scenarioSetId}/entries`, {
      entryType: 'baseline',
      label: 'Baseline Existing Conditions',
      summary: 'Baseline for managed run smoke.',
      assumptions: {
        analysisQueryText: 'Baseline corridor conditions for Nevada City pilot corridor.',
      },
      status: 'ready',
      sortOrder: 0,
    });
    if (baselineEntryResult.status !== 201) throw new Error(`Baseline entry creation failed: ${baselineEntryResult.status} ${JSON.stringify(baselineEntryResult.data)}`);
    summary.baselineEntryId = baselineEntryResult.data.entryId;

    const alternativeEntryResult = await appFetch(`/api/scenarios/${summary.scenarioSetId}/entries`, {
      entryType: 'alternative',
      label: 'Alternative Protected Bike Lane',
      summary: 'Alternative used for managed run smoke.',
      assumptions: {
        analysisQueryText: 'Evaluate protected bike lane and crossing safety improvements for the same corridor.',
        analysisQuerySuffix: 'Prioritize active transportation access and safety outcomes.',
      },
      status: 'ready',
      sortOrder: 1,
    });
    if (alternativeEntryResult.status !== 201) throw new Error(`Alternative entry creation failed: ${alternativeEntryResult.status} ${JSON.stringify(alternativeEntryResult.data)}`);
    summary.alternativeEntryId = alternativeEntryResult.data.entryId;
    summary.notes.push('Created baseline and alternative scenario entries.');

    const corridorGeojson = {
      type: 'Polygon',
      coordinates: [
        [
          [-121.642, 39.220],
          [-121.631, 39.220],
          [-121.631, 39.229],
          [-121.642, 39.229],
          [-121.642, 39.220],
        ],
      ],
    };

    const modelResult = await appFetch('/api/models', {
      projectId: summary.projectId,
      scenarioSetId: summary.scenarioSetId,
      title: `Managed Run Smoke Model ${stamp}`,
      modelFamily: 'scenario_model',
      status: 'ready_for_review',
      configVersion: 'smoke-v1',
      ownerLabel: 'QA smoke harness',
      assumptionsSummary: 'Uses deterministic corridor backend for production smoke validation.',
      inputSummary: 'Model defaults include query text and corridor geometry.',
      outputSummary: 'Managed run should create linked analysis run and scenario attachment.',
      summary: 'Production smoke model for managed run execution.',
      configJson: {
        runTemplate: {
          queryText: 'Evaluate managed-run smoke corridor conditions for multimodal safety and access.',
          corridorGeojson,
        },
      },
    });
    if (modelResult.status !== 201) throw new Error(`Model creation failed: ${modelResult.status} ${JSON.stringify(modelResult.data)}`);
    summary.modelId = modelResult.data.modelId;
    summary.notes.push('Created model with embedded run template defaults.');
    summary.attachedRunTitle = null;

    await page.goto(`${productionBaseUrl}/models/${summary.modelId}`, { waitUntil: 'networkidle' });
    await page.getByText('Managed scenario → run execution', { exact: true }).waitFor({ timeout: 20000 });
    await page.locator('#managed-run-scenario').selectOption(summary.alternativeEntryId);
    await screenshot('prod-managed-run-01-model-launch-ready');

    const launchResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes(`/api/models/${summary.modelId}/runs`) && response.status() === 201,
      { timeout: 60000 }
    );
    await page.getByRole('button', { name: /Launch managed run/i }).click();
    const launchResponse = await launchResponsePromise;
    const launchPayload = await launchResponse.json();
    summary.modelRunId = launchPayload.modelRunId ?? null;
    summary.sourceAnalysisRunId = launchPayload.runId ?? null;
    summary.notes.push(`Launched managed run via production model detail UI (${summary.modelRunId}).`);

    if (!summary.modelRunId || !summary.sourceAnalysisRunId) {
      throw new Error(`Managed run response missing identifiers: ${JSON.stringify(launchPayload)}`);
    }

    let modelRunRow = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await jsonFetch(`${supabaseUrl}/rest/v1/model_runs?select=id,status,source_analysis_run_id,scenario_entry_id,result_summary_json,error_message&id=eq.${summary.modelRunId}`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
      const rows = Array.isArray(result.data) ? result.data : [];
      modelRunRow = rows[0] ?? null;
      if (modelRunRow?.status === 'succeeded') break;
      if (modelRunRow?.status === 'failed') {
        throw new Error(`Managed model run failed: ${modelRunRow.error_message || 'unknown failure'}`);
      }
      await sleep(1500);
    }

    if (!modelRunRow || modelRunRow.status !== 'succeeded') {
      throw new Error(`Managed model run did not reach succeeded state in time: ${JSON.stringify(modelRunRow)}`);
    }

    const scenarioEntryVerify = await jsonFetch(`${supabaseUrl}/rest/v1/scenario_entries?select=id,attached_run_id,status&id=eq.${summary.alternativeEntryId}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const alternativeRow = Array.isArray(scenarioEntryVerify.data) ? scenarioEntryVerify.data[0] : null;
    if (!alternativeRow || alternativeRow.attached_run_id !== summary.sourceAnalysisRunId) {
      throw new Error(`Scenario entry did not receive managed run attachment: ${JSON.stringify(alternativeRow)}`);
    }

    const attachedRunVerify = await jsonFetch(`${supabaseUrl}/rest/v1/runs?select=id,title&id=eq.${summary.sourceAnalysisRunId}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const attachedRunRow = Array.isArray(attachedRunVerify.data) ? attachedRunVerify.data[0] : null;
    summary.attachedRunTitle = attachedRunRow?.title ?? null;
    summary.notes.push('Scenario entry attachment updated to the launched analysis run.');

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Backed by analysis run', { exact: false }).waitFor({ timeout: 20000 });
    await screenshot('prod-managed-run-02-model-history');

    await page.goto(`${productionBaseUrl}/scenarios/${summary.scenarioSetId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Alternative Protected Bike Lane/i }).waitFor({ timeout: 20000 });
    if (summary.attachedRunTitle) {
      await page.waitForFunction(
        (runTitle) => document.body.innerText.includes(runTitle),
        summary.attachedRunTitle,
        { timeout: 20000 }
      );
    }
    await screenshot('prod-managed-run-03-scenario-entry');

    const reportPath = path.join(repoRoot, `docs/ops/${outputDate}-openplan-production-managed-run-smoke.md`);
    const lines = [
      `# OpenPlan Production Managed Run Smoke — ${outputDate}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- Workspace id: ${summary.workspaceId}`,
      `- Project id: ${summary.projectId}`,
      `- Scenario set id: ${summary.scenarioSetId}`,
      `- Baseline entry id: ${summary.baselineEntryId}`,
      `- Alternative entry id: ${summary.alternativeEntryId}`,
      `- Model id: ${summary.modelId}`,
      `- Managed model run id: ${summary.modelRunId}`,
      `- Linked analysis run id: ${summary.sourceAnalysisRunId}`,
      '',
      '## Pass/Fail Notes',
      ...summary.notes.map((note) => `- PASS: ${note}`),
      '',
      '## Assertions proven on production',
      '- Managed run launcher rendered on model detail page.',
      '- UI launch request returned a real `modelRunId` and linked `runId`.',
      '- `model_runs` row reached `succeeded` on production.',
      '- Scenario entry was automatically updated with the resulting analysis run id.',
      '- Model detail page showed linked run history after refresh.',
      '- Scenario set page showed the scenario entry with run attachment state after launch.',
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
