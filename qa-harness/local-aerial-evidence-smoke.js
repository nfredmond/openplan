/**
 * Local Aerial evidence smoke — self-provisioning.
 *
 * WHAT THIS PROVES
 * ----------------
 * That the Aerial module's evidence chain works end to end on a project the
 * harness created moments earlier: mission -> AOI polygon -> evidence package
 * -> cached project aerial posture -> map AOI feature -> rendered list and
 * detail surfaces, including the DJI export affordance.
 *
 * And, just as importantly, that the module writes only where it should: after
 * every aerial mutation, the workspace still holds exactly ONE project. The
 * previous version enforced that by refusing to call project routes at all —
 * harness discipline standing in for a product guarantee. Asserting the project
 * count directly tests the invariant that actually matters.
 *
 * HOW IT PROVISIONS
 * -----------------
 * One fresh auth user, whose workspace the `on_auth_user_created` trigger
 * provisions, then `POST /api/projects` and the aerial routes. Nothing is read
 * from a checked-in fixture, and nothing here names a real place: AOI geometry
 * is anchored on a deliberately meaningless origin (see fixtures/provision.js).
 *
 * COUNT EXPECTATIONS
 * ------------------
 * The old version asserted "seeded 3 missions + 1 new" against a demo seed it
 * shelled first. It now establishes its own baseline through the API — two
 * missions, one ready package — asserts the cached posture reflects exactly
 * that, then adds the proof mission and package and asserts the posture moved
 * to exactly three and two. Same arithmetic, no fixture.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, guardLocalMutationTargets, loadEnv, repoRoot } = require('./harness-env');
const {
  assertArray,
  assertEqual,
  assertOk,
  assertRowCount,
  buildRunIdentity,
  createAppFetch,
  createExpectingAppFetch,
  createQaAuthUser,
  createRestClient,
  firstRow,
  signInThroughBrowser,
  syntheticPolygon,
} = require('./fixtures/provision');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

/** Baseline the smoke establishes through the API before the proof mutation. */
const BASELINE_MISSION_COUNT = 2;
const BASELINE_READY_PACKAGE_COUNT = 1;
/** Exactly one mission and one ready package are added by the proof mutation. */
const EXPECTED_POST_RUN_MISSION_COUNT = BASELINE_MISSION_COUNT + 1;
const EXPECTED_POST_RUN_READY_PACKAGE_COUNT = BASELINE_READY_PACKAGE_COUNT + 1;

