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

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
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
    throw new Error(`Local grants flow smoke refuses non-local base URLs. Received ${baseUrl}.`);
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
  const email = `openplan-local-grants-flow-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}GrantsFlow`;
  const projectName = `Local Grants Flow Smoke ${suffix}`;
  const programTitle = `ATP Implementation Program ${suffix}`;
  const opportunityTitle = `ATP Awarded Call ${suffix}`;
  const awardTitle = `ATP construction award ${suffix}`;
  const invoiceNumber = `ATP-CLOSEOUT-${suffix}`;
  const obligationDueAt = isoDaysFromNow(60);
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const artifacts = [];
  const notes = [];
  const ids = {};

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
        purpose: 'openplan-local-grants-flow-smoke',
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
    await page.goto(`${baseUrl}/grants`, { waitUntil: 'networkidle' });
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
      planType: 'active_transportation_plan',
      deliveryPhase: 'programming',
      status: 'active',
      summary: 'Local grants-flow proof project for opportunity, award, RTP posture, milestone, reimbursement, and closeout verification.',
    });
    if (projectResult.status !== 201) {
      throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    }
    ids.workspaceId = projectResult.data.workspaceId;
    ids.projectId = projectResult.data.projectRecordId;
    notes.push(`Created project workspace ${projectName}.`);

    const fundingProfileResult = await appFetch(`/api/projects/${ids.projectId}/funding-profile`, {
      fundingNeedAmount: 500000,
      localMatchNeedAmount: 50000,
      notes: 'Local grants-flow proof anchors a known project funding need before award write-back.',
    }, 'PATCH');
    if (fundingProfileResult.status !== 200) {
      throw new Error(`Funding profile patch failed: ${fundingProfileResult.status} ${JSON.stringify(fundingProfileResult.data)}`);
    }
    notes.push('Saved a project funding profile with a known need and local match.');

    const programResult = await appFetch('/api/programs', {
      projectId: ids.projectId,
      title: programTitle,
      programType: 'rtip',
      status: 'programmed',
      cycleName: 'ATP Cycle 8',
      fundingClassification: 'discretionary',
      sponsorAgency: 'Caltrans',
      ownerLabel: 'Grant lead',
      cadenceLabel: 'Annual cycle',
      fiscalYearStart: 2027,
      fiscalYearEnd: 2028,
      nominationDueAt: isoDaysFromNow(30),
      adoptionTargetAt: isoDaysFromNow(90),
      summary: 'Local grants-flow proof program.',
    });
    if (programResult.status !== 201) {
      throw new Error(`Program creation failed: ${programResult.status} ${JSON.stringify(programResult.data)}`);
    }
    ids.programId = programResult.data.programId;
    notes.push('Created the funding program that owns the opportunity and award.');

    const opportunityResult = await appFetch('/api/funding-opportunities', {
      programId: ids.programId,
      projectId: ids.projectId,
      title: opportunityTitle,
      status: 'awarded',
      decisionState: 'awarded',
      agencyName: 'Caltrans',
      ownerLabel: 'Grant lead',
      cadenceLabel: 'Annual cycle',
      expectedAwardAmount: 500000,
      closesAt: isoDaysFromNow(15),
      decisionDueAt: isoDaysFromNow(10),
      decisionRationale: 'Local grants-flow smoke advances the opportunity to awarded posture.',
      summary: 'Local awarded opportunity fixture for grants workflow proof.',
    });
    if (opportunityResult.status !== 201) {
      throw new Error(`Funding opportunity creation failed: ${opportunityResult.status} ${JSON.stringify(opportunityResult.data)}`);
    }
    ids.opportunityId = opportunityResult.data.opportunityId;
    notes.push('Created an awarded funding opportunity linked to the project and program.');

    const awardResult = await appFetch('/api/funding-awards', {
      projectId: ids.projectId,
      opportunityId: ids.opportunityId,
      programId: ids.programId,
      title: awardTitle,
      awardedAmount: 500000,
      matchAmount: 50000,
      matchPosture: 'secured',
      spendingStatus: 'active',
      riskFlag: 'none',
      obligationDueAt,
      notes: 'Local grants-flow smoke converts the awarded opportunity into a committed award.',
    });
    if (awardResult.status !== 201) {
      throw new Error(`Funding award creation failed: ${awardResult.status} ${JSON.stringify(awardResult.data)}`);
    }
    ids.awardId = awardResult.data.awardId;
    notes.push('Converted the awarded opportunity into a committed funding award.');

    const projectAfterAward = firstRow(
      await restSelect('projects', {
        select: 'id,rtp_posture,rtp_posture_updated_at',
        id: `eq.${ids.projectId}`,
      }),
      'project after award'
    );
    assertEqual(projectAfterAward.rtp_posture?.status, 'funded', 'Award creation did not write funded RTP posture to the project');
    assertEqual(projectAfterAward.rtp_posture?.pipelineStatus, 'funded', 'Award creation did not write funded pipeline posture to the project');
    assertEqual(projectAfterAward.rtp_posture?.reimbursementStatus, 'not_started', 'Award creation should leave reimbursement not-started before invoices');
    if (!projectAfterAward.rtp_posture_updated_at) {
      throw new Error('Award creation did not stamp rtp_posture_updated_at.');
    }
    notes.push('Verified the award write-back persisted funded RTP posture on the project.');

    const obligationMilestones = await restSelect('project_milestones', {
      select: 'id,title,milestone_type,phase_code,status,target_date,funding_award_id',
      funding_award_id: `eq.${ids.awardId}`,
      milestone_type: 'eq.obligation',
    });
    const obligationMilestone = firstRow(obligationMilestones, 'obligation milestone');
    ids.obligationMilestoneId = obligationMilestone.id;
    assertEqual(obligationMilestone.status, 'scheduled', 'Award obligation milestone status drifted');
    assertEqual(obligationMilestone.phase_code, 'programming', 'Award obligation milestone phase drifted');
    notes.push('Verified the award emitted a scheduled obligation milestone.');

    await page.goto(`${baseUrl}/grants?focusProjectId=${ids.projectId}#grants-awards-reimbursement`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^grants$/i }).waitFor({ timeout: 20000 });
    await page.getByText(projectName, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(/No reimbursement requests yet/i).first().waitFor({ timeout: 20000 });
    await screenshot('local-grants-flow-01-award-posture');

    const invoiceResult = await appFetch('/api/billing/invoices', {
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      fundingAwardId: ids.awardId,
      invoiceNumber,
      consultantName: 'Nat Ford Planning QA',
      billingBasis: 'progress_payment',
      status: 'paid',
      invoiceDate,
      dueDate: isoDaysFromNow(20).slice(0, 10),
      amount: 500000,
      retentionPercent: 0,
      supportingDocsStatus: 'accepted',
      submittedTo: 'Caltrans Local Assistance',
      caltransPosture: 'federal_aid_candidate',
      notes: 'Local grants-flow smoke pays the linked reimbursement invoice so closeout can reconcile.',
    });
    if (invoiceResult.status !== 201) {
      throw new Error(`Billing invoice creation failed: ${invoiceResult.status} ${JSON.stringify(invoiceResult.data)}`);
    }
    ids.invoiceId = invoiceResult.data.invoice?.id ?? null;
    if (!ids.invoiceId) {
      throw new Error(`Billing invoice creation returned no invoice id: ${JSON.stringify(invoiceResult.data)}`);
    }
    notes.push('Created a paid, award-linked reimbursement invoice covering the full award.');

    const closeoutResult = await appFetch(`/api/funding-awards/${ids.awardId}/closeout`, {
      notes: 'Local grants-flow smoke reconciled 100% paid invoice coverage and generated the closeout milestone.',
    });
    if (closeoutResult.status !== 200) {
      throw new Error(`Funding award closeout failed: ${closeoutResult.status} ${JSON.stringify(closeoutResult.data)}`);
    }
    assertEqual(closeoutResult.data.coverage?.outstandingAmount, 0, 'Closeout returned unexpected outstanding coverage');
    notes.push('Closed out the award after 100% paid invoice coverage.');

    const awardAfterCloseout = firstRow(
      await restSelect('funding_awards', {
        select: 'id,spending_status,awarded_amount',
        id: `eq.${ids.awardId}`,
      }),
      'award after closeout'
    );
    assertEqual(awardAfterCloseout.spending_status, 'fully_spent', 'Closeout did not mark the award fully spent');

    const closeoutMilestones = await restSelect('project_milestones', {
      select: 'id,title,milestone_type,phase_code,status,actual_date,funding_award_id',
      funding_award_id: `eq.${ids.awardId}`,
      milestone_type: 'eq.closeout',
    });
    const closeoutMilestone = firstRow(closeoutMilestones, 'closeout milestone');
    ids.closeoutMilestoneId = closeoutMilestone.id;
    assertEqual(closeoutMilestone.status, 'complete', 'Closeout milestone status drifted');
    assertEqual(closeoutMilestone.phase_code, 'closeout', 'Closeout milestone phase drifted');
    notes.push('Verified closeout persisted a complete closeout milestone.');

    const projectAfterCloseout = firstRow(
      await restSelect('projects', {
        select: 'id,rtp_posture,rtp_posture_updated_at',
        id: `eq.${ids.projectId}`,
      }),
      'project after closeout'
    );
    assertEqual(projectAfterCloseout.rtp_posture?.status, 'funded', 'Closeout changed the project funding status unexpectedly');
    assertEqual(projectAfterCloseout.rtp_posture?.reimbursementStatus, 'paid', 'Closeout did not rebuild project reimbursement posture as paid');
    notes.push('Verified closeout rebuilt project RTP posture with paid reimbursement status.');

    await page.goto(`${baseUrl}/projects/${ids.projectId}#project-funding-opportunities`, { waitUntil: 'networkidle' });
    await page.getByText(projectName, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(/Funded/i).first().waitFor({ timeout: 20000 });
    await page.getByText(/Awarded dollars reimbursed/i).first().waitFor({ timeout: 20000 });
    const projectAwardRow = page.locator('.module-record-row').filter({ has: page.getByRole('heading', { name: awardTitle, exact: false }) }).first();
    await projectAwardRow.waitFor({ timeout: 20000 });
    await projectAwardRow.getByText(/Fully spent/i).waitFor({ timeout: 20000 });
    await projectAwardRow.getByText(invoiceNumber, { exact: false }).waitFor({ timeout: 20000 });
    await screenshot('local-grants-flow-02-project-closeout');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-grants-flow-smoke.md`);
    const lines = [
      `# OpenPlan Local Grants Flow Smoke — ${datePart}`,
      '',
      `- Base URL: ${baseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Program id: ${ids.programId ?? 'unknown'}`,
      `- Opportunity id: ${ids.opportunityId ?? 'unknown'}`,
      `- Award id: ${ids.awardId ?? 'unknown'}`,
      `- Invoice id: ${ids.invoiceId ?? 'unknown'}`,
      `- Obligation milestone id: ${ids.obligationMilestoneId ?? 'unknown'}`,
      `- Closeout milestone id: ${ids.closeoutMilestoneId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Local rendered/API smoke confirms the Grants OS flow from project funding need to awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.',
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
