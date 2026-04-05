const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, loadEnv, repoRoot } = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
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
  const email = `openplan-report-traceability-qa-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}TraceQa`;
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
        purpose: 'openplan-production-report-traceability-smoke',
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
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1600 } }));
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
    await page.goto(`${productionBaseUrl}/reports`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/reports', { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');

    const projectName = `QA Report Traceability Project ${stamp}`;
    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production report traceability smoke project created by automation.',
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

    const campaignTitle = `QA Report Traceability Campaign ${stamp}`;
    await page.locator('#engagement-project').selectOption({ label: projectName });
    await page.locator('#engagement-title').fill(campaignTitle);
    await page.locator('#engagement-type').selectOption('comment_collection');
    await page.locator('#engagement-summary').fill('Production smoke for report detail engagement-source backlink continuity.');
    await Promise.all([
      page.waitForURL(/\/engagement\/[0-9a-f-]+$/i, { timeout: 20000 }),
      page.getByRole('button', { name: /^create campaign$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    ids.campaignId = page.url().split('/').pop() ?? null;
    notes.push(`Created engagement campaign ${campaignTitle}.`);
    await screenshot('prod-report-traceability-01-campaign-detail');

    const categoryLabel = `Traceability ${stamp.slice(11, 19)}`;
    await page.locator('#engagement-category-label').fill(categoryLabel);
    await page.locator('#engagement-category-description').fill('Traceability verification category.');
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

    const itemTitle = `Traceability testimony ${stamp}`;
    await page.locator('#engagement-item-submitter').fill('QA workshop note');
    await page.locator('#engagement-item-title').fill(itemTitle);
    await page.locator('#engagement-item-body').fill('Residents asked for a clearly traceable path from outreach findings into the final report packet.');
    await page.locator('#engagement-item-source').selectOption('meeting');
    await page.locator('#engagement-item-status').selectOption('approved');
    await page.locator('#engagement-item-notes').fill('Approved for production traceability smoke.');
    await page.locator('#engagement-item-latitude').fill('39.1454');
    await page.locator('#engagement-item-longitude').fill('-121.6489');
    await page.getByRole('button', { name: /^add item$/i }).click();
    await page.getByText(itemTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push(`Created approved engagement item ${itemTitle}.`);

    const createHandoffButton = page.getByRole('button', { name: /^create handoff report$/i });
    try {
      await createHandoffButton.waitFor({ timeout: 15000 });
    } catch {
      await page.reload({ waitUntil: 'networkidle' });
      await createHandoffButton.waitFor({ timeout: 15000 });
    }

    await Promise.all([
      page.waitForURL(/\/reports\/[0-9a-f-]+$/i, { timeout: 20000 }),
      createHandoffButton.click(),
    ]);
    await page.waitForLoadState('networkidle');
    ids.reportId = page.url().split('/').pop() ?? null;
    notes.push('Created handoff report from the engagement campaign detail UI.');

    await page.getByText('Engagement source', { exact: true }).waitFor({ timeout: 20000 });
    await page.getByText(campaignTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByRole('link', { name: /Open engagement campaign/i }).waitFor({ timeout: 20000 });

    const link = page.getByRole('link', { name: /Open engagement campaign/i });
    const href = await link.getAttribute('href');
    if (!href || !ids.campaignId || !href.endsWith(`/engagement/${ids.campaignId}`)) {
      throw new Error(`Unexpected engagement backlink href: ${href}`);
    }
    notes.push(`Report detail rendered engagement source card and backlink to ${href}.`);
    await screenshot('prod-report-traceability-02-report-detail');

    await Promise.all([
      page.waitForURL(new RegExp(`/engagement/${ids.campaignId}$`, 'i'), { timeout: 20000 }),
      link.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByText(campaignTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push('Open engagement campaign backlink navigated back to the originating engagement detail surface on production.');
    await screenshot('prod-report-traceability-03-backlink-target');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-report-traceability-smoke.md`);
    const lines = [
      `# OpenPlan Production Report Traceability Smoke — ${datePart}`,
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
      '- Production report detail rendered engagement source provenance card',
      '- Production report detail rendered the Open engagement campaign navigation link',
      '- Production backlink target matched the originating engagement campaign id',
      '- Production backlink click navigated back to the originating engagement campaign detail page',
      '',
      '## Notes',
      '- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.',
      '- Mutations were limited to QA project/campaign/item/report records needed for verification.',
      '- This complements the earlier production engagement-to-report handoff smoke by proving reversible navigation from report detail back to engagement source.',
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
