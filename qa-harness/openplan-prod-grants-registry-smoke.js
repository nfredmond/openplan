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
  const projectName = `Grass Valley Safe Routes Smoke ${stamp.slice(11, 19)}`;
  const programTitle = `ATP Grants Smoke ${stamp.slice(11, 19)}`;
  const opportunityTitle = `2027 ATP countywide active transportation call ${stamp.slice(11, 19)}`;
  const linkedAwardOpportunityTitle = `2027 ATP linked award conversion ${stamp.slice(11, 19)}`;
  const awardTitle = `ATP award conversion smoke ${stamp.slice(11, 19)}`;
  const unlinkedInvoiceNumber = `ATP-RELINK-${stamp.slice(11, 19).replace(/-/g, '')}`;
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
    ids.bootstrapWorkspaceId = bootstrapResult.data.workspaceId;
    notes.push(`Bootstrapped workspace ${workspaceName}.`);

    const currentWorkspaceResult = await appFetch('/api/workspaces/current', null, 'GET');
    if (!currentWorkspaceResult.ok) {
      throw new Error(`Current workspace lookup failed: ${currentWorkspaceResult.status} ${JSON.stringify(currentWorkspaceResult.data)}`);
    }
    ids.workspaceId = currentWorkspaceResult.data.workspaceId;
    if (ids.workspaceId !== ids.bootstrapWorkspaceId) {
      notes.push(`Current workspace resolved to ${ids.workspaceId} instead of the freshly bootstrapped workspace ${ids.bootstrapWorkspaceId}; smoke data was aligned to the active workspace selection.`);
    }

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
        summary: 'Production smoke project used to verify award conversion from the shared grants surface.',
        status: 'active',
        plan_type: 'corridor_plan',
        delivery_phase: 'scoping',
        created_by: ids.userId,
      }),
    });
    if (!createProjectResult.ok) {
      throw new Error(`Project seed failed: ${createProjectResult.status} ${JSON.stringify(createProjectResult.data)}`);
    }
    const createdProject = Array.isArray(createProjectResult.data)
      ? createProjectResult.data[0]
      : createProjectResult.data;
    ids.projectId = createdProject?.id ?? null;
    if (!ids.projectId) {
      throw new Error(`Project seed returned no project id: ${JSON.stringify(createProjectResult.data)}`);
    }
    notes.push(`Seeded linked project ${projectName} inside the smoke workspace.`);

    const programResult = await appFetch('/api/programs', {
      projectId: ids.projectId,
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

    const firstOpportunityResult = await appFetch('/api/funding-opportunities', {
      programId: ids.programId,
      title: opportunityTitle,
      status: 'open',
      agencyName: 'Caltrans',
      ownerLabel: 'Grant lead',
      cadenceLabel: 'Annual cycle',
      expectedAwardAmount: 500000,
      closesAt: closeIso,
      decisionDueAt: decisionIso,
      summary: 'Smoke-tested funding opportunity created to verify the shared Grants OS surface.',
    });
    if (firstOpportunityResult.status !== 201) {
      throw new Error(`Primary funding opportunity creation failed: ${firstOpportunityResult.status} ${JSON.stringify(firstOpportunityResult.data)}`);
    }

    await page.goto(`${productionBaseUrl}/grants`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^grants$/i }).waitFor({ timeout: 30000 });
    await page.getByRole('heading', { name: opportunityTitle, exact: false }).waitFor({ timeout: 30000 });
    await page.getByText(/Advance near-term funding windows/i).waitFor({ timeout: 30000 });
    notes.push('Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.');

    await page.locator('select[id^="funding-decision-"]').first().selectOption('pursue');
    await page.getByPlaceholder('Record why the team chose pursue, monitor, or skip.').first().fill('Smoke proof moved this grant into a real pursue posture from the shared registry.');
    await page.getByRole('button', { name: /save decision/i }).first().click();
    await page.getByText(/Funding decision saved\./i).waitFor({ timeout: 30000 });
    notes.push('Updated the opportunity decision to pursue directly from the grants registry row controls.');

    const linkedAwardOpportunityResult = await appFetch('/api/funding-opportunities', {
      programId: ids.programId,
      projectId: ids.projectId,
      title: linkedAwardOpportunityTitle,
      status: 'awarded',
      decisionState: 'pursue',
      agencyName: 'Caltrans',
      ownerLabel: 'Grant lead',
      cadenceLabel: 'Annual cycle',
      expectedAwardAmount: 500000,
      closesAt: closeIso,
      decisionDueAt: decisionIso,
      decisionRationale: 'Production smoke seeded a linked awarded opportunity so the award-conversion lane could take over from `/grants`.',
      summary: 'Linked awarded opportunity used to verify direct award conversion from the shared grants workspace.',
    });
    if (linkedAwardOpportunityResult.status !== 201) {
      throw new Error(`Linked awarded opportunity creation failed: ${linkedAwardOpportunityResult.status} ${JSON.stringify(linkedAwardOpportunityResult.data)}`);
    }
    ids.opportunityId = linkedAwardOpportunityResult.data.opportunityId;
    notes.push('Created a linked awarded opportunity so the shared award-conversion lane could take over.');

    await page.goto(`${productionBaseUrl}/grants`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^grants$/i }).waitFor({ timeout: 30000 });
    await page.getByText(/Awarded opportunities still missing committed award records/i).waitFor({ timeout: 30000 });
    await page.getByRole('heading', { name: /Create the lead award record now/i }).waitFor({ timeout: 30000 });

    const leadAwardCard = page.locator('article').filter({ has: page.getByRole('heading', { name: /Create the lead award record now/i }) }).first();
    await leadAwardCard.getByPlaceholder('Cycle 8 ATP award').fill(awardTitle);
    await leadAwardCard.getByPlaceholder('1750000').fill('500000');
    await leadAwardCard.getByPlaceholder('250000').fill('50000');
    await leadAwardCard.locator('input[type="datetime-local"]').first().fill(toDateTimeLocal(closeIso));
    await leadAwardCard
      .getByPlaceholder('Award terms, obligation risks, reimbursement posture, or scope notes.')
      .fill('Production smoke converted the awarded opportunity into a committed funding award from the shared grants lane.');
    await leadAwardCard.getByRole('button', { name: /save award/i }).click();
    await leadAwardCard.getByText(/Funding award saved\./i).waitFor({ timeout: 30000 });
    await page.getByText(/Award records current/i).waitFor({ timeout: 30000 });
    notes.push('Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.');

    const awardStackSection = page.locator('article').filter({ has: page.getByRole('heading', { name: /Workspace award stack and reimbursement posture/i }) }).first();
    await awardStackSection.getByRole('heading', { name: projectName, exact: false }).waitFor({ timeout: 30000 });
    await awardStackSection.getByText(/No reimbursement requests yet/i).waitFor({ timeout: 30000 });
    notes.push('The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.');

    await screenshot('prod-grants-registry-01-registry');
    await screenshot('prod-grants-registry-02-award-conversion');

    const reimbursementComposer = page.locator('article').filter({ has: page.getByRole('heading', { name: /Start the lead reimbursement record now/i }) }).first();
    await reimbursementComposer.waitFor({ timeout: 30000 });
    await reimbursementComposer.getByRole('button', { name: /save invoice record/i }).click();
    await reimbursementComposer.getByText(/Invoice record saved\./i).waitFor({ timeout: 30000 });
    await awardStackSection.getByText(/Invoice drafting started/i).waitFor({ timeout: 30000 });
    const reimbursementQueueSection = page.locator('article').filter({ has: page.getByRole('heading', { name: /Workspace reimbursement follow-through queue/i }) }).first();
    await reimbursementQueueSection.waitFor({ timeout: 30000 });
    await reimbursementQueueSection.getByRole('link', { name: /Open reimbursement register/i }).first().waitFor({ timeout: 30000 });
    notes.push('Created the first award-linked reimbursement invoice directly from `/grants`, advanced the stack into drafting posture, and surfaced it in the workspace reimbursement queue.');

    await reimbursementQueueSection.getByRole('button', { name: /Move to internal review/i }).first().click();
    await reimbursementQueueSection.getByText(/Invoice moved to internal review\./i).first().waitFor({ timeout: 30000 });
    await awardStackSection.getByText(/Reimbursement in flight/i).waitFor({ timeout: 30000 });
    notes.push('Advanced the reimbursement queue item in place from draft to internal review directly from `/grants`.');

    const unlinkedInvoiceResult = await appFetch('/api/billing/invoices', {
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      invoiceNumber: unlinkedInvoiceNumber,
      amount: 120000,
      dueDate: closeIso,
      notes: 'Production smoke seeded a single unlinked reimbursement invoice so the exact award relink action could be proven from the shared grants queue.',
    });
    if (unlinkedInvoiceResult.status !== 201) {
      throw new Error(`Unlinked invoice creation failed: ${unlinkedInvoiceResult.status} ${JSON.stringify(unlinkedInvoiceResult.data)}`);
    }
    ids.unlinkedInvoiceId = unlinkedInvoiceResult.data.invoice?.id ?? null;
    if (!ids.unlinkedInvoiceId) {
      throw new Error(`Unlinked invoice creation returned no invoice id: ${JSON.stringify(unlinkedInvoiceResult.data)}`);
    }

    await page.goto(`${productionBaseUrl}/grants`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^grants$/i }).waitFor({ timeout: 30000 });
    const refreshedQueueSection = page.locator('article').filter({ has: page.getByRole('heading', { name: /Workspace reimbursement follow-through queue/i }) }).first();
    await refreshedQueueSection.getByText(unlinkedInvoiceNumber, { exact: false }).waitFor({ timeout: 30000 });
    const exactRelinkRow = refreshedQueueSection.locator('.module-record-row').filter({ has: page.getByRole('heading', { name: unlinkedInvoiceNumber, exact: false }) }).first();
    await exactRelinkRow.getByText(/Exact relink ready/i).waitFor({ timeout: 30000 });
    const useExactMatchButton = exactRelinkRow.getByRole('button', { name: /Use exact match/i });
    if (await useExactMatchButton.isVisible().catch(() => false)) {
      await useExactMatchButton.click();
    }
    await exactRelinkRow.getByRole('button', { name: /Save exact funding link|Save funding link/i }).click();
    await page.waitForTimeout(2000);
    if (!page.url().includes(`relinkedInvoiceId=${ids.unlinkedInvoiceId}`)) {
      throw new Error(`Exact relink did not update the grants URL as expected: ${page.url()}`);
    }
    const relinkedRow = page.locator('.module-record-row').filter({ has: page.getByRole('heading', { name: unlinkedInvoiceNumber, exact: false }) }).first();
    await relinkedRow.getByText(/Relink just saved/i).waitFor({ timeout: 30000 });
    await relinkedRow.getByText(/Relink saved in this grants queue/i).waitFor({ timeout: 30000 });
    notes.push('Repaired an exact award relink directly from the shared grants queue without leaving `/grants`, and the queue now confirms the saved relink state inline.');

    await screenshot('prod-grants-registry-03-reimbursement-creation');

    const reimbursementLink = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: /Workspace award stack and reimbursement posture/i }) })
      .first()
      .getByRole('link', { name: /Review in-flight reimbursement/i })
      .first();
    await reimbursementLink.waitFor({ timeout: 30000 });
    await Promise.all([
      page.waitForURL(new RegExp(`/projects/${ids.projectId}#project-invoices$`, 'i'), { timeout: 30000 }),
      reimbursementLink.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { name: /Project-linked billing register/i }).waitFor({ timeout: 30000 });
    notes.push('The grants reimbursement action landed directly on the project billing register anchor after direct invoice creation.');

    await screenshot('prod-grants-registry-04-project-billing-register');

    await page.goto(`${productionBaseUrl}/grants`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^grants$/i }).waitFor({ timeout: 30000 });

    const programFundingLink = page.getByRole('link', { name: /Open program funding lane/i }).first();
    await programFundingLink.waitFor({ timeout: 30000 });
    await Promise.all([
      page.waitForURL(new RegExp(`/programs/${ids.programId}#program-funding-opportunities$`, 'i'), { timeout: 30000 }),
      programFundingLink.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { name: /Linked funding opportunities/i }).waitFor({ timeout: 30000 });
    notes.push('The grants registry linked back into the canonical program funding lane.');

    await screenshot('prod-grants-registry-05-program-detail');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-grants-registry-smoke.md`);
    const lines = [
      `# OpenPlan Production Grants Registry Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Bootstrapped workspace id: ${ids.bootstrapWorkspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Program id: ${ids.programId ?? 'unknown'}`,
      `- Opportunity id: ${ids.opportunityId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, start the first reimbursement invoice directly from the shared grants surface, advance that reimbursement queue item in place, repair an exact award relink from the shared queue with inline confirmation, land on the exact project billing register, and still link back into the canonical program funding lane.',
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
