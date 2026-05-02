const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const {
  appRoot,
  buildBrowserContextOptions,
  getOutputDir,
  guardLocalMutationTargets,
  loadEnv,
  repoRoot,
} = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3000';

// Mirrors deterministic IDs exported by openplan/scripts/seed-nctc-demo.ts.
const DEMO = {
  workspaceId: 'd0000001-0000-4000-8000-000000000001',
  projectId: 'd0000001-0000-4000-8000-000000000003',
  rtpCycleId: 'd0000001-0000-4000-8000-000000000004',
  countyRunId: 'd0000001-0000-4000-8000-000000000005',
  projectRtpLinkId: 'd0000001-0000-4000-8000-000000000006',
  programId: 'd0000001-0000-4000-8000-000000000016',
  fundingOpportunityId: 'd0000001-0000-4000-8000-000000000018',
  projectFundingProfileId: 'd0000001-0000-4000-8000-000000000040',
  awardedFundingOpportunityId: 'd0000001-0000-4000-8000-000000000041',
  fundingAwardId: 'd0000001-0000-4000-8000-000000000042',
  reimbursementInvoiceId: 'd0000001-0000-4000-8000-000000000043',
  datasetIds: [
    'd0000001-0000-4000-8000-000000000051',
    'd0000001-0000-4000-8000-000000000052',
    'd0000001-0000-4000-8000-000000000053',
  ],
  scenarioSetId: 'd0000001-0000-4000-8000-000000000030',
  baselineRunId: 'd0000001-0000-4000-8000-000000000031',
  alternativeRunId: 'd0000001-0000-4000-8000-000000000032',
  baselineEntryId: 'd0000001-0000-4000-8000-000000000033',
  alternativeEntryId: 'd0000001-0000-4000-8000-000000000034',
  missionIds: [
    'd0000001-0000-4000-8000-000000000008',
    'd0000001-0000-4000-8000-000000000009',
    'd0000001-0000-4000-8000-00000000000a',
  ],
  packageIds: [
    'd0000001-0000-4000-8000-00000000000b',
    'd0000001-0000-4000-8000-00000000000c',
    'd0000001-0000-4000-8000-00000000000d',
  ],
  corridorIds: [
    'd0000001-0000-4000-8000-00000000000e',
    'd0000001-0000-4000-8000-00000000000f',
  ],
  engagementCampaignId: 'd0000001-0000-4000-8000-000000000010',
  engagementItemIds: [
    'd0000001-0000-4000-8000-000000000011',
    'd0000001-0000-4000-8000-000000000012',
    'd0000001-0000-4000-8000-000000000013',
    'd0000001-0000-4000-8000-000000000014',
  ],
};

