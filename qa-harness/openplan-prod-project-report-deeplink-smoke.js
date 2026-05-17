const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOpenplanBaseUrl, getOutputDir, loadEnv, repoRoot } = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const productionBaseUrl = getOpenplanBaseUrl();

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

function expectedReportHref(reportId, freshnessLabel) {
  if (/refresh recommended/i.test(freshnessLabel || '')) {
    return `/reports/${reportId}#drift-since-generation`;
  }
  if (/no packet/i.test(freshnessLabel || '')) {
    return `/reports/${reportId}#report-controls`;
  }
  return `/reports/${reportId}#packet-release-review`;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment keys');
  }
  if (/vercel\.app/i.test(productionBaseUrl) && /^http:\/\/127\.0\.0\.1|^http:\/\/localhost/i.test(supabaseUrl)) {
    throw new Error('Production smoke requires production Supabase credentials. Run with OPENPLAN_ENV_PATH=openplan/.env.production.local or export production env vars.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortStamp = stamp.slice(11, 19);
  const email = `openplan-prod-project-report-link-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}ProjectReportLink`;
  const workspaceName = `OpenPlan Prod Project Report Link Smoke ${shortStamp}`;
  const projectName = `Project Detail Report Link Smoke ${shortStamp}`;
  const reportTitle = `Project Detail Supported Report Packet ${shortStamp}`;
  const artifacts = [];
  const notes = [];
  const ids = {};

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
        purpose: 'openplan-production-project-report-deeplink-smoke',
        created_by: 'bartholomew',
        created_at: new Date().toISOString(),
      },
    }),
  });

  if (!createUserResult.ok) {
    throw new Error(`Failed to create QA user: ${createUserResult.status} ${JSON.stringify(createUserResult.data)}`);
  }
  ids.userId = createUserResult.data.user?.id ?? createUserResult.data.id ?? null;
  notes.push(`Created bounded QA auth user ${email}.`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1500 } }));
  const page = await context.newPage();

  async function screenshot(name) {
    const fileName = `${datePart}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await page.screenshot({ path: fullPath, fullPage: true });
    artifacts.push(fileName);
    return fileName;
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
    await page.goto(`${productionBaseUrl}/projects`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    try {
      await page.waitForFunction(() => !window.location.pathname.startsWith('/sign-in'), null, { timeout: 30000 });
    } catch (error) {
      const alertText = await page.getByRole('alert').textContent().catch(() => null);
      throw new Error(`Sign-in did not leave /sign-in. ${alertText ? `Page alert: ${alertText}` : 'No page alert was visible.'}`);
    }
    await page.waitForLoadState('networkidle');
    notes.push('Signed into production successfully.');

    const bootstrapResult = await appFetch('/api/workspaces/bootstrap', {
      workspaceName,
      plan: 'pilot',
    });
    if (!bootstrapResult.ok) {
      throw new Error(`Workspace bootstrap failed: ${bootstrapResult.status} ${JSON.stringify(bootstrapResult.data)}`);
    }
    ids.workspaceId = bootstrapResult.data.workspaceId;
    notes.push(`Bootstrapped isolated QA workspace ${workspaceName}.`);

    const createProjectResult = await jsonFetch(`${supabaseUrl}/rest/v1/projects?select=id,name`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        workspace_id: ids.workspaceId,
        name: projectName,
        summary: 'Bounded production smoke project proving the supported project-detail report card and deep-link path.',
        status: 'active',
        plan_type: 'corridor_plan',
        delivery_phase: 'scoping',
        created_by: ids.userId,
      }),
    });
    if (!createProjectResult.ok) {
      throw new Error(`Project seed failed: ${createProjectResult.status} ${JSON.stringify(createProjectResult.data)}`);
    }
    const createdProject = Array.isArray(createProjectResult.data) ? createProjectResult.data[0] : createProjectResult.data;
    ids.projectId = createdProject?.id ?? null;
    if (!ids.projectId) {
      throw new Error(`Project seed returned no project id: ${JSON.stringify(createProjectResult.data)}`);
    }
    notes.push(`Seeded project ${projectName}.`);

    const reportResult = await appFetch('/api/reports', {
      projectId: ids.projectId,
      reportType: 'project_status',
      title: reportTitle,
    });
    if (reportResult.status !== 201) {
      throw new Error(`Project report creation failed: ${reportResult.status} ${JSON.stringify(reportResult.data)}`);
    }
    ids.reportId = reportResult.data.reportId ?? null;
    if (!ids.reportId) {
      throw new Error(`Project report creation returned no report id: ${JSON.stringify(reportResult.data)}`);
    }
    notes.push(`Created project-linked report ${reportTitle}.`);

    const generateResult = await appFetch(`/api/reports/${ids.reportId}/generate`, { format: 'html' });
    if (!generateResult.ok) {
      throw new Error(`Project report generation failed: ${generateResult.status} ${JSON.stringify(generateResult.data)}`);
    }
    notes.push('Generated a real report artifact so the project card is a supported packet path, not a no-packet placeholder.');

    await page.goto(`${productionBaseUrl}/projects/${ids.projectId}#project-reporting`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Packet freshness and regeneration cues/i }).waitFor({ timeout: 30000 });
    await page.getByText(reportTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.getByText(/Project packet queue/i).first().waitFor({ timeout: 30000 });
    await page.getByText(/Recent report records/i).first().waitFor({ timeout: 30000 });

    const supportedReportHrefPattern = new RegExp(`^/reports/${ids.reportId}#(packet-release-review|drift-since-generation|report-controls)$`);

    const queueLink = page
      .locator('a')
      .filter({ has: page.getByText(new RegExp(reportTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) })
      .first();
    await queueLink.waitFor({ timeout: 30000 });
    const queueHref = await queueLink.getAttribute('href');
    if (!queueHref || !supportedReportHrefPattern.test(queueHref)) {
      throw new Error(`Project packet queue did not target a supported report detail anchor for the seeded report. Received ${queueHref || 'empty'}`);
    }

    const recentReportLink = page.locator(`a#project-report-${ids.reportId}`).first();
    await recentReportLink.waitFor({ timeout: 30000 });
    const recentReportHref = await recentReportLink.getAttribute('href');
    if (!recentReportHref || !supportedReportHrefPattern.test(recentReportHref)) {
      throw new Error(`Project recent report card did not target a supported report detail anchor for the seeded report. Received ${recentReportHref || 'empty'}`);
    }
    if (recentReportHref !== queueHref) {
      throw new Error(`Project packet queue and recent report card disagreed on the supported report detail anchor. Queue ${queueHref}; recent card ${recentReportHref}.`);
    }
    const verifiedAnchor = recentReportHref.split('#')[1];
    notes.push(`Project detail rendered both the Project packet queue row and recent report card with href ${recentReportHref}.`);
    await screenshot('prod-project-report-deeplink-01-project-detail');

    await Promise.all([
      page.waitForURL(new RegExp(`${recentReportHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), { timeout: 30000 }),
      recentReportLink.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByText(reportTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.locator(`#${verifiedAnchor}`).waitFor({ timeout: 30000 });
    notes.push(`Clicking the project report card landed on the supported report detail #${verifiedAnchor} packet-work anchor.`);
    await screenshot('prod-project-report-deeplink-02-report-detail');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-project-report-deeplink-smoke.md`);
    const lines = [
      `# OpenPlan Production Project Report Deep-Link Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Report id: ${ids.reportId ?? 'unknown'}`,
      `- Verified href: ${recentReportHref}`,
      `- Verified anchor: #${verifiedAnchor}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Production authenticated smoke proves the supported project-detail report packet path: project report queue/card links deep-link directly into a report detail packet-work anchor. It does not rely on dashboard or shared runtime-cue assumptions.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(JSON.stringify({ reportPath, artifacts, ids, verifiedHref: recentReportHref, verifiedAnchor, notes }, null, 2));
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
