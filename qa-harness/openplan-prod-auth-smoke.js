const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions } = require('./harness-env');

const repoRoot = path.resolve(__dirname, '..');
const appRoot = path.join(repoRoot, 'openplan');
const datePart = new Date().toISOString().slice(0, 10);
const outputDir = path.join(repoRoot, `docs/ops/${datePart}-test-output`);
const productionBaseUrl = process.env.OPENPLAN_BASE_URL || 'https://openplan-zeta.vercel.app';

function readEnv(filePath) {
  const env = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const rawValue = line.slice(idx + 1).trim();
    const value = rawValue.replace(/^(["'])(.*)\1$/, '$2');
    env[key] = value;
  }
  return env;
}

function resolveEnvPath() {
  const candidates = [
    process.env.OPENPLAN_ENV_PATH,
    path.join(appRoot, '.env.local'),
    path.join(repoRoot, '.env.local'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadEnv() {
  const resolvedPath = resolveEnvPath();
  if (!resolvedPath) {
    return { env: { ...process.env }, envPath: 'process.env' };
  }

  return {
    env: {
      ...readEnv(resolvedPath),
      ...process.env,
    },
    envPath: resolvedPath,
  };
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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

  const { env, envPath } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment keys');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `openplan-qa-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}Qa`;

  const artifacts = [];
  const notes = [`Loaded environment from ${envPath}.`];
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
        purpose: 'openplan-production-authenticated-smoke',
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
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1200 } }));
  const page = await context.newPage();

  async function screenshot(name) {
    const fileName = `${datePart}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await page.screenshot({ path: fullPath, fullPage: true });
    artifacts.push(fileName);
    return fileName;
  }

  async function appFetch(route, payload) {
    return await page.evaluate(async ({ route, payload }) => {
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
    }, { route, payload });
  }

  try {
    await page.goto(`${productionBaseUrl}/models`, { waitUntil: 'networkidle' });
    const redirectedUrl = page.url();
    if (!redirectedUrl.includes('/sign-in') || !redirectedUrl.includes('redirect=%2Fmodels')) {
      throw new Error(`Expected signed-out redirect to sign-in with redirect param, got ${redirectedUrl}`);
    }
    notes.push('Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.');
    await screenshot('prod-auth-smoke-01-signed-out-redirect');

    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/models', { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');

    const bodyAfterLogin = await page.locator('body').innerText();
    if (/workspace membership required/i.test(bodyAfterLogin)) {
      notes.push('Signed-in no-membership resolution state rendered explicitly on /models.');
      await screenshot('prod-auth-smoke-02-no-membership-models');
    } else if (/models module live/i.test(bodyAfterLogin)) {
      notes.push('Signed-in user landed on live Models workspace surface after redirect.');
      await screenshot('prod-auth-smoke-02-models-after-login');
    } else {
      throw new Error('Unexpected post-login Models state; neither membership gate nor live models surface was detected.');
    }

    const projectName = `QA Continuity Project ${stamp}`;
    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production authenticated smoke project created by automation.',
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

    const planTitle = `QA Corridor Plan ${stamp}`;
    const planResult = await appFetch('/api/plans', {
      projectId: ids.projectId,
      title: planTitle,
      planType: 'corridor',
      status: 'active',
      geographyLabel: 'QA Test Corridor',
      horizonYear: 2040,
      summary: 'Production smoke plan used to verify supporting model basis.',
      links: [{ linkType: 'project_record', linkedId: ids.projectId }],
    });
    if (planResult.status !== 201) {
      throw new Error(`Plan creation failed: ${planResult.status} ${JSON.stringify(planResult.data)}`);
    }
    ids.planId = planResult.data.planId;
    notes.push(`Created plan ${planTitle}.`);

    const modelTitle = `QA Accessibility Model ${stamp}`;
    const modelResult = await appFetch('/api/models', {
      projectId: ids.projectId,
      title: modelTitle,
      modelFamily: 'accessibility',
      status: 'configuring',
      configVersion: 'qa-v1',
      ownerLabel: 'Bartholomew QA',
      horizonLabel: '2040 pilot',
      assumptionsSummary: 'Production authenticated smoke continuity test assumptions.',
      inputSummary: 'Linked to the QA project and corridor plan.',
      outputSummary: 'Supports corridor planning and programming visibility.',
      summary: 'Automated production continuity verification model.',
      links: [
        { linkType: 'plan', linkedId: ids.planId },
        { linkType: 'project_record', linkedId: ids.projectId },
      ],
    });
    if (modelResult.status !== 201) {
      throw new Error(`Model creation failed: ${modelResult.status} ${JSON.stringify(modelResult.data)}`);
    }
    ids.modelId = modelResult.data.modelId;
    notes.push(`Created model ${modelTitle}.`);

    const programTitle = `QA RTIP Program ${stamp}`;
    const programResult = await appFetch('/api/programs', {
      projectId: ids.projectId,
      title: programTitle,
      programType: 'rtip',
      status: 'assembling',
      cycleName: 'QA 2028 RTIP Cycle',
      sponsorAgency: 'Nat Ford QA',
      fiscalYearStart: 2027,
      fiscalYearEnd: 2029,
      summary: 'Automated production continuity verification program.',
      links: [
        { linkType: 'plan', linkedId: ids.planId },
        { linkType: 'project_record', linkedId: ids.projectId },
      ],
    });
    if (programResult.status !== 201) {
      throw new Error(`Program creation failed: ${programResult.status} ${JSON.stringify(programResult.data)}`);
    }
    ids.programId = programResult.data.programId;
    notes.push(`Created program ${programTitle}.`);

    await page.goto(`${productionBaseUrl}/projects`, { waitUntil: 'networkidle' });
    await page.getByText(projectName, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push('Projects list loaded and showed the QA project.');
    await screenshot('prod-auth-smoke-03-projects-list');

    await page.goto(`${productionBaseUrl}/models`, { waitUntil: 'networkidle' });
    await page.getByText(modelTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.locator('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]').first().fill('Accessibility Model');
    await page.waitForTimeout(1000);
    notes.push('Models list loaded, showed the QA model, and accepted search input.');
    await screenshot('prod-auth-smoke-04-models-list');

    await page.goto(`${productionBaseUrl}/models/${ids.modelId}`, { waitUntil: 'networkidle' });
    await page.getByText(modelTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(planTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push('Model detail loaded and showed linked plan continuity.');
    await screenshot('prod-auth-smoke-05-model-detail');

    await page.goto(`${productionBaseUrl}/plans/${ids.planId}`, { waitUntil: 'networkidle' });
    await page.getByText(planTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText('Supporting model basis', { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(modelTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push('Plan detail loaded and surfaced Supporting model basis with the linked model.');
    await screenshot('prod-auth-smoke-06-plan-detail');

    await page.goto(`${productionBaseUrl}/programs/${ids.programId}`, { waitUntil: 'networkidle' });
    await page.getByText(programTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(modelTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    notes.push('Program detail loaded and surfaced model continuity inherited from linked plan/project context.');
    await screenshot('prod-auth-smoke-07-program-detail');

    await page.goto(`${productionBaseUrl}/billing`, { waitUntil: 'networkidle' });
    await page.getByText(/Starter|Professional|billing|subscription/i).first().waitFor({ timeout: 20000 });
    notes.push('Billing page loaded in an authenticated, provisioned state.');
    await screenshot('prod-auth-smoke-08-billing');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-authenticated-smoke.md`);
    const lines = [
      `# OpenPlan Production Authenticated Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Plan id: ${ids.planId ?? 'unknown'}`,
      `- Model id: ${ids.modelId ?? 'unknown'}`,
      `- Program id: ${ids.programId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((file) => `- docs/ops/${datePart}-test-output/${file}`),
      '',
      '## Coverage',
      '- Signed-out redirect continuity',
      '- Sign-in return-path behavior',
      '- Signed-in unprovisioned UX',
      '- Authenticated project creation via production API/session',
      '- Project → Plan → Model → Program continuity on deployed production routes',
      '- Billing page authenticated load',
      '',
      '## Notes',
      '- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.',
      '- No destructive mutations were performed beyond creating QA data needed for verification.',
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
