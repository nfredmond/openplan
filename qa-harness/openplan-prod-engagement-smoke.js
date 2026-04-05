const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getOutputDir, loadEnv, repoRoot } = require('./harness-env');

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
  const email = `openplan-engagement-qa-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}EngagementQa`;

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
        purpose: 'openplan-production-engagement-smoke',
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
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
    const redirectedUrl = page.url();
    if (!redirectedUrl.includes('/sign-in') || !redirectedUrl.includes('redirect=%2Fengagement')) {
      throw new Error(`Expected signed-out redirect to sign-in with redirect param, got ${redirectedUrl}`);
    }
    notes.push('Signed-out redirect continuity passed for /engagement → /sign-in?redirect=%2Fengagement.');
    await screenshot('prod-engagement-smoke-01-signed-out-redirect');

    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/engagement', { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');

    const signedInBody = await page.locator('body').innerText();
    if (/workspace/i.test(signedInBody) && /not been provisioned/i.test(signedInBody)) {
      notes.push('Signed-in unprovisioned engagement state rendered explicit workspace-membership guidance.');
      await screenshot('prod-engagement-smoke-02-unprovisioned-engagement');
    } else if (/campaigns now have a real operator registry/i.test(signedInBody) || /engagement catalog live/i.test(signedInBody)) {
      notes.push('Signed-in user landed directly on the live Engagement catalog surface after redirect.');
      await screenshot('prod-engagement-smoke-02-engagement-catalog-after-login');
    } else {
      throw new Error('Unexpected post-login Engagement state; neither workspace-required nor live catalog surface was detected.');
    }

    const projectName = `QA Engagement Project ${stamp}`;
    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production engagement smoke project created by automation.',
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

    const campaignTitle = `QA Downtown Safety Campaign ${stamp}`;
    const campaignSummary = 'Production browser smoke for engagement intake, moderation, and traceability.';

    await page.locator('#engagement-project').selectOption({ label: projectName });
    await page.locator('#engagement-title').fill(campaignTitle);
    await page.locator('#engagement-type').selectOption('map_feedback');
    await page.locator('#engagement-summary').fill(campaignSummary);
    await Promise.all([
      page.waitForURL(/\/engagement\/[0-9a-f-]+$/i, { timeout: 20000 }),
      page.getByRole('button', { name: /^create campaign$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');

    ids.campaignId = page.url().split('/').pop() ?? null;
    notes.push(`Created engagement campaign ${campaignTitle} from the live catalog UI.`);
    await page.getByText(campaignTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(projectName, { exact: false }).first().waitFor({ timeout: 20000 });
    await screenshot('prod-engagement-smoke-03-campaign-detail');

    const categoryLabel = `Safety ${stamp.slice(11, 19)}`;
    await page.locator('#engagement-category-label').fill(categoryLabel);
    await page.locator('#engagement-category-description').fill('Crossings, driver behavior, and conflict points.');
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
    await page.waitForLoadState('networkidle');
    await page.locator('#engagement-item-category').selectOption({ label: categoryLabel });
    notes.push(`Added category ${categoryLabel} from the live detail UI and confirmed it appeared in the intake selector.`);
    await screenshot('prod-engagement-smoke-04-category-created');

    const itemTitle = `Unsafe crossing near school pickup ${stamp}`;
    await page.locator('#engagement-item-submitter').fill('Workshop attendee note');
    await page.locator('#engagement-item-title').fill(itemTitle);
    await page.locator('#engagement-item-body').fill(
      'Parents reported long crossing delays and poor yielding behavior during afternoon pickup. Requested curb extensions and stronger daylighting.'
    );
    await page.locator('#engagement-item-source').selectOption('meeting');
    await page.locator('#engagement-item-status').selectOption('pending');
    await page.locator('#engagement-item-notes').fill('Entered during production smoke to prove moderation lane continuity.');
    await page.locator('#engagement-item-latitude').fill('39.1454');
    await page.locator('#engagement-item-longitude').fill('-121.6489');
    await page.getByRole('button', { name: /^add item$/i }).click();
    await page.getByText(itemTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push(`Created intake item ${itemTitle} from the campaign detail UI.`);
    await screenshot('prod-engagement-smoke-05-item-created');

    await page.getByPlaceholder('Title, body, submitter, source').fill('school pickup');
    await page.getByText(itemTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push('Registry search accepted query input and kept the created intake item visible.');

    await page.getByRole('button', { name: /^approve$/i }).first().click();
    await page.getByText(/approved/i).first().waitFor({ timeout: 20000 });
    notes.push('Moderation quick action updated the created intake item to approved from the live registry UI.');
    await screenshot('prod-engagement-smoke-06-item-approved');

    await page.locator('#campaign-control-status').selectOption('active');
    await page.locator('#campaign-control-summary').fill(`${campaignSummary} Campaign moved to active after first verified intake item.`);
    await page.getByRole('button', { name: /^save campaign$/i }).click();
    await page.getByText(/active/i).first().waitFor({ timeout: 20000 });
    notes.push('Campaign controls saved active status and refreshed the detail surface without error.');
    await screenshot('prod-engagement-smoke-07-campaign-active');

    await page.goto(`${productionBaseUrl}/engagement`, { waitUntil: 'networkidle' });
    const campaignRow = page.locator('.module-record-row').filter({ hasText: campaignTitle }).first();
    await campaignRow.waitFor({ timeout: 20000 });
    const campaignRowText = await campaignRow.innerText();
    if (!campaignRowText.toLowerCase().includes(projectName.toLowerCase())) {
      throw new Error(`Engagement catalog row for ${campaignTitle} did not expose linked project ${projectName}. Row text: ${campaignRowText}`);
    }
    notes.push('Engagement catalog listed the created campaign with linked project context after save/refresh.');
    await screenshot('prod-engagement-smoke-08-catalog-list');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-engagement-smoke.md`);
    const lines = [
      `# OpenPlan Production Engagement Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Campaign id: ${ids.campaignId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((file) => `- docs/ops/${datePart}-test-output/${file}`),
      '',
      '## Coverage',
      '- Signed-out redirect continuity for Engagement',
      '- Sign-in return-path behavior into explicit workspace-required or live catalog state',
      '- Workspace bootstrap / project creation via live authenticated session',
      '- Engagement catalog create flow through the browser UI',
      '- Campaign detail load with linked project traceability',
      '- Category creation through the browser UI',
      '- Intake item creation through the browser UI',
      '- Registry search interaction',
      '- Moderation quick-action approval through the browser UI',
      '- Campaign metadata/status update through the browser UI',
      '- Catalog refresh showing the created linked campaign',
      '',
      '## Notes',
      '- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.',
      '- Mutations were limited to QA project/campaign/category/item records needed for verification.',
      '- Follow-up cleanup/archival of QA records can be done later if desired.',
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