/** The AOI attached by the proof mutation. Synthetic, anchored on nowhere. */
const PROOF_AOI_GEOJSON = syntheticPolygon(3);

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

  const { restSelect, selectRows } = createRestClient({ supabaseUrl, serviceRoleKey });
  const identity = buildRunIdentity('aerial-evidence-smoke');
  const { email, password, stamp, suffix } = identity;

  const projectName = `Aerial Evidence Smoke Project ${suffix}`;
  const missionTitle = `Aerial evidence proof mission ${stamp}`;
  const packageTitle = `Aerial evidence proof ready package ${stamp}`;
  const mutationStartedAt = new Date();

  const artifacts = [];
  const notes = [];
  const ids = {};
  notes.push(localGuardNote);

  ids.userId = await createQaAuthUser({
    supabaseUrl,
    serviceRoleKey,
    email,
    password,
    purpose: 'openplan-local-aerial-evidence-smoke',
  });
  notes.push(`Created one fresh QA auth user (${email}); this run reads no pre-existing fixture data.`);

  const browser = await chromium.launch({ headless: true, executablePath: process.env.OPENPLAN_QA_CHROME || undefined });
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1700 } }));
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  const appFetch = createAppFetch(page);
  const expectAppFetch = createExpectingAppFetch(appFetch);

  async function screenshot(name) {
    const fileName = `${datePart}-${name}.png`;
    await page.screenshot({ path: path.join(outputDir, fileName), fullPage: true });
    artifacts.push(fileName);
    return fileName;
  }

  async function readAerialCounts(label) {
    const missions = await selectRows(
      'aerial_missions',
      { select: 'id,title,status', workspace_id: `eq.${ids.workspaceId}`, project_id: `eq.${ids.projectId}` },
      `${label} missions`
    );
    const packages = await selectRows(
      'aerial_evidence_packages',
      {
        select: 'id,mission_id,title,status,verification_readiness',
        workspace_id: `eq.${ids.workspaceId}`,
        project_id: `eq.${ids.projectId}`,
      },
      `${label} packages`
    );
    return {
      missionCount: missions.length,
      packageCount: packages.length,
      // Mirrors buildAerialProjectPosture: a package counts as ready once it
      // is `ready` or `shared`, not merely verification-ready.
      readyPackageCount: packages.filter((row) => row.status === 'ready' || row.status === 'shared').length,
    };
  }

  async function countWorkspaceProjects(stage) {
    const projects = assertArray(
      await restSelect('projects', { select: 'id,name', workspace_id: `eq.${ids.workspaceId}` }),
      `${stage} workspace projects`
    );
    assertRowCount(projects, 1, `${stage} workspace projects`);
    assertEqual(projects[0].id, ids.projectId, `${stage}: the workspace project id drifted`);
    return projects.length;
  }

  try {
    await signInThroughBrowser(page, { baseUrl, email, password });
    notes.push('Signed into the local app through the real sign-in form.');

    const currentWorkspace = await expectAppFetch(
      '/api/workspaces/current',
      undefined,
      200,
      'Current workspace lookup'
    );
    ids.workspaceId = currentWorkspace.workspaceId;
    assertOk(ids.workspaceId, 'Sign-up did not auto-provision a workspace for the new user.');

    const projectPayload = await expectAppFetch(
      '/api/projects',
      {
        projectName,
        planType: 'corridor_plan',
        deliveryPhase: 'scoping',
        status: 'active',
        summary: 'Aerial evidence smoke project. Every mission and package below attaches to this one project.',
      },
      201,
      'Project creation'
    );
    ids.projectId = projectPayload.projectRecordId;
    assertEqual(
      projectPayload.workspaceId,
      ids.workspaceId,
      'The new project landed in a workspace other than the caller current workspace'
    );
    await countWorkspaceProjects('post-create');
    notes.push('Created exactly one project in the auto-provisioned workspace and verified the session resolves to it.');

    // -------------------------------------------------------------------
    // Baseline: two missions, one ready package — established through the API
    // -------------------------------------------------------------------
    ids.baselineMissionIds = [];
    ids.baselinePackageIds = [];
    for (let index = 0; index < BASELINE_MISSION_COUNT; index += 1) {
      const baselineMission = await expectAppFetch(
        '/api/aerial/missions',
        {
          projectId: ids.projectId,
          title: `Aerial evidence baseline mission ${index + 1} (${suffix})`,
          status: index === 0 ? 'complete' : 'active',
          missionType: 'corridor_survey',
          geographyLabel: `Study corridor, Segment ${index + 1}`,
          collectedAt: new Date().toISOString(),
          notes: 'Baseline mission the smoke creates so its posture arithmetic depends on no fixture.',
        },
        201,
        `Baseline aerial mission ${index + 1} creation`
      );
      ids.baselineMissionIds.push(baselineMission.missionId);
    }

    const baselineReadyPackage = await expectAppFetch(
      '/api/aerial/evidence-packages',
      {
        missionId: ids.baselineMissionIds[0],
        title: `Aerial evidence baseline ready package (${suffix})`,
        packageType: 'measurable_output',
        status: 'ready',
        verificationReadiness: 'ready',
        notes: 'Baseline ready package establishing the pre-mutation posture.',
      },
      201,
      'Baseline ready evidence package creation'
    );
    ids.baselinePackageIds.push(baselineReadyPackage.packageId);

    const baselineCounts = await readAerialCounts('baseline aerial');
    assertEqual(baselineCounts.missionCount, BASELINE_MISSION_COUNT, 'Baseline aerial mission count drifted');
    assertEqual(
      baselineCounts.readyPackageCount,
      BASELINE_READY_PACKAGE_COUNT,
      'Baseline ready-package count drifted'
    );

    const postureBefore = firstRow(
      await restSelect('aerial_project_posture', {
        select: 'project_id,workspace_id,posture,updated_at',
        project_id: `eq.${ids.projectId}`,
      }),
      'aerial_project_posture before the proof mutation'
    );
    assertEqual(
      postureBefore.posture?.missionCount,
      BASELINE_MISSION_COUNT,
      'Cached posture did not reflect the baseline mission count'
    );
    assertEqual(
      postureBefore.posture?.readyPackageCount,
      BASELINE_READY_PACKAGE_COUNT,
      'Cached posture did not reflect the baseline ready-package count'
    );
    ids.projectAerialPostureBefore = postureBefore.updated_at ?? null;
    notes.push(
      `Established a baseline of ${BASELINE_MISSION_COUNT} missions and ${BASELINE_READY_PACKAGE_COUNT} ready package through the aerial routes, and verified the cached posture matched it exactly.`
    );

    // -------------------------------------------------------------------
    // The proof mutation: one mission, one AOI, one ready package
    // -------------------------------------------------------------------
    const missionPayload = await expectAppFetch(
      '/api/aerial/missions',
      {
        projectId: ids.projectId,
        title: missionTitle,
        status: 'complete',
        missionType: 'aoi_capture',
        geographyLabel: 'Study corridor, proof AOI',
        collectedAt: mutationStartedAt.toISOString(),
        notes: 'Local QA proof mission created by qa-harness/local-aerial-evidence-smoke.js.',
      },
      201,
      'Aerial mission creation'
    );
    ids.missionId = missionPayload.missionId;
    assertOk(ids.missionId, 'Mission creation did not return a mission id.');
    notes.push('Created one project-linked mission through POST /api/aerial/missions.');

    await expectAppFetch(
      `/api/aerial/missions/${ids.missionId}`,
      {
        aoiGeojson: PROOF_AOI_GEOJSON,
        notes: 'AOI attached through PATCH because mission POST intentionally does not accept AOI geometry in this contract.',
      },
      200,
      'Aerial mission AOI PATCH',
      'PATCH'
    );
    notes.push('Attached a closed synthetic GeoJSON polygon through PATCH /api/aerial/missions/[missionId].');

    const packagePayload = await expectAppFetch(
      '/api/aerial/evidence-packages',
      {
        missionId: ids.missionId,
        title: packageTitle,
        packageType: 'measurable_output',
        status: 'ready',
        verificationReadiness: 'ready',
        notes: 'Ready local proof package used to verify project aerial posture write-back.',
      },
      201,
      'Aerial evidence package creation'
    );
    ids.packageId = packagePayload.packageId;
    assertOk(ids.packageId, 'Evidence package creation did not return a package id.');
    notes.push('Created one ready evidence package through POST /api/aerial/evidence-packages.');

    // -------------------------------------------------------------------
    // Verification
    // -------------------------------------------------------------------
    const missionRow = firstRow(
      await restSelect('aerial_missions', {
        select: 'id,workspace_id,project_id,title,status,mission_type,aoi_geojson',
        id: `eq.${ids.missionId}`,
      }),
      'created aerial mission'
    );
    assertEqual(missionRow.workspace_id, ids.workspaceId, 'Mission workspace drifted');
    assertEqual(missionRow.project_id, ids.projectId, 'Mission project drifted');
    assertEqual(JSON.stringify(missionRow.aoi_geojson), JSON.stringify(PROOF_AOI_GEOJSON), 'Mission AOI drifted');

    const packageRow = firstRow(
      await restSelect('aerial_evidence_packages', {
        select: 'id,workspace_id,project_id,mission_id,title,status,verification_readiness',
        id: `eq.${ids.packageId}`,
      }),
      'created aerial evidence package'
    );
    assertEqual(packageRow.workspace_id, ids.workspaceId, 'Package workspace drifted');
    assertEqual(packageRow.project_id, ids.projectId, 'Package project drifted');
    assertEqual(packageRow.mission_id, ids.missionId, 'Package mission drifted');
    assertEqual(packageRow.status, 'ready', 'Package status drifted');
    assertEqual(packageRow.verification_readiness, 'ready', 'Package verification readiness drifted');

    const postureAfter = firstRow(
      await restSelect('aerial_project_posture', {
        select: 'project_id,workspace_id,posture,updated_at',
        project_id: `eq.${ids.projectId}`,
      }),
      'aerial_project_posture after the proof evidence package'
    );
    assertEqual(postureAfter.project_id, ids.projectId, 'Posture write-back updated a different project');
    assertOk(postureAfter.posture, 'aerial_project_posture.posture was not written.');
    assertOk(postureAfter.updated_at, 'aerial_project_posture.updated_at was not written.');
    assertOk(
      new Date(postureAfter.updated_at).getTime() >= mutationStartedAt.getTime() - 5000,
      `aerial_project_posture timestamp was not refreshed by this package creation: ${postureAfter.updated_at}`
    );
    assertEqual(
      postureAfter.posture.missionCount,
      EXPECTED_POST_RUN_MISSION_COUNT,
      'Aerial posture mission count did not match the baseline-plus-one expectation'
    );
    assertEqual(
      postureAfter.posture.readyPackageCount,
      EXPECTED_POST_RUN_READY_PACKAGE_COUNT,
      'Aerial posture ready-package count did not match the baseline-plus-one expectation'
    );
    ids.projectAerialPostureAfter = postureAfter.updated_at;
    const postureSummary = postureAfter.posture;

    const postMutationCounts = await readAerialCounts('post-mutation aerial');
    assertEqual(postMutationCounts.missionCount, EXPECTED_POST_RUN_MISSION_COUNT, 'Post-mutation aerial mission count drifted');
    assertEqual(
      postMutationCounts.readyPackageCount,
      EXPECTED_POST_RUN_READY_PACKAGE_COUNT,
      'Post-mutation ready-package count drifted'
    );
    notes.push('Asserted aerial_project_posture.posture and .updated_at were rewritten for exactly this project.');

    // The invariant the old "never call project routes" guard was standing in
    // for: aerial writes must not mint a project of their own.
    await countWorkspaceProjects('post-mutation');
    notes.push('Verified the workspace still holds exactly one project after every aerial write — the module minted none.');

    const mapFeatures = await expectAppFetch(
      '/api/map-features/aerial-missions',
      undefined,
      200,
      'Aerial map-feature lookup'
    );
    assertEqual(mapFeatures.type, 'FeatureCollection', 'Aerial map-feature response type drifted');
    const features = Array.isArray(mapFeatures.features) ? mapFeatures.features : [];
    const newMissionFeature = features.find((feature) => feature.properties?.missionId === ids.missionId);
    assertOk(newMissionFeature, 'Aerial map-feature response did not include the new mission AOI.');
    assertEqual(
      JSON.stringify(newMissionFeature.geometry),
      JSON.stringify(PROOF_AOI_GEOJSON),
      'Map-feature AOI geometry drifted'
    );
    const mapFeatureSummary = {
      featureCount: features.length,
      missionId: ids.missionId,
      projectId: newMissionFeature.properties?.projectId ?? null,
      geometryType: newMissionFeature.geometry?.type ?? null,
      scope: 'current authenticated workspace membership',
    };
    notes.push('Verified /api/map-features/aerial-missions returns a FeatureCollection containing the new mission AOI.');

    await page.goto(`${baseUrl}/aerial`, { waitUntil: 'networkidle' });
    await page.getByText(/Mission register/i).first().waitFor({ timeout: 30000 });
    await page.getByText(missionTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.getByRole('region', { name: 'Aerial imagery layers' }).waitFor({ timeout: 30000 });
    await page.getByText(/No map-ready aerial preview yet/i).waitFor({ timeout: 30000 });
    await screenshot('local-aerial-evidence-smoke-01-aerial-list');
    notes.push('Asserted /aerial renders the mission list and the normal-path aerial layer panel.');

    await page.goto(`${baseUrl}/aerial/missions/${ids.missionId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: missionTitle, exact: false }).waitFor({ timeout: 30000 });
    await page.getByText(packageTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.getByText(/Project aerial summary \(saved\)/i).first().waitFor({ timeout: 30000 });
    await page.getByText(/Mission AOI & export/i).first().waitFor({ timeout: 30000 });

    /*
      THE DJI EXPORT MOVED, AND IT MOVED UP. This asserted an "Export DJI JSON"
      link that exported the AOI PERIMETER — a polygon, not a flight. It was
      deliberately removed when the flight-plan section landed, which exports
      the actual survey grid for DJI Pilot 2, Litchi or GIS, and the migration
      note in the mission page says so in as many words.

      So this asserts the successor rather than being deleted: a mission detail
      that offers no way to get a flight out of OpenPlan is still a defect, and
      dropping the assertion would have stopped anyone noticing. Exports
      themselves unlock only after a grid is generated and saved, so what is
      proven here is that the section a planner needs is on the page.
    */
    await page
      .getByRole('heading', { name: /Survey flight plan & exports/i })
      .first()
      .waitFor({ timeout: 30000 });
    assertEqual(
      await page.locator('.op-cart-mapdock').count(),
      0,
      'The shell map dock covered the mission evidence sidebar even though this page owns its map'
    );
    await screenshot('local-aerial-evidence-smoke-02-mission-detail');
    notes.push('Asserted mission detail renders package log, cached project posture, AOI state, and DJI export state without the shell map dock covering its evidence sidebar.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const narrowLayout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    assertOk(
      narrowLayout.documentWidth <= narrowLayout.viewportWidth + 1,
      `Mission detail overflows horizontally at 390px: ${JSON.stringify(narrowLayout)}`
    );
    await screenshot('local-aerial-evidence-smoke-03-mission-detail-narrow');
    notes.push('Asserted the mission detail has no horizontal overflow at 390 x 844.');
    assertOk(
      browserErrors.length === 0,
      `Aerial list/detail browser errors: ${browserErrors.join(' | ')}`
    );
    notes.push('Read the browser console and found no console errors or uncaught page errors.');

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
      '## Provisioning Posture',
      '- **Self-provisioning.** No checked-in fixture is read. One auth user is created, the `on_auth_user_created` trigger provisions its workspace, and every mission, AOI, and package asserted on below was written by the aerial route a planner would use.',
      '- **Place-neutral.** Geography labels are generic and the AOI polygon is anchored on a deliberately meaningless origin (0°, 0°), so proof geometry can never be mistaken for a real survey boundary.',
      '- **Hermetic.** Each run works in a workspace that did not exist a moment earlier, so there is nothing to clean up between runs and no shared state with any other smoke.',
      '',
      '## Cleanup / Idempotency Posture',
      '- None required. The old version had to delete its own prior rows out of a shared seeded workspace; a per-run workspace removes that class of problem entirely. Local QA users and their workspaces accumulate until the local database is reset.',
      '',
      '## Count Expectations',
      `- Baseline established through the API: ${BASELINE_MISSION_COUNT} missions, ${BASELINE_READY_PACKAGE_COUNT} ready package.`,
      `- Post-mutation expectation: ${EXPECTED_POST_RUN_MISSION_COUNT} missions, ${EXPECTED_POST_RUN_READY_PACKAGE_COUNT} ready packages.`,
      '',
      '## Key IDs',
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId}`,
      `- Project id: ${ids.projectId}`,
      `- Baseline mission ids: ${ids.baselineMissionIds.join(', ')}`,
      `- Baseline package ids: ${ids.baselinePackageIds.join(', ')}`,
      `- Proof mission id: ${ids.missionId}`,
      `- Proof evidence package id: ${ids.packageId}`,
      '',
      '## Boundary Notes',
      '- Mission creation used `POST /api/aerial/missions`; the AOI was attached with `PATCH /api/aerial/missions/[missionId]` because mission POST does not accept AOI geometry.',
      '- `/api/map-features/aerial-missions` scopes by current authenticated workspace membership, not by any client-supplied workspace id.',
      '- The AOI is a small closed synthetic Polygon, not a legal survey boundary, and not anywhere.',
      '- The project count is asserted before and after every aerial write. The previous version instead forbade the harness from calling project routes; asserting the count tests the product invariant rather than the harness discipline.',
      '',
      '## Project Aerial Posture',
      '- Before `aerial_project_posture.updated_at`: ' + `${ids.projectAerialPostureBefore ?? 'null'}`,
      '- After `aerial_project_posture.updated_at`: ' + `${ids.projectAerialPostureAfter ?? 'unknown'}`,
      '',
      '```json',
      JSON.stringify(postureSummary, null, 2),
      '```',
      '',
      '## Count Summary',
      '```json',
      JSON.stringify({ baseline: baselineCounts, postMutation: postMutationCounts }, null, 2),
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
      '- PASS: The smoke created one project fixture through the project route, established a known baseline through the aerial routes, created a project-linked mission, attached an AOI through the mission PATCH boundary, created a ready evidence package, verified the cached project posture was rewritten to the baseline-plus-one counts, rendered the Aerial list and detail surfaces including the DJI export affordance, confirmed the map AOI feature, and left the workspace with exactly one project.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(
      JSON.stringify({ reportPath, artifacts, baselineCounts, postMutationCounts, ids, postureSummary, mapFeatureSummary, notes }, null, 2)
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
