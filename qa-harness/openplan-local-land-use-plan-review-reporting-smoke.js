const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, guardLocalMutationTargets, loadEnv, repoRoot } = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || 'http://localhost:3040';

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

function requireResult(result, label, expectedStatus) {
  if (result.status !== expectedStatus) {
    throw new Error(`${label} failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing local Supabase environment keys');
  const guardNote = guardLocalMutationTargets({ appUrl: baseUrl, supabaseUrl, scriptName: 'local land-use-plan review-reporting smoke' });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `openplan-local-land-use-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}LandUseReview`;
  const planTitle = `Local review journey ${stamp.slice(11, 19)}`;
  const ids = {};
  const notes = [guardNote];
  const artifacts = [];

  const createdUser = requireResult(await jsonFetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { purpose: 'openplan-local-land-use-plan-review-reporting-smoke' } }),
  }), 'QA user creation', 200);
  ids.userId = createdUser.user?.id ?? createdUser.id;

  const localChrome = fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.OPENPLAN_QA_CHROME || localChrome });
  const context = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1200 } }));
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  async function screenshot(targetPage, name) {
    const fileName = `${datePart}-${name}.png`;
    await targetPage.screenshot({ path: path.join(outputDir, fileName), fullPage: true });
    artifacts.push(fileName);
  }

  async function signedFetch(route, payload, method = payload ? 'POST' : 'GET') {
    const execute = () => page.evaluate(async ({ route, method, body }) => {
      const response = await fetch(route, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: response.ok, status: response.status, data };
    }, { route, method, body: payload });
    try {
      return await execute();
    } catch (error) {
      if (!String(error?.message ?? error).includes('Execution context was destroyed')) throw error;
      await page.waitForLoadState('domcontentloaded');
      return execute();
    }
  }

  async function appFetch(route, payload, method = payload ? 'POST' : 'GET') {
    return signedFetch(route, payload, method);
  }

  async function expectAppFetch(route, payload, expectedStatus = 201, label = route, method = payload ? 'POST' : 'GET') {
    return requireResult(await signedFetch(route, payload, method), label, expectedStatus);
  }

  try {
    await page.goto(`${baseUrl}/land-use-plans`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    const bootstrap = await expectAppFetch('/api/workspaces/bootstrap', { workspaceName: `Land use QA ${stamp.slice(11, 19)}`, plan: 'pilot' }, 200, 'workspace bootstrap');
    ids.workspaceId = bootstrap.workspaceId;

    const document = await expectAppFetch('/api/knowledge-base/documents/paste', {
      workspaceId: ids.workspaceId,
      title: 'Public review and adoption evidence',
      text: 'Planner-authored record of the external review, response disposition, hearing evidence, and adoption decision.',
      docKind: 'other',
    });
    ids.documentId = document.document.id;

    const layer = await expectAppFetch('/api/workspace-gis/layers', { name: `Future land use ${stamp}`, description: 'Exact designation-map version for the land-use-plan workflow.' });
    ids.layerId = layer.layer.id;
    const ingest = await expectAppFetch('/api/workspace-gis/ingests', {
      layerId: ids.layerId,
      sourceFormat: 'geojson',
      sourceFilename: 'future-land-use.geojson',
      sourceByteSize: 480,
      declaredFeatureCount: 1,
      sourceFeatureCount: 1,
      droppedFeatureCount: 0,
      geometryKinds: ['Polygon'],
      attributeFields: [{ name: 'designation', type: 'string' }, { name: 'private_owner', type: 'string' }],
      bbox: [-121.1, 39.1, -121.0, 39.2],
      reprojectionEngine: 'none',
    });
    ids.layerVersionId = ingest.version.id;
    requireResult(await appFetch(`/api/workspace-gis/ingests/${ids.layerVersionId}/features`, {
      startIndex: 0,
      features: [{ type: 'Feature', properties: { designation: 'Mixed-use center', private_owner: 'Never public' }, geometry: { type: 'Polygon', coordinates: [[[-121.1, 39.1], [-121.0, 39.1], [-121.0, 39.2], [-121.1, 39.2], [-121.1, 39.1]]] } }],
    }, 'POST'), 'GIS feature ingest', 200);
    requireResult(await appFetch(`/api/workspace-gis/ingests/${ids.layerVersionId}/finalize`, undefined, 'POST'), 'GIS finalize', 200);

    const plan = await expectAppFetch('/api/land-use-plans', {
      title: planTitle,
      descriptorId: 'local-unconfigured',
      planKindKey: 'comprehensive',
      authorityLabel: 'Local QA planning authority',
      geographyLabel: 'QA drawn study area',
      geographyGeojson: { type: 'Polygon', coordinates: [[[-121.2, 39.0], [-120.9, 39.0], [-120.9, 39.3], [-121.2, 39.3], [-121.2, 39.0]]] },
    });
    ids.planId = plan.planId;
    ids.version1Id = plan.versionId;
    const unpublished = await jsonFetch(`${baseUrl}/api/public/land-use-plans/${ids.planId}`);
    if (unpublished.status !== 404) throw new Error(`Unpublished plan was exposed: ${unpublished.status}`);

    let detail = requireResult(await appFetch(`/api/land-use-plans/${ids.planId}`), 'plan detail', 200);
    const section = detail.nodes.find((node) => node.node_kind === 'section');
    await expectAppFetch(`/api/land-use-plans/${ids.planId}/content`, { operation: 'update', nodeId: section.id, body: 'This plan directs compact mixed-use growth while preserving the exact adopted designation map.' }, 200);
    const policy = await expectAppFetch(`/api/land-use-plans/${ids.planId}/content`, { operation: 'create', parentNodeId: section.id, nodeKind: 'policy', title: 'Direct growth to mapped centers', body: 'Use the adopted designation layer when evaluating implementation work.' });
    const designation = await expectAppFetch(`/api/land-use-plans/${ids.planId}/designations`, {
      layerId: ids.layerId,
      layerVersionId: ids.layerVersionId,
      designationSetLabel: 'Future land-use designations',
      legendMetadata: { disclosure: 'Future land use is not zoning.' },
      publicFieldKeys: ['designation'],
      legendField: 'designation',
      policyNodeIds: [policy.nodeId],
    });
    ids.designation1Id = designation.designationId;
    await expectAppFetch(`/api/land-use-plans/${ids.planId}/implementation`, { operation: 'create', title: 'Update implementation program', description: 'Annual status is frozen into the implementation report.', responsibleParty: 'Planning department', dueOn: '2027-04-01' });
    const frozen1 = await expectAppFetch(`/api/land-use-plans/${ids.planId}/freeze`, { state: 'public_review' }, 200);
    ids.version1Hash = frozen1.contentHash;

    const campaign = await expectAppFetch('/api/engagement/campaigns', { title: `Plan review ${stamp}`, summary: 'Public response closure for the first review round.', engagementType: 'comment_collection', status: 'active' });
    ids.campaignId = campaign.campaignId;
    const comment = await expectAppFetch(`/api/engagement/campaigns/${ids.campaignId}/items`, { title: 'Support mixed-use centers', body: 'Please explain how implementation will be reported.', submittedBy: 'Local participant', status: 'approved', sourceType: 'public' });
    await expectAppFetch(`/api/engagement/campaigns/${ids.campaignId}/closeloop`, { themeTitle: 'Implementation reporting', youSaid: 'Explain how progress will be reported.', weDid: 'The adopted workflow freezes annual action status.', sourceItemIds: [comment.itemId], status: 'published' });
    const release1 = await expectAppFetch(`/api/land-use-plans/${ids.planId}/review-releases`, {
      operation: 'release', versionId: ids.version1Id, versionContentHash: ids.version1Hash,
      reviewMethod: 'engagement_campaign', reviewOpenOn: '2026-08-01', reviewCloseOn: '2026-08-22',
      engagementCampaignId: ids.campaignId, externalReviewDocumentId: null,
    });
    ids.release1Id = release1.releaseId;
    ids.release1Token = release1.publicUrl.split('/').pop();
    await expectAppFetch(`/api/land-use-plans/${ids.planId}/process`, { versionId: ids.version1Id, processKey: 'local_process', status: 'in_progress', dueOn: '2026-09-24', completedOn: null, evidenceDocumentId: ids.documentId, notes: 'Open process record used to prove My Work reachability.' }, 200);
    await page.goto(`${baseUrl}/my-work?scope=all_projects`, { waitUntil: 'networkidle' });
    await page.getByText(/Close review round \d+/i).waitFor();
    await page.getByText(/Local\s+process/i).waitFor();
    await screenshot(page, 'land-use-review-02-my-work-dated-links');
    requireResult(await appFetch(`/api/engagement/campaigns/${ids.campaignId}`, { status: 'closed' }, 'PATCH'), 'campaign closure', 200);
    const closed1 = await expectAppFetch(`/api/land-use-plans/${ids.planId}/review-releases`, { operation: 'close', releaseId: ids.release1Id, dispositionSummary: null }, 200);
    if (!closed1.outcomeHash) throw new Error('Engagement review closed without an outcome hash');

    const anonContext = await browser.newContext(buildBrowserContextOptions({ viewport: { width: 1440, height: 1200 } }));
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`${baseUrl}${release1.publicUrl}`, { waitUntil: 'domcontentloaded' });
    await anonPage.getByText(planTitle, { exact: false }).first().waitFor();
    await anonPage.getByText(/closed release remains available/i).waitFor();
    await screenshot(anonPage, 'land-use-review-01-closed-record-desktop');
    const publicMap = await jsonFetch(`${baseUrl}/api/public/land-use-plan-reviews/${ids.release1Token}/map/${ids.designation1Id}?bbox=-121.2,39,-120.9,39.3`);
    requireResult(publicMap, 'anonymous frozen designation map', 200);
    const serializedMap = JSON.stringify(publicMap.data);
    if (!serializedMap.includes('Mixed-use center') || serializedMap.includes('Never public') || serializedMap.includes('private_owner')) {
      throw new Error(`Public map field selection failed: ${serializedMap}`);
    }
    await expectAppFetch(`/api/land-use-plans/${ids.planId}/review-releases`, { operation: 'withdraw', releaseId: ids.release1Id, reason: 'Superseded QA release used to prove withdrawal hiding.' }, 200);
    const withdrawn = await anonPage.goto(`${baseUrl}${release1.publicUrl}`, { waitUntil: 'domcontentloaded' });
    if (withdrawn.status() !== 404) throw new Error(`Withdrawn review content remained public: ${withdrawn.status()}`);
    notes.push('Closed review remained public, then withdrawal hid its content while retaining the release row.');

    const revision = await expectAppFetch(`/api/land-use-plans/${ids.planId}/versions`, { baseVersionId: ids.version1Id });
    ids.version2Id = revision.versionId;
    if (revision.versionKind !== 'revision') throw new Error(`Reviewed draft forked as ${revision.versionKind}`);
    detail = requireResult(await appFetch(`/api/land-use-plans/${ids.planId}`), 'revision detail', 200);
    if (detail.processRecords.length !== 0) throw new Error('Revision inherited prior-version process completion');
    const frozen2 = await expectAppFetch(`/api/land-use-plans/${ids.planId}/freeze`, { state: 'public_review' }, 200);
    ids.version2Hash = frozen2.contentHash;
    detail = requireResult(await appFetch(`/api/land-use-plans/${ids.planId}`), 'second frozen version detail', 200);
    ids.designation2Id = detail.designations[0].id;
    const release2 = await expectAppFetch(`/api/land-use-plans/${ids.planId}/review-releases`, {
      operation: 'release', versionId: ids.version2Id, versionContentHash: ids.version2Hash,
      reviewMethod: 'external_process', reviewOpenOn: '2026-08-23', reviewCloseOn: '2026-09-23',
      engagementCampaignId: null, externalReviewDocumentId: ids.documentId,
    });
    ids.release2Id = release2.releaseId;
    ids.release2Token = release2.publicUrl.split('/').pop();
    await expectAppFetch(`/api/land-use-plans/${ids.planId}/review-releases`, { operation: 'close', releaseId: ids.release2Id, dispositionSummary: 'The planner reviewed the external record and retained the mapped designation and annual reporting commitment.' }, 200);
    await expectAppFetch(`/api/land-use-plans/${ids.planId}/process`, { versionId: ids.version2Id, processKey: 'local_process', status: 'complete', dueOn: '2026-09-23', completedOn: '2026-09-24', evidenceDocumentId: ids.documentId, notes: 'Actual date entered by the planner; OpenPlan did not calculate it.' }, 200);
    const adopted = await expectAppFetch(`/api/land-use-plans/${ids.planId}/decisions`, {
      operation: 'adopt', versionId: ids.version2Id, versionContentHash: ids.version2Hash,
      decisionKind: 'adoption', decisionBody: 'Local QA legislative body', instrumentType: 'resolution',
      instrumentIdentifier: `QA-${stamp.slice(11, 19)}`, vote: '5-0', decidedOn: '2026-09-24', effectiveOn: '2026-09-24', supportingDocumentId: ids.documentId,
    }, 200);
    ids.decisionId = adopted.decisionId;
    const publication = await expectAppFetch(`/api/land-use-plans/${ids.planId}/decisions`, { operation: 'publish', versionId: ids.version2Id, versionContentHash: ids.version2Hash, title: `${planTitle} adopted packet` }, 200);
    ids.packetReportId = publication.reportId;
    detail = requireResult(await appFetch(`/api/land-use-plans/${ids.planId}`), 'adopted detail', 200);
    const adoptedAction = detail.actions[0];
    await expectAppFetch(`/api/land-use-plans/${ids.planId}/implementation`, { operation: 'update_status', actionId: adoptedAction.id, status: 'in_progress', evidenceDocumentId: ids.documentId }, 200);
    const implementation = await expectAppFetch(`/api/land-use-plans/${ids.planId}/implementation-reports`, { reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-12-31', title: `${planTitle} annual implementation report`, summary: 'One action is in progress against the exact adopted plan hash.' });
    ids.implementationReportId = implementation.reportId;

    const provenance = requireResult(await appFetch(`/api/reports/${ids.implementationReportId}/provenance`), 'implementation provenance', 200);
    if (provenance.report.land_use_plan_id !== ids.planId || provenance.artifact.metadata_json.snapshot.actions[0].status !== 'in_progress') {
      throw new Error('Implementation report provenance did not resolve the plan and frozen action status');
    }

    await page.goto(`${baseUrl}/land-use-plans/${ids.planId}`, { waitUntil: 'networkidle' });
    await page.getByText(planTitle, { exact: false }).first().waitFor();
    await page.getByRole('link', { name: /Open adopted-plan report/i }).waitFor();
    await page.getByRole('link', { name: /^open readable report$/i }).waitFor();
    await screenshot(page, 'land-use-review-03-adopted-workbench-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: /^open readable report$/i }).scrollIntoViewIfNeeded();
    await screenshot(page, 'land-use-review-04-adopted-workbench-mobile-report-link');

    await anonPage.setViewportSize({ width: 1440, height: 1200 });
    await anonPage.goto(`${baseUrl}${release2.publicUrl}`, { waitUntil: 'domcontentloaded' });
    await anonPage.getByText(/Future land-use designations/i).first().waitFor();
    await screenshot(anonPage, 'land-use-review-05-second-review-map-desktop');
    await anonPage.setViewportSize({ width: 390, height: 844 });
    await screenshot(anonPage, 'land-use-review-06-second-review-map-mobile');
    await anonPage.setViewportSize({ width: 1440, height: 1200 });
    await anonPage.goto(`${baseUrl}${publication.publicUrl}`, { waitUntil: 'domcontentloaded' });
    await anonPage.getByText(/They are not zoning/i).waitFor();
    await screenshot(anonPage, 'land-use-review-07-adopted-map-desktop');

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`${baseUrl}/reports/${ids.packetReportId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: `${planTitle} adopted packet` }).waitFor();
    await page.getByText(/Direct growth to mapped centers/i).waitFor();
    await page.emulateMedia({ media: 'print' });
    await screenshot(page, 'land-use-review-08-printable-plan-packet');
    await page.emulateMedia({ media: 'screen' });
    await page.goto(`${baseUrl}/reports/${ids.implementationReportId}`, { waitUntil: 'networkidle' });
    await page.getByText(/Frozen action-status snapshot/i).waitFor();
    await screenshot(page, 'land-use-review-09-readable-implementation-report');

    const releaseAudit = await jsonFetch(`${supabaseUrl}/rest/v1/land_use_plan_review_releases?id=eq.${ids.release1Id}&select=id,status,withdrawal_reason`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
    if (releaseAudit.data?.[0]?.status !== 'withdrawn') throw new Error('Withdrawn review audit row was not retained');
    if (browserErrors.length) throw new Error(`Browser console errors: ${browserErrors.join(' | ')}`);
    notes.push('API journey completed creation, GIS finalization, Engagement closure, revision, second review, exact-hash adoption, publication, and readable annual reporting.');
    notes.push('Anonymous map returned only the planner-selected designation field; the private source attribute never appeared.');

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-land-use-plan-review-reporting-smoke.md`);
    const lines = [
      `# OpenPlan local Land Use Plans review-reporting smoke — ${datePart}`,
      '',
      `- App: ${baseUrl}`,
      `- Supabase: ${supabaseUrl}`,
      `- Plan: ${planTitle}`,
      '',
      '## Result',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Durable journey IDs',
      ...Object.entries(ids).map(([key, value]) => `- ${key}: ${value}`),
      '',
      '## Screenshots',
      ...artifacts.map((artifact) => `- ${artifact}`),
      '',
      'This smoke is local-only and intentionally leaves its timestamped QA workspace and records in the local database for inspection.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(JSON.stringify({ reportPath, ids, artifacts, notes }, null, 2));
    await anonPage.close();
    await anonContext.close();
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
