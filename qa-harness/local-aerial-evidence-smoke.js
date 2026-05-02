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
const baseUrl = process.env.OPENPLAN_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

// Mirrors deterministic IDs exported by openplan/scripts/seed-nctc-demo.ts.
const DEMO = {
  workspaceId: 'd0000001-0000-4000-8000-000000000001',
  projectId: 'd0000001-0000-4000-8000-000000000003',
};

const DEMO_PROJECT_NAME = 'NCTC 2045 RTP (proof-of-capability)';
const QA_EMAIL = 'openplan-local-aerial-evidence-smoke@natfordplanning.com';
const MISSION_TITLE_PREFIX = 'NCTC local Aerial evidence smoke';
const PACKAGE_TITLE_PREFIX = 'NCTC local Aerial ready package';
const SEEDED_MISSION_COUNT = 3;
const SEEDED_READY_PACKAGE_COUNT = 2;
const EXPECTED_POST_RUN_MISSION_COUNT = SEEDED_MISSION_COUNT + 1;
const EXPECTED_POST_RUN_READY_PACKAGE_COUNT = SEEDED_READY_PACKAGE_COUNT + 1;

const LOCAL_AOI_GEOJSON = {
  type: 'Polygon',
  coordinates: [
    [
      [-121.0466, 39.2348],
      [-121.0379, 39.2447],
      [-121.0248, 39.2415],
      [-121.0274, 39.2293],
      [-121.0408, 39.2279],
      [-121.0466, 39.2348],
    ],
  ],
};

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

  notes.push('Ran pnpm seed:nctc from openplan/ and refreshed the deterministic NCTC fixture.');
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
    purpose: 'openplan-local-aerial-evidence-smoke',
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
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const localGuardNote = guardLocalMutationTargets({
    appUrl: baseUrl,
    supabaseUrl,
    scriptName: 'local Aerial evidence smoke',
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

  function inFilter(values) {
    return `in.(${values.join(',')})`;
  }

  async function selectRows(table, params, label) {
    return assertArray(await restSelect(table, params), label);
  }

  async function deleteRowsByIds(table, idsToDelete, label) {
    if (!idsToDelete.length) {
      return;
    }
    const result = await restDelete(table, { id: inFilter(idsToDelete) });
    if (!result.ok) {
      throw new Error(`${label} delete failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
  }

  function summarizeAerialRows(missions, packages) {
    return {
      missionCount: missions.length,
      packageCount: packages.length,
      readyPackageCount: packages.filter((row) => row.verification_readiness === 'ready').length,
    };
  }

  async function readAerialCounts(label) {
    const missions = await selectRows(
      'aerial_missions',
      {
        select: 'id,title,status',
        workspace_id: `eq.${DEMO.workspaceId}`,
        project_id: `eq.${DEMO.projectId}`,
      },
      `${label} missions`
    );
    const packages = await selectRows(
      'aerial_evidence_packages',
      {
        select: 'id,mission_id,title,status,verification_readiness',
        workspace_id: `eq.${DEMO.workspaceId}`,
        project_id: `eq.${DEMO.projectId}`,
      },
      `${label} packages`
    );
    return summarizeAerialRows(missions, packages);
  }

  async function cleanupPriorAerialSmokeRows() {
    const preCleanupCounts = await readAerialCounts('pre-cleanup aerial');
    const staleMissions = await selectRows(
      'aerial_missions',
      {
        select: 'id,title',
        workspace_id: `eq.${DEMO.workspaceId}`,
        project_id: `eq.${DEMO.projectId}`,
        title: `like.${MISSION_TITLE_PREFIX}*`,
      },
      'prior aerial smoke missions'
    );
    const staleMissionIds = staleMissions.map((mission) => mission.id).filter(Boolean);

    const stalePackages = new Map();
    for (const row of await selectRows(
      'aerial_evidence_packages',
      {
        select: 'id,mission_id,title',
        workspace_id: `eq.${DEMO.workspaceId}`,
        project_id: `eq.${DEMO.projectId}`,
        title: `like.${PACKAGE_TITLE_PREFIX}*`,
      },
      'prior aerial smoke packages by title'
    )) {
      stalePackages.set(row.id, row);
    }

    if (staleMissionIds.length) {
      for (const row of await selectRows(
        'aerial_evidence_packages',
        {
          select: 'id,mission_id,title',
          workspace_id: `eq.${DEMO.workspaceId}`,
          project_id: `eq.${DEMO.projectId}`,
          mission_id: inFilter(staleMissionIds),
        },
        'prior aerial smoke packages by mission'
      )) {
        stalePackages.set(row.id, row);
      }
    }

    const stalePackageIds = [...stalePackages.keys()];
    await deleteRowsByIds('aerial_evidence_packages', stalePackageIds, 'prior aerial smoke packages');
    await deleteRowsByIds('aerial_missions', staleMissionIds, 'prior aerial smoke missions');

    const postCleanupCounts = await readAerialCounts('post-cleanup aerial');
    return {
      preCleanupCounts,
      postCleanupCounts,
      removedMissionCount: staleMissionIds.length,
      removedPackageCount: stalePackageIds.length,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const password = `OpenPlan!${Date.now()}AerialEvidenceSmoke`;
  const missionTitle = `${MISSION_TITLE_PREFIX} ${stamp}`;
  const packageTitle = `${PACKAGE_TITLE_PREFIX} ${stamp}`;
  const mutationStartedAt = new Date();
  const artifacts = [];
  const notes = [];
  const ids = {
    workspaceId: DEMO.workspaceId,
    projectId: DEMO.projectId,
  };
  notes.push(localGuardNote);

  runNctcSeed(env, notes);
  const cleanupSummary = await cleanupPriorAerialSmokeRows();
  assertEqual(
    cleanupSummary.postCleanupCounts.missionCount,
    SEEDED_MISSION_COUNT,
    'Post-cleanup seeded aerial mission count drifted'
  );
  assertEqual(
    cleanupSummary.postCleanupCounts.readyPackageCount,
    SEEDED_READY_PACKAGE_COUNT,
    'Post-cleanup seeded ready-package count drifted'
  );
  notes.push(
    `Cleaned stale harness aerial rows before mutation: ${cleanupSummary.removedMissionCount} mission(s) and ${cleanupSummary.removedPackageCount} package(s) removed.`
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

  const extraMembershipCleanup = await restDelete('workspace_members', {
    user_id: `eq.${ids.userId}`,
    workspace_id: `neq.${DEMO.workspaceId}`,
  });
  if (!extraMembershipCleanup.ok) {
    throw new Error(
      `Failed to scope QA user memberships: ${extraMembershipCleanup.status} ${JSON.stringify(extraMembershipCleanup.data)}`
    );
  }
  notes.push('Attached the QA user only to the seeded NCTC workspace.');

  const canonicalProjects = assertArray(
    await restSelect('projects', {
      select: 'id,workspace_id,name,aerial_posture,aerial_posture_updated_at',
      workspace_id: `eq.${DEMO.workspaceId}`,
      name: `eq.${DEMO_PROJECT_NAME}`,
      order: 'id.asc',
    }),
    'canonical NCTC projects'
  );
  assertEqual(canonicalProjects.length, 1, 'Canonical NCTC project count drifted');
  const projectBefore = canonicalProjects[0];
  assertEqual(projectBefore.id, DEMO.projectId, 'Canonical NCTC project id drifted');
  ids.projectAerialPostureBefore = projectBefore.aerial_posture_updated_at ?? null;
  notes.push('Verified exactly one canonical seeded NCTC project exists; no project creation API is called by this harness.');

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
    if (/^\/api\/projects(?:\/|\?|$)/.test(route) && method !== 'GET') {
      throw new Error(`Project mutation APIs are out of bounds for this smoke: ${method} ${route}`);
    }

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
    notes.push('Signed into the local app through Playwright as the scoped QA user.');

    const currentWorkspaceResult = await appFetch('/api/workspaces/current');
    if (currentWorkspaceResult.status !== 200) {
      throw new Error(
        `Current workspace lookup failed: ${currentWorkspaceResult.status} ${JSON.stringify(currentWorkspaceResult.data)}`
      );
    }
    assertEqual(currentWorkspaceResult.data.workspaceId, DEMO.workspaceId, 'Current workspace did not resolve to NCTC');
    notes.push('Verified the current session workspace resolves to the seeded NCTC workspace.');

    const missionResult = await appFetch('/api/aerial/missions', {
      projectId: DEMO.projectId,
      title: missionTitle,
      status: 'complete',
      missionType: 'aoi_capture',
      geographyLabel: 'Grass Valley / NCTC local proof AOI',
      collectedAt: mutationStartedAt.toISOString(),
      notes: 'Local QA proof mission created by qa-harness/local-aerial-evidence-smoke.js.',
    });
    if (missionResult.status !== 201) {
      throw new Error(`Aerial mission creation failed: ${missionResult.status} ${JSON.stringify(missionResult.data)}`);
    }
    ids.missionId = missionResult.data.missionId;
    assertOk(ids.missionId, 'Mission creation did not return a mission id.');
    notes.push('Created one project-linked mission through POST /api/aerial/missions.');

    const patchResult = await appFetch(
      `/api/aerial/missions/${ids.missionId}`,
      {
        aoiGeojson: LOCAL_AOI_GEOJSON,
        notes:
          'AOI attached through PATCH because mission POST intentionally does not accept AOI geometry in this contract.',
      },
      'PATCH'
    );
    if (patchResult.status !== 200) {
      throw new Error(`Aerial mission AOI PATCH failed: ${patchResult.status} ${JSON.stringify(patchResult.data)}`);
    }
    notes.push('Attached a closed Grass Valley/NCTC GeoJSON polygon through PATCH /api/aerial/missions/[missionId].');

    const packageResult = await appFetch('/api/aerial/evidence-packages', {
      missionId: ids.missionId,
      title: packageTitle,
      packageType: 'measurable_output',
      status: 'ready',
      verificationReadiness: 'ready',
      notes: 'Ready local proof package used to verify project aerial posture write-back.',
    });
    if (packageResult.status !== 201) {
      throw new Error(`Aerial evidence package creation failed: ${packageResult.status} ${JSON.stringify(packageResult.data)}`);
    }
    ids.packageId = packageResult.data.packageId;
    assertOk(ids.packageId, 'Evidence package creation did not return a package id.');
    notes.push('Created one ready evidence package through POST /api/aerial/evidence-packages.');

    const missionRow = firstRow(
      await restSelect('aerial_missions', {
        select: 'id,workspace_id,project_id,title,status,mission_type,aoi_geojson',
        id: `eq.${ids.missionId}`,
      }),
      'created aerial mission'
    );
    assertEqual(missionRow.workspace_id, DEMO.workspaceId, 'Mission workspace drifted');
    assertEqual(missionRow.project_id, DEMO.projectId, 'Mission project drifted');
    assertEqual(JSON.stringify(missionRow.aoi_geojson), JSON.stringify(LOCAL_AOI_GEOJSON), 'Mission AOI drifted');

    const packageRow = firstRow(
      await restSelect('aerial_evidence_packages', {
        select: 'id,workspace_id,project_id,mission_id,title,status,verification_readiness',
        id: `eq.${ids.packageId}`,
      }),
      'created aerial evidence package'
    );
    assertEqual(packageRow.workspace_id, DEMO.workspaceId, 'Package workspace drifted');
    assertEqual(packageRow.project_id, DEMO.projectId, 'Package project drifted');
    assertEqual(packageRow.mission_id, ids.missionId, 'Package mission drifted');
    assertEqual(packageRow.status, 'ready', 'Package status drifted');
    assertEqual(packageRow.verification_readiness, 'ready', 'Package verification readiness drifted');

    const projectAfter = firstRow(
      await restSelect('projects', {
        select: 'id,workspace_id,name,aerial_posture,aerial_posture_updated_at',
        id: `eq.${DEMO.projectId}`,
      }),
      'NCTC project after aerial evidence package'
    );
    assertEqual(projectAfter.id, DEMO.projectId, 'Posture write-back updated a different project');
    assertOk(projectAfter.aerial_posture, 'Project aerial_posture was not written.');
    assertOk(projectAfter.aerial_posture_updated_at, 'Project aerial_posture_updated_at was not written.');
    assertOk(
      new Date(projectAfter.aerial_posture_updated_at).getTime() >= mutationStartedAt.getTime() - 5000,
      `Project aerial posture timestamp was not refreshed by this package creation: ${projectAfter.aerial_posture_updated_at}`
    );
    assertEqual(
      projectAfter.aerial_posture.missionCount,
      EXPECTED_POST_RUN_MISSION_COUNT,
      'Project aerial posture mission count did not match seeded-plus-new expectation'
    );
    assertEqual(
      projectAfter.aerial_posture.readyPackageCount,
      EXPECTED_POST_RUN_READY_PACKAGE_COUNT,
      'Project aerial posture ready-package count did not match seeded-plus-new expectation'
    );
    ids.projectAerialPostureAfter = projectAfter.aerial_posture_updated_at;
    const postureSummary = projectAfter.aerial_posture;
    const postMutationCounts = await readAerialCounts('post-mutation aerial');
    assertEqual(
      postMutationCounts.missionCount,
      EXPECTED_POST_RUN_MISSION_COUNT,
      'Post-mutation aerial mission count drifted'
    );
    assertEqual(
      postMutationCounts.readyPackageCount,
      EXPECTED_POST_RUN_READY_PACKAGE_COUNT,
      'Post-mutation ready-package count drifted'
    );
    notes.push('Asserted projects.aerial_posture and projects.aerial_posture_updated_at updated on the same seeded project.');

    const mapFeaturesResult = await appFetch(`/api/map-features/aerial-missions?workspaceId=${DEMO.workspaceId}`);
    if (mapFeaturesResult.status !== 200) {
      throw new Error(`Aerial map-feature lookup failed: ${mapFeaturesResult.status} ${JSON.stringify(mapFeaturesResult.data)}`);
    }
    assertEqual(mapFeaturesResult.data.type, 'FeatureCollection', 'Aerial map-feature response type drifted');
    const features = Array.isArray(mapFeaturesResult.data.features) ? mapFeaturesResult.data.features : [];
    const newMissionFeature = features.find((feature) => feature.properties?.missionId === ids.missionId);
    assertOk(newMissionFeature, 'Aerial map-feature response did not include the new mission AOI.');
    assertEqual(JSON.stringify(newMissionFeature.geometry), JSON.stringify(LOCAL_AOI_GEOJSON), 'Map-feature AOI geometry drifted');
    const mapFeatureSummary = {
      featureCount: features.length,
      missionId: ids.missionId,
      projectId: newMissionFeature.properties?.projectId ?? null,
      geometryType: newMissionFeature.geometry?.type ?? null,
      queryWorkspaceId: DEMO.workspaceId,
      scope: 'current authenticated workspace membership; workspaceId query param is not trusted by the route',
    };
    notes.push('Verified /api/map-features/aerial-missions returns a FeatureCollection containing the new mission AOI.');

    await page.goto(`${baseUrl}/aerial`, { waitUntil: 'networkidle' });
    await page.getByText(/Mission register/i).first().waitFor({ timeout: 30000 });
    await page.getByText(missionTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await screenshot('local-aerial-evidence-smoke-01-aerial-list');
    notes.push('Asserted /aerial renders the mission list with the new mission.');

    await page.goto(`${baseUrl}/aerial/missions/${ids.missionId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: missionTitle, exact: false }).waitFor({ timeout: 30000 });
    await page.getByText(packageTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.getByText(/Project aerial posture \(cached\)/i).first().waitFor({ timeout: 30000 });
    await page.getByText(/Mission AOI & export/i).first().waitFor({ timeout: 30000 });
    await page.getByRole('link', { name: /Export DJI JSON/i }).waitFor({ timeout: 30000 });
    await screenshot('local-aerial-evidence-smoke-02-mission-detail');
    notes.push('Asserted mission detail renders package log, cached project posture, AOI state, and DJI export state.');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-aerial-evidence-smoke.md`);
    const lines = [
      `# OpenPlan Local Aerial Evidence Smoke - ${datePart}`,
      '',
      '## Command',
      '- `cd qa-harness && npm run local-aerial-evidence-smoke`',
      '',
      '## Local Targets',
      `- App URL: ${baseUrl}`,
      `- Supabase URL: ${supabaseUrl}`,
      `- Local guard result: ${localGuardNote}`,
      '',
      '## Mutation Summary',
      '- Refreshed the deterministic NCTC seed, scoped one deterministic local QA user to the NCTC workspace, created one project-linked mission, attached one AOI polygon, and created one ready evidence package.',
      '',
      '## Cleanup / Idempotency Posture',
      `- Before writing mission/package rows, the harness deletes prior harness-owned rows in the deterministic NCTC workspace/project whose mission title starts with \`${MISSION_TITLE_PREFIX}\` or package title starts with \`${PACKAGE_TITLE_PREFIX}\`.`,
      `- Cleanup removed ${cleanupSummary.removedMissionCount} mission(s) and ${cleanupSummary.removedPackageCount} package(s).`,
      `- Post-cleanup exact seed expectation: ${SEEDED_MISSION_COUNT} seeded missions and ${SEEDED_READY_PACKAGE_COUNT} seeded ready packages.`,
      `- Post-run exact expectation: ${EXPECTED_POST_RUN_MISSION_COUNT} total missions and ${EXPECTED_POST_RUN_READY_PACKAGE_COUNT} ready packages.`,
      '',
      '## Key IDs',
      `- QA user email: ${QA_EMAIL}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${DEMO.workspaceId}`,
      `- Project id: ${DEMO.projectId}`,
      `- Mission id: ${ids.missionId}`,
      `- Evidence package id: ${ids.packageId}`,
      '',
      '## Boundary Notes',
      '- Mission creation used `POST /api/aerial/missions`; AOI was attached with `PATCH /api/aerial/missions/[missionId]` because mission POST does not accept AOI geometry.',
      '- `/api/map-features/aerial-missions` scopes by current authenticated workspace membership. The `workspaceId` query parameter in this smoke is operator traceability, not an authorization input.',
      '- No project creation API was called. The harness verified exactly one canonical seeded NCTC project before writing mission/package rows.',
      '- AOI boundary: small closed Polygon around Grass Valley / NCTC demo geography; coordinates are local proof geometry, not a legal survey boundary.',
      '',
      '## Project Aerial Posture',
      `- Before ` + '`projects.aerial_posture_updated_at`' + `: ${ids.projectAerialPostureBefore ?? 'null'}`,
      `- After ` + '`projects.aerial_posture_updated_at`' + `: ${ids.projectAerialPostureAfter ?? 'unknown'}`,
      '',
      '```json',
      JSON.stringify(postureSummary, null, 2),
      '```',
      '',
      '## Count Summary',
      '```json',
      JSON.stringify(
        {
          preCleanup: cleanupSummary.preCleanupCounts,
          removed: {
            missions: cleanupSummary.removedMissionCount,
            packages: cleanupSummary.removedPackageCount,
          },
          postCleanup: cleanupSummary.postCleanupCounts,
          postMutation: postMutationCounts,
        },
        null,
        2
      ),
      '```',
      '',
      '## Map Feature Summary',
      '```json',
      JSON.stringify(mapFeatureSummary, null, 2),
      '```',
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- docs/ops/${datePart}-test-output/${artifact}`),
      '',
      '## Verdict',
      '- PASS: Local Aerial evidence spine proof created a project-linked mission, attached AOI through the existing mission PATCH boundary, created a ready evidence package, verified same-project aerial posture write-back, rendered the Aerial list/detail surfaces, and confirmed the map AOI feature without duplicating the seeded NCTC project.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(
      JSON.stringify(
        { reportPath, artifacts, cleanupSummary, ids, postureSummary, mapFeatureSummary, notes },
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
