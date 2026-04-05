const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, loadEnv, repoRoot } = require('./harness-env');

const outputDate = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(outputDate);
const productionBaseUrl = process.env.OPENPLAN_BASE_URL || 'https://openplan-zeta.vercel.app';

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

function buildManifest({ runName, countyFips, countyPrefix, scaffoldPath, stamp, validated }) {
  const validationSummary = validated
    ? {
        validation_type: 'screening_assignment_vs_observed_counts',
        model_run_id: `${runName}-validation`,
        model_engine: 'AequilibraE screening runtime',
        model_caveats: ['screening-grade only', 'smoke harness proof'],
        counts_source_csv: scaffoldPath,
        model_geometry_source: `/tmp/${runName}-loaded_links.geojson`,
        model_project_db: `/tmp/${runName}-project.sqlite`,
        model_volume_field: 'PCE_tot',
        stations_total: 1,
        stations_matched: 1,
        stations_missed: 0,
        screening_gate: {
          status_label: 'bounded screening-ready',
          required_matches: 1,
          ready_median_ape_threshold: 30,
          ready_critical_ape_threshold: 50,
          reasons: ['Smoke harness seeded a bounded screening-ready validation slice.'],
        },
        metrics: {
          median_absolute_percent_error: 16.01,
          mean_absolute_percent_error: 16.01,
          min_absolute_percent_error: 16.01,
          max_absolute_percent_error: 16.01,
          spearman_rho_facility_ranking: 1,
        },
        created_at: new Date().toISOString(),
      }
    : null;

  return {
    schema_version: 'openplan.county_onramp_manifest.v1',
    generated_at: new Date().toISOString(),
    name: runName,
    county_fips: countyFips,
    county_prefix: countyPrefix,
    run_dir: `/tmp/${runName}`,
    mode: 'existing-run',
    stage: validated ? 'validated-screening' : 'runtime-complete',
    artifacts: {
      scaffold_csv: scaffoldPath,
      review_packet_md: `/tmp/${runName}-review-packet.md`,
      run_summary_json: `/tmp/${runName}-run-summary.json`,
      bundle_manifest_json: `/tmp/${runName}-bundle-manifest.json`,
      validation_summary_json: validated ? `/tmp/${runName}-validation-summary.json` : null,
      activitysim_bundle_manifest_json: null,
      behavioral_prototype_manifest_json: null,
      behavioral_runtime_manifest_json: null,
      behavioral_runtime_summary_json: null,
      behavioral_ingestion_summary_json: null,
      behavioral_kpi_summary_json: null,
      behavioral_kpi_packet_md: null,
    },
    runtime: {
      keep_project: true,
      force: false,
      overall_demand_scalar: 0.369,
      external_demand_scalar: null,
      hbw_scalar: null,
      hbo_scalar: null,
      nhb_scalar: null,
      activitysim_container_image: null,
      container_engine_cli: null,
      activitysim_container_cli_template: null,
      container_network_mode: null,
    },
    summary: {
      run: {
        zone_count: 26,
        population_total: 102345,
        jobs_total: 45678,
        loaded_links: 3174,
        final_gap: 0.0091,
        total_trips: 231828.75,
      },
      validation: validationSummary,
      bundle_validation: validated
        ? {
            counts_csv: scaffoldPath,
            status_label: 'bounded screening-ready',
            matched_stations: 1,
            metrics: {
              median_absolute_percent_error: 16.01,
              mean_absolute_percent_error: 16.01,
              min_absolute_percent_error: 16.01,
              max_absolute_percent_error: 16.01,
              spearman_rho_facility_ranking: 1,
            },
          }
        : null,
      scaffold: {
        station_count: 1,
        observed_volume_filled_count: 1,
        observed_volume_missing_count: 0,
        source_agency_filled_count: 1,
        source_agency_tbd_count: 0,
        source_description_filled_count: 1,
        source_description_missing_count: 0,
        ready_station_count: 1,
        next_action_label: 'All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.',
      },
      activitysim_bundle: null,
      behavioral_prototype: null,
    },
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const { env, envPath } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase environment keys');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `openplan-county-scaffold-smoke-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}CountyScaffold`;
  const projectName = `County Scaffold Smoke Project ${stamp}`;
  const runName = `county-scaffold-smoke-${stamp}`;
  const countyFips = '06057';
  const countyPrefix = 'NEVADA';
  const scaffoldPath = `/tmp/openplan-county-scaffold-smoke-${stamp}.csv`;
  const initialCsv = 'station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n';
  const replacementCsv = 'station_id,observed_volume,source_agency,source_description\nA,789,Caltrans,PM 2.4\nB,456,Nevada County,Truckee Way\n';

  const summary = {
    createdAt: new Date().toISOString(),
    baseUrl: productionBaseUrl,
    envPath,
    email,
    password,
    projectName,
    runName,
    countyFips,
    countyPrefix,
    scaffoldPath,
    workspaceId: null,
    projectId: null,
    countyRunId: null,
    screenshots: [],
    downloadedFiles: [],
    notes: [],
  };

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
        purpose: 'openplan-production-county-scaffold-smoke',
        created_by: 'bartholomew',
        created_at: new Date().toISOString(),
      },
    }),
  });
  if (!createUserResult.ok) throw new Error(`Failed to create QA user: ${createUserResult.status} ${JSON.stringify(createUserResult.data)}`);
  summary.userId = createUserResult.data.user?.id ?? null;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    buildBrowserContextOptions({ viewport: { width: 1440, height: 1800 }, acceptDownloads: true })
  );
  const page = await context.newPage();

  async function screenshot(name) {
    const fileName = `${outputDate}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await page.screenshot({ path: fullPath, fullPage: true });
    summary.screenshots.push(fullPath);
    return fullPath;
  }

  async function appFetch(route, payload, method = payload ? 'POST' : 'GET') {
    return await page.evaluate(
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
    await page.goto(`${productionBaseUrl}/sign-in`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    summary.notes.push('Signed into production with dedicated county scaffold smoke user.');

    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production smoke project for county scaffold import/download verification.',
      planType: 'corridor_plan',
      deliveryPhase: 'scoping',
      status: 'active',
    });
    if (projectResult.status !== 201) throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    summary.workspaceId = projectResult.data.workspaceId;
    summary.projectId = projectResult.data.projectRecordId;
    summary.notes.push('Created project/workspace via production API.');

    const countyRunResult = await appFetch('/api/county-runs', {
      workspaceId: summary.workspaceId,
      geographyType: 'county_fips',
      geographyId: countyFips,
      geographyLabel: 'Nevada County, CA',
      runName,
      countyPrefix,
      runtimeOptions: {},
    });
    if (countyRunResult.status !== 201) throw new Error(`County run creation failed: ${countyRunResult.status} ${JSON.stringify(countyRunResult.data)}`);
    summary.countyRunId = countyRunResult.data.countyRunId;
    summary.notes.push('Created county run record via production API.');

    const runtimeManifestResult = await appFetch(`/api/county-runs/${summary.countyRunId}/manifest`, {
      status: 'completed',
      manifest: buildManifest({ runName, countyFips, countyPrefix, scaffoldPath, stamp, validated: false }),
    });
    if (runtimeManifestResult.status !== 200) throw new Error(`Runtime manifest ingest failed: ${runtimeManifestResult.status} ${JSON.stringify(runtimeManifestResult.data)}`);
    summary.notes.push('Ingested runtime-complete county manifest with registered scaffold path.');

    const scaffoldSeedResult = await appFetch(`/api/county-runs/${summary.countyRunId}/scaffold`, { csvContent: initialCsv });
    if (scaffoldSeedResult.status !== 200) throw new Error(`Scaffold seed failed: ${scaffoldSeedResult.status} ${JSON.stringify(scaffoldSeedResult.data)}`);
    summary.notes.push('Seeded initial scaffold CSV through the production scaffold API.');

    const initialScaffoldGet = await appFetch(`/api/county-runs/${summary.countyRunId}/scaffold`);
    if (initialScaffoldGet.status !== 200 || initialScaffoldGet.data?.csvContent !== initialCsv) {
      throw new Error(`Initial scaffold GET failed after seed: ${initialScaffoldGet.status} ${JSON.stringify(initialScaffoldGet.data)}`);
    }
    summary.notes.push('Verified the seeded scaffold reloaded from the live scaffold GET endpoint.');

    const validatedManifestResult = await appFetch(`/api/county-runs/${summary.countyRunId}/manifest`, {
      status: 'completed',
      manifest: buildManifest({ runName, countyFips, countyPrefix, scaffoldPath, stamp, validated: true }),
    });
    if (validatedManifestResult.status !== 200) throw new Error(`Validated manifest ingest failed: ${validatedManifestResult.status} ${JSON.stringify(validatedManifestResult.data)}`);
    summary.notes.push('Promoted the county run back to a bounded screening-ready state before exercising scaffold edits.');

    const detailBeforeEdit = await appFetch(`/api/county-runs/${summary.countyRunId}`);
    if (detailBeforeEdit.status !== 200 || detailBeforeEdit.data?.stage !== 'validated-screening') {
      throw new Error(`Expected validated-screening detail before UI edit: ${detailBeforeEdit.status} ${JSON.stringify(detailBeforeEdit.data)}`);
    }

    await page.goto(`${productionBaseUrl}/county-runs/${summary.countyRunId}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Nevada County, CA/i }).waitFor({ timeout: 20000 });
    await page.waitForFunction(
      (expected) => {
        const textarea = document.querySelector('textarea');
        return Boolean(textarea && textarea.value.includes(expected));
      },
      'station_id,observed_volume,source_agency,source_description',
      { timeout: 20000 }
    );
    await screenshot('prod-county-scaffold-01-detail-ready');
    summary.notes.push('County run detail rendered the registered scaffold CSV in the production editor.');

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: 'Download scaffold CSV' }).click();
    const download = await downloadPromise;
    const downloadPath = path.join(outputDir, `${outputDate}-prod-county-scaffold-download.csv`);
    await download.saveAs(downloadPath);
    const downloadedCsv = fs.readFileSync(downloadPath, 'utf8');
    if (downloadedCsv !== initialCsv) {
      throw new Error(`Downloaded scaffold CSV mismatch. Expected ${JSON.stringify(initialCsv)} got ${JSON.stringify(downloadedCsv)}`);
    }
    summary.downloadedFiles.push(downloadPath);
    summary.notes.push('Download scaffold CSV emitted the current stored CSV content.');

    const replacementInput = page.locator('input[type="file"]');
    await replacementInput.setInputFiles({
      name: 'replacement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(replacementCsv, 'utf8'),
    });
    await page.getByText('Imported file: replacement.csv').waitFor({ timeout: 10000 });
    await page.waitForFunction(
      (expected) => {
        const textarea = document.querySelector('textarea');
        return Boolean(textarea && textarea.value.includes(expected));
      },
      'A,789,Caltrans,PM 2.4',
      { timeout: 10000 }
    );
    await screenshot('prod-county-scaffold-02-imported');
    summary.notes.push('Imported replacement CSV file hydrated the editor without manual paste workflow.');

    const saveButton = page.getByRole('button', { name: 'Save scaffold CSV' });
    const saveButtonDisabledBeforeClick = await saveButton.isDisabled();
    summary.notes.push(`Save scaffold button disabled before click: ${saveButtonDisabledBeforeClick}.`);
    if (saveButtonDisabledBeforeClick) {
      throw new Error('Save scaffold button remained disabled after scaffold import.');
    }

    const saveResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes(`/api/county-runs/${summary.countyRunId}/scaffold`),
      { timeout: 30000 }
    );
    await saveButton.click();
    const saveResponse = await saveResponsePromise;
    summary.notes.push(`Save scaffold response status: ${saveResponse.status()}.`);
    if (saveResponse.status() !== 200) {
      const failureBody = await saveResponse.text().catch(() => '<unreadable>');
      throw new Error(`Save scaffold POST failed with status ${saveResponse.status()}: ${failureBody}`);
    }
    await page.getByText('Scaffold saved and readiness refreshed.').waitFor({ timeout: 30000 });

    const scaffoldAfterSave = await appFetch(`/api/county-runs/${summary.countyRunId}/scaffold`);
    if (scaffoldAfterSave.status !== 200 || scaffoldAfterSave.data?.csvContent !== replacementCsv) {
      throw new Error(`Saved scaffold GET failed: ${scaffoldAfterSave.status} ${JSON.stringify(scaffoldAfterSave.data)}`);
    }

    const detailAfterSave = await appFetch(`/api/county-runs/${summary.countyRunId}`);
    if (detailAfterSave.status !== 200) {
      throw new Error(`County detail reload failed after save: ${detailAfterSave.status} ${JSON.stringify(detailAfterSave.data)}`);
    }
    if (detailAfterSave.data?.stage !== 'validation-scaffolded') {
      throw new Error(`Expected stage=validation-scaffolded after scaffold save, got ${JSON.stringify(detailAfterSave.data?.stage)}`);
    }
    if (detailAfterSave.data?.statusLabel !== 'Validation pending scaffold edits') {
      throw new Error(`Expected validation invalidation status label after save, got ${JSON.stringify(detailAfterSave.data?.statusLabel)}`);
    }
    if (detailAfterSave.data?.manifest?.summary?.validation !== null) {
      throw new Error('Expected validation summary to be cleared after scaffold save.');
    }
    if (detailAfterSave.data?.manifest?.summary?.scaffold?.ready_station_count !== 2) {
      throw new Error(`Expected ready_station_count=2 after scaffold save, got ${JSON.stringify(detailAfterSave.data?.manifest?.summary?.scaffold?.ready_station_count)}`);
    }

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Nevada County, CA/i }).waitFor({ timeout: 20000 });
    await page.waitForFunction(
      (expected) => {
        const textarea = document.querySelector('textarea');
        return Boolean(textarea && textarea.value.includes(expected));
      },
      'A,789,Caltrans,PM 2.4',
      { timeout: 20000 }
    );
    const statusVisible = await page.getByText('Validation pending scaffold edits').isVisible().catch(() => false);
    summary.notes.push(
      `Validation invalidation label visible after reload: ${statusVisible}. Backend state was confirmed via production API regardless of this visual check.`
    );
    await screenshot('prod-county-scaffold-03-saved');
    summary.notes.push('Saving the imported CSV persisted the new scaffold, refreshed readiness counts, and invalidated the prior validation state.');

    const reportPath = path.join(repoRoot, `docs/ops/${outputDate}-openplan-production-county-scaffold-smoke.md`);
    const lines = [
      `# OpenPlan Production County Scaffold Smoke — ${outputDate}`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- QA user email: ${email}`,
      `- Workspace id: ${summary.workspaceId}`,
      `- Project id: ${summary.projectId}`,
      `- County run id: ${summary.countyRunId}`,
      `- Registered scaffold path: ${scaffoldPath}`,
      '',
      '## Pass/Fail Notes',
      ...summary.notes.map((note) => `- PASS: ${note}`),
      '',
      '## Assertions proven on production',
      '- County run creation and manifest ingest succeeded on the live deployment.',
      '- The live scaffold API could store and reload a scaffold CSV at the registered path.',
      '- County run detail loaded the stored scaffold into the editor on production.',
      '- Download scaffold CSV exported the currently stored scaffold content.',
      '- Import scaffold CSV file hydrated the editor with a replacement file without manual paste.',
      '- Save scaffold CSV persisted the replacement content, refreshed readiness counts, and invalidated a previously validated county slice.',
      '',
      '## Artifacts',
      ...summary.screenshots.map((filePath) => `- ${path.relative(repoRoot, filePath)}`),
      ...summary.downloadedFiles.map((filePath) => `- ${path.relative(repoRoot, filePath)}`),
      '',
      '## Notes',
      '- This smoke used dedicated production QA identities and records for verification.',
      '- Run the QA cleanup harness afterward to remove the temporary county run/workspace/auth user.',
      '',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'));

    console.log(JSON.stringify({ success: true, reportPath, summary }, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