const DEMO_PROJECT_NAME = 'NCTC 2045 RTP (proof-of-capability)';
const DEMO_ALTERNATIVE_RUN_TITLE = 'NCTC SR-49 safety package screening run';
const QA_EMAIL = 'openplan-local-spine-smoke@natfordplanning.com';
const SPINE_REPORT_TITLE_PREFIX = 'NCTC Phase 1 Spine Smoke';

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

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${expected}, received ${actual ?? 'null'}.`);
  }
}

function assertArray(result, label) {
  if (!result.ok) {
    throw new Error(`${label} query failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  if (!Array.isArray(result.data)) {
    throw new Error(`${label} query did not return an array: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

function firstRow(result, label) {
  const rows = assertArray(result, label);
  const row = rows[0] ?? null;
  if (!row) {
    throw new Error(`No ${label} row returned: ${JSON.stringify(result.data)}`);
  }
  return row;
}

function assertRowCount(rows, expectedCount, label) {
  if (rows.length !== expectedCount) {
    throw new Error(`${label} count drifted. Expected ${expectedCount}, received ${rows.length}.`);
  }
}

function assertEvery(rows, predicate, label) {
  const failed = rows.filter((row) => !predicate(row));
  if (failed.length > 0) {
    throw new Error(`${label} had rows outside the expected spine: ${JSON.stringify(failed)}`);
  }
}

function inFilter(values) {
  return `in.(${values.join(',')})`;
}

function tail(text, maxChars = 6000) {
  if (!text) return '';
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

function runNctcSeed(env, notes) {
  const result = spawnSync('pnpm', ['seed:nctc'], {
    cwd: appRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `pnpm seed:nctc failed with status ${result.status}\nSTDOUT:\n${tail(result.stdout)}\nSTDERR:\n${tail(result.stderr)}`
    );
  }

  notes.push('Ran pnpm seed:nctc and the deterministic NCTC fixture completed.');
}

async function listAdminUsers(supabaseUrl, serviceRoleKey) {
  const users = [];
  const pageSize = 200;
  let page = 1;

  while (true) {
    const result = await jsonFetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${pageSize}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!result.ok) {
      throw new Error(`Failed to list auth users: ${result.status} ${JSON.stringify(result.data)}`);
    }

    const batch = Array.isArray(result.data?.users) ? result.data.users : [];
    users.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }

  return users;
}

async function createOrUpdateAuthUser({ supabaseUrl, serviceRoleKey, email, password }) {
  const users = await listAdminUsers(supabaseUrl, serviceRoleKey);
  const existing = users.find((user) => String(user.email || '').toLowerCase() === email.toLowerCase());
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  const metadata = {
    purpose: 'openplan-local-spine-smoke',
    created_by: 'qa-harness',
    smoke_updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const result = await jsonFetch(`${supabaseUrl}/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        password,
        email_confirm: true,
        user_metadata: metadata,
      }),
    });

    if (!result.ok) {
      throw new Error(`Failed to update QA auth user ${email}: ${result.status} ${JSON.stringify(result.data)}`);
    }

    return {
      id: result.data?.user?.id ?? result.data?.id ?? existing.id,
      existed: true,
    };
  }

  const result = await jsonFetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    }),
  });

  if (!result.ok) {
    throw new Error(`Failed to create QA auth user ${email}: ${result.status} ${JSON.stringify(result.data)}`);
  }

  return {
    id: result.data?.user?.id ?? result.data?.id ?? null,
    existed: false,
  };
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
    scriptName: 'local Phase 1 spine smoke',
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

  async function restUpsert(table, payload, onConflict) {
    const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
    return jsonFetch(`${supabaseUrl}/rest/v1/${table}${query}`, {
      method: 'POST',
      headers: {
        ...restHeaders,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    });
  }

  async function restDelete(table, params) {
    const query = new URLSearchParams(params);
    return jsonFetch(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, {
      method: 'DELETE',
      headers: {
        ...restHeaders,
        Prefer: 'return=minimal',
      },
    });
  }

  async function selectRows(table, params, label) {
    return assertArray(await restSelect(table, params), label);
  }

  async function deleteRows(table, params, label) {
    const result = await restDelete(table, params);
    if (!result.ok) {
      throw new Error(`${label} delete failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
  }

  async function cleanupPriorSpineReports() {
    const priorReports = await selectRows(
      'reports',
      {
        select: 'id,title',
        workspace_id: `eq.${DEMO.workspaceId}`,
        project_id: `eq.${DEMO.projectId}`,
        title: `like.${SPINE_REPORT_TITLE_PREFIX}*`,
      },
      'prior spine smoke reports'
    );
    const reportIds = priorReports.map((report) => report.id).filter(Boolean);
    const summary = {
      reportCount: reportIds.length,
      artifactCount: 0,
      sectionCount: 0,
      runLinkCount: 0,
    };

    if (!reportIds.length) {
      return summary;
    }

    const reportIdFilter = inFilter(reportIds);
    const artifacts = await selectRows(
      'report_artifacts',
      { select: 'id,report_id', report_id: reportIdFilter },
      'prior spine report artifacts'
    );
    const sections = await selectRows(
      'report_sections',
      { select: 'id,report_id', report_id: reportIdFilter },
      'prior spine report sections'
    );
    const runLinks = await selectRows(
      'report_runs',
      { select: 'id,report_id', report_id: reportIdFilter },
      'prior spine report run links'
    );
    summary.artifactCount = artifacts.length;
    summary.sectionCount = sections.length;
    summary.runLinkCount = runLinks.length;

    await deleteRows('report_artifacts', { report_id: reportIdFilter }, 'prior spine report artifacts');
    await deleteRows('report_sections', { report_id: reportIdFilter }, 'prior spine report sections');
    await deleteRows('report_runs', { report_id: reportIdFilter }, 'prior spine report run links');
    await deleteRows('reports', { id: reportIdFilter }, 'prior spine smoke reports');

    return summary;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const password = `OpenPlan!${Date.now()}SpineSmoke`;
  const reportTitle = `${SPINE_REPORT_TITLE_PREFIX} ${stamp}`;
  const artifacts = [];
  const notes = [];
  const ids = {
    workspaceId: DEMO.workspaceId,
    projectId: DEMO.projectId,
    rtpCycleId: DEMO.rtpCycleId,
    countyRunId: DEMO.countyRunId,
    baselineRunId: DEMO.baselineRunId,
    alternativeRunId: DEMO.alternativeRunId,
  };
  notes.push(localGuardNote);

  runNctcSeed(env, notes);
  const cleanupSummary = await cleanupPriorSpineReports();
  notes.push(
    `Removed ${cleanupSummary.reportCount} prior spine-smoke report(s), ${cleanupSummary.artifactCount} artifact(s), ${cleanupSummary.sectionCount} section(s), and ${cleanupSummary.runLinkCount} report-run link(s) before creating the fresh report.`
  );

  const qaUser = await createOrUpdateAuthUser({
    supabaseUrl,
    serviceRoleKey,
    email: QA_EMAIL,
    password,
  });
  ids.userId = qaUser.id;
  assertOk(ids.userId, 'QA auth user did not return an id.');
  notes.push(`${qaUser.existed ? 'Updated' : 'Created'} deterministic QA auth user ${QA_EMAIL}.`);

  const membershipUpsert = await restUpsert(
    'workspace_members',
    {
      workspace_id: DEMO.workspaceId,
      user_id: ids.userId,
      role: 'owner',
    },
    'workspace_id,user_id'
  );
  if (!membershipUpsert.ok) {
    throw new Error(`Failed to upsert QA membership: ${membershipUpsert.status} ${JSON.stringify(membershipUpsert.data)}`);
  }
  notes.push('Attached the QA user to the seeded NCTC demo workspace.');

  const extraMembershipCleanup = await restDelete('workspace_members', {
    user_id: `eq.${ids.userId}`,
    workspace_id: `neq.${DEMO.workspaceId}`,
  });
  if (!extraMembershipCleanup.ok) {
    throw new Error(
      `Failed to scope QA user memberships: ${extraMembershipCleanup.status} ${JSON.stringify(extraMembershipCleanup.data)}`
    );
  }
  notes.push('Scoped the QA login to the NCTC workspace so current-workspace map APIs load the seeded spine.');

  const workspace = firstRow(
    await restSelect('workspaces', {
      select: 'id,name,slug,is_demo,subscription_status',
      id: `eq.${DEMO.workspaceId}`,
    }),
    'NCTC workspace'
  );
  assertEqual(workspace.id, DEMO.workspaceId, 'Workspace id drifted');
  assertEqual(workspace.is_demo, true, 'NCTC workspace demo flag drifted');

  const project = firstRow(
    await restSelect('projects', {
      select: 'id,workspace_id,name,plan_type,delivery_phase,latitude,longitude',
      id: `eq.${DEMO.projectId}`,
    }),
    'NCTC project'
  );
  assertEqual(project.id, DEMO.projectId, 'Project id drifted');
  assertEqual(project.workspace_id, DEMO.workspaceId, 'Project workspace drifted');
  assertEqual(project.name, DEMO_PROJECT_NAME, 'Project name drifted');
  notes.push('Verified the canonical NCTC project exists once in the seeded workspace.');

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
    await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(QA_EMAIL);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    notes.push('Signed into the local app through Playwright as the QA user.');

    const currentWorkspaceResult = await appFetch('/api/workspaces/current');
    if (currentWorkspaceResult.status !== 200) {
      throw new Error(
        `Current workspace lookup failed: ${currentWorkspaceResult.status} ${JSON.stringify(currentWorkspaceResult.data)}`
      );
    }
    assertEqual(
      currentWorkspaceResult.data.workspaceId,
      DEMO.workspaceId,
      'Current workspace selection did not resolve to the NCTC demo workspace'
    );
    notes.push('Verified current workspace selection resolves to the NCTC demo workspace.');

    const mapProjects = await appFetch('/api/map-features/projects');
    if (mapProjects.status !== 200) {
      throw new Error(`Project map feature lookup failed: ${mapProjects.status} ${JSON.stringify(mapProjects.data)}`);
    }
    assertOk(
      Array.isArray(mapProjects.data.features) &&
        mapProjects.data.features.some((feature) => feature.properties?.projectId === DEMO.projectId),
      'Project map features did not include the seeded NCTC project.'
    );

    const mapRtpCycles = await appFetch('/api/map-features/rtp-cycles');
    if (mapRtpCycles.status !== 200) {
      throw new Error(`RTP map feature lookup failed: ${mapRtpCycles.status} ${JSON.stringify(mapRtpCycles.data)}`);
    }
    assertOk(
      Array.isArray(mapRtpCycles.data.features) &&
        mapRtpCycles.data.features.some((feature) => feature.properties?.rtpCycleId === DEMO.rtpCycleId),
      'RTP map features did not include the seeded RTP cycle.'
    );

    const mapCorridors = await appFetch('/api/map-features/corridors');
    if (mapCorridors.status !== 200) {
      throw new Error(`Corridor map feature lookup failed: ${mapCorridors.status} ${JSON.stringify(mapCorridors.data)}`);
    }
    assertOk(
      Array.isArray(mapCorridors.data.features) &&
        DEMO.corridorIds.every((corridorId) =>
          mapCorridors.data.features.some((feature) => feature.properties?.corridorId === corridorId)
        ),
      'Corridor map features did not include every seeded project corridor.'
    );

    const mapAerial = await appFetch('/api/map-features/aerial-missions');
    if (mapAerial.status !== 200) {
      throw new Error(`Aerial map feature lookup failed: ${mapAerial.status} ${JSON.stringify(mapAerial.data)}`);
    }
    assertOk(
      Array.isArray(mapAerial.data.features) &&
        DEMO.missionIds.every((missionId) =>
          mapAerial.data.features.some((feature) => feature.properties?.missionId === missionId)
        ),
      'Aerial map features did not include every seeded aerial mission.'
    );

    const mapEngagement = await appFetch('/api/map-features/engagement');
    if (mapEngagement.status !== 200) {
      throw new Error(`Engagement map feature lookup failed: ${mapEngagement.status} ${JSON.stringify(mapEngagement.data)}`);
    }
    assertOk(
      Array.isArray(mapEngagement.data.features) &&
        DEMO.engagementItemIds.every((itemId) =>
          mapEngagement.data.features.some((feature) => feature.properties?.itemId === itemId)
        ),
      'Engagement map features did not include every seeded approved engagement item.'
    );
    notes.push('Verified map feature APIs expose the seeded project, RTP cycle, corridors, aerial AOIs, and engagement points.');

    const reportResult = await appFetch('/api/reports', {
      projectId: DEMO.projectId,
      reportType: 'analysis_summary',
      title: reportTitle,
      summary:
        'Local Phase 1 spine smoke report tying the NCTC project to seeded scenario runs and the county-run modeling evidence backbone.',
      modelingCountyRunId: DEMO.countyRunId,
      runIds: [DEMO.baselineRunId, DEMO.alternativeRunId],
    });
    if (reportResult.status !== 201) {
      throw new Error(`Project-targeted report creation failed: ${reportResult.status} ${JSON.stringify(reportResult.data)}`);
    }
    ids.reportId = reportResult.data.reportId;
    notes.push('Created a project-targeted analysis_summary report through /api/reports.');

    await page.goto(`${baseUrl}/projects/${DEMO.projectId}`, { waitUntil: 'networkidle' });
    await page.getByText(DEMO_PROJECT_NAME, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.getByText(/Aerial evidence/i).first().waitFor({ timeout: 30000 });
    await screenshot('local-spine-smoke-01-project-detail');
    notes.push('Rendered the seeded project detail surface with the shared project spine.');

    await page.goto(`${baseUrl}/reports/${ids.reportId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: reportTitle, exact: false }).waitFor({ timeout: 30000 });
    await page.getByText(/Linked runs/i).first().waitFor({ timeout: 30000 });
    await page.getByText(DEMO_ALTERNATIVE_RUN_TITLE, { exact: false }).first().waitFor({ timeout: 30000 });
    await screenshot('local-spine-smoke-02-report-detail');
    notes.push('Rendered the project-targeted report detail page with both seeded analysis runs linked.');

    const projectRtpLink = firstRow(
      await restSelect('project_rtp_cycle_links', {
        select: 'id,workspace_id,project_id,rtp_cycle_id,portfolio_role',
        id: `eq.${DEMO.projectRtpLinkId}`,
      }),
      'project RTP cycle link'
    );
    assertEqual(projectRtpLink.project_id, DEMO.projectId, 'RTP link project id drifted');
    assertEqual(projectRtpLink.rtp_cycle_id, DEMO.rtpCycleId, 'RTP link cycle id drifted');
    notes.push('Verified RTP linkage reuses the canonical project_id.');

    const rtpCycle = firstRow(
      await restSelect('rtp_cycles', {
        select: 'id,workspace_id,title,status',
        id: `eq.${DEMO.rtpCycleId}`,
      }),
      'RTP cycle'
    );
    assertEqual(rtpCycle.workspace_id, DEMO.workspaceId, 'RTP cycle workspace drifted');

    const fundingProfile = firstRow(
      await restSelect('project_funding_profiles', {
        select: 'id,workspace_id,project_id,funding_need_amount,local_match_need_amount',
        id: `eq.${DEMO.projectFundingProfileId}`,
      }),
      'project funding profile'
    );
    assertEqual(fundingProfile.project_id, DEMO.projectId, 'Funding profile project id drifted');

    const program = firstRow(
      await restSelect('programs', {
        select: 'id,workspace_id,project_id,title,status,program_type',
        id: `eq.${DEMO.programId}`,
      }),
      'program'
    );
    assertEqual(program.project_id, DEMO.projectId, 'Program project id drifted');

    const opportunities = assertArray(
      await restSelect('funding_opportunities', {
        select: 'id,workspace_id,program_id,project_id,title,opportunity_status,decision_state',
        id: inFilter([DEMO.fundingOpportunityId, DEMO.awardedFundingOpportunityId]),
        order: 'id.asc',
      }),
      'funding opportunities'
    );
    assertRowCount(opportunities, 2, 'funding opportunities');
    assertEvery(opportunities, (row) => row.project_id === DEMO.projectId && row.program_id === DEMO.programId, 'funding opportunities');

    const award = firstRow(
      await restSelect('funding_awards', {
        select: 'id,workspace_id,project_id,program_id,funding_opportunity_id,title,awarded_amount',
        id: `eq.${DEMO.fundingAwardId}`,
      }),
      'funding award'
    );
    assertEqual(award.project_id, DEMO.projectId, 'Funding award project id drifted');
    assertEqual(award.funding_opportunity_id, DEMO.awardedFundingOpportunityId, 'Funding award opportunity id drifted');

    const invoice = firstRow(
      await restSelect('billing_invoice_records', {
        select: 'id,workspace_id,project_id,funding_award_id,invoice_number,status,amount',
        id: `eq.${DEMO.reimbursementInvoiceId}`,
      }),
      'billing invoice record'
    );
    assertEqual(invoice.project_id, DEMO.projectId, 'Billing invoice project id drifted');
    assertEqual(invoice.funding_award_id, DEMO.fundingAwardId, 'Billing invoice award id drifted');
    notes.push('Verified grants funding profile, program, opportunities, award, and invoice all reuse the canonical project_id.');

    const engagementCampaign = firstRow(
      await restSelect('engagement_campaigns', {
        select: 'id,workspace_id,project_id,rtp_cycle_id,title,status',
        id: `eq.${DEMO.engagementCampaignId}`,
      }),
      'engagement campaign'
    );
    assertEqual(engagementCampaign.project_id, DEMO.projectId, 'Engagement campaign project id drifted');
    assertEqual(engagementCampaign.rtp_cycle_id, DEMO.rtpCycleId, 'Engagement campaign RTP cycle id drifted');

    const engagementItems = assertArray(
      await restSelect('engagement_items', {
        select: 'id,campaign_id,title,status,source_type,latitude,longitude',
        id: inFilter(DEMO.engagementItemIds),
        order: 'id.asc',
      }),
      'engagement items'
    );
    assertRowCount(engagementItems, DEMO.engagementItemIds.length, 'engagement items');
    assertEvery(engagementItems, (row) => row.campaign_id === DEMO.engagementCampaignId, 'engagement items');
    notes.push('Verified engagement campaign and items hang from the same project/RTP spine.');

    const scenarioSet = firstRow(
      await restSelect('scenario_sets', {
        select: 'id,workspace_id,project_id,title,baseline_entry_id,status',
        id: `eq.${DEMO.scenarioSetId}`,
      }),
      'scenario set'
    );
    assertEqual(scenarioSet.project_id, DEMO.projectId, 'Scenario set project id drifted');
    assertEqual(scenarioSet.baseline_entry_id, DEMO.baselineEntryId, 'Scenario baseline entry id drifted');

    const scenarioEntries = assertArray(
      await restSelect('scenario_entries', {
        select: 'id,scenario_set_id,entry_type,label,attached_run_id,status,sort_order',
        id: inFilter([DEMO.baselineEntryId, DEMO.alternativeEntryId]),
        order: 'sort_order.asc',
      }),
      'scenario entries'
    );
    assertRowCount(scenarioEntries, 2, 'scenario entries');
    assertEvery(scenarioEntries, (row) => row.scenario_set_id === DEMO.scenarioSetId && row.status === 'ready', 'scenario entries');
    assertOk(
      scenarioEntries.some((row) => row.attached_run_id === DEMO.baselineRunId) &&
        scenarioEntries.some((row) => row.attached_run_id === DEMO.alternativeRunId),
      'Scenario entries are not attached to both seeded runs.'
    );

    const runs = assertArray(
      await restSelect('runs', {
        select: 'id,workspace_id,title,metrics,summary_text',
        id: inFilter([DEMO.baselineRunId, DEMO.alternativeRunId]),
        order: 'id.asc',
      }),
      'analysis runs'
    );
    assertRowCount(runs, 2, 'analysis runs');
    assertEvery(runs, (row) => row.workspace_id === DEMO.workspaceId && row.metrics && row.summary_text, 'analysis runs');

    const countyRun = firstRow(
      await restSelect('county_runs', {
        select: 'id,workspace_id,geography_id,run_name,stage,status_label',
        id: `eq.${DEMO.countyRunId}`,
      }),
      'county run'
    );
    assertEqual(countyRun.workspace_id, DEMO.workspaceId, 'County run workspace drifted');
    assertEqual(countyRun.stage, 'validated-screening', 'County run stage drifted');

    const sourceManifests = assertArray(
      await restSelect('modeling_source_manifests', {
        select: 'id,workspace_id,county_run_id,source_key,source_kind,source_label',
        county_run_id: `eq.${DEMO.countyRunId}`,
      }),
      'modeling source manifests'
    );
    assertOk(sourceManifests.length > 0, 'No modeling source manifests were linked to the seeded county run.');
    assertEvery(sourceManifests, (row) => row.workspace_id === DEMO.workspaceId, 'modeling source manifests');

    const validationRows = assertArray(
      await restSelect('modeling_validation_results', {
        select: 'id,workspace_id,county_run_id,track,metric_key,status',
        county_run_id: `eq.${DEMO.countyRunId}`,
      }),
      'modeling validation results'
    );
    assertOk(validationRows.length > 0, 'No modeling validation results were linked to the seeded county run.');
    assertEvery(validationRows, (row) => row.workspace_id === DEMO.workspaceId, 'modeling validation results');

    const claimDecision = firstRow(
      await restSelect('modeling_claim_decisions', {
        select: 'id,workspace_id,county_run_id,track,claim_status,status_reason',
        county_run_id: `eq.${DEMO.countyRunId}`,
      }),
      'modeling claim decision'
    );
    assertEqual(claimDecision.workspace_id, DEMO.workspaceId, 'Modeling claim decision workspace drifted');
    notes.push('Verified scenario runs, county run, and modeling evidence backbone rows share the seeded workspace/project spine.');

    const reportRow = firstRow(
      await restSelect('reports', {
        select: 'id,workspace_id,project_id,rtp_cycle_id,modeling_county_run_id,title,report_type,status',
        id: `eq.${ids.reportId}`,
      }),
      'project-targeted report'
    );
    assertEqual(reportRow.workspace_id, DEMO.workspaceId, 'Report workspace drifted');
    assertEqual(reportRow.project_id, DEMO.projectId, 'Report project id drifted');
    assertEqual(reportRow.modeling_county_run_id, DEMO.countyRunId, 'Report modeling county run id drifted');
    assertEqual(reportRow.report_type, 'analysis_summary', 'Report type drifted');

    const reportRuns = assertArray(
      await restSelect('report_runs', {
        select: 'id,report_id,run_id,sort_order',
        report_id: `eq.${ids.reportId}`,
        order: 'sort_order.asc',
      }),
      'report runs'
    );
    assertRowCount(reportRuns, 2, 'report run links');
    assertEqual(reportRuns[0].run_id, DEMO.baselineRunId, 'First report run link drifted');
    assertEqual(reportRuns[1].run_id, DEMO.alternativeRunId, 'Second report run link drifted');
    ids.reportRunIds = reportRuns.map((row) => row.id);
    notes.push('Verified the project-targeted report and report_runs preserve county-run and seeded run linkage.');

    const datasetLinks = assertArray(
      await restSelect('data_dataset_project_links', {
        select: 'dataset_id,project_id,relationship_type',
        project_id: `eq.${DEMO.projectId}`,
        order: 'dataset_id.asc',
      }),
      'data dataset project links'
    );
    assertRowCount(datasetLinks, DEMO.datasetIds.length, 'data dataset project links');
    assertEvery(datasetLinks, (row) => row.project_id === DEMO.projectId, 'data dataset project links');

    const corridors = assertArray(
      await restSelect('project_corridors', {
        select: 'id,workspace_id,project_id,name,corridor_type,los_grade,geometry_geojson',
        id: inFilter(DEMO.corridorIds),
        order: 'id.asc',
      }),
      'project corridors'
    );
    assertRowCount(corridors, DEMO.corridorIds.length, 'project corridors');
    assertEvery(corridors, (row) => row.workspace_id === DEMO.workspaceId && row.project_id === DEMO.projectId, 'project corridors');

    const missions = assertArray(
      await restSelect('aerial_missions', {
        select: 'id,workspace_id,project_id,title,status,mission_type,aoi_geojson',
        id: inFilter(DEMO.missionIds),
        order: 'id.asc',
      }),
      'aerial missions'
    );
    assertRowCount(missions, DEMO.missionIds.length, 'aerial missions');
    assertEvery(missions, (row) => row.workspace_id === DEMO.workspaceId && row.project_id === DEMO.projectId, 'aerial missions');

    const packages = assertArray(
      await restSelect('aerial_evidence_packages', {
        select: 'id,workspace_id,project_id,mission_id,title,status,verification_readiness',
        id: inFilter(DEMO.packageIds),
        order: 'id.asc',
      }),
      'aerial evidence packages'
    );
    assertRowCount(packages, DEMO.packageIds.length, 'aerial evidence packages');
    assertEvery(packages, (row) => row.workspace_id === DEMO.workspaceId && row.project_id === DEMO.projectId, 'aerial evidence packages');
    notes.push('Verified Data Hub, corridor map, aerial mission, and aerial evidence rows all reuse the canonical project_id.');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-spine-smoke.md`);
    const lines = [
      `# OpenPlan Local Phase 1 Spine Smoke - ${datePart}`,
      '',
      '## Local Targets',
      `- App URL: ${baseUrl}`,
      `- Supabase URL: ${supabaseUrl}`,
      `- Local guard result: ${localGuardNote}`,
      '',
      '## Mutation Summary',
      '- Refreshed the deterministic NCTC seed, scoped one deterministic local QA user to the NCTC workspace, and created one fresh project-targeted analysis_summary report with two report_run links.',
      '',
      '## Cleanup / Idempotency Posture',
      `- Before creating the report, the harness deletes prior harness-owned reports whose title starts with \`${SPINE_REPORT_TITLE_PREFIX}\` in the deterministic NCTC workspace/project, plus their report artifacts, sections, and report_run links.`,
      `- Cleanup removed ${cleanupSummary.reportCount} report(s), ${cleanupSummary.artifactCount} artifact(s), ${cleanupSummary.sectionCount} section(s), and ${cleanupSummary.runLinkCount} report_run link(s).`,
      '- The NCTC seed and QA membership are deterministic; the only fresh harness residue after a successful run is the current proof report and screenshots.',
      '',
      '## Key IDs',
      `- QA user email: ${QA_EMAIL}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId}`,
      `- Project id: ${ids.projectId}`,
      `- RTP cycle id: ${ids.rtpCycleId}`,
      `- Project RTP link id: ${DEMO.projectRtpLinkId}`,
      `- Program id: ${DEMO.programId}`,
      `- Funding opportunity ids: ${DEMO.fundingOpportunityId}, ${DEMO.awardedFundingOpportunityId}`,
      `- Funding award id: ${DEMO.fundingAwardId}`,
      `- Billing invoice id: ${DEMO.reimbursementInvoiceId}`,
      `- Engagement campaign id: ${DEMO.engagementCampaignId}`,
      `- Engagement item ids: ${DEMO.engagementItemIds.join(', ')}`,
      `- Scenario set id: ${DEMO.scenarioSetId}`,
      `- Scenario entry ids: ${DEMO.baselineEntryId}, ${DEMO.alternativeEntryId}`,
      `- Linked run ids: ${DEMO.baselineRunId}, ${DEMO.alternativeRunId}`,
      `- County run id: ${DEMO.countyRunId}`,
      `- Project-targeted report id: ${ids.reportId ?? 'unknown'}`,
      `- Report run link ids: ${ids.reportRunIds?.join(', ') ?? 'unknown'}`,
      `- Data dataset ids: ${DEMO.datasetIds.join(', ')}`,
      `- Project corridor ids: ${DEMO.corridorIds.join(', ')}`,
      `- Aerial mission ids: ${DEMO.missionIds.join(', ')}`,
      `- Aerial evidence package ids: ${DEMO.packageIds.join(', ')}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      `- PASS: Local API/rendered smoke confirms project_id ${DEMO.projectId} is reused across RTP, grants, engagement, analysis/scenario runs, county-run modeling evidence, project-targeted report/report_runs, Data Hub, map corridor rows, aerial missions, and aerial evidence packages without creating a duplicate project.`,
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(JSON.stringify({ reportPath, artifacts, cleanupSummary, ids, notes }, null, 2));
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
