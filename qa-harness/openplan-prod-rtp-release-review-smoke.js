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
  const email = `openplan-prod-rtp-release-smoke-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}ProdRtpRelease`;
  const workspaceName = `OpenPlan Prod RTP Release Smoke ${stamp.slice(11, 19)}`;
  const cycleTitle = `Production RTP Release Smoke ${stamp.slice(0, 10)}`;
  const projectName = `RTP Funding Smoke Project ${stamp.slice(11, 19)}`;
  const opportunityTitle = `RTP linked funding opportunity ${stamp.slice(11, 19)}`;
  const awardTitle = `RTP linked funding award ${stamp.slice(11, 19)}`;
  const invoiceNumber = `RTP-FUND-${stamp.slice(11, 19).replace(/-/g, '')}`;
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
        purpose: 'openplan-production-rtp-release-review-smoke',
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
    await page.goto(`${productionBaseUrl}/rtp`, { waitUntil: 'networkidle' });
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
      notes.push(`Current workspace resolved to ${ids.workspaceId} instead of the freshly bootstrapped workspace ${ids.bootstrapWorkspaceId}; RTP smoke data was aligned to the active workspace selection.`);
    }

    const cycleResult = await appFetch('/api/rtp-cycles', {
      title: cycleTitle,
      status: 'public_review',
      geographyLabel: 'Nevada County, California',
      horizonStartYear: 2025,
      horizonEndYear: 2045,
      adoptionTargetDate: '2026-12-15',
      publicReviewOpenAt: '2026-06-01T07:00:00.000Z',
      publicReviewCloseAt: '2026-07-01T07:00:00.000Z',
      summary: 'Production smoke cycle for RTP packet create, generate, and release-review verification.',
    });
    if (cycleResult.status !== 200) {
      throw new Error(`RTP cycle creation failed: ${cycleResult.status} ${JSON.stringify(cycleResult.data)}`);
    }
    ids.rtpCycleId = cycleResult.data.rtpCycleId;
    notes.push(`Created production RTP cycle ${cycleTitle}.`);

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
        summary: 'Production RTP funding smoke project used to verify portfolio funding posture in release review.',
        status: 'active',
        plan_type: 'corridor_plan',
        delivery_phase: 'scoping',
        created_by: ids.userId,
      }),
    });
    if (!createProjectResult.ok) {
      throw new Error(`RTP smoke project seed failed: ${createProjectResult.status} ${JSON.stringify(createProjectResult.data)}`);
    }
    const createdProject = Array.isArray(createProjectResult.data)
      ? createProjectResult.data[0]
      : createProjectResult.data;
    ids.projectId = createdProject?.id ?? null;
    if (!ids.projectId) {
      throw new Error(`RTP smoke project seed returned no project id: ${JSON.stringify(createProjectResult.data)}`);
    }
    notes.push(`Seeded linked RTP project ${projectName} in the active workspace.`);

    const linkResult = await appFetch(`/api/projects/${ids.projectId}/rtp-links`, {
      rtpCycleId: ids.rtpCycleId,
      portfolioRole: 'constrained',
      priorityRationale: 'Production smoke link for RTP funding posture proof.',
    });
    if (linkResult.status !== 200) {
      throw new Error(`RTP project link failed: ${linkResult.status} ${JSON.stringify(linkResult.data)}`);
    }
    notes.push('Linked the smoke project into the RTP cycle portfolio.');

    const fundingProfileResult = await appFetch(`/api/projects/${ids.projectId}/funding-profile`, {
      fundingNeedAmount: 900000,
      localMatchNeedAmount: 120000,
      notes: 'Production RTP funding smoke profile for release-review proof.',
    }, 'PATCH');
    if (fundingProfileResult.status !== 200) {
      throw new Error(`RTP funding profile patch failed: ${fundingProfileResult.status} ${JSON.stringify(fundingProfileResult.data)}`);
    }

    const opportunityResult = await appFetch('/api/funding-opportunities', {
      projectId: ids.projectId,
      title: opportunityTitle,
      status: 'open',
      decisionState: 'pursue',
      agencyName: 'Caltrans',
      ownerLabel: 'Grant lead',
      cadenceLabel: 'Annual cycle',
      expectedAwardAmount: 250000,
      closesAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      decisionDueAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      summary: 'Production RTP funding smoke opportunity.',
    });
    if (opportunityResult.status !== 201) {
      throw new Error(`RTP funding opportunity creation failed: ${opportunityResult.status} ${JSON.stringify(opportunityResult.data)}`);
    }
    ids.opportunityId = opportunityResult.data.opportunityId ?? null;

    const awardResult = await appFetch('/api/funding-awards', {
      projectId: ids.projectId,
      opportunityId: ids.opportunityId,
      title: awardTitle,
      awardedAmount: 600000,
      matchAmount: 120000,
      matchPosture: 'secured',
      obligationDueAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
      spendingStatus: 'active',
      riskFlag: 'watch',
      notes: 'Production RTP funding smoke award.',
    });
    if (awardResult.status !== 201) {
      throw new Error(`RTP funding award creation failed: ${awardResult.status} ${JSON.stringify(awardResult.data)}`);
    }
    ids.awardId = awardResult.data.awardId ?? null;

    const invoiceResult = await appFetch('/api/billing/invoices', {
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      fundingAwardId: ids.awardId,
      invoiceNumber,
      consultantName: 'Nat Ford Planning',
      billingBasis: 'time_and_materials',
      status: 'submitted',
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      amount: 140000,
      supportingDocsStatus: 'complete',
      submittedTo: 'Caltrans Local Assistance',
      caltransPosture: 'local_agency_consulting',
      notes: 'Production RTP funding smoke reimbursement packet.',
    });
    if (invoiceResult.status !== 201) {
      throw new Error(`RTP funding invoice creation failed: ${invoiceResult.status} ${JSON.stringify(invoiceResult.data)}`);
    }
    ids.invoiceId = invoiceResult.data.invoice?.id ?? null;
    notes.push('Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.');

    const reportResult = await appFetch('/api/reports', {
      rtpCycleId: ids.rtpCycleId,
      reportType: 'board_packet',
    });
    if (reportResult.status !== 201) {
      throw new Error(`RTP packet record creation failed: ${reportResult.status} ${JSON.stringify(reportResult.data)}`);
    }
    ids.reportId = reportResult.data.reportId;
    notes.push('Created RTP board-packet record from the production API.');

    const generateResult = await appFetch(`/api/reports/${ids.reportId}/generate`, { format: 'html' });
    if (!generateResult.ok) {
      throw new Error(`RTP packet generation failed: ${generateResult.status} ${JSON.stringify(generateResult.data)}`);
    }
    notes.push('Generated the first RTP packet artifact on production through the existing report generation route.');

    await page.goto(`${productionBaseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Move into the right module lane/i }).waitFor({ timeout: 30000 });
    const dashboardReviewLink = page.getByRole('link', { name: /Open RTP funding release review/i }).first();
    await dashboardReviewLink.waitFor({ timeout: 30000 });
    const dashboardReviewHref = await dashboardReviewLink.getAttribute('href');
    if (dashboardReviewHref !== `/reports/${ids.reportId}#packet-release-review`) {
      throw new Error(`Dashboard RTP funding review action did not target the expected packet release-review path. Received ${dashboardReviewHref}`);
    }
    await page.getByText(/1 current RTP packet still needs funding-backed release review even though packet freshness already reads current\./i).first().waitFor({ timeout: 30000 });
    await page.getByText(/1 current for release review, 1 funding-backed\./i).first().waitFor({ timeout: 30000 });
    notes.push('Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.');
    await screenshot('prod-rtp-release-review-dashboard');

    await page.goto(`${productionBaseUrl}/explore`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Corridor analysis workspace/i }).waitFor({ timeout: 30000 });
    await page.getByText(/What should move around this analysis workspace/i).first().waitFor({ timeout: 30000 });
    await page.getByText(new RegExp(projectName, 'i')).first().waitFor({ timeout: 30000 });
    const analysisRuntimeCueLink = page.getByRole('link', { name: /Open RTP funding review/i }).first();
    await analysisRuntimeCueLink.waitFor({ timeout: 30000 });
    const analysisRuntimeCueHref = await analysisRuntimeCueLink.getAttribute('href');
    if (analysisRuntimeCueHref !== `/reports/${ids.reportId}#packet-release-review`) {
      throw new Error(`Analysis Studio runtime cue did not target the expected RTP funding review. Received ${analysisRuntimeCueHref}`);
    }
    await page.getByText(/1 current RTP packet still needs funding-backed release review even though packet freshness already reads current\./i).first().waitFor({ timeout: 30000 });
    await page.getByText(/1 current for release review, 1 funding-backed\./i).first().waitFor({ timeout: 30000 });
    notes.push('Analysis Studio surfaced the shared RTP funding-review runtime cue and inherited the same command-board pressure while keeping the smoke project as the visible project context.');
    await screenshot('prod-rtp-release-review-analysis-workspace');

    await page.goto(`${productionBaseUrl}/reports`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Report packets and exports/i }).waitFor({ timeout: 30000 });
    await page.getByText(/1 RTP funding review/i).first().waitFor({ timeout: 30000 });
    const reportQueue = page.locator('div').filter({ has: page.getByText(/Report packet queue/i) }).first();
    await reportQueue.waitFor({ timeout: 30000 });
    const reportQueueText = await reportQueue.textContent();
    if (!reportQueueText || !reportQueueText.includes('run funding-backed release review')) {
      throw new Error(`Reports queue did not surface RTP funding-backed release review copy. Queue text: ${reportQueueText}`);
    }
    if (!reportQueueText.includes(`${cycleTitle} Board / Binder`)) {
      throw new Error(`Reports queue did not surface the RTP smoke report title. Queue text: ${reportQueueText}`);
    }
    const runtimeCueLink = page.getByRole('link', { name: /Open RTP funding review/i }).first();
    const runtimeCueCount = await runtimeCueLink.count();
    if (runtimeCueCount < 1) {
      const operatorCard = page.locator('article').filter({ has: page.getByRole('heading', { name: /Report packets and exports/i }) }).first();
      const commandBoard = page.locator('article').filter({ has: page.getByRole('heading', { name: /What should move around reports/i }) }).first();
      const [operatorCardText, commandBoardText] = await Promise.all([
        operatorCard.textContent().catch(() => null),
        commandBoard.textContent().catch(() => null),
      ]);
      throw new Error(
        `Reports runtime cue was not visible. Operator card: ${operatorCardText ?? 'n/a'} | Command board: ${commandBoardText ?? 'n/a'}`
      );
    }
    const runtimeCueHref = await runtimeCueLink.getAttribute('href');
    if (runtimeCueHref !== `/reports/${ids.reportId}#packet-release-review`) {
      throw new Error(`Reports runtime cue did not target the expected RTP funding release review. Received ${runtimeCueHref}`);
    }
    await page.getByText(/Shared runtime cue:/i).first().waitFor({ timeout: 30000 });
    notes.push('Reports surface showed RTP funding-review queue pressure and the shared runtime cue pointed back to the RTP funding release-review packet before opening detail.');
    await screenshot('prod-rtp-release-review-02-reports-runtime-cue');

    await page.goto(`${productionBaseUrl}/rtp`, { waitUntil: 'networkidle' });
    await page.getByText(cycleTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    const cycleRow = page.locator('article').filter({ has: page.getByRole('link', { name: new RegExp(cycleTitle, 'i') }) }).first();
    await cycleRow.getByText(/Release review with funding follow-up/i).first().waitFor({ timeout: 30000 });
    await cycleRow.getByText(/Funding gap review|Award follow-through pending|Reimbursement in flight|Pipeline-backed review/i).first().waitFor({ timeout: 30000 });
    await page.getByText(/Funding review/i).first().waitFor({ timeout: 30000 });
    await page.getByRole('link', { name: /Open release-review lane/i }).waitFor({ timeout: 30000 });
    const reviewCurrentPacketLink = page.getByRole('link', { name: /Review current packet/i }).first();
    await reviewCurrentPacketLink.waitFor({ timeout: 30000 });
    notes.push('Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.');
    await screenshot('prod-rtp-release-review-01-registry');

    await Promise.all([
      page.waitForURL(new RegExp(`/reports/${ids.reportId}#packet-release-review$`, 'i'), { timeout: 30000 }),
      reviewCurrentPacketLink.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { name: /Freshness against RTP source/i }).waitFor({ timeout: 30000 });
    await page.getByText(/Packet posture/i).first().waitFor({ timeout: 30000 });
    await page.getByText(/Generation-time funding posture/i).waitFor({ timeout: 30000 });
    await page.getByText(/Current funding posture/i).waitFor({ timeout: 30000 });
    await page.getByText(/What should move around this RTP packet|What should move around this report/i).first().waitFor({ timeout: 30000 });
    await page.getByText(/1 current RTP packet still needs funding-backed release review even though packet freshness already reads current\./i).first().waitFor({ timeout: 30000 });
    notes.push('Production registry current-packet link landed on the packet release-review anchor in report detail.');
    await screenshot('prod-rtp-release-review-03-report-detail');

    const invoicePatchResult = await appFetch(`/api/billing/invoices/${ids.invoiceId}`, {
      workspaceId: ids.workspaceId,
      status: 'paid',
    }, 'PATCH');
    if (invoicePatchResult.status !== 200) {
      throw new Error(`RTP funding invoice patch failed: ${invoicePatchResult.status} ${JSON.stringify(invoicePatchResult.data)}`);
    }

    await page.goto(`${productionBaseUrl}/reports/${ids.reportId}#drift-since-generation`, { waitUntil: 'networkidle' });
    await page.getByText(/Source drift/i).first().waitFor({ timeout: 30000 });
    const driftPanel = page.locator('article').filter({ has: page.getByRole('heading', { name: /What changed since this packet was generated/i }) }).first();
    await driftPanel.waitFor({ timeout: 30000 });
    const driftText = await driftPanel.textContent();
    if (!driftText || !driftText.includes('Funding posture')) {
      throw new Error(`RTP release review did not surface funding posture drift. Drift text: ${driftText}`);
    }
    notes.push('Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.');
    await screenshot('prod-rtp-release-review-04-funding-drift');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-rtp-release-review-smoke.md`);
    const lines = [
      `# OpenPlan Production RTP Release-Review Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- RTP cycle id: ${ids.rtpCycleId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Opportunity id: ${ids.opportunityId ?? 'unknown'}`,
      `- Award id: ${ids.awardId ?? 'unknown'}`,
      `- Invoice id: ${ids.invoiceId ?? 'unknown'}`,
      `- Report id: ${ids.reportId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.',
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
