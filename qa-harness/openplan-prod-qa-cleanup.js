const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const appRoot = path.join(repoRoot, 'openplan');
const outputDate = new Date().toISOString().slice(0, 10);
const outputDir = path.join(repoRoot, `docs/ops/${outputDate}-test-output`);
const summaryPath = path.join(repoRoot, `docs/ops/${outputDate}-openplan-production-qa-cleanup.md`);
const createdAfter = process.env.CLEANUP_DATE || '2026-03-17';
const qaPattern = /qa|proof|trace|canary|debug/i;

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
    env[key] = rawValue.replace(/^(["'])(.*)\1$/, '$2');
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

const { env, envPath } = loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = env.OPENPLAN_STRIPE_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase environment keys');
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
  return { ok: response.ok, status: response.status, data, headers: Object.fromEntries(response.headers.entries()) };
}

async function restSelect(table, select, extra = '') {
  const url = `${supabaseUrl}/rest/v1/${table}?select=${select}${extra}`;
  return await jsonFetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
}

async function restDelete(table, filters) {
  const url = `${supabaseUrl}/rest/v1/${table}?${filters}`;
  return await jsonFetch(url, {
    method: 'DELETE',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=representation',
    },
  });
}

function inFilter(column, values) {
  if (!values.length) return null;
  return `${column}=in.${encodeURIComponent(`(${values.join(',')})`)}`;
}

async function expireCheckoutSession(sessionId) {
  if (!stripeKey) {
    return { sessionId, skipped: true, reason: 'Missing OPENPLAN_STRIPE_SECRET_KEY' };
  }

  const getResult = await jsonFetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      Authorization: `Bearer ${stripeKey}`,
    },
  });

  if (!getResult.ok) {
    return { sessionId, status: 'lookup_failed', detail: getResult.data };
  }

  if (getResult.data?.status !== 'open') {
    return { sessionId, status: 'already_not_open', checkoutStatus: getResult.data?.status ?? null };
  }

  const expireResult = await jsonFetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });

  return {
    sessionId,
    status: expireResult.ok ? 'expired' : 'expire_failed',
    detail: expireResult.data,
  };
}

