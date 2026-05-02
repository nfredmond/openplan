const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, guardLocalMutationTargets, loadEnv, repoRoot } = require('./harness-env');

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

function encodeRestValue(value) {
  return value.replace(/,/g, '\\,');
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment keys');
  }
  const localGuardNote = guardLocalMutationTargets({
    appUrl: baseUrl,
    supabaseUrl,
    scriptName: 'local Engagement report handoff smoke',
  });

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
  const email = `openplan-local-engagement-handoff-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}EngageHandoff`;
  const projectName = `Local Engagement Handoff Smoke ${suffix}`;
  const campaignTitle = `Local Public Feedback Campaign ${suffix}`;
  const campaignSummary = 'Local engagement-flow proof for public submission, moderation, and report handoff traceability.';
  const categoryLabel = `School access ${suffix}`;
  const shareToken = `localengage${suffix}`.toLowerCase();
  const itemTitle = `Missing sidewalk near school ${suffix}`;
  const itemBody =
    `Families reported a missing sidewalk and fast turning traffic near the school entrance during the ${suffix} local smoke.`;
  const submittedBy = `Public tester ${suffix}`;
  const artifacts = [];
  const notes = [];
  const ids = {};
  notes.push(localGuardNote);

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
        purpose: 'openplan-local-engagement-report-handoff-smoke',
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
  const publicContext = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1280, height: 1500 } }));
  const publicPage = await publicContext.newPage();

  async function screenshot(targetPage, name) {
    const fileName = `${datePart}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await targetPage.screenshot({ path: fullPath, fullPage: true });
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
    await page.goto(`${baseUrl}/engagement`, { waitUntil: 'networkidle' });
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
      deliveryPhase: 'scoping',
      status: 'active',
      summary: 'Local engagement handoff smoke project for public feedback, moderation, and report artifact proof.',
    });
    if (projectResult.status !== 201) {
      throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    }
    ids.workspaceId = projectResult.data.workspaceId;
    ids.projectId = projectResult.data.projectRecordId;
    notes.push(`Created project workspace ${projectName}.`);

    const campaignResult = await appFetch('/api/engagement/campaigns', {
      projectId: ids.projectId,
      title: campaignTitle,
      summary: campaignSummary,
      engagementType: 'map_feedback',
      status: 'draft',
    });
    if (campaignResult.status !== 201) {
      throw new Error(`Engagement campaign creation failed: ${campaignResult.status} ${JSON.stringify(campaignResult.data)}`);
    }
    ids.campaignId = campaignResult.data.campaignId;
    notes.push(`Created linked engagement campaign ${campaignTitle}.`);

    const categoryResult = await appFetch(`/api/engagement/campaigns/${ids.campaignId}/categories`, {
      label: categoryLabel,
      description: 'School access, missing sidewalks, and crossing safety.',
      sortOrder: 0,
    });
    if (categoryResult.status !== 201) {
      throw new Error(`Engagement category creation failed: ${categoryResult.status} ${JSON.stringify(categoryResult.data)}`);
    }
    ids.categoryId = categoryResult.data.categoryId;
    notes.push(`Created moderation category ${categoryLabel}.`);

    const shareResult = await appFetch(
      `/api/engagement/campaigns/${ids.campaignId}`,
      {
        status: 'active',
        shareToken,
        publicDescription: 'Public feedback lane for the local engagement-to-report handoff smoke.',
        allowPublicSubmissions: true,
      },
      'PATCH'
    );
    if (shareResult.status !== 200) {
      throw new Error(`Engagement public sharing patch failed: ${shareResult.status} ${JSON.stringify(shareResult.data)}`);
    }
    notes.push(`Activated public engagement portal with share token ${shareToken}.`);

    await publicPage.goto(`${baseUrl}/engage/${shareToken}`, { waitUntil: 'networkidle' });
    await publicPage.getByRole('heading', { name: campaignTitle, exact: false }).waitFor({ timeout: 20000 });
    await publicPage.locator('#public-category').selectOption(ids.categoryId);
    await publicPage.locator('#public-title').fill(itemTitle);
    await publicPage.locator('#public-body').fill(itemBody);
    await publicPage.locator('#public-name').fill(submittedBy);
    await Promise.all([
      publicPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/engage/${shareToken}/submit`) &&
          response.ok(),
        { timeout: 20000 }
      ),
      publicPage.getByRole('button', { name: /^submit feedback$/i }).click(),
    ]);
    await publicPage.getByText(/Your input has been received/i).waitFor({ timeout: 20000 });
    notes.push('Submitted public feedback through the share portal and received the public success state.');
    await screenshot(publicPage, 'local-engagement-report-handoff-01-public-submit');

    const submittedItem = firstRow(
      await restSelect('engagement_items', {
        select: 'id,campaign_id,category_id,title,body,submitted_by,status,source_type',
        campaign_id: `eq.${ids.campaignId}`,
        title: `eq.${encodeRestValue(itemTitle)}`,
      }),
      'submitted engagement item'
    );
    ids.itemId = submittedItem.id;
    assertEqual(submittedItem.status, 'pending', 'Public submission did not land in the pending moderation queue');
    assertEqual(submittedItem.source_type, 'public', 'Public submission source type drifted');
    assertEqual(submittedItem.category_id, ids.categoryId, 'Public submission category did not persist');
    assertEqual(submittedItem.submitted_by, submittedBy, 'Public submission submitter did not persist');
    notes.push('Verified the public item persisted as pending, categorized, and source_type=public.');

    await page.goto(`${baseUrl}/engagement/${ids.campaignId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: campaignTitle, exact: false }).waitFor({ timeout: 20000 });
    const itemRow = page.locator('.module-record-row').filter({ has: page.getByRole('heading', { name: itemTitle, exact: false }) }).first();
    await itemRow.waitFor({ timeout: 20000 });
    await itemRow.getByText(/Pending/i).first().waitFor({ timeout: 20000 });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().includes(`/api/engagement/campaigns/${ids.campaignId}/items/${ids.itemId}`) &&
          response.ok(),
        { timeout: 20000 }
      ),
      itemRow.getByRole('button', { name: /^approve$/i }).click(),
    ]);

    const approvedItem = firstRow(
      await restSelect('engagement_items', {
        select: 'id,status,source_type,category_id,title,body',
        id: `eq.${ids.itemId}`,
      }),
      'approved engagement item'
    );
    assertEqual(approvedItem.status, 'approved', 'Moderation quick action did not approve the public item');
    notes.push('Approved the public item through the staff moderation registry and verified durable status.');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText(itemTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText(/Approved/i).first().waitFor({ timeout: 20000 });
    await screenshot(page, 'local-engagement-report-handoff-02-moderation-approved');

    await publicPage.goto(`${baseUrl}/engage/${shareToken}`, { waitUntil: 'networkidle' });
    await publicPage.getByRole('button', { name: /Community feedback/i }).click();
    await publicPage.getByText(itemTitle, { exact: false }).waitFor({ timeout: 20000 });
    await publicPage.getByText(itemBody, { exact: false }).waitFor({ timeout: 20000 });
    notes.push('Verified approved feedback is visible on the public Community feedback tab.');
    await screenshot(publicPage, 'local-engagement-report-handoff-03-public-feedback-published');

    await page.goto(`${baseUrl}/engagement/${ids.campaignId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: campaignTitle, exact: false }).waitFor({ timeout: 20000 });
    const handoffButton = page.getByRole('button', { name: /^create handoff report$/i });
    await Promise.all([
      page.waitForURL(/\/reports\/[0-9a-f-]+$/i, { timeout: 20000 }),
      handoffButton.click(),
    ]);
    await page.waitForLoadState('networkidle');
    ids.reportId = page.url().split('/').pop() ?? null;
    if (!ids.reportId) {
      throw new Error('Report detail URL did not expose a report id after handoff creation.');
    }
    await page.getByText(/Engagement campaign summary/i).first().waitFor({ timeout: 20000 });
    await page.getByText(/Engagement handoff/i).first().waitFor({ timeout: 20000 });
    notes.push('Created a handoff report from the engagement campaign detail surface.');

    const reportSection = firstRow(
      await restSelect('report_sections', {
        select: 'id,section_key,config_json',
        report_id: `eq.${ids.reportId}`,
        section_key: 'eq.engagement_summary',
      }),
      'engagement report section'
    );
    ids.reportSectionId = reportSection.id;
    assertEqual(reportSection.config_json?.campaignId, ids.campaignId, 'Report engagement section did not preserve campaign id');
    assertEqual(
      reportSection.config_json?.provenance?.origin,
      'engagement_campaign_handoff',
      'Report engagement section did not preserve handoff provenance'
    );
    assertEqual(
      reportSection.config_json?.provenance?.counts?.readyForHandoffCount,
      1,
      'Report engagement section did not freeze the approved/categorized handoff count'
    );
    notes.push('Verified report section provenance froze the campaign id and handoff-ready count.');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/reports/${ids.reportId}/generate`) &&
          response.ok(),
        { timeout: 30000 }
      ),
      page.getByRole('button', { name: /Generate HTML packet/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByText(/Latest HTML artifact/i).waitFor({ timeout: 30000 });

    const iframe = page.locator('iframe[title="Latest report artifact preview"]');
    await iframe.waitFor({ timeout: 30000 });
    const srcDoc = (await iframe.getAttribute('srcdoc')) || '';
    for (const expected of [
      campaignTitle,
      'Engagement campaign summary',
      'Report origin: Engagement Campaign Handoff',
      'Handoff snapshot: 1 ready for handoff',
      'Current live campaign counts: 1 ready for handoff',
    ]) {
      if (!srcDoc.includes(expected)) {
        throw new Error(`Generated report artifact did not include expected content: ${expected}`);
      }
    }
    notes.push('Generated an HTML packet and verified handoff provenance plus live engagement counts in the artifact preview.');
    await screenshot(page, 'local-engagement-report-handoff-04-generated-artifact');

    const artifactRow = firstRow(
      await restSelect('report_artifacts', {
        select: 'id,artifact_kind,metadata_json,created_at',
        report_id: `eq.${ids.reportId}`,
        order: 'created_at.desc',
        limit: '1',
      }),
      'report artifact'
    );
    ids.artifactId = artifactRow.id;
    assertEqual(artifactRow.artifact_kind, 'html', 'Generated report artifact kind drifted');
    if (!artifactRow.metadata_json?.sourceContext || artifactRow.metadata_json.sourceContext.engagementItemCount !== 1) {
      throw new Error(`Report artifact source context did not preserve engagement item count: ${JSON.stringify(artifactRow.metadata_json?.sourceContext)}`);
    }
    notes.push('Verified the report artifact source context preserved engagement item counts.');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-engagement-report-handoff-smoke.md`);
    const lines = [
      `# OpenPlan Local Engagement Report Handoff Smoke — ${datePart}`,
      '',
      '## Local Targets',
      `- App URL: ${baseUrl}`,
      `- Supabase URL: ${supabaseUrl}`,
      `- Local guard result: ${localGuardNote}`,
      '',
      '## Mutation Summary',
      '- Created one local QA auth user and one project workspace, then wrote an engagement campaign, moderation category, public feedback item, handoff report, report section, and generated report artifact.',
      '',
      '## Cleanup / Idempotency Posture',
      '- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.',
      '- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.',
      '',
      '## Key IDs',
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${ids.projectId ?? 'unknown'}`,
      `- Campaign id: ${ids.campaignId ?? 'unknown'}`,
      `- Category id: ${ids.categoryId ?? 'unknown'}`,
      `- Engagement item id: ${ids.itemId ?? 'unknown'}`,
      `- Report id: ${ids.reportId ?? 'unknown'}`,
      `- Report section id: ${ids.reportSectionId ?? 'unknown'}`,
      `- Artifact id: ${ids.artifactId ?? 'unknown'}`,
      `- Share token: ${shareToken}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Local rendered/API smoke confirms public engagement intake, pending moderation persistence, staff approval, public feedback publication, handoff report provenance, HTML packet generation, and artifact source-context traceability through the shared project/campaign/report spine.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(JSON.stringify({ reportPath, artifacts, ids, notes }, null, 2));
  } finally {
    await publicPage.close().catch(() => {});
    await publicContext.close().catch(() => {});
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
