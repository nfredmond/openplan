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

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment keys');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `openplan-engagement-report-qa-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}EngageReportQa`;
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
        purpose: 'openplan-production-engagement-report-handoff-smoke',
        created_by: 'bartholomew',
        created_at: new Date().toISOString(),
      },
    }),
  });

  if (!createUserResult.ok) {
    throw new Error(`Failed to create QA user: ${createUserResult.status} ${JSON.stringify(createUserResult.data)}`);
  }

  ids.userId = createUserResult.data.user?.id ?? null;
  notes.push(`Created QA auth user ${email}.`);

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

  async function appFetch(route, payload) {
    return await page.evaluate(
      async ({ route, payload }) => {
        const response = await fetch(route, {
          method: payload ? 'POST' : 'GET',
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
      { route, payload }
    );
  }

  try {
    await page.goto(`${productionBaseUrl}/engagement`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/engagement', { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');

    const projectName = `QA Engagement Report Project ${stamp}`;
    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production engagement-to-report handoff smoke project created by automation.',
      planType: 'corridor_plan',
      deliveryPhase: 'scoping',
      status: 'active',
    });
    if (projectResult.status !== 201) {
      throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    }
    ids.workspaceId = projectResult.data.workspaceId;
    ids.projectId = projectResult.data.projectRecordId;
    notes.push(`Created project/workspace via production API: ${projectName}.`);

    await page.goto(`${productionBaseUrl}/engagement`, { waitUntil: 'networkidle' });
    await page.locator('#engagement-title').waitFor({ timeout: 20000 });

    const campaignTitle = `QA Engagement Report Campaign ${stamp}`;
    await page.locator('#engagement-project').selectOption({ label: projectName });
    await page.locator('#engagement-title').fill(campaignTitle);
    await page.locator('#engagement-type').selectOption('comment_collection');
    await page.locator('#engagement-summary').fill('Production smoke for engagement-to-report handoff continuity.');
    await Promise.all([
      page.waitForURL(/\/engagement\/[0-9a-f-]+$/i, { timeout: 20000 }),
      page.getByRole('button', { name: /^create campaign$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    ids.campaignId = page.url().split('/').pop() ?? null;
    notes.push(`Created engagement campaign ${campaignTitle}.`);
    await screenshot('prod-engagement-report-handoff-01-campaign-detail');

    const categoryLabel = `Safety ${stamp.slice(11, 19)}`;
    await page.locator('#engagement-category-label').fill(categoryLabel);
    await page.locator('#engagement-category-description').fill('Crossings and speed management.');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/engagement/campaigns/${ids.campaignId}/categories`) &&
          response.ok(),
        { timeout: 20000 }
      ),
      page.getByRole('button', { name: /^add category$/i }).click(),
    ]);
    await page.locator('#engagement-item-category').selectOption({ label: categoryLabel });

    const itemTitle = `Verified crossing concern ${stamp}`;
    await page.locator('#engagement-item-submitter').fill('Workshop note');
    await page.locator('#engagement-item-title').fill(itemTitle);
    await page.locator('#engagement-item-body').fill('Residents reported recurring near-miss conflicts and requested daylighting plus curb extensions.');
    await page.locator('#engagement-item-source').selectOption('meeting');
    await page.locator('#engagement-item-status').selectOption('approved');
    await page.locator('#engagement-item-notes').fill('Approved during production handoff smoke.');
    await page.locator('#engagement-item-latitude').fill('39.1454');
    await page.locator('#engagement-item-longitude').fill('-121.6489');
    await page.getByRole('button', { name: /^add item$/i }).click();
    await page.getByText(itemTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push(`Created approved engagement item ${itemTitle}.`);
    await screenshot('prod-engagement-report-handoff-02-item-ready');

    const maybeCreateButton = page.getByRole('button', { name: /^create handoff report$/i });
    try {
      await maybeCreateButton.waitFor({ timeout: 15000 });
    } catch {
      await page.reload({ waitUntil: 'networkidle' });
      await maybeCreateButton.waitFor({ timeout: 15000 });
    }

    await Promise.all([
      page.waitForURL(/\/reports\/[0-9a-f-]+$/i, { timeout: 20000 }),
      maybeCreateButton.click(),
    ]);
    await page.waitForLoadState('networkidle');
    ids.reportId = page.url().split('/').pop() ?? null;
    notes.push('Created handoff report from the engagement campaign detail UI.');
    await page.getByText(/Engagement campaign summary/i).first().waitFor({ timeout: 20000 });
    await screenshot('prod-engagement-report-handoff-03-report-detail');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/reports/${ids.reportId}/generate`) &&
          response.ok(),
        { timeout: 30000 }
      ),
      page.getByRole('button', { name: /generate html packet/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByText(/Latest HTML artifact/i).waitFor({ timeout: 30000 });

    const iframe = page.locator('iframe[title="Latest report artifact preview"]');
    await iframe.waitFor({ timeout: 30000 });
    const srcDoc = (await iframe.getAttribute('srcdoc')) || '';
    if (!srcDoc.includes(campaignTitle) || !srcDoc.includes('Engagement campaign summary')) {
      throw new Error('Generated report artifact did not include expected engagement handoff content.');
    }
    notes.push('Generated HTML packet and verified the artifact preview included the engagement campaign summary content.');
    await screenshot('prod-engagement-report-handoff-04-generated-artifact');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-engagement-report-handoff-smoke.md`);
    const lines = [
      `# OpenPlan Production Engagement Report Handoff Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Campaign id: ${ids.campaignId ?? 'unknown'}`,
      `- Report id: ${ids.reportId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((file) => `- docs/ops/${datePart}-test-output/${file}`),
      '',
      '## Coverage',
      '- Engagement campaign creation on production',
      '- Category + approved intake item creation on production',
      '- Handoff report creation from engagement campaign detail',
      '- Report detail load with engagement section present',
      '- HTML packet generation on production',
      '- Generated artifact preview contains engagement campaign summary content',
      '',
      '## Notes',
      '- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.',
      '- Mutations were limited to QA project/campaign/item/report records needed for verification.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));

    console.log(JSON.stringify({ success: true, reportPath, artifacts, notes, ids, email }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