async function listAdminUsers() {
  const pageSize = 200;
  let page = 1;
  const users = [];
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

async function deleteAuthUser(userId) {
  return await jsonFetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const summary = {
    startedAt,
    createdAfter,
    envPath,
    qaPattern: qaPattern.toString(),
    stripeSessionResults: [],
    deleteResults: [],
    verification: {},
  };

  const workspacesResult = await restSelect(
    'workspaces',
    'id,name,slug,plan,subscription_plan,subscription_status,created_at',
    `&created_at=gte.${createdAfter}T00:00:00Z&order=created_at.asc`
  );
  if (!workspacesResult.ok) throw new Error(`Failed to list workspaces: ${workspacesResult.status}`);
  const allWorkspaces = Array.isArray(workspacesResult.data) ? workspacesResult.data : [];
  const qaWorkspaces = allWorkspaces.filter((workspace) => qaPattern.test(workspace.name || ''));
  const workspaceIds = qaWorkspaces.map((workspace) => workspace.id);

  const [
    projectsResult,
    reportsResult,
    campaignsResult,
    plansResult,
    modelsResult,
    programsResult,
    projectDeliverablesResult,
    projectRisksResult,
    projectIssuesResult,
    projectDecisionsResult,
    projectMeetingsResult,
    workspaceMembersResult,
    billingEventsResult,
  ] = await Promise.all([
    restSelect('projects', 'id,workspace_id,name,created_at', `&created_at=gte.${createdAfter}T00:00:00Z&order=created_at.asc`),
    restSelect('reports', 'id,workspace_id,project_id,title,created_at', `&created_at=gte.${createdAfter}T00:00:00Z&order=created_at.asc`),
    restSelect('engagement_campaigns', 'id,workspace_id,project_id,title,created_at', `&created_at=gte.${createdAfter}T00:00:00Z&order=created_at.asc`),
    restSelect('plans', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('models', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('programs', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('project_deliverables', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('project_risks', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('project_issues', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('project_decisions', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('project_meetings', 'id,workspace_id,project_id', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('workspace_members', 'workspace_id,user_id,role', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
    restSelect('billing_events', 'id,workspace_id,event_type,payload,created_at', workspaceIds.length ? `&${inFilter('workspace_id', workspaceIds)}` : '&limit=0'),
  ]);

  const projects = (Array.isArray(projectsResult.data) ? projectsResult.data : []).filter((project) => qaPattern.test(project.name || '') || workspaceIds.includes(project.workspace_id));
  const projectIds = projects.map((project) => project.id);
  const reports = (Array.isArray(reportsResult.data) ? reportsResult.data : []).filter((report) => qaPattern.test(report.title || '') || workspaceIds.includes(report.workspace_id));
  const reportIds = reports.map((report) => report.id);
  const campaigns = (Array.isArray(campaignsResult.data) ? campaignsResult.data : []).filter((campaign) => qaPattern.test(campaign.title || '') || workspaceIds.includes(campaign.workspace_id));
  const campaignIds = campaigns.map((campaign) => campaign.id);

  const [reportArtifactsResult, reportRunsResult, reportSectionsResult, engagementCategoriesResult, engagementItemsResult] = await Promise.all([
    restSelect('report_artifacts', 'id,report_id', reportIds.length ? `&${inFilter('report_id', reportIds)}` : '&limit=0'),
    restSelect('report_runs', 'id,report_id,run_id', reportIds.length ? `&${inFilter('report_id', reportIds)}` : '&limit=0'),
    restSelect('report_sections', 'id,report_id', reportIds.length ? `&${inFilter('report_id', reportIds)}` : '&limit=0'),
    restSelect('engagement_categories', 'id,campaign_id', campaignIds.length ? `&${inFilter('campaign_id', campaignIds)}` : '&limit=0'),
    restSelect('engagement_items', 'id,campaign_id', campaignIds.length ? `&${inFilter('campaign_id', campaignIds)}` : '&limit=0'),
  ]);

  const reportArtifactIds = (Array.isArray(reportArtifactsResult.data) ? reportArtifactsResult.data : []).map((row) => row.id);
  const reportRunIds = (Array.isArray(reportRunsResult.data) ? reportRunsResult.data : []).map((row) => row.id);
  const reportSectionIds = (Array.isArray(reportSectionsResult.data) ? reportSectionsResult.data : []).map((row) => row.id);
  const engagementCategoryIds = (Array.isArray(engagementCategoriesResult.data) ? engagementCategoriesResult.data : []).map((row) => row.id);
  const engagementItemIds = (Array.isArray(engagementItemsResult.data) ? engagementItemsResult.data : []).map((row) => row.id);
  const planIds = (Array.isArray(plansResult.data) ? plansResult.data : []).map((row) => row.id);
  const modelIds = (Array.isArray(modelsResult.data) ? modelsResult.data : []).map((row) => row.id);
  const programIds = (Array.isArray(programsResult.data) ? programsResult.data : []).map((row) => row.id);
  const deliverableIds = (Array.isArray(projectDeliverablesResult.data) ? projectDeliverablesResult.data : []).map((row) => row.id);
  const riskIds = (Array.isArray(projectRisksResult.data) ? projectRisksResult.data : []).map((row) => row.id);
  const issueIds = (Array.isArray(projectIssuesResult.data) ? projectIssuesResult.data : []).map((row) => row.id);
  const decisionIds = (Array.isArray(projectDecisionsResult.data) ? projectDecisionsResult.data : []).map((row) => row.id);
  const meetingIds = (Array.isArray(projectMeetingsResult.data) ? projectMeetingsResult.data : []).map((row) => row.id);
  const billingEvents = Array.isArray(billingEventsResult.data) ? billingEventsResult.data : [];
  const stripeSessionIds = Array.from(new Set(
    billingEvents
      .map((event) => (event.payload && typeof event.payload === 'object' ? event.payload.sessionId : null))
      .filter((value) => typeof value === 'string')
  ));

  summary.targets = {
    workspaceCount: workspaceIds.length,
    projectCount: projectIds.length,
    reportCount: reportIds.length,
    campaignCount: campaignIds.length,
    usersPlanned: 0,
    workspaces: qaWorkspaces,
  };

  for (const sessionId of stripeSessionIds) {
    summary.stripeSessionResults.push(await expireCheckoutSession(sessionId));
  }

  const deleteSteps = [
    ['report_artifacts', 'id', reportArtifactIds],
    ['report_runs', 'id', reportRunIds],
    ['report_sections', 'id', reportSectionIds],
    ['engagement_items', 'id', engagementItemIds],
    ['engagement_categories', 'id', engagementCategoryIds],
    ['project_deliverables', 'id', deliverableIds],
    ['project_risks', 'id', riskIds],
    ['project_issues', 'id', issueIds],
    ['project_decisions', 'id', decisionIds],
    ['project_meetings', 'id', meetingIds],
    ['plans', 'id', planIds],
    ['models', 'id', modelIds],
    ['programs', 'id', programIds],
    ['billing_events', 'workspace_id', workspaceIds],
    ['engagement_campaigns', 'id', campaignIds],
    ['reports', 'id', reportIds],
    ['projects', 'id', projectIds],
    ['workspace_members', 'workspace_id', workspaceIds],
    ['workspaces', 'id', workspaceIds],
  ];

  for (const [table, column, values] of deleteSteps) {
    if (!values.length) continue;
    const result = await restDelete(table, inFilter(column, values));
    summary.deleteResults.push({ table, column, countPlanned: values.length, ok: result.ok, status: result.status, deletedCount: Array.isArray(result.data) ? result.data.length : null, error: result.ok ? null : result.data });
  }

  const adminUsers = await listAdminUsers();
  const qaUsers = adminUsers.filter((user) => {
    const email = user.email || '';
    const createdAt = user.created_at || '';
    return qaPattern.test(email) && createdAt >= `${createdAfter}T00:00:00`;
  });
  summary.targets.usersPlanned = qaUsers.length;
  summary.authDeletes = [];
  for (const user of qaUsers) {
    const result = await deleteAuthUser(user.id);
    summary.authDeletes.push({ userId: user.id, email: user.email, ok: result.ok, status: result.status, error: result.ok ? null : result.data });
  }

  const verifyWorkspaces = await restSelect('workspaces', 'id,name,created_at', `&created_at=gte.${createdAfter}T00:00:00Z&order=created_at.asc`);
  const remainingWorkspaces = (Array.isArray(verifyWorkspaces.data) ? verifyWorkspaces.data : []).filter((workspace) => qaPattern.test(workspace.name || ''));
  const remainingUsers = (await listAdminUsers()).filter((user) => qaPattern.test(user.email || '') && (user.created_at || '') >= `${createdAfter}T00:00:00`);
  summary.verification = {
    remainingWorkspaceCount: remainingWorkspaces.length,
    remainingUserCount: remainingUsers.length,
    remainingWorkspaces,
    remainingUsers: remainingUsers.map((user) => ({ id: user.id, email: user.email, created_at: user.created_at })),
  };

  const lines = [
    `# OpenPlan Production QA Cleanup — ${outputDate}`,
    '',
    `- Started: ${startedAt}`,
    `- Created-after filter: ${createdAfter}`,
    `- QA match rule: ${qaPattern}`,
    '',
    '## Scope',
    `- Targeted QA/debug/proof/trace/canary production records created on or after ${createdAfter}.`,
    `- Targeted workspaces: ${workspaceIds.length}`,
    `- Targeted auth users: ${summary.targets.usersPlanned}`,
    '',
    '## Stripe cleanup',
    ...(summary.stripeSessionResults.length
      ? summary.stripeSessionResults.map((item) => `- ${item.sessionId}: ${item.status || (item.skipped ? 'skipped' : 'unknown')}`)
      : ['- No Stripe checkout sessions found for targeted workspaces.']),
    '',
    '## Delete results',
    ...summary.deleteResults.map((item) => `- ${item.table}: status=${item.status} ok=${item.ok} planned=${item.countPlanned} deleted=${item.deletedCount ?? 'n/a'}`),
    '',
    '## Auth deletes',
    ...(summary.authDeletes.length
      ? summary.authDeletes.map((item) => `- ${item.email}: status=${item.status} ok=${item.ok}`)
      : ['- No matching auth users found.']),
    '',
    '## Verification',
    `- Remaining matching workspaces: ${summary.verification.remainingWorkspaceCount}`,
    `- Remaining matching auth users: ${summary.verification.remainingUserCount}`,
    '',
    '## Notes',
    '- This cleanup intentionally targeted obvious test-only records and QA identities, not user-authored production workspaces.',
    '- Historical evidence remains in repo-side docs/screenshots even after production row cleanup.',
    '',
  ];
  fs.writeFileSync(summaryPath, lines.join('\n'));
  fs.writeFileSync(path.join(outputDir, `${outputDate}-qa-cleanup-summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ success: true, summaryPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
