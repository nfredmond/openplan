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

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function toDateTimeLocal(iso) {
  return new Date(iso).toISOString().slice(0, 16);
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
  const email = `openplan-prod-grants-smoke-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}ProdGrants`;
  const workspaceName = `OpenPlan Prod Grants Smoke ${stamp.slice(11, 19)}`;
  const programTitle = `ATP Grants Smoke ${stamp.slice(11, 19)}`;
  const opportunityTitle = `2027 ATP countywide active transportation call ${stamp.slice(11, 19)}`;
  const closeIso = isoDaysFromNow(7);
  const decisionIso = isoDaysFromNow(5);
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
        purpose: 'openplan-production-grants-registry-smoke',
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
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1800 } }));
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
    await page.goto(`${productionBaseUrl}/sign-in?redirect=%2Fgrants`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
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
    notes.push(`Bootstrapped workspace ${workspaceName}.`);

    const programResult = await appFetch('/api/programs', {
      title: programTitle,
      programType: 'rtip',
      cycleName: 'ATP Cycle 8',
      status: 'assembling',
      fundingClassification: 'discretionary',
      sponsorAgency: 'Caltrans',
      ownerLabel: 'Grant lead',
      cadenceLabel: 'Annual cycle',
      fiscalYearStart: 2027,
      fiscalYearEnd: 2028,
      nominationDueAt: decisionIso,
      adoptionTargetAt: closeIso,
      summary: 'Production smoke program to anchor the grants workspace registry.',
    });
    if (programResult.status !== 201) {
      throw new Error(`Program creation failed: ${programResult.status} ${JSON.stringify(programResult.data)}`);
    }
    ids.programId = programResult.data.programId;
    notes.push(`Created production program ${programTitle}.`);

    await page.goto(`${productionBaseUrl}/grants`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^grants$/i }).waitFor({ timeout: 30000 });
    await page.getByText(/No funding opportunities yet/i).waitFor({ timeout: 30000 });
    notes.push('Grants registry rendered its empty state before the first opportunity was created.');

    await page.locator('#funding-opportunity-title').fill(opportunityTitle);
    await page.locator('#funding-opportunity-program').selectOption(ids.programId);
    await page.locator('#funding-opportunity-status').selectOption('open');
    await page.locator('#funding-opportunity-agency').fill('Caltrans');
    await page.locator('#funding-opportunity-owner').fill('Grant lead');
    await page.locator('#funding-opportunity-cadence').fill('Annual cycle');
    await page.locator('#funding-opportunity-expected-award').fill('500000');
    await page.locator('#funding-opportunity-closes').fill(toDateTimeLocal(closeIso));
    await page.locator('#funding-opportunity-decision').fill(toDateTimeLocal(decisionIso));
    await page.locator('#funding-opportunity-summary').fill('Smoke-tested funding opportunity created from the shared Grants OS surface.');
    await page.getByRole('button', { name: /save funding opportunity/i }).click();

    await page.getByText(/Funding opportunity saved\./i).waitFor({ timeout: 30000 });
    await page.getByRole('heading', { name: opportunityTitle, exact: false }).waitFor({ timeout: 30000 });
    await page.getByText(/Advance near-term funding windows/i).waitFor({ timeout: 30000 });
    notes.push('Created the first funding opportunity from the shared grants surface and confirmed the workspace grants queue surfaced the near-term deadline command.');

    await page.locator('select[id^="funding-decision-"]').first().selectOption('pursue');
    await page.getByPlaceholder('Record why the team chose pursue, monitor, or skip.').first().fill('Smoke proof moved this grant into a real pursue posture from the shared registry.');
    await page.getByRole('button', { name: /save decision/i }).first().click();
    await page.getByText(/Funding decision saved\./i).waitFor({ timeout: 30000 });
    notes.push('Updated the opportunity decision to pursue directly from the grants registry row controls.');

    await screenshot('prod-grants-registry-01-registry');

    const programFundingLink = page.getByRole('link', { name: /Open program funding lane/i }).first();
    await programFundingLink.waitFor({ timeout: 30000 });
    await Promise.all([
      page.waitForURL(new RegExp(`/programs/${ids.programId}#program-funding-opportunities$`, 'i'), { timeout: 30000 }),
      programFundingLink.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { name: /Linked funding opportunities/i }).waitFor({ timeout: 30000 });
    notes.push('The grants registry linked back into the canonical program funding lane.');

    await screenshot('prod-grants-registry-02-program-detail');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-grants-registry-smoke.md`);
    const lines = [
      `# OpenPlan Production Grants Registry Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Program id: ${ids.programId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Production rendered smoke confirms the new `/grants` workspace surface can create a funding opportunity, surface the shared grants queue, update pursue posture, and link back into the canonical funding lane.',
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
  console.error(error);
  process.exitCode = 1;
});
