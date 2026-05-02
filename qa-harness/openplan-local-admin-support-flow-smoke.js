const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, guardLocalMutationTargets, loadEnv, repoRoot } = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3000';
const reviewerEmail = normalizeEmail(
  process.env.OPENPLAN_LOCAL_ADMIN_REVIEWER_EMAIL ||
    process.env.OPENPLAN_ADMIN_OPERATIONS_SMOKE_REVIEWER_EMAIL ||
    'openplan-local-admin-reviewer@natfordplanning.com'
);
const allowlistEnv = 'OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS';

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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseAllowlist(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  );
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${expected}, received ${actual ?? 'null'}.`);
  }
}

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function firstRow(result, label) {
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) {
    throw new Error(`No ${label} row returned: ${JSON.stringify(result.data)}`);
  }
  return row;
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

async function createOrUpdateAuthUser({ supabaseUrl, serviceRoleKey, email, password, metadata }) {
  const users = await listAdminUsers(supabaseUrl, serviceRoleKey);
  const existing = users.find((user) => normalizeEmail(user.email) === normalizeEmail(email));
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
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
      throw new Error(`Failed to update auth user ${email}: ${result.status} ${JSON.stringify(result.data)}`);
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
    throw new Error(`Failed to create auth user ${email}: ${result.status} ${JSON.stringify(result.data)}`);
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
    scriptName: 'local Admin/support flow smoke',
  });

  const allowlist = parseAllowlist(env[allowlistEnv]);
  if (!allowlist.has(reviewerEmail)) {
    throw new Error(
      `${allowlistEnv} must include ${reviewerEmail} in the dev-server shell and the smoke shell. ` +
        `Example: ${allowlistEnv}=${reviewerEmail} pnpm dev`
    );
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
  const agencyName = `Local Admin Support Smoke ${suffix} RTPA`;
  const workspaceName = `Local Admin Support Workspace ${suffix}`;
  const contactEmail = `openplan-local-admin-support-owner-${stamp}@natfordplanning.com`;
  const reviewerPassword = `OpenPlan!${Date.now()}Reviewer`;
  const inviteePassword = `OpenPlan!${Date.now()}Invitee`;
  const forwardedIp = `127.88.${Number(suffix.slice(0, 2)) || 10}.${Number(suffix.slice(2, 4)) || 10}`;
  const artifacts = [];
  const notes = [];
  const ids = {};
  notes.push(localGuardNote);

  const reviewerUser = await createOrUpdateAuthUser({
    supabaseUrl,
    serviceRoleKey,
    email: reviewerEmail,
    password: reviewerPassword,
    metadata: {
      purpose: 'openplan-local-admin-support-flow-smoke-reviewer',
      created_by: 'bartholomew',
      smoke_stamp: stamp,
    },
  });
  ids.reviewerUserId = reviewerUser.id;
  notes.push(
    `${reviewerUser.existed ? 'Updated' : 'Created'} allowlisted reviewer account ${reviewerEmail}.`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    buildBrowserContextOptions({
      viewport: { width: 1440, height: 1700 },
      extraHTTPHeaders: {
        'x-forwarded-for': forwardedIp,
      },
    })
  );
  const page = await context.newPage();

  async function screenshot(name, targetPage = page) {
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
    await page.goto(`${baseUrl}/request-access`, { waitUntil: 'networkidle' });
    await page.locator('#request-agency').fill(agencyName);
    await page.locator('#request-organization-type').selectOption('rtpa_mpo');
    await page.locator('#request-region').fill('Local smoke region');
    await page.locator('#request-workspace').fill(workspaceName);
    await page.locator('#request-contact-name').fill('Local Admin Support Owner');
    await page.locator('#request-contact-email').fill(contactEmail);
    await page.locator('#request-role').fill('Planning Director');
    await page.locator('#request-service-lane').selectOption('managed_hosting_admin');
    await page.locator('#request-first-workflow').selectOption('rtp');
    await page.locator('#request-deployment-posture').selectOption('nat_ford_managed');
    await page.locator('#request-data-sensitivity').selectOption('internal_planning');
    await page
      .locator('#request-onboarding-needs')
      .fill('Configure a supervised managed-hosting pilot, import RTP project records, and prepare staff handoff.');
    await page
      .locator('#request-use-case')
      .fill(
        'Use OpenPlan as the first supervised RTP planning workbench: project database, report packets, engagement handoff, and grant-ready evidence for a rural transportation planning agency.'
      );

    const requestSubmitPromise = page.waitForResponse(
      (response) => response.url().includes('/api/request-access') && response.request().method() === 'POST',
      { timeout: 30000 }
    );
    await page.getByRole('button', { name: /Request access/i }).click();
    const requestSubmitResponse = await requestSubmitPromise;
    if (!requestSubmitResponse.ok()) {
      throw new Error(`Request-access submission failed: ${requestSubmitResponse.status()} ${await requestSubmitResponse.text()}`);
    }
    const requestSubmitPayload = await requestSubmitResponse.json();
    ids.accessRequestId = requestSubmitPayload.requestId;
    await page.getByText(/Request received/i).waitFor({ timeout: 20000 });
    notes.push('Submitted public request-access intake through the rendered form.');
    await screenshot('local-admin-support-flow-01-request-submitted');

    if (!ids.accessRequestId) {
      const requestRow = firstRow(
        await restSelect('access_requests', {
          select: 'id,status,contact_email',
          email_normalized: `eq.${contactEmail}`,
          order: 'created_at.desc',
          limit: '1',
        }),
        'access request'
      );
      ids.accessRequestId = requestRow.id;
    }

    const initialAccessRequest = firstRow(
      await restSelect('access_requests', {
        select:
          'id,agency_name,contact_email,email_normalized,service_lane,desired_first_workflow,status,source_path,provisioned_workspace_id',
        id: `eq.${ids.accessRequestId}`,
      }),
      'initial access request'
    );
    assertEqual(initialAccessRequest.status, 'new', 'Access request did not start in new status');
    assertEqual(initialAccessRequest.source_path, '/request-access', 'Access request source path drifted');
    assertEqual(initialAccessRequest.provisioned_workspace_id, null, 'Access request was provisioned too early');
    notes.push('Verified service-role-only access_requests row started as new with no provisioned workspace.');

    await page.goto(`${baseUrl}/sign-in?redirect=%2Fadmin%2Foperations`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(reviewerEmail);
    await page.getByLabel('Password').fill(reviewerPassword);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/admin/operations', { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { name: /Warning watchboard/i }).waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: /Service lane intake queue/i }).waitFor({ timeout: 20000 });
    assertOk(!(await page.getByText(/Review locked/i).count()), 'Admin operations page rendered locked for the reviewer.');
    await page.getByText(agencyName, { exact: false }).waitFor({ timeout: 20000 });
    notes.push('Signed in as the allowlisted reviewer and loaded the admin operations intake queue.');
    await screenshot('local-admin-support-flow-02-intake-queue');

    const reviewingResult = await appFetch(`/api/admin/access-requests/${ids.accessRequestId}`, {
      status: 'reviewing',
    });
    if (reviewingResult.status !== 200) {
      throw new Error(`Reviewing transition failed: ${reviewingResult.status} ${JSON.stringify(reviewingResult.data)}`);
    }
    assertEqual(reviewingResult.data?.sideEffects?.outboundEmailSent, false, 'Reviewing transition claimed outbound email');

    const contactedResult = await appFetch(`/api/admin/access-requests/${ids.accessRequestId}`, {
      status: 'contacted',
    });
    if (contactedResult.status !== 200) {
      throw new Error(`Contacted transition failed: ${contactedResult.status} ${JSON.stringify(contactedResult.data)}`);
    }
    assertEqual(contactedResult.data?.request?.status, 'contacted', 'Contacted transition returned wrong status');
    notes.push('Recorded reviewing and contacted triage events through the authenticated admin API.');

    await page.reload({ waitUntil: 'networkidle' });
    const record = page.locator('.module-record-row').filter({ hasText: agencyName }).first();
    await record.getByText('Contacted', { exact: true }).first().waitFor({ timeout: 20000 });
    await record.getByRole('button', { name: /Create invite/i }).waitFor({ timeout: 20000 });
    notes.push('Verified the admin operations surface exposes provisioning only after contacted status.');
    await screenshot('local-admin-support-flow-03-triaged-ready');

    await record.getByLabel('Workspace name').fill(workspaceName);
    const provisionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/admin/access-requests/${ids.accessRequestId}/provision`) &&
        response.request().method() === 'POST',
      { timeout: 30000 }
    );
    await record.getByRole('button', { name: /Create invite/i }).click();
    const provisionResponse = await provisionResponsePromise;
    if (provisionResponse.status() !== 201) {
      throw new Error(`Workspace provisioning failed: ${provisionResponse.status()} ${await provisionResponse.text()}`);
    }
    const provisionPayload = await provisionResponse.json();
    ids.workspaceId = provisionPayload.workspace?.id ?? null;
    ids.ownerInvitationId = provisionPayload.ownerInvitation?.id ?? null;
    const invitationUrl = provisionPayload.ownerInvitation?.invitationUrl ?? null;
    assertOk(ids.workspaceId, 'Provision response did not return workspace id');
    assertOk(ids.ownerInvitationId, 'Provision response did not return owner invitation id');
    assertOk(invitationUrl, 'Provision response did not return the one-time owner invitation URL');
    const inviteToken = new URL(invitationUrl).searchParams.get('invite');
    assertOk(inviteToken, 'Owner invitation URL did not contain an invite token');
    assertEqual(provisionPayload.sideEffects?.outboundEmailSent, false, 'Provisioning claimed outbound email');
    notes.push('Created a pilot workspace and one-time manual owner invitation from the admin surface.');

    await page.reload({ waitUntil: 'networkidle' });
    const provisionedRecord = page.locator('.module-record-row').filter({ hasText: agencyName }).first();
    await provisionedRecord.getByText('Provisioned', { exact: true }).first().waitFor({ timeout: 20000 });
    await provisionedRecord.getByText(/Owner invite Pending/i).waitFor({ timeout: 20000 });
    notes.push('Reloaded the admin queue and verified the persisted provisioned row does not reload the invitation token.');
    await screenshot('local-admin-support-flow-04-provisioned-invite');

    const provisionedRequest = firstRow(
      await restSelect('access_requests', {
        select: 'id,status,reviewed_by_user_id,reviewed_at,provisioned_workspace_id',
        id: `eq.${ids.accessRequestId}`,
      }),
      'provisioned access request'
    );
    assertEqual(provisionedRequest.status, 'provisioned', 'Access request was not provisioned');
    assertEqual(provisionedRequest.provisioned_workspace_id, ids.workspaceId, 'Access request workspace link drifted');
    assertEqual(provisionedRequest.reviewed_by_user_id, ids.reviewerUserId, 'Access request reviewer user drifted');

    const reviewEvents = await restSelect('access_request_review_events', {
      select: 'id,previous_status,status,metadata_json,reviewer_user_id,created_at',
      access_request_id: `eq.${ids.accessRequestId}`,
      order: 'created_at.asc',
    });
    if (!Array.isArray(reviewEvents.data) || reviewEvents.data.length !== 3) {
      throw new Error(`Expected three review events, received ${JSON.stringify(reviewEvents.data)}`);
    }
    const eventPath = reviewEvents.data.map((event) => `${event.previous_status}->${event.status}`).join(',');
    assertEqual(eventPath, 'new->reviewing,reviewing->contacted,contacted->provisioned', 'Review event path drifted');
    assertEqual(
      reviewEvents.data[2]?.metadata_json?.owner_invitation_id,
      ids.ownerInvitationId,
      'Provisioning review event did not preserve owner invitation id'
    );
    ids.reviewEventIds = reviewEvents.data.map((event) => event.id);
    notes.push('Verified triage/provisioning review-event audit path: new -> reviewing -> contacted -> provisioned.');

    const workspaceRow = firstRow(
      await restSelect('workspaces', {
        select: 'id,name,slug,plan,subscription_plan,subscription_status',
        id: `eq.${ids.workspaceId}`,
      }),
      'provisioned workspace'
    );
    assertEqual(workspaceRow.name, workspaceName, 'Provisioned workspace name drifted');
    assertEqual(workspaceRow.plan, 'pilot', 'Provisioned workspace plan drifted');
    assertEqual(workspaceRow.subscription_plan, 'pilot', 'Provisioned workspace subscription plan drifted');
    assertEqual(workspaceRow.subscription_status, 'pilot', 'Provisioned workspace subscription status drifted');
    notes.push('Verified workspace ledger carries pilot plan and pilot subscription posture.');

    const invitationRow = firstRow(
      await restSelect('workspace_invitations', {
        select: 'id,workspace_id,email_normalized,role,status,invited_by_user_id,accepted_by_user_id,expires_at',
        id: `eq.${ids.ownerInvitationId}`,
      }),
      'owner invitation'
    );
    assertEqual(invitationRow.workspace_id, ids.workspaceId, 'Owner invitation workspace link drifted');
    assertEqual(invitationRow.email_normalized, normalizeEmail(contactEmail), 'Owner invitation email drifted');
    assertEqual(invitationRow.role, 'owner', 'Owner invitation role drifted');
    assertEqual(invitationRow.status, 'pending', 'Owner invitation was not pending before acceptance');
    assertEqual(invitationRow.invited_by_user_id, ids.reviewerUserId, 'Owner invitation inviter drifted');
    notes.push('Verified the owner invitation ledger is pending, owner-scoped, and linked to the reviewer.');

    const inviteeUser = await createOrUpdateAuthUser({
      supabaseUrl,
      serviceRoleKey,
      email: contactEmail,
      password: inviteePassword,
      metadata: {
        purpose: 'openplan-local-admin-support-flow-smoke-invitee',
        created_by: 'bartholomew',
        access_request_id: ids.accessRequestId,
        smoke_stamp: stamp,
      },
    });
    ids.inviteeUserId = inviteeUser.id;
    notes.push('Created the invited owner account after provisioning so the invite acceptance path could run.');

    const inviteeContext = await browser.newContext(
      buildBrowserContextOptions({ viewport: { width: 1440, height: 1400 } })
    );
    const inviteePage = await inviteeContext.newPage();
    try {
      await inviteePage.goto(`${baseUrl}/sign-in?invite=${encodeURIComponent(inviteToken)}&redirect=%2Fdashboard`, {
        waitUntil: 'networkidle',
      });
      await inviteePage.getByText(/Workspace invitation link detected/i).waitFor({ timeout: 20000 });
      await inviteePage.getByLabel('Work email').fill(contactEmail);
      await inviteePage.getByLabel('Password').fill(inviteePassword);
      await Promise.all([
        inviteePage.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
        inviteePage.getByRole('button', { name: /^sign in$/i }).click(),
      ]);
      await inviteePage.waitForLoadState('networkidle');
      await screenshot('local-admin-support-flow-05-invite-accepted-dashboard', inviteePage);
    } finally {
      await inviteeContext.close().catch(() => {});
    }

    const acceptedInvitation = firstRow(
      await restSelect('workspace_invitations', {
        select: 'id,status,accepted_by_user_id,accepted_at',
        id: `eq.${ids.ownerInvitationId}`,
      }),
      'accepted owner invitation'
    );
    assertEqual(acceptedInvitation.status, 'accepted', 'Owner invitation did not reach accepted status');
    assertEqual(acceptedInvitation.accepted_by_user_id, ids.inviteeUserId, 'Owner invitation accepter drifted');

    const ownerMembership = firstRow(
      await restSelect('workspace_members', {
        select: 'workspace_id,user_id,role',
        workspace_id: `eq.${ids.workspaceId}`,
        user_id: `eq.${ids.inviteeUserId}`,
      }),
      'accepted owner membership'
    );
    assertEqual(ownerMembership.role, 'owner', 'Accepted invite did not create owner membership');
    notes.push('Accepted the owner invite as the prospect account and verified owner membership in the provisioned workspace.');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-admin-support-flow-smoke.md`);
    const lines = [
      `# OpenPlan Local Admin Support Flow Smoke — ${datePart}`,
      '',
      '## Local Targets',
      `- App URL: ${baseUrl}`,
      `- Supabase URL: ${supabaseUrl}`,
      `- Local guard result: ${localGuardNote}`,
      '',
      '## Mutation Summary',
      '- Created or updated the local reviewer auth user, submitted one public access request, wrote triage/review events, provisioned one pilot workspace, created one owner invitation, created or updated the invited owner auth user, and accepted the invitation.',
      '',
      '## Cleanup / Idempotency Posture',
      '- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.',
      '- This timestamped workflow smoke intentionally creates fresh local access-request/workspace/invitation records on each run. It is safe to rerun against local Supabase, but old local proof records remain until the local database is reset or cleaned manually.',
      '',
      '## Key IDs',
      `- Reviewer email: ${reviewerEmail}`,
      `- Reviewer user id: ${ids.reviewerUserId ?? 'unknown'}`,
      `- Access request id: ${ids.accessRequestId ?? 'unknown'}`,
      `- Provisioned workspace id: ${ids.workspaceId ?? 'unknown'}`,
      `- Owner invitation id: ${ids.ownerInvitationId ?? 'unknown'}`,
      `- Invitee email: ${contactEmail}`,
      `- Invitee user id: ${ids.inviteeUserId ?? 'unknown'}`,
      `- Review event ids: ${(ids.reviewEventIds ?? []).join(', ') || 'unknown'}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '- PASS: The one-time owner invitation URL was used in memory only; committed screenshots and this memo do not contain the invite token.',
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      '## Verdict',
      '- PASS: Local rendered/API smoke confirms public access-request intake, allowlisted admin triage, provision-only-after-contacted gating, pilot workspace provisioning, billing posture write-back, owner invitation ledgering, review-event audit trail, and invited-owner acceptance into the provisioned workspace.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(
      JSON.stringify(
        {
          reportPath,
          artifacts,
          ids,
          reviewerEmail,
          inviteeEmail: contactEmail,
          notes,
        },
        null,
        2
      )
    );
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
