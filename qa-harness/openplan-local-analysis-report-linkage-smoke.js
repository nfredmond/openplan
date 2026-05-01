const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, loadEnv, repoRoot } = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3000';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${expected}, received ${actual ?? 'null'}.`);
  }
}

function firstRow(result, label) {
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) {
    throw new Error(`No ${label} row returned: ${JSON.stringify(result.data)}`);
  }
  return row;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl)) {
    throw new Error(`Local analysis report linkage smoke refuses non-local base URLs. Received ${baseUrl}.`);
  }

  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment keys');
  }

  const restHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  async function restSelect(table, params) {
    const query = new URLSearchParams(params);
    return jsonFetch(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, {
      headers: restHeaders,
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = stamp.slice(11, 19).replace(/-/g, '');
  const email = `openplan-local-analysis-linkage-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}AnalysisLink`;
  const projectName = `Local Analysis Linkage Smoke ${suffix}`;
  const scenarioTitle = `Local Corridor Scenario Set ${suffix}`;
  const modelTitle = `Local Corridor Analysis Model ${suffix}`;
  const alternativeLabel = `Safety access alternative ${suffix}`;
  const reportTitle = `Local Analysis Summary Packet ${suffix}`;
  const queryText = `Evaluate the ${suffix} school access corridor for multimodal safety, equity, and transit-access benefit.`;
  const artifacts = [];
  const notes = [];
  const ids = {};

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

  const createUserResult = await jsonFetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      ...restHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        purpose: 'openplan-local-analysis-report-linkage-smoke',
        created_by: 'bartholomew',
        created_at: new Date().toISOString(),
      },
    }),
  });

  if (!createUserResult.ok) {
    throw new Error(`Failed to create QA user: ${createUserResult.status} ${JSON.stringify(createUserResult.data)}`);
  }

  ids.userId = createUserResult.data.user?.id ?? createUserResult.data.id ?? null;
  notes.push(`Created QA auth user ${email}.`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1700 } }));
  const page = await context.newPage();

  async function screenshot(name) {
    const fileName = `${datePart}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await page.screenshot({ path: fullPath, fullPage: true });
    artifacts.push(fileName);
    return fileName;
  }

  async function appFetch(route, payload, method = payload ? 'POST' : 'GET') {
    return page.evaluate(
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
    await page.goto(`${baseUrl}/models`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    notes.push('Signed into the local app successfully.');

    const projectResult = await appFetch('/api/projects', {
      projectName,
      plan: 'pilot',
      planType: 'corridor_plan',
      deliveryPhase: 'analysis',
      status: 'active',
      summary: 'Local analysis-flow proof project for managed corridor run output and report linkage.',
    });
    if (projectResult.status !== 201) {
      throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    }
    ids.workspaceId = projectResult.data.workspaceId;
    ids.projectId = projectResult.data.projectRecordId;
    notes.push(`Created project workspace ${projectName}.`);

    const scenarioResult = await appFetch('/api/scenarios', {
      projectId: ids.projectId,
      title: scenarioTitle,
      summary: 'Local analysis-flow proof scenario set.',
      planningQuestion: 'Can a corridor model run produce output and carry that output into a report packet?',
      status: 'active',
    });
    if (scenarioResult.status !== 201) {
      throw new Error(`Scenario set creation failed: ${scenarioResult.status} ${JSON.stringify(scenarioResult.data)}`);
    }
    ids.scenarioSetId = scenarioResult.data.scenarioSetId;
    notes.push('Created scenario set for managed-run attachment.');

    const baselineEntryResult = await appFetch(`/api/scenarios/${ids.scenarioSetId}/entries`, {
      entryType: 'baseline',
      label: 'Existing conditions baseline',
      summary: 'Baseline context for local analysis-linkage proof.',
      assumptions: {
        analysisQueryText: 'Baseline school access corridor conditions.',
      },
      status: 'ready',
      sortOrder: 0,
    });
    if (baselineEntryResult.status !== 201) {
      throw new Error(`Baseline entry creation failed: ${baselineEntryResult.status} ${JSON.stringify(baselineEntryResult.data)}`);
    }
    ids.baselineEntryId = baselineEntryResult.data.entryId;

    const alternativeEntryResult = await appFetch(`/api/scenarios/${ids.scenarioSetId}/entries`, {
      entryType: 'alternative',
      label: alternativeLabel,
      summary: 'Alternative with school access and crossing safety improvements.',
      assumptions: {
        analysisQueryText: queryText,
        analysisQuerySuffix: 'Preserve evidence for a report-linked planning packet.',
      },
      status: 'ready',
      sortOrder: 1,
    });
    if (alternativeEntryResult.status !== 201) {
      throw new Error(`Alternative entry creation failed: ${alternativeEntryResult.status} ${JSON.stringify(alternativeEntryResult.data)}`);
    }
    ids.alternativeEntryId = alternativeEntryResult.data.entryId;
    notes.push('Created baseline and alternative scenario entries.');

    const modelResult = await appFetch('/api/models', {
      projectId: ids.projectId,
      scenarioSetId: ids.scenarioSetId,
      title: modelTitle,
      modelFamily: 'scenario_model',
      status: 'ready_for_review',
      configVersion: 'local-smoke-v1',
      ownerLabel: 'QA smoke harness',
      assumptionsSummary: 'Uses deterministic corridor backend for local workflow proof.',
      inputSummary: 'Model defaults include query text and corridor geometry.',
      outputSummary: 'Managed run should create linked analysis run, scenario attachment, and report linkage.',
      summary: 'Local analysis-flow proof model.',
      configJson: {
        runTemplate: {
          queryText,
          corridorGeojson,
        },
      },
    });
    if (modelResult.status !== 201) {
      throw new Error(`Model creation failed: ${modelResult.status} ${JSON.stringify(modelResult.data)}`);
    }
    ids.modelId = modelResult.data.modelId;
    notes.push('Created model with embedded corridor run-template defaults.');

    await page.goto(`${baseUrl}/models/${ids.modelId}`, { waitUntil: 'networkidle' });
    await page.getByText('Managed scenario → run execution', { exact: true }).waitFor({ timeout: 20000 });
    await page.locator('#managed-run-scenario').selectOption(ids.alternativeEntryId);
    await screenshot('local-analysis-report-linkage-01-model-launch-ready');

    const launchResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(`/api/models/${ids.modelId}/runs`) &&
        response.ok(),
      { timeout: 90000 }
    );
    await page.getByRole('button', { name: /Launch managed run/i }).click();
    const launchResponse = await launchResponsePromise;
    const launchPayload = await launchResponse.json();
    ids.modelRunId = launchPayload.modelRunId ?? null;
    ids.sourceAnalysisRunId = launchPayload.runId ?? null;
    if (!ids.modelRunId || !ids.sourceAnalysisRunId) {
      throw new Error(`Managed run response missing identifiers: ${JSON.stringify(launchPayload)}`);
    }
    notes.push('Launched a managed deterministic corridor run from the model detail UI.');

    let modelRunRow = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await restSelect('model_runs', {
        select: 'id,status,source_analysis_run_id,scenario_entry_id,result_summary_json,error_message',
        id: `eq.${ids.modelRunId}`,
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
    assertEqual(modelRunRow.source_analysis_run_id, ids.sourceAnalysisRunId, 'Model run source analysis run drifted');
    assertEqual(modelRunRow.scenario_entry_id, ids.alternativeEntryId, 'Model run scenario entry drifted');
    if (!modelRunRow.result_summary_json?.runId) {
      throw new Error(`Model run did not persist result summary JSON: ${JSON.stringify(modelRunRow.result_summary_json)}`);
    }
    notes.push('Verified model_runs reached succeeded with source analysis run and result summary.');

    const scenarioEntry = firstRow(
      await restSelect('scenario_entries', {
        select: 'id,attached_run_id,status',
        id: `eq.${ids.alternativeEntryId}`,
      }),
      'scenario entry after managed run'
    );
    assertEqual(scenarioEntry.attached_run_id, ids.sourceAnalysisRunId, 'Scenario entry was not attached to the source analysis run');
    notes.push('Verified scenario entry was automatically attached to the generated analysis run.');

    const sourceRun = firstRow(
      await restSelect('runs', {
        select: 'id,title,query_text,metrics,summary_text',
        id: `eq.${ids.sourceAnalysisRunId}`,
      }),
      'source analysis run'
    );
    ids.sourceAnalysisRunTitle = sourceRun.title;
    if (!sourceRun.metrics || !sourceRun.summary_text) {
      throw new Error(`Source analysis run did not persist metrics and summary: ${JSON.stringify(sourceRun)}`);
    }
    notes.push(`Verified source analysis run output persisted as ${sourceRun.title}.`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Backed by analysis run', { exact: false }).waitFor({ timeout: 20000 });
    await page.getByText(ids.sourceAnalysisRunId, { exact: false }).first().waitFor({ timeout: 20000 });
    await screenshot('local-analysis-report-linkage-02-model-history');

    await page.goto(`${baseUrl}/explore?runId=${ids.sourceAnalysisRunId}#analysis-run-history`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Corridor analysis workspace/i }).waitFor({ timeout: 30000 });
    await page.getByRole('heading', { name: /Analysis run history/i }).waitFor({ timeout: 30000 });
    await page.getByText(ids.sourceAnalysisRunTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    notes.push('Verified Analysis Studio can deep-link back to the generated run output.');
    await screenshot('local-analysis-report-linkage-03-analysis-studio-run');

    const reportResult = await appFetch('/api/reports', {
      projectId: ids.projectId,
      reportType: 'analysis_summary',
      title: reportTitle,
      summary: 'Local analysis-flow proof packet linked to the managed corridor run output.',
      runIds: [ids.sourceAnalysisRunId],
    });
    if (reportResult.status !== 201) {
      throw new Error(`Analysis report creation failed: ${reportResult.status} ${JSON.stringify(reportResult.data)}`);
    }
    ids.reportId = reportResult.data.reportId;
    notes.push('Created an analysis summary report linked to the generated run.');

    const reportRun = firstRow(
      await restSelect('report_runs', {
        select: 'id,report_id,run_id,sort_order',
        report_id: `eq.${ids.reportId}`,
        run_id: `eq.${ids.sourceAnalysisRunId}`,
      }),
      'report run link'
    );
    ids.reportRunId = reportRun.id;
    assertEqual(reportRun.sort_order, 0, 'Report run link sort order drifted');
    notes.push('Verified durable report_runs linkage between the report and source analysis run.');

    await page.goto(`${baseUrl}/reports/${ids.reportId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: reportTitle, exact: false }).waitFor({ timeout: 20000 });
    await page.getByText(ids.sourceAnalysisRunTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(/Linked runs/i).first().waitFor({ timeout: 20000 });
    await screenshot('local-analysis-report-linkage-04-report-detail');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/reports/${ids.reportId}/generate`) &&
          response.ok(),
        { timeout: 30000 }
      ),
      page.getByRole('button', { name: /Generate HTML packet/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByText(/Latest HTML artifact/i).waitFor({ timeout: 30000 });

    const iframe = page.locator('iframe[title="Latest report artifact preview"]');
    await iframe.waitFor({ timeout: 30000 });
    const srcDoc = (await iframe.getAttribute('srcdoc')) || '';
    for (const expected of [
      reportTitle,
      ids.sourceAnalysisRunTitle,
      'Selected run summaries',
      'Analysis query',
      queryText,
    ]) {
      if (!srcDoc.includes(expected)) {
        throw new Error(`Generated analysis report artifact did not include expected content: ${expected}`);
      }
    }
    notes.push('Generated an HTML packet and verified the linked run summary/query in the artifact preview.');
    await screenshot('local-analysis-report-linkage-05-generated-artifact');

    const artifactRow = firstRow(
      await restSelect('report_artifacts', {
        select: 'id,artifact_kind,metadata_json,created_at',
        report_id: `eq.${ids.reportId}`,
        order: 'created_at.desc',
        limit: '1',
      }),
      'analysis report artifact'
    );
    ids.artifactId = artifactRow.id;
    assertEqual(artifactRow.artifact_kind, 'html', 'Generated report artifact kind drifted');
    if (artifactRow.metadata_json?.sourceContext?.linkedRunCount !== 1) {
      throw new Error(`Report artifact source context did not preserve linked run count: ${JSON.stringify(artifactRow.metadata_json?.sourceContext)}`);
    }
    notes.push('Verified artifact source context preserved linked analysis-run count.');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-analysis-report-linkage-smoke.md`);
    const lines = [
      `# OpenPlan Local Analysis Report Linkage Smoke — ${datePart}`,
      '',
      `- Base URL: ${baseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Scenario set id: ${ids.scenarioSetId ?? 'unknown'}`,
      `- Baseline entry id: ${ids.baselineEntryId ?? 'unknown'}`,
      `- Alternative entry id: ${ids.alternativeEntryId ?? 'unknown'}`,
      `- Model id: ${ids.modelId ?? 'unknown'}`,
      `- Managed model run id: ${ids.modelRunId ?? 'unknown'}`,
      `- Source analysis run id: ${ids.sourceAnalysisRunId ?? 'unknown'}`,
      `- Source analysis run title: ${ids.sourceAnalysisRunTitle ?? 'unknown'}`,
      `- Report id: ${ids.reportId ?? 'unknown'}`,
      `- Report run link id: ${ids.reportRunId ?? 'unknown'}`,
      `- Artifact id: ${ids.artifactId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Local rendered/API smoke confirms the Analysis flow from corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, analysis-summary report linkage, generated HTML artifact, and artifact source-context traceability.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(JSON.stringify({ reportPath, artifacts, ids, notes }, null, 2));
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
