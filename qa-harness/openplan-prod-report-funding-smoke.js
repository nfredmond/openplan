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

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment keys');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `openplan-report-funding-qa-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}FundingQa`;
  const projectName = `QA Report Funding Project ${stamp}`;
  const opportunityTitle = `QA Funding Opportunity ${stamp}`;
  const awardTitle = `QA Funding Award ${stamp}`;
  const invoiceNumber = `QA-FUND-${stamp.slice(11, 19).replace(/-/g, '')}`;
  const reportTitle = `QA Funding Snapshot Report ${stamp}`;
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
        purpose: 'openplan-production-report-funding-smoke',
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
    await page.goto(`${productionBaseUrl}/reports`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/reports', { timeout: 30000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    notes.push('Signed into production successfully through the reports surface.');

    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production QA workspace used to verify funding snapshot capture and report drift continuity.',
      planType: 'corridor_plan',
      deliveryPhase: 'scoping',
      status: 'active',
    });
    if (projectResult.status !== 201) {
      throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    }
    ids.workspaceId = projectResult.data.workspaceId;
    ids.projectId = projectResult.data.projectRecordId;
    notes.push(`Created QA project/workspace ${projectName}.`);

    const fundingProfileResult = await appFetch(`/api/projects/${ids.projectId}/funding-profile`, {
      fundingNeedAmount: 1000000,
      localMatchNeedAmount: 150000,
      notes: 'Production smoke seeded a target funding need so report packet funding posture is meaningful.',
    }, 'PATCH');
    if (fundingProfileResult.status !== 200) {
      throw new Error(`Funding profile patch failed: ${fundingProfileResult.status} ${JSON.stringify(fundingProfileResult.data)}`);
    }
    notes.push('Seeded project funding profile for report snapshot capture.');

    const opportunityResult = await appFetch('/api/funding-opportunities', {
      projectId: ids.projectId,
      title: opportunityTitle,
      status: 'open',
      decisionState: 'pursue',
      agencyName: 'Caltrans',
      ownerLabel: 'Grant lead',
      cadenceLabel: 'Annual cycle',
      expectedAwardAmount: 300000,
      closesAt: isoDaysFromNow(14),
      decisionDueAt: isoDaysFromNow(7),
      summary: 'Production smoke opportunity used to verify funding snapshot capture inside report artifacts.',
    });
    if (opportunityResult.status !== 201) {
      throw new Error(`Funding opportunity creation failed: ${opportunityResult.status} ${JSON.stringify(opportunityResult.data)}`);
    }
    ids.opportunityId = opportunityResult.data.opportunityId ?? null;
    notes.push(`Created pursued funding opportunity ${opportunityTitle}.`);

    const awardResult = await appFetch('/api/funding-awards', {
      projectId: ids.projectId,
      opportunityId: ids.opportunityId,
      title: awardTitle,
      awardedAmount: 650000,
      matchAmount: 150000,
      matchPosture: 'secured',
      obligationDueAt: isoDaysFromNow(45),
      spendingStatus: 'active',
      riskFlag: 'watch',
      notes: 'Production smoke award used to verify funding snapshot digest and reimbursement posture.',
    });
    if (awardResult.status !== 201) {
      throw new Error(`Funding award creation failed: ${awardResult.status} ${JSON.stringify(awardResult.data)}`);
    }
    ids.awardId = awardResult.data.awardId ?? null;
    notes.push(`Created committed funding award ${awardTitle}.`);

    const invoiceResult = await appFetch('/api/billing/invoices', {
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      fundingAwardId: ids.awardId,
      invoiceNumber,
      consultantName: 'Nat Ford Planning',
      billingBasis: 'time_and_materials',
      status: 'submitted',
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: isoDaysFromNow(30).slice(0, 10),
      amount: 150000,
      supportingDocsStatus: 'complete',
      submittedTo: 'Caltrans Local Assistance',
      caltransPosture: 'local_agency_consulting',
      notes: 'Production smoke reimbursement packet linked to the QA funding award.',
    });
    if (invoiceResult.status !== 201) {
      throw new Error(`Invoice creation failed: ${invoiceResult.status} ${JSON.stringify(invoiceResult.data)}`);
    }
    ids.invoiceId = invoiceResult.data.invoice?.id ?? null;
    notes.push(`Created submitted reimbursement invoice ${invoiceNumber}.`);

    const reportResult = await appFetch('/api/reports', {
      projectId: ids.projectId,
      reportType: 'project_status',
      title: reportTitle,
      summary: 'Production smoke report used to verify funding snapshot visibility, grants navigation, and drift.',
    });
    if (reportResult.status !== 201) {
      throw new Error(`Report creation failed: ${reportResult.status} ${JSON.stringify(reportResult.data)}`);
    }
    ids.reportId = reportResult.data.reportId ?? null;
    if (!ids.reportId) {
      throw new Error(`Report creation returned no report id: ${JSON.stringify(reportResult.data)}`);
    }
    notes.push(`Created report record ${reportTitle}.`);

    await page.goto(`${productionBaseUrl}/reports/${ids.reportId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: reportTitle }).waitFor({ timeout: 30000 });
    await page.getByText('Funding posture', { exact: true }).first().waitFor({ timeout: 30000 });
    await page.getByRole('link', { name: /Open grants lane for this project/i }).waitFor({ timeout: 30000 });

    const grantsLink = page.getByRole('link', { name: /Open grants lane for this project/i });
    const grantsHref = await grantsLink.getAttribute('href');
    if (!grantsHref || !grantsHref.includes(`/grants?focusProjectId=${ids.projectId}#grants-awards-reimbursement`)) {
      throw new Error(`Unexpected grants lane href on report detail: ${grantsHref}`);
    }
    notes.push(`Report detail exposed grants navigation back into ${grantsHref}.`);

    await screenshot('prod-report-funding-01-detail-before-generate');

    await page.getByRole('button', { name: /Generate HTML packet/i }).click();
    await page.locator('iframe[title="Latest report artifact preview"]').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /HTML packet/i }).waitFor({ timeout: 30000 });
    await page.frameLocator('iframe[title="Latest report artifact preview"]').getByText(/Funding posture at generation/i).waitFor({ timeout: 30000 });
    notes.push('Generated a live report artifact and verified the preview embeds funding posture at generation.');

    await screenshot('prod-report-funding-02-detail-generated');

    await page.goto(`${productionBaseUrl}/reports`, { waitUntil: 'networkidle' });
    const reportCard = page.locator('article').filter({ has: page.getByRole('heading', { name: reportTitle }) }).first();
    await reportCard.waitFor({ timeout: 30000 });
    await reportCard.getByText('Funding posture', { exact: true }).waitFor({ timeout: 30000 });
    const reportCardText = await reportCard.textContent();
    if (!reportCardText || reportCardText.includes('No funding snapshot is attached to the latest artifact yet.')) {
      throw new Error(`Reports registry did not surface the stored funding snapshot digest for ${reportTitle}.`);
    }
    notes.push('Reports registry rendered the stored funding posture digest instead of the empty funding-snapshot fallback.');

    await screenshot('prod-report-funding-03-reports-registry');

    const invoicePatchResult = await appFetch(`/api/billing/invoices/${ids.invoiceId}`, {
      workspaceId: ids.workspaceId,
      status: 'paid',
    }, 'PATCH');
    if (invoicePatchResult.status !== 200) {
      throw new Error(`Invoice patch failed: ${invoicePatchResult.status} ${JSON.stringify(invoicePatchResult.data)}`);
    }
    notes.push('Changed reimbursement posture after generation by marking the QA invoice paid.');

    await page.goto(`${productionBaseUrl}/reports/${ids.reportId}`, { waitUntil: 'networkidle' });
    const driftPanel = page.locator('#drift-since-generation');
    await driftPanel.waitFor({ timeout: 30000 });
    await driftPanel.getByText('Funding posture', { exact: true }).waitFor({ timeout: 30000 });
    const driftText = await driftPanel.textContent();
    if (!driftText || !driftText.includes('Reimbursement posture:')) {
      throw new Error(`Funding drift panel did not reflect live reimbursement changes after generation. Drift text: ${driftText}`);
    }
    notes.push('Report detail surfaced funding drift after live reimbursement posture changed post-generation.');

    await screenshot('prod-report-funding-04-detail-drift');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-report-funding-smoke.md`);
    const lines = [
      `# OpenPlan Production Report Funding Smoke — ${datePart}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
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
      ...artifacts.map((file) => `- docs/ops/${datePart}-test-output/${file}`),
      '',
      '## Coverage',
      '- Production report detail rendered funding posture and grants-lane navigation for a live project-backed report',
      '- Production report generation embedded funding posture into the latest HTML artifact preview',
      '- Production reports registry rendered the stored funding snapshot digest for the generated artifact',
      '- Production report detail surfaced live funding drift after reimbursement posture changed post-generation',
      '',
      '## Notes',
      '- This smoke used a dedicated QA auth user and real production QA records/workspace for evidence-backed verification.',
      '- Mutations were limited to QA funding profile, opportunity, award, invoice, and report records needed to prove the new Grants → Reports funding seam.',
      '- Cleanup should be run after proof so the QA workspace and auth user do not remain in production.',
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
