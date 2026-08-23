/**
 * Local real-orthophoto smoke.
 *
 * Unlike the lightweight aerial evidence smoke, this one requires a directory
 * of genuine overlapping mission photos. It uploads them through the normal
 * mission UI, dispatches OpenPlan's v1.1 worker, waits for NodeODM, proves that
 * OpenPlan holds the resulting preview bytes, and renders that preview on the
 * mission map and the shared authenticated Aerial map.
 *
 * Required environment:
 *   OPENPLAN_AERIAL_SMOKE_PHOTOS_DIR=/absolute/path/to/mission/photos
 *
 * The app must be running with the v1.1 worker contract. The worker and
 * NodeODM are operator services, so this smoke checks them rather than starting
 * or reconfiguring them.
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { chromium } = require('playwright');
const {
  buildBrowserContextOptions,
  getOutputDir,
  guardLocalMutationTargets,
  loadEnv,
  repoRoot,
} = require('./harness-env');
const {
  assertEqual,
  assertOk,
  buildRunIdentity,
  createAppFetch,
  createExpectingAppFetch,
  createQaAuthUser,
  createRestClient,
  signInThroughBrowser,
} = require('./fixtures/provision');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const baseUrl = process.env.OPENPLAN_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const workerHealthUrl = process.env.OPENPLAN_AERIAL_SMOKE_WORKER_HEALTH_URL || 'http://localhost:8484/healthz';
const photosDir = process.env.OPENPLAN_AERIAL_SMOKE_PHOTOS_DIR;
const PHOTO_EXTENSION = /\.(?:jpe?g|png|tiff?|dng)$/i;
const PROCESSING_TIMEOUT_MS = Number(process.env.OPENPLAN_AERIAL_SMOKE_TIMEOUT_MS || 20 * 60 * 1000);
const POLL_INTERVAL_MS = 5000;

function readPhotoPaths() {
  assertOk(photosDir, 'Set OPENPLAN_AERIAL_SMOKE_PHOTOS_DIR to a directory of genuine overlapping mission photos.');
  assertOk(path.isAbsolute(photosDir), 'OPENPLAN_AERIAL_SMOKE_PHOTOS_DIR must be an absolute path.');
  assertOk(fs.statSync(photosDir).isDirectory(), `${photosDir} is not a directory.`);
  const photos = fs.readdirSync(photosDir)
    .filter((name) => PHOTO_EXTENSION.test(name))
    .map((name) => path.join(photosDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort();
  assertOk(photos.length >= 3, `The real-orthophoto smoke needs at least 3 photos; found ${photos.length}.`);
  return photos;
}

function previewBoundsToAoi(row) {
  const west = Number(row.bounds_west);
  const south = Number(row.bounds_south);
  const east = Number(row.bounds_east);
  const north = Number(row.bounds_north);
  assertOk(
    [west, south, east, north].every(Number.isFinite) && west < east && south < north,
    'The held preview did not carry a valid WGS84 rectangle from the worker.'
  );
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

async function waitFor(label, load, accept) {
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  let latest;
  while (Date.now() < deadline) {
    latest = await load();
    if (accept(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${label} did not arrive within ${Math.round(PROCESSING_TIMEOUT_MS / 1000)} seconds. Last value: ${JSON.stringify(latest)}`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const photoPaths = readPhotoPaths();
  const photoBytes = photoPaths.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);

  const workerHealthResponse = await fetch(workerHealthUrl);
  const workerHealth = await workerHealthResponse.json().catch(() => null);
  assertOk(workerHealthResponse.ok, `ODM worker health failed: HTTP ${workerHealthResponse.status}`);
  assertEqual(workerHealth?.status, 'ok', 'ODM worker did not report healthy');
  assertEqual(workerHealth?.nodeodm?.reachable, true, 'ODM worker could not reach NodeODM');

  const { env } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  assertOk(supabaseUrl && serviceRoleKey, 'Missing local Supabase configuration.');
  const localGuardNote = guardLocalMutationTargets({
    appUrl: baseUrl,
    supabaseUrl,
    scriptName: 'local real orthophoto render smoke',
  });

  const { selectRows } = createRestClient({ supabaseUrl, serviceRoleKey });
  const identity = buildRunIdentity('aerial-ortho-render-smoke');
  const projectName = `Aerial Ortho Render Smoke ${identity.suffix}`;
  const missionTitle = `Real orthophoto render proof ${identity.stamp}`;
  const artifacts = [];
  const notes = [localGuardNote];
  const ids = {};

  ids.userId = await createQaAuthUser({
    supabaseUrl,
    serviceRoleKey,
    email: identity.email,
    password: identity.password,
    purpose: 'openplan-local-aerial-ortho-render-smoke',
  });

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.OPENPLAN_QA_CHROME || undefined,
  });
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

  try {
    await signInThroughBrowser(page, {
      baseUrl,
      email: identity.email,
      password: identity.password,
    });
    const currentWorkspace = await expectAppFetch('/api/workspaces/current', undefined, 200, 'Current workspace lookup');
    ids.workspaceId = currentWorkspace.workspaceId;
    assertOk(ids.workspaceId, 'Sign-up did not provision a workspace.');

    const project = await expectAppFetch(
      '/api/projects',
      {
        projectName,
        planType: 'corridor_plan',
        deliveryPhase: 'scoping',
        status: 'active',
        summary: 'Hermetic local proof that a real ODM preview survives custody and renders as a planning-map layer.',
      },
      201,
      'Project creation'
    );
    ids.projectId = project.projectRecordId;

    const mission = await expectAppFetch(
      '/api/aerial/missions',
      {
        projectId: ids.projectId,
        title: missionTitle,
        status: 'active',
        missionType: 'aoi_capture',
        geographyLabel: 'Mission imagery extent, read from the processed artifact',
        collectedAt: new Date().toISOString(),
        notes: 'Real local ODM render proof. The source directory remains outside the repository.',
      },
      201,
      'Mission creation'
    );
    ids.missionId = mission.missionId;

    await page.goto(`${baseUrl}/aerial`, { waitUntil: 'networkidle' });
    await page.getByText(missionTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.locator(`a[href="/aerial/missions/${ids.missionId}"]`).first().click();
    await page.waitForURL((url) => url.pathname === `/aerial/missions/${ids.missionId}`, { timeout: 30000 });
    await page.getByRole('heading', { name: missionTitle, exact: false }).waitFor({ timeout: 30000 });

    const capability = await expectAppFetch(
      `/api/aerial/missions/${ids.missionId}/process`,
      undefined,
      200,
      'Worker capability'
    );
    assertEqual(capability.workerConfigured, true, 'OpenPlan did not see a configured ODM worker');
    assertEqual(capability.workerContract, 'v1.1', 'OpenPlan was not running the stored-photo v1.1 contract');

    const uploadInput = page.locator(`#aerial-imagery-upload-${ids.missionId}`);
    await uploadInput.setInputFiles(photoPaths);
    const uploadControl = page.locator(`label[for="aerial-imagery-upload-${ids.missionId}"]`);
    await uploadControl.getByText('Uploading…', { exact: true }).waitFor({ timeout: 30000 });
    await uploadControl.getByText('Upload photos', { exact: true }).waitFor({ timeout: 240000 });
    await page.getByText(`${path.basename(photoPaths[0])}: stored.`, { exact: true }).waitFor({ timeout: 30000 });
    await page.getByText(`${path.basename(photoPaths[photoPaths.length - 1])}: stored.`, { exact: true }).waitFor({ timeout: 30000 });

    const imageryPayload = await expectAppFetch(
      `/api/aerial/missions/${ids.missionId}/imagery`,
      undefined,
      200,
      'Stored mission imagery'
    );
    const imageryRows = imageryPayload.imagery;
    assertOk(Array.isArray(imageryRows), `Stored mission imagery rows were not an array: ${JSON.stringify(imageryPayload)}`);
    assertEqual(imageryRows.length, photoPaths.length, 'Not every selected photo was stored');
    assertOk(
      imageryRows.every((row) => typeof row.checksum_sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.checksum_sha256)),
      'At least one stored photo lacked its computed SHA-256.'
    );
    notes.push(`Uploaded ${photoPaths.length} real photos (${photoBytes} bytes) through the mission photo control.`);

    // Reload so the processing form re-reads the v1.1 stored-photo count.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('aerial-stored-photos-source').waitFor({ timeout: 30000 });
    await page.getByTestId('aerial-stored-photos-source').getByText(`${photoPaths.length} stored photos`, { exact: false }).waitFor();
    await page.locator('#aerial-preset').selectOption('fast-preview');
    const processingForm = page.getByRole('form', { name: 'Request imagery processing' });
    await processingForm.getByRole('button', { name: 'Request processing' }).click();
    await processingForm.getByRole('status').waitFor({ timeout: 30000 });

    const jobRows = await waitFor(
      'Succeeded ODM job',
      () => selectRows(
        'aerial_processing_jobs',
        {
          select: 'id,request_id,job_reference,status,progress,message,imagery_type,imagery_image_count,updated_at',
          mission_id: `eq.${ids.missionId}`,
        },
        'ODM job poll'
      ),
      (rows) => rows.length === 1 && ['succeeded', 'failed', 'canceled'].includes(rows[0].status)
    );
    const job = jobRows[0];
    ids.processingJobId = job.id;
    ids.jobReference = job.job_reference;
    assertEqual(job.status, 'succeeded', `ODM job ended as ${job.status}: ${job.message || 'no message'}`);
    assertEqual(job.imagery_type, 'photo_manifest', 'ODM job did not use the stored-photo manifest');
    assertEqual(job.imagery_image_count, photoPaths.length, 'ODM job image count drifted');

    const custodyRows = await waitFor(
      'Held orthophoto preview',
      () => selectRows(
        'aerial_artifact_custody',
        {
          select: 'id,kind,state,storage_bucket,storage_path,byte_size,checksum_sha256,content_type,bounds_west,bounds_south,bounds_east,bounds_north,crs,pixel_size_m,held_at,failure_code,failure_detail',
          processing_job_id: `eq.${ids.processingJobId}`,
        },
        'Artifact custody poll'
      ),
      (rows) => rows.some((row) => row.kind === 'ortho_preview' && row.state === 'held')
    );
    const preview = custodyRows.find((row) => row.kind === 'ortho_preview');
    assertOk(preview, 'The succeeded worker callback did not produce an ortho_preview custody row.');
    assertEqual(preview.state, 'held', `The preview was not held: ${preview.failure_code || preview.failure_detail || 'unknown reason'}`);
    assertEqual(preview.storage_bucket, 'aerial-artifacts', 'The preview landed in the wrong storage bucket');
    assertEqual(preview.content_type, 'image/png', 'The held preview is not a PNG');
    assertOk(Number(preview.byte_size) > 0, 'The held preview has no stored bytes.');
    assertOk(/^[0-9a-f]{64}$/.test(preview.checksum_sha256), 'The held preview has no valid SHA-256.');
    ids.custodyId = preview.id;

    const aoiGeojson = previewBoundsToAoi(preview);
    await expectAppFetch(
      `/api/aerial/missions/${ids.missionId}`,
      { aoiGeojson },
      200,
      'Mission AOI from verified preview bounds',
      'PATCH'
    );

    const signedProof = await page.evaluate(async ({ custodyId }) => {
      const catalogResponse = await fetch(`/api/map-layers/aerial-orthos?custodyId=${encodeURIComponent(custodyId)}`);
      const catalog = await catalogResponse.json();
      if (!catalogResponse.ok || catalog.state !== 'verified' || !catalog.layer?.url) {
        return { ok: false, stage: 'catalog', status: catalogResponse.status, catalog };
      }
      const imageResponse = await fetch(catalog.layer.url);
      const bytes = await imageResponse.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      return {
        ok: imageResponse.ok,
        stage: 'image',
        status: imageResponse.status,
        contentType: imageResponse.headers.get('content-type'),
        byteSize: bytes.byteLength,
        checksum,
      };
    }, { custodyId: ids.custodyId });
    assertEqual(signedProof.ok, true, `The browser could not fetch the resolved held preview: ${JSON.stringify(signedProof)}`);
    assertEqual(signedProof.contentType, 'image/png', 'The signed preview response is not image/png');
    assertEqual(signedProof.byteSize, Number(preview.byte_size), 'Signed preview bytes differ from custody');
    assertEqual(signedProof.checksum, preview.checksum_sha256, 'Signed preview SHA-256 differs from custody');

    const storagePathMarker = encodeURIComponent(preview.storage_path).replaceAll('%2F', '/');
    const missionPreviewResponse = page.waitForResponse(
      (response) => response.url().includes(storagePathMarker) && response.ok(),
      { timeout: 60000 }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await missionPreviewResponse;
    await page.getByTestId('aerial-mission-map').scrollIntoViewIfNeeded();
    const missionOrthoToggle = page.getByLabel('Orthomosaic preview', { exact: false });
    await missionOrthoToggle.waitFor({ timeout: 30000 });
    assertEqual(await missionOrthoToggle.isChecked(), true, 'Mission preview did not default visible');
    await page.waitForTimeout(1500);
    await screenshot('local-aerial-ortho-render-smoke-01-mission-preview');

    const workspaceToggle = page.getByLabel('Show this preview on other planning maps', { exact: true });
    await workspaceToggle.check();
    assertEqual(await workspaceToggle.isChecked(), true, 'Planner selection did not remain checked');

    const sharedPreviewResponse = page.waitForResponse(
      (response) => response.url().includes(storagePathMarker) && response.ok(),
      { timeout: 60000 }
    );
    await page.goto(`${baseUrl}/aerial`, { waitUntil: 'domcontentloaded' });
    await sharedPreviewResponse;
    const aerialLayers = page.getByRole('region', { name: 'Aerial imagery layers' });
    await aerialLayers.waitFor({ timeout: 30000 });
    const sharedToggle = aerialLayers.getByLabel(missionTitle, { exact: false });
    await sharedToggle.waitFor({ timeout: 30000 });
    assertEqual(await sharedToggle.isChecked(), true, 'Selected preview was not on in the shared Aerial map');
    const sharedCanvas = page.locator('.mapboxgl-canvas').first();
    await sharedCanvas.waitFor({ timeout: 30000 });
    await aerialLayers.getByRole('button', { name: 'Zoom to preview' }).click();
    await page.waitForTimeout(2000);
    const sharedMapOn = await sharedCanvas.screenshot();
    await screenshot('local-aerial-ortho-render-smoke-02-shared-map-on');
    await sharedToggle.uncheck();
    await page.waitForTimeout(1000);
    const sharedMapOff = await sharedCanvas.screenshot();
    assertOk(!sharedMapOn.equals(sharedMapOff), 'The shared map canvas did not change when the preview was switched off.');
    await screenshot('local-aerial-ortho-render-smoke-03-shared-map-off');

    assertOk(browserErrors.length === 0, `Browser errors: ${browserErrors.join(' | ')}`);
    notes.push('Verified the browser-resolved PNG byte count and SHA-256 against the custody row.');
    notes.push('Observed successful PNG responses while the mission map and shared Aerial map rendered the held preview.');
    notes.push(`Zoomed to the selected preview and proved its shared map canvas changed when switched off (on ${createHash('sha256').update(sharedMapOn).digest('hex').slice(0, 12)}, off ${createHash('sha256').update(sharedMapOff).digest('hex').slice(0, 12)}).`);

    const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-aerial-ortho-render-smoke.md`);
    const report = [
      `# OpenPlan Local Real Orthophoto Render Smoke - ${datePart}`,
      '',
      '## Command',
      '- `cd qa-harness && OPENPLAN_AERIAL_SMOKE_PHOTOS_DIR=/absolute/path/to/photos npm run local-aerial-ortho-render-smoke`',
      '',
      '## Proof boundary',
      '- The input was a caller-supplied directory of genuine overlapping mission photos. The photos are not stored in this repository.',
      '- The smoke created a fresh local user, workspace, project, and mission through OpenPlan, then uploaded every photo through the mission photo control.',
      '- OpenPlan dispatched a `photo_manifest` under contract v1.1. The self-hosted worker ran NodeODM and called OpenPlan back.',
      '- OpenPlan copied the worker-produced PNG into its own `aerial-artifacts` bucket. The browser fetched those held bytes through the authenticated map-layer route.',
      '- Exact coordinates are deliberately omitted from this repository report. The browser screenshots remain local test output and are gitignored because they contain real imagery.',
      '',
      '## Result',
      `- Photos processed: ${photoPaths.length}`,
      `- Source bytes: ${photoBytes}`,
      `- Processing status: ${job.status}`,
      `- Imagery type: ${job.imagery_type}`,
      `- Held preview bytes: ${preview.byte_size}`,
      `- Held preview SHA-256: ${preview.checksum_sha256}`,
      `- Native CRS reported: ${preview.crs || 'none'}`,
      `- Pixel size reported: ${preview.pixel_size_m || 'none'}`,
      '- Georeference: valid WGS84 rectangle reported by the worker; coordinates withheld from this report.',
      '',
      '## Pass notes',
      ...notes.map((note) => `- PASS: ${note}`),
      '',
      '## Local screenshots',
      ...artifacts.map((artifact) => `- docs/ops/${datePart}-test-output/${artifact}`),
      '',
      '## Verdict',
      '- PASS: A real NodeODM run produced a georeferenced PNG, OpenPlan took custody of the exact bytes, the signed map route served the same SHA-256, and the preview was visible on both the mission map and the planner-selected shared Aerial map.',
      '',
    ];
    fs.writeFileSync(reportPath, report.join('\n'));
    console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
    console.log(JSON.stringify({ reportPath, artifacts, ids, photoCount: photoPaths.length, photoBytes, job, preview: { ...preview, bounds_west: 'withheld', bounds_south: 'withheld', bounds_east: 'withheld', bounds_north: 'withheld' }, notes }, null, 2));
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
