/**
 * Local Phase 1 spine smoke — self-provisioning.
 *
 * WHAT THIS PROVES
 * ----------------
 * That one canonical `project_id`, created once through `POST /api/projects`,
 * is the spine every other module hangs off: RTP, grants, engagement,
 * scenarios, managed model runs, county-run provenance, the project-targeted
 * report and its typed evidence citations, Data Hub datasets, the corridor map
 * layer, aerial missions, and aerial evidence packages. No module may mint a
 * second project along the way.
 *
 * HOW IT PROVISIONS
 * -----------------
 * Through the app's own HTTP routes, as a real signed-in user, in a workspace
 * that did not exist when the run began. The harness creates one auth user;
 * the `on_auth_user_created` trigger provisions that user's workspace; every
 * record after that is written by the route a planner would use.
 *
 * This replaced a version that shelled a checked-in demo seed and asserted
 * against its hand-written UUIDs. That version proved the seed matched itself,
 * and it proved it about one real county. This version proves the routes work,
 * and it names no place at all — every label is generic and every geometry is
 * anchored on a deliberately meaningless origin (see fixtures/provision.js).
 *
 * NO EXCEPTIONS
 * -------------
 * Every row this smoke creates goes through a product route. There used to be
 * one documented exception — the three cartographic-backdrop layers, which had
 * no write route anywhere in the product and had to be written directly with
 * the service-role key. That gap is closed, so the exception is gone, and
 * `fixtures/provision.js` now asserts it has no call sites left.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, guardLocalMutationTargets, loadEnv, repoRoot } = require('./harness-env');
const {
  SYNTHETIC_AGENCY_LABEL,
  SYNTHETIC_GEOGRAPHY,
  assertArray,
  assertEqual,
  assertEvery,
  assertOk,
  assertRowCount,
  buildRunIdentity,
  createAppFetch,
  createExpectingAppFetch,
  createQaAuthUser,
  createRestClient,
  firstRow,
  inFilter,
  isoDaysFromNow,
  signInThroughBrowser,
  syntheticLineString,
  syntheticPoint,
  syntheticPolygon,
  syntheticTripGenProgram,
} = require('./fixtures/provision');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3000';

const CORRIDOR_COUNT = 2;
const AERIAL_MISSION_COUNT = 3;
const AERIAL_PACKAGE_COUNT = 3;
const ENGAGEMENT_ITEM_COUNT = 4;
const DATASET_COUNT = 3;

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

  // Read-only. `restInsert` / `restUpdate` exist on this client for a gap that
  // no longer has one — see the guard in fixtures/provision.js.
  const { restSelect } = createRestClient({ supabaseUrl, serviceRoleKey });
  const identity = buildRunIdentity('spine-smoke');
  const { email, password, stamp, suffix } = identity;

  const projectName = `Spine Smoke Project ${suffix}`;
  const rtpTitle = `Regional Transportation Plan 2050 (spine smoke ${suffix})`;
  const programTitle = `Spine Smoke Capital Program ${suffix}`;
  const awardTitle = `Spine smoke construction award ${suffix}`;
  const invoiceNumber = `SPINE-SMOKE-${suffix}`;
  const campaignTitle = `Spine Smoke Public Input ${suffix}`;
  const scenarioTitle = `Spine Smoke Scenario Set ${suffix}`;
  const modelTitle = `Spine Smoke Trip Generation Model ${suffix}`;
  const countyRunName = `Spine smoke validation run ${suffix}`;
  const reportTitle = `Spine Smoke Analysis Packet ${stamp}`;
  const alternativeEntryLabel = `Infill alternative ${suffix}`;

  const artifacts = [];
  const notes = [];
  const ids = {};
  notes.push(localGuardNote);

  ids.userId = await createQaAuthUser({
    supabaseUrl,
    serviceRoleKey,
    email,
    password,
    purpose: 'openplan-local-spine-smoke',
  });
  notes.push(`Created one fresh QA auth user (${email}); no pre-existing fixture data is read by this run.`);

  const browser = await chromium.launch({ headless: true, executablePath: process.env.OPENPLAN_QA_CHROME || undefined });
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1700 } }));
  const page = await context.newPage();
  const appFetch = createAppFetch(page);
  const expectAppFetch = createExpectingAppFetch(appFetch);

  async function screenshot(name) {
    const fileName = `${datePart}-${name}.png`;
    await page.screenshot({ path: path.join(outputDir, fileName), fullPage: true });
    artifacts.push(fileName);
    return fileName;
  }

  try {
    await signInThroughBrowser(page, { baseUrl, email, password });
    notes.push('Signed into the local app through the real sign-in form.');

    // ---------------------------------------------------------------------
    // 1. The workspace the front door provisioned, and the ONE project in it
    // ---------------------------------------------------------------------
    const currentWorkspace = await expectAppFetch(
      '/api/workspaces/current',
      undefined,
      200,
      'Current workspace lookup'
    );
    ids.workspaceId = currentWorkspace.workspaceId;
    assertOk(ids.workspaceId, 'Sign-up did not auto-provision a workspace for the new user.');
    notes.push('Verified sign-up alone auto-provisions a workspace — no operator step, no seed.');

    const projectPayload = await expectAppFetch(
      '/api/projects',
      {
        projectName,
        planType: 'regional_transportation_plan',
        deliveryPhase: 'programming',
        status: 'active',
        summary:
          'Spine smoke project. Every module below is attached to this one project id so a duplicate project anywhere fails the run.',
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
    notes.push(`Created the canonical project ${projectName} in the auto-provisioned workspace.`);

    async function assertSingleProject(stage) {
      const projects = assertArray(
        await restSelect('projects', { select: 'id,workspace_id,name', workspace_id: `eq.${ids.workspaceId}` }),
        `${stage} workspace projects`
      );
      assertRowCount(projects, 1, `${stage} workspace projects`);
      assertEqual(projects[0].id, ids.projectId, `${stage}: the workspace project id drifted`);
    }
    await assertSingleProject('post-create');

    // ---------------------------------------------------------------------
    // 2. RTP
    // ---------------------------------------------------------------------
    const rtpPayload = await expectAppFetch(
      '/api/rtp-cycles',
      {
        title: rtpTitle,
        status: 'draft',
        geographyLabel: 'Countywide, including unincorporated areas',
        horizonStartYear: 2030,
        horizonEndYear: 2050,
        summary: 'Spine smoke RTP cycle that the canonical project is programmed into.',
      },
      // Both RTP routes answer 200 on create, unlike every other create route
      // in this chain. Pinning the real contract keeps the smoke honest rather
      // than asserting a shape the product does not have.
      200,
      'RTP cycle creation'
    );
    ids.rtpCycleId = rtpPayload.rtpCycleId ?? rtpPayload.rtpCycle?.id ?? null;
    assertOk(ids.rtpCycleId, `RTP cycle creation returned no id: ${JSON.stringify(rtpPayload)}`);

    const rtpLinkPayload = await expectAppFetch(
      `/api/projects/${ids.projectId}/rtp-links`,
      {
        rtpCycleId: ids.rtpCycleId,
        portfolioRole: 'constrained',
        priorityRationale: 'Spine smoke links the canonical project into the RTP portfolio.',
      },
      200,
      'Project RTP link creation'
    );
    ids.projectRtpLinkId = rtpLinkPayload.link?.id ?? rtpLinkPayload.linkId ?? null;
    assertOk(ids.projectRtpLinkId, `RTP link creation returned no id: ${JSON.stringify(rtpLinkPayload)}`);
    notes.push('Created the RTP cycle and linked the canonical project into its portfolio.');

    // ---------------------------------------------------------------------
    // 3. Grants: funding need -> program -> opportunities -> award -> invoice
    // ---------------------------------------------------------------------
    await expectAppFetch(
      `/api/projects/${ids.projectId}/funding-profile`,
      {
        fundingNeedAmount: 500000,
        localMatchNeedAmount: 50000,
        notes: 'Spine smoke anchors a known project funding need before any award writes back.',
      },
      200,
      'Funding profile patch',
      'PATCH'
    );

    const programPayload = await expectAppFetch(
      '/api/programs',
      {
        projectId: ids.projectId,
        title: programTitle,
        programType: 'rtip',
        status: 'programmed',
        cycleName: 'Cycle 1',
        fundingClassification: 'discretionary',
        sponsorAgency: SYNTHETIC_AGENCY_LABEL,
        ownerLabel: 'Grant lead',
        cadenceLabel: 'Annual cycle',
        fiscalYearStart: 2030,
        fiscalYearEnd: 2031,
        nominationDueAt: isoDaysFromNow(30),
        adoptionTargetAt: isoDaysFromNow(90),
        summary: 'Spine smoke funding program that owns both opportunities.',
      },
      201,
      'Program creation'
    );
    ids.programId = programPayload.programId;

    const openOpportunity = await expectAppFetch(
      '/api/funding-opportunities',
      {
        programId: ids.programId,
        projectId: ids.projectId,
        title: `Open call ${suffix}`,
        status: 'open',
        agencyName: SYNTHETIC_AGENCY_LABEL,
        ownerLabel: 'Grant lead',
        expectedAwardAmount: 250000,
        closesAt: isoDaysFromNow(45),
        summary: 'Spine smoke open opportunity on the canonical project.',
      },
      201,
      'Open funding opportunity creation'
    );
    ids.openOpportunityId = openOpportunity.opportunityId;

    const awardedOpportunity = await expectAppFetch(
      '/api/funding-opportunities',
      {
        programId: ids.programId,
        projectId: ids.projectId,
        title: `Awarded call ${suffix}`,
        status: 'awarded',
        decisionState: 'awarded',
        agencyName: SYNTHETIC_AGENCY_LABEL,
        ownerLabel: 'Grant lead',
        expectedAwardAmount: 500000,
        closesAt: isoDaysFromNow(15),
        decisionDueAt: isoDaysFromNow(10),
        decisionRationale: 'Spine smoke advances one opportunity to awarded posture.',
        summary: 'Spine smoke awarded opportunity on the canonical project.',
      },
      201,
      'Awarded funding opportunity creation'
    );
    ids.awardedOpportunityId = awardedOpportunity.opportunityId;

    const awardPayload = await expectAppFetch(
      '/api/funding-awards',
      {
        projectId: ids.projectId,
        opportunityId: ids.awardedOpportunityId,
        programId: ids.programId,
        title: awardTitle,
        awardedAmount: 500000,
        matchAmount: 50000,
        matchPosture: 'secured',
        spendingStatus: 'active',
        riskFlag: 'none',
        obligationDueAt: isoDaysFromNow(60),
        notes: 'Spine smoke converts the awarded opportunity into a committed award.',
      },
      201,
      'Funding award creation'
    );
    ids.fundingAwardId = awardPayload.awardId;

    const invoicePayload = await expectAppFetch(
      '/api/invoicing/invoices',
      {
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        fundingAwardId: ids.fundingAwardId,
        invoiceNumber,
        consultantName: 'Example Planning Consultants',
        billingBasis: 'progress_payment',
        status: 'submitted',
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: isoDaysFromNow(20).slice(0, 10),
        amount: 125000,
        retentionPercent: 0,
        supportingDocsStatus: 'accepted',
        submittedTo: SYNTHETIC_AGENCY_LABEL,
        notes: 'Spine smoke reimbursement invoice tied to the same project and award.',
      },
      201,
      'Reimbursement invoice creation'
    );
    ids.invoiceId = invoicePayload.invoice?.id ?? null;
    assertOk(ids.invoiceId, `Invoice creation returned no id: ${JSON.stringify(invoicePayload)}`);
    notes.push('Created the grants chain — funding profile, program, two opportunities, award, and reimbursement invoice.');

    // ---------------------------------------------------------------------
    // 4. Engagement
    // ---------------------------------------------------------------------
    const campaignPayload = await expectAppFetch(
      '/api/engagement/campaigns',
      {
        projectId: ids.projectId,
        rtpCycleId: ids.rtpCycleId,
        title: campaignTitle,
        summary: 'Spine smoke public-input campaign attached to the same project and RTP cycle.',
        engagementType: 'map_feedback',
        status: 'active',
      },
      201,
      'Engagement campaign creation'
    );
    ids.engagementCampaignId = campaignPayload.campaignId;

    ids.engagementItemIds = [];
    for (let index = 0; index < ENGAGEMENT_ITEM_COUNT; index += 1) {
      const point = syntheticPoint(index + 1);
      const itemPayload = await expectAppFetch(
        `/api/engagement/campaigns/${ids.engagementCampaignId}/items`,
        {
          title: `Spine smoke comment ${index + 1} (${suffix})`,
          body: `Synthetic public comment ${index + 1} recorded by the spine smoke to exercise moderated map input.`,
          submittedBy: `Example resident ${index + 1}`,
          status: 'approved',
          sourceType: 'internal',
          latitude: point.lat,
          longitude: point.lon,
        },
        201,
        `Engagement item ${index + 1} creation`
      );
      ids.engagementItemIds.push(itemPayload.itemId ?? itemPayload.item?.id);
    }
    assertEvery(ids.engagementItemIds.map((id) => ({ id })), (row) => Boolean(row.id), 'engagement item ids');
    notes.push(`Created the engagement campaign and ${ENGAGEMENT_ITEM_COUNT} approved, geolocated items through the moderation route.`);

    // ---------------------------------------------------------------------
    // 5. Scenarios + managed model runs
    //
    // The `ite_trip_generation` engine is used deliberately: it is a pure
    // computation over a land-use program, so it is the one managed run a
    // place-neutral smoke can drive. The corridor engine would require real
    // geography with live Census/LODES coverage, which is exactly the
    // place-shaped dependency this smoke exists to avoid.
    // ---------------------------------------------------------------------
    const scenarioPayload = await expectAppFetch(
      '/api/scenarios',
      {
        projectId: ids.projectId,
        title: scenarioTitle,
        summary: 'Spine smoke scenario set on the canonical project.',
        planningQuestion: 'Does a scenario comparison stay attached to the project that owns it?',
        status: 'active',
      },
      201,
      'Scenario set creation'
    );
    ids.scenarioSetId = scenarioPayload.scenarioSetId;

    const baselineEntry = await expectAppFetch(
      `/api/scenarios/${ids.scenarioSetId}/entries`,
      {
        entryType: 'baseline',
        label: 'Existing conditions baseline',
        summary: 'Baseline land-use program for the spine smoke.',
        status: 'ready',
        sortOrder: 0,
      },
      201,
      'Baseline scenario entry creation'
    );
    ids.baselineEntryId = baselineEntry.entryId ?? baselineEntry.entry?.id;

    const alternativeEntry = await expectAppFetch(
      `/api/scenarios/${ids.scenarioSetId}/entries`,
      {
        entryType: 'alternative',
        label: alternativeEntryLabel,
        summary: 'Alternative land-use program for the spine smoke.',
        status: 'ready',
        sortOrder: 1,
      },
      201,
      'Alternative scenario entry creation'
    );
    ids.alternativeEntryId = alternativeEntry.entryId ?? alternativeEntry.entry?.id;

    const modelPayload = await expectAppFetch(
      '/api/models',
      {
        projectId: ids.projectId,
        scenarioSetId: ids.scenarioSetId,
        title: modelTitle,
        modelFamily: 'scenario_model',
        status: 'ready_for_review',
        configVersion: 'spine-smoke-v1',
        ownerLabel: 'QA smoke harness',
        assumptionsSummary: 'Screening-grade trip generation over a synthetic land-use program.',
        summary: 'Spine smoke model that produces the evidence the report cites.',
      },
      201,
      'Model creation'
    );
    ids.modelId = modelPayload.modelId;

    async function launchTripGenRun(scenarioEntryId, title, program) {
      const payload = await expectAppFetch(
        `/api/models/${ids.modelId}/runs`,
        {
          scenarioEntryId,
          title,
          engineKey: 'ite_trip_generation',
          tripGenProgram: program,
        },
        201,
        `Managed run "${title}"`
      );
      assertEqual(payload.status, 'succeeded', `Managed run "${title}" did not succeed`);
      assertOk(payload.modelRunId, `Managed run "${title}" returned no model run id`);
      return payload.modelRunId;
    }

    ids.baselineModelRunId = await launchTripGenRun(
      ids.baselineEntryId,
      `Baseline trip generation ${suffix}`,
      syntheticTripGenProgram({ dwellingUnits: 400, officeKsf: 60 })
    );
    ids.alternativeModelRunId = await launchTripGenRun(
      ids.alternativeEntryId,
      `Alternative trip generation ${suffix}`,
      syntheticTripGenProgram({ dwellingUnits: 900, officeKsf: 140 })
    );
    notes.push('Created the scenario set, both entries, the model, and two succeeded managed runs through the run-launch route.');

    // ---------------------------------------------------------------------
    // 6. County run — modeling provenance attributed to the same project
    // ---------------------------------------------------------------------
    const countyRunPayload = await expectAppFetch(
      '/api/county-runs',
      {
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        geographyType: SYNTHETIC_GEOGRAPHY.geographyType,
        geographyId: SYNTHETIC_GEOGRAPHY.geographyId,
        geographyLabel: SYNTHETIC_GEOGRAPHY.geographyLabel,
        countyPrefix: SYNTHETIC_GEOGRAPHY.countyPrefix,
        runName: countyRunName,
      },
      201,
      'County run creation'
    );
    ids.countyRunId = countyRunPayload.countyRunId;
    assertEqual(countyRunPayload.stage, 'bootstrap-incomplete', 'A freshly created county run should start at bootstrap-incomplete');
    notes.push(
      'Created a county validation run attributed to the canonical project. It stays at bootstrap-incomplete because no worker ran — the smoke proves the provenance edge, not a validated model.'
    );

    // ---------------------------------------------------------------------
    // 7. Data Hub datasets linked to the project
    // ---------------------------------------------------------------------
    ids.datasetIds = [];
    for (let index = 0; index < DATASET_COUNT; index += 1) {
      const datasetPayload = await expectAppFetch(
        '/api/data-hub/records',
        {
          recordType: 'dataset',
          workspaceId: ids.workspaceId,
          projectId: ids.projectId,
          relationshipType: index === 0 ? 'primary_input' : 'reference',
          name: `Spine smoke dataset ${index + 1} (${suffix})`,
          status: 'ready',
          geographyScope: 'corridor',
          coverageSummary: 'Study area focus zones + comparator geographies',
          notes: 'Spine smoke dataset attached to the canonical project.',
        },
        201,
        `Data Hub dataset ${index + 1} creation`
      );
      ids.datasetIds.push(datasetPayload.datasetId ?? datasetPayload.record?.id ?? datasetPayload.id);
    }
    assertEvery(ids.datasetIds.map((id) => ({ id })), (row) => Boolean(row.id), 'dataset ids');
    notes.push(`Created ${DATASET_COUNT} Data Hub datasets linked to the canonical project.`);

    // ---------------------------------------------------------------------
    // 8. The cartographic backdrop — now reachable through the product
    //
    // These three layers used to be written directly here, because the product
    // had no write route for any of them: a project created through
    // `POST /api/projects` had no coordinates, an RTP cycle had no anchor, and
    // a corridor could not be created at all. Their only historical producer
    // was the deleted demo seed, so every one of these layers was permanently
    // empty for a workspace built by using the app.
    //
    // They now go through real routes, which is what makes this section proof
    // rather than setup: if the write path regresses, the map assertions below
    // fail instead of being propped up by a service-role insert.
    // ---------------------------------------------------------------------
    const projectAnchor = syntheticPoint(1);
    await expectAppFetch(
      `/api/projects/${ids.projectId}/location`,
      { latitude: projectAnchor.lat, longitude: projectAnchor.lon },
      200,
      'Project location patch',
      'PATCH'
    );
    const rtpAnchor = syntheticPoint(2);
    await expectAppFetch(
      `/api/rtp-cycles/${ids.rtpCycleId}`,
      { anchorLatitude: rtpAnchor.lat, anchorLongitude: rtpAnchor.lon },
      200,
      'RTP cycle anchor patch',
      'PATCH'
    );
    notes.push('Placed the project marker and the RTP pin through the product write routes.');

    ids.corridorIds = [];
    for (let index = 0; index < CORRIDOR_COUNT; index += 1) {
      const corridorPayload = await expectAppFetch(
        `/api/projects/${ids.projectId}/corridors`,
        {
          name: `Spine smoke corridor ${index + 1} (${suffix})`,
          corridorType: index === 0 ? 'arterial' : 'bike',
          losGrade: index === 0 ? 'D' : 'C',
          geometry: syntheticLineString(index + 1, 5),
        },
        201,
        `Corridor ${index + 1} creation`
      );
      ids.corridorIds.push(corridorPayload.corridor?.id);
    }
    assertEvery(ids.corridorIds.map((id) => ({ id })), (row) => Boolean(row.id), 'corridor ids');
    assertRowCount(ids.corridorIds, CORRIDOR_COUNT, 'project corridors');
    notes.push(`Drew ${CORRIDOR_COUNT} corridors through POST /api/projects/{id}/corridors.`);

    // ---------------------------------------------------------------------
    // 9. Aerial missions, AOIs, evidence packages
    // ---------------------------------------------------------------------
    ids.missionIds = [];
    ids.packageIds = [];
    for (let index = 0; index < AERIAL_MISSION_COUNT; index += 1) {
      const missionPayload = await expectAppFetch(
        '/api/aerial/missions',
        {
          projectId: ids.projectId,
          title: `Spine smoke mission ${index + 1} (${suffix})`,
          status: 'complete',
          missionType: 'aoi_capture',
          geographyLabel: `Study corridor, Segment ${index + 1}`,
          collectedAt: new Date().toISOString(),
          notes: 'Spine smoke aerial mission on the canonical project.',
        },
        201,
        `Aerial mission ${index + 1} creation`
      );
      const missionId = missionPayload.missionId;
      ids.missionIds.push(missionId);

      await expectAppFetch(
        `/api/aerial/missions/${missionId}`,
        { aoiGeojson: syntheticPolygon(index + 1) },
        200,
        `Aerial mission ${index + 1} AOI attach`,
        'PATCH'
      );

      const packagePayload = await expectAppFetch(
        '/api/aerial/evidence-packages',
        {
          missionId,
          title: `Spine smoke evidence package ${index + 1} (${suffix})`,
          packageType: 'measurable_output',
          status: index < AERIAL_PACKAGE_COUNT - 1 ? 'ready' : 'qa_pending',
          verificationReadiness: index < AERIAL_PACKAGE_COUNT - 1 ? 'ready' : 'pending',
          notes: 'Spine smoke evidence package on the canonical project.',
        },
        201,
        `Aerial evidence package ${index + 1} creation`
      );
      ids.packageIds.push(packagePayload.packageId);
    }
    notes.push(
      `Created ${AERIAL_MISSION_COUNT} aerial missions with AOI polygons and ${AERIAL_PACKAGE_COUNT} evidence packages through the aerial routes.`
    );

    // ---------------------------------------------------------------------
    // 10. The project-targeted report that cites the evidence
    // ---------------------------------------------------------------------
    const reportPayload = await expectAppFetch(
      '/api/reports',
      {
        projectId: ids.projectId,
        reportType: 'analysis_summary',
        title: reportTitle,
        summary:
          'Spine smoke packet tying the canonical project to its managed model runs and its county-run modeling provenance.',
        modelingCountyRunId: ids.countyRunId,
        modelRunIds: [ids.baselineModelRunId, ids.alternativeModelRunId],
        countyRunIds: [ids.countyRunId],
      },
      201,
      'Project-targeted report creation'
    );
    ids.reportId = reportPayload.reportId;
    notes.push('Created a project-targeted analysis_summary report citing both managed runs and the county run.');

    // ---------------------------------------------------------------------
    // 11. Map feature routes must surface everything just created
    // ---------------------------------------------------------------------
    const mapProjects = await expectAppFetch('/api/map-features/projects', undefined, 200, 'Project map features');
    assertOk(
      Array.isArray(mapProjects.features) &&
        mapProjects.features.some((feature) => feature.properties?.projectId === ids.projectId),
      'Project map features did not include the canonical project.'
    );

    const mapRtpCycles = await expectAppFetch('/api/map-features/rtp-cycles', undefined, 200, 'RTP map features');
    assertOk(
      Array.isArray(mapRtpCycles.features) &&
        mapRtpCycles.features.some((feature) => feature.properties?.rtpCycleId === ids.rtpCycleId),
      'RTP map features did not include the RTP cycle created by this run.'
    );

    const mapCorridors = await expectAppFetch('/api/map-features/corridors', undefined, 200, 'Corridor map features');
    assertOk(
      Array.isArray(mapCorridors.features) &&
        ids.corridorIds.every((corridorId) =>
          mapCorridors.features.some((feature) => feature.properties?.corridorId === corridorId)
        ),
      'Corridor map features did not include every corridor created by this run.'
    );

    const mapAerial = await expectAppFetch('/api/map-features/aerial-missions', undefined, 200, 'Aerial map features');
    assertOk(
      Array.isArray(mapAerial.features) &&
        ids.missionIds.every((missionId) =>
          mapAerial.features.some((feature) => feature.properties?.missionId === missionId)
        ),
      'Aerial map features did not include every mission AOI created by this run.'
    );

    const mapEngagement = await expectAppFetch('/api/map-features/engagement', undefined, 200, 'Engagement map features');
    assertOk(
      Array.isArray(mapEngagement.features) &&
        ids.engagementItemIds.every((itemId) =>
          mapEngagement.features.some((feature) => feature.properties?.itemId === itemId)
        ),
      'Engagement map features did not include every approved item created by this run.'
    );
    notes.push('Verified all five map-feature routes surface the records this run created, scoped to its own workspace.');

    // ---------------------------------------------------------------------
    // 12. Database spine assertions — one project_id, everywhere
    // ---------------------------------------------------------------------
    const sameProject = (row) => row.project_id === ids.projectId;
    const sameWorkspace = (row) => row.workspace_id === ids.workspaceId;
    const sameSpine = (row) => sameProject(row) && sameWorkspace(row);

    const projectRtpLink = firstRow(
      await restSelect('project_rtp_cycle_links', {
        select: 'id,workspace_id,project_id,rtp_cycle_id,portfolio_role',
        id: `eq.${ids.projectRtpLinkId}`,
      }),
      'project RTP cycle link'
    );
    assertEqual(projectRtpLink.project_id, ids.projectId, 'RTP link project id drifted');
    assertEqual(projectRtpLink.rtp_cycle_id, ids.rtpCycleId, 'RTP link cycle id drifted');

    const rtpCycle = firstRow(
      await restSelect('rtp_cycles', { select: 'id,workspace_id,title,status', id: `eq.${ids.rtpCycleId}` }),
      'RTP cycle'
    );
    assertEqual(rtpCycle.workspace_id, ids.workspaceId, 'RTP cycle workspace drifted');

    const fundingProfile = firstRow(
      await restSelect('project_funding_profiles', {
        select: 'id,workspace_id,project_id,funding_need_amount,local_match_need_amount',
        project_id: `eq.${ids.projectId}`,
      }),
      'project funding profile'
    );
    assertOk(sameSpine(fundingProfile), 'Funding profile left the project/workspace spine');
    ids.projectFundingProfileId = fundingProfile.id;

    const program = firstRow(
      await restSelect('programs', {
        select: 'id,workspace_id,project_id,title,status,program_type',
        id: `eq.${ids.programId}`,
      }),
      'program'
    );
    assertOk(sameSpine(program), 'Program left the project/workspace spine');

    const opportunities = assertArray(
      await restSelect('funding_opportunities', {
        select: 'id,workspace_id,program_id,project_id,title,opportunity_status,decision_state',
        id: inFilter([ids.openOpportunityId, ids.awardedOpportunityId]),
      }),
      'funding opportunities'
    );
    assertRowCount(opportunities, 2, 'funding opportunities');
    assertEvery(opportunities, (row) => sameSpine(row) && row.program_id === ids.programId, 'funding opportunities');

    const award = firstRow(
      await restSelect('funding_awards', {
        select: 'id,workspace_id,project_id,program_id,funding_opportunity_id,title,awarded_amount',
        id: `eq.${ids.fundingAwardId}`,
      }),
      'funding award'
    );
    assertOk(sameSpine(award), 'Funding award left the project/workspace spine');
    assertEqual(award.funding_opportunity_id, ids.awardedOpportunityId, 'Funding award opportunity id drifted');

    const invoice = firstRow(
      await restSelect('billing_invoice_records', {
        select: 'id,workspace_id,project_id,funding_award_id,invoice_number,status,amount',
        id: `eq.${ids.invoiceId}`,
      }),
      'reimbursement invoice record'
    );
    assertOk(sameSpine(invoice), 'Reimbursement invoice left the project/workspace spine');
    assertEqual(invoice.funding_award_id, ids.fundingAwardId, 'Reimbursement invoice award id drifted');
    notes.push('Verified funding profile, program, both opportunities, award, and invoice all reuse the canonical project id.');

    const engagementCampaign = firstRow(
      await restSelect('engagement_campaigns', {
        select: 'id,workspace_id,project_id,rtp_cycle_id,title,status',
        id: `eq.${ids.engagementCampaignId}`,
      }),
      'engagement campaign'
    );
    assertOk(sameSpine(engagementCampaign), 'Engagement campaign left the project/workspace spine');
    assertEqual(engagementCampaign.rtp_cycle_id, ids.rtpCycleId, 'Engagement campaign RTP cycle id drifted');

    const engagementItems = assertArray(
      await restSelect('engagement_items', {
        select: 'id,campaign_id,title,status,source_type,latitude,longitude',
        id: inFilter(ids.engagementItemIds),
      }),
      'engagement items'
    );
    assertRowCount(engagementItems, ENGAGEMENT_ITEM_COUNT, 'engagement items');
    assertEvery(
      engagementItems,
      (row) => row.campaign_id === ids.engagementCampaignId && row.status === 'approved',
      'engagement items'
    );
    notes.push('Verified the engagement campaign and every approved item hang from the same project/RTP spine.');

    const scenarioSet = firstRow(
      await restSelect('scenario_sets', {
        select: 'id,workspace_id,project_id,title,status',
        id: `eq.${ids.scenarioSetId}`,
      }),
      'scenario set'
    );
    assertOk(sameSpine(scenarioSet), 'Scenario set left the project/workspace spine');

    const scenarioEntries = assertArray(
      await restSelect('scenario_entries', {
        select: 'id,scenario_set_id,entry_type,label,status,sort_order',
        id: inFilter([ids.baselineEntryId, ids.alternativeEntryId]),
        order: 'sort_order.asc',
      }),
      'scenario entries'
    );
    assertRowCount(scenarioEntries, 2, 'scenario entries');
    assertEvery(
      scenarioEntries,
      (row) => row.scenario_set_id === ids.scenarioSetId && row.status === 'ready',
      'scenario entries'
    );

    const modelRuns = assertArray(
      await restSelect('model_runs', {
        select: 'id,workspace_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,result_summary_json',
        id: inFilter([ids.baselineModelRunId, ids.alternativeModelRunId]),
      }),
      'managed model runs'
    );
    assertRowCount(modelRuns, 2, 'managed model runs');
    assertEvery(
      modelRuns,
      (row) =>
        sameWorkspace(row) &&
        row.model_id === ids.modelId &&
        row.status === 'succeeded' &&
        row.engine_key === 'ite_trip_generation' &&
        Boolean(row.result_summary_json),
      'managed model runs'
    );
    assertOk(
      modelRuns.some((row) => row.scenario_entry_id === ids.baselineEntryId) &&
        modelRuns.some((row) => row.scenario_entry_id === ids.alternativeEntryId),
      'Managed runs are not attributed to both scenario entries.'
    );

    const modelRunKpis = assertArray(
      await restSelect('model_run_kpis', {
        select: 'id,run_id,kpi_name',
        run_id: inFilter([ids.baselineModelRunId, ids.alternativeModelRunId]),
      }),
      'managed model run KPIs'
    );
    assertOk(modelRunKpis.length > 0, 'The managed runs recorded no KPI rows.');
    notes.push('Verified both managed runs succeeded, carry their scenario entry, and wrote KPI evidence rows.');

    const countyRun = firstRow(
      await restSelect('county_runs', {
        select: 'id,workspace_id,project_id,geography_id,run_name,stage,status_label',
        id: `eq.${ids.countyRunId}`,
      }),
      'county run'
    );
    assertOk(sameSpine(countyRun), 'County run left the project/workspace spine');
    assertEqual(countyRun.geography_id, SYNTHETIC_GEOGRAPHY.geographyId, 'County run geography drifted');

    const reportRow = firstRow(
      await restSelect('reports', {
        select: 'id,workspace_id,project_id,rtp_cycle_id,modeling_county_run_id,title,report_type,status',
        id: `eq.${ids.reportId}`,
      }),
      'project-targeted report'
    );
    assertOk(sameSpine(reportRow), 'Report left the project/workspace spine');
    assertEqual(reportRow.modeling_county_run_id, ids.countyRunId, 'Report modeling county run id drifted');
    assertEqual(reportRow.report_type, 'analysis_summary', 'Report type drifted');

    const reportRuns = assertArray(
      await restSelect('report_runs', {
        select: 'id,report_id,run_id,model_run_id,county_run_id,sort_order',
        report_id: `eq.${ids.reportId}`,
        order: 'sort_order.asc',
      }),
      'report evidence citations'
    );
    assertRowCount(reportRuns, 3, 'report evidence citations');
    assertEqual(reportRuns[0].model_run_id, ids.baselineModelRunId, 'First cited model run drifted');
    assertEqual(reportRuns[1].model_run_id, ids.alternativeModelRunId, 'Second cited model run drifted');
    assertEqual(reportRuns[2].county_run_id, ids.countyRunId, 'Cited county run drifted');
    ids.reportRunIds = reportRuns.map((row) => row.id);
    notes.push('Verified the report and its typed evidence citations preserve both managed runs and the county run.');

    const datasetLinks = assertArray(
      await restSelect('data_dataset_project_links', {
        select: 'dataset_id,project_id,relationship_type',
        project_id: `eq.${ids.projectId}`,
      }),
      'data dataset project links'
    );
    assertRowCount(datasetLinks, DATASET_COUNT, 'data dataset project links');
    assertEvery(datasetLinks, sameProject, 'data dataset project links');

    const corridors = assertArray(
      await restSelect('project_corridors', {
        select: 'id,workspace_id,project_id,name,corridor_type,los_grade,geometry_geojson',
        id: inFilter(ids.corridorIds),
      }),
      'project corridors'
    );
    assertRowCount(corridors, CORRIDOR_COUNT, 'project corridors');
    assertEvery(corridors, sameSpine, 'project corridors');

    const missions = assertArray(
      await restSelect('aerial_missions', {
        select: 'id,workspace_id,project_id,title,status,mission_type,aoi_geojson',
        id: inFilter(ids.missionIds),
      }),
      'aerial missions'
    );
    assertRowCount(missions, AERIAL_MISSION_COUNT, 'aerial missions');
    assertEvery(missions, (row) => sameSpine(row) && Boolean(row.aoi_geojson), 'aerial missions');

    const packages = assertArray(
      await restSelect('aerial_evidence_packages', {
        select: 'id,workspace_id,project_id,mission_id,title,status,verification_readiness',
        id: inFilter(ids.packageIds),
      }),
      'aerial evidence packages'
    );
    assertRowCount(packages, AERIAL_PACKAGE_COUNT, 'aerial evidence packages');
    assertEvery(packages, sameSpine, 'aerial evidence packages');
    notes.push('Verified Data Hub links, corridors, aerial missions, and aerial evidence packages all reuse the canonical project id.');

    // The whole point: after every module wrote, there is still exactly ONE
    // project in this workspace. A module that silently minted its own fails
    // here.
    await assertSingleProject('post-mutation');
    notes.push('Verified the workspace still holds exactly one project after every module wrote — no module minted a second.');

    // ---------------------------------------------------------------------
    // 13. Rendered surfaces
    // ---------------------------------------------------------------------
    await page.goto(`${baseUrl}/projects/${ids.projectId}`, { waitUntil: 'networkidle' });
    await page.getByText(projectName, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.getByText(/Aerial evidence/i).first().waitFor({ timeout: 30000 });
    await screenshot('local-spine-smoke-01-project-detail');
    notes.push('Rendered the project detail surface with the shared project spine.');

    await page.goto(`${baseUrl}/reports/${ids.reportId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: reportTitle, exact: false }).waitFor({ timeout: 30000 });
    await screenshot('local-spine-smoke-02-report-detail');
    notes.push('Rendered the project-targeted report detail page.');

    // ---------------------------------------------------------------------
    // 14. Proof record
    // ---------------------------------------------------------------------
    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-spine-smoke.md`);
    const lines = [
      `# OpenPlan Local Phase 1 Spine Smoke - ${datePart}`,
      '',
      '## Command',
      '- `cd qa-harness && npm run local-spine-smoke`',
      '',
      '## Local Targets',
      `- App URL: ${baseUrl}`,
      `- Supabase URL: ${supabaseUrl}`,
      `- Local guard result: ${localGuardNote}`,
      '',
      '## Provisioning Posture',
      '- **Self-provisioning.** This smoke reads no checked-in fixture. It creates one auth user, lets the `on_auth_user_created` trigger provision that user a workspace, and then builds every record it asserts on through the app HTTP route a planner would use.',
      '- **Place-neutral.** No jurisdiction, agency, or real coordinate appears anywhere in the fixture. Labels are generic; every geometry is anchored on a deliberately meaningless origin (0°, 0°) so a fixture can never be mistaken for analysis geography.',
      '- **Hermetic.** Each run works inside a workspace that did not exist a moment earlier, so there is no prior-run residue to clean and no shared state with any other smoke.',
      '',
      '## Boundary Notes',
      '- **All three cartographic-backdrop layers were written through product routes.** They previously had no write path at all — the deleted demo seed was their only producer, so a project or RTP cycle created through the app never appeared on the map and a corridor could not be created by any means. This run places the project marker via `PATCH /api/projects/{id}/location`, the RTP pin via `PATCH /api/rtp-cycles/{id}`, and the corridors via `POST /api/projects/{id}/corridors`, then asserts the map-features routes return them.',
      '- The managed runs use the `ite_trip_generation` engine, which is a pure computation over a land-use program. The corridor engine was not used because it needs real geography with live Census/LODES coverage — a place-shaped dependency this smoke exists to avoid.',
      '- The county run stays at `bootstrap-incomplete`. Advancing it to `validated-screening` requires the Python worker and real artifacts on disk; this smoke proves the project-provenance edge only, and claims nothing about model validity.',
      '',
      '## Key IDs',
      `- QA user email: ${email}`,
      `- QA user id: ${ids.userId ?? 'unknown'}`,
      `- Workspace id: ${ids.workspaceId}`,
      `- Canonical project id: ${ids.projectId}`,
      `- RTP cycle id: ${ids.rtpCycleId}`,
      `- Project RTP link id: ${ids.projectRtpLinkId}`,
      `- Project funding profile id: ${ids.projectFundingProfileId ?? 'unknown'}`,
      `- Program id: ${ids.programId}`,
      `- Funding opportunity ids: ${ids.openOpportunityId}, ${ids.awardedOpportunityId}`,
      `- Funding award id: ${ids.fundingAwardId}`,
      `- Reimbursement invoice id: ${ids.invoiceId}`,
      `- Engagement campaign id: ${ids.engagementCampaignId}`,
      `- Engagement item ids: ${ids.engagementItemIds.join(', ')}`,
      `- Scenario set id: ${ids.scenarioSetId}`,
      `- Scenario entry ids: ${ids.baselineEntryId}, ${ids.alternativeEntryId}`,
      `- Model id: ${ids.modelId}`,
      `- Managed model run ids: ${ids.baselineModelRunId}, ${ids.alternativeModelRunId}`,
      `- County run id: ${ids.countyRunId}`,
      `- Project-targeted report id: ${ids.reportId}`,
      `- Report evidence citation ids: ${ids.reportRunIds?.join(', ') ?? 'unknown'}`,
      `- Data Hub dataset ids: ${ids.datasetIds.join(', ')}`,
      `- Project corridor ids: ${ids.corridorIds.join(', ')}`,
      `- Aerial mission ids: ${ids.missionIds.join(', ')}`,
      `- Aerial evidence package ids: ${ids.packageIds.join(', ')}`,
      '',
      '## Pass/Fail Notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Artifacts',
      ...artifacts.map((artifact) => `- docs/ops/${datePart}-test-output/${artifact}`),
      '',
      '## Verdict',
      `- PASS: project_id ${ids.projectId} — created once through \`POST /api/projects\` — is reused across RTP linkage, the grants chain, engagement, scenarios and managed model runs, county-run modeling provenance, the project-targeted report and its typed evidence citations, Data Hub dataset links, the corridor map layer, aerial missions, and aerial evidence packages. All five map-feature routes surface those records, and the workspace still holds exactly one project after every module wrote.`,
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
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
