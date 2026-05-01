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

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment keys');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `openplan-local-rtp-release-smoke-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}RtpReleaseSmoke`;
  const workspaceName = `OpenPlan RTP Release Smoke ${stamp.slice(11, 19)}`;
  const cycleTitle = `Nevada County RTP ${stamp.slice(0, 10)}`;
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
        purpose: 'openplan-local-rtp-release-review-smoke',
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
    await page.goto(`${baseUrl}/rtp`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    notes.push('Signed into the local app successfully.');

    const bootstrapResult = await appFetch('/api/workspaces/bootstrap', {
      workspaceName,
      plan: 'pilot',
    });
    if (!bootstrapResult.ok) {
      throw new Error(`Workspace bootstrap failed: ${bootstrapResult.status} ${JSON.stringify(bootstrapResult.data)}`);
    }
    ids.workspaceId = bootstrapResult.data.workspaceId;
    notes.push(`Bootstrapped workspace ${workspaceName}.`);

    const cycleResult = await appFetch('/api/rtp-cycles', {
      title: cycleTitle,
      status: 'public_review',
      geographyLabel: 'Nevada County, California',
      horizonStartYear: 2025,
      horizonEndYear: 2045,
      adoptionTargetDate: '2026-12-15',
      publicReviewOpenAt: '2026-06-01T07:00:00.000Z',
      publicReviewCloseAt: '2026-07-01T07:00:00.000Z',
      summary: 'Local smoke cycle for RTP packet create, generate, and release-review verification.',
    });
    if (cycleResult.status !== 200) {
      throw new Error(`RTP cycle creation failed: ${cycleResult.status} ${JSON.stringify(cycleResult.data)}`);
    }
    ids.rtpCycleId = cycleResult.data.rtpCycleId;
    notes.push(`Created RTP cycle ${cycleTitle}.`);

    const reportResult = await appFetch('/api/reports', {
      rtpCycleId: ids.rtpCycleId,
      reportType: 'board_packet',
    });
    if (reportResult.status !== 201) {
      throw new Error(`RTP packet record creation failed: ${reportResult.status} ${JSON.stringify(reportResult.data)}`);
    }
    ids.reportId = reportResult.data.reportId;
    notes.push('Created RTP board-packet record from the local API.');

    const generateResult = await appFetch(`/api/reports/${ids.reportId}/generate`, { format: 'html' });
    if (!generateResult.ok) {
      throw new Error(`RTP packet generation failed: ${generateResult.status} ${JSON.stringify(generateResult.data)}`);
    }
    notes.push('Generated the first RTP packet artifact through the existing report generation route.');

    await page.goto(`${baseUrl}/rtp`, { waitUntil: 'networkidle' });
    await page.getByText(cycleTitle, { exact: false }).first().waitFor({ timeout: 20000 });
    const openLinkedPacketLink = page.getByRole('link', { name: /Open linked packet/i }).first();
    await openLinkedPacketLink.waitFor({ timeout: 20000 });
    notes.push('RTP registry rendered the linked packet action for the generated current packet.');
    await screenshot('local-rtp-release-review-01-registry');

    await Promise.all([
      page.waitForURL(new RegExp(`/reports/${ids.reportId}#packet-release-review$`, 'i'), { timeout: 20000 }),
      openLinkedPacketLink.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { name: /Freshness against RTP source/i }).waitFor({ timeout: 20000 });
    await page.getByText(/Packet posture/i).first().waitFor({ timeout: 20000 });
    notes.push('The registry current-packet link landed on the packet release-review anchor in report detail.');
    await screenshot('local-rtp-release-review-02-report-detail');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-rtp-release-review-smoke.md`);
    const lines = [
      `# OpenPlan Local RTP Release-Review Smoke — ${datePart}`,
      '',
      `- Base URL: ${baseUrl}`,
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- RTP cycle id: ${ids.rtpCycleId ?? 'unknown'}`,
      `- Report id: ${ids.reportId ?? 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ` + artifact),
      '',
      '## Verdict',
      '- PASS: Local rendered smoke confirms RTP cycle creation, board-packet creation, artifact generation, registry linked-packet navigation, and report release-review anchor landing.',
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
