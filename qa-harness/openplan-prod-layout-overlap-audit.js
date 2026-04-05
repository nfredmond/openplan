const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOpenplanBaseUrl, getOutputDir, loadEnv, repoRoot } = require('./harness-env');

const outputDate = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(outputDate);
const productionBaseUrl = getOpenplanBaseUrl();
const viewportWidth = Number(process.env.OPENPLAN_AUDIT_WIDTH || 1440);
const viewportHeight = Number(process.env.OPENPLAN_AUDIT_HEIGHT || 1600);
const viewportTag = `w${viewportWidth}`;

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

function buildCountyManifest({ runName, countyFips, countyPrefix, scaffoldPath }) {
  return {
    schema_version: 'openplan.county_onramp_manifest.v1',
    generated_at: new Date().toISOString(),
    name: runName,
    county_fips: countyFips,
    county_prefix: countyPrefix,
    run_dir: `/tmp/${runName}`,
    mode: 'existing-run',
    stage: 'validated-screening',
    artifacts: {
      scaffold_csv: scaffoldPath,
      review_packet_md: `/tmp/${runName}-review.md`,
      run_summary_json: `/tmp/${runName}-run-summary.json`,
      bundle_manifest_json: `/tmp/${runName}-bundle-manifest.json`,
      validation_summary_json: `/tmp/${runName}-validation-summary.json`,
    },
    runtime: {
      keep_project: true,
      force: false,
      overall_demand_scalar: 0.369,
      external_demand_scalar: null,
      hbw_scalar: null,
      hbo_scalar: null,
      nhb_scalar: null,
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
      validation: {
        screening_gate: {
          status_label: 'bounded screening-ready',
          required_matches: 1,
          ready_median_ape_threshold: 30,
          ready_critical_ape_threshold: 50,
          reasons: ['Layout audit seeded a bounded screening-ready validation slice.'],
        },
      },
      bundle_validation: {
        status_label: 'bounded screening-ready',
      },
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
  const email = `openplan-layout-audit-${stamp}@natfordplanning.com`;
  const password = `OpenPlan!${Date.now()}LayoutAudit`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    buildBrowserContextOptions({ viewport: { width: viewportWidth, height: viewportHeight } })
  );
  const page = await context.newPage();

  const summary = {
    createdAt: new Date().toISOString(),
    baseUrl: productionBaseUrl,
    viewport: { width: viewportWidth, height: viewportHeight },
    envPath,
    email,
    password,
    pages: [],
    screenshots: [],
    notes: [],
    ids: {},
  };

  async function screenshot(name) {
    const fileName = `${outputDate}-${viewportTag}-${name}.png`;
    const fullPath = path.join(outputDir, fileName);
    await page.screenshot({ path: fullPath, fullPage: true });
    summary.screenshots.push(fullPath);
    return fullPath;
  }

  async function appFetch(route, payload) {
    return await page.evaluate(async ({ route, payload }) => {
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
    }, { route, payload });
  }

  async function auditCurrentPage(name) {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);

    const audit = await page.evaluate(() => {
      const selector = ['[data-slot="card"]', '.module-section-surface', '.module-intro-card', '.module-record-row'].join(',');
      const elements = Array.from(document.querySelectorAll(selector))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 60 && rect.height > 40;
        })
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          return {
            index,
            text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140),
            classes: Array.from(element.classList).slice(0, 10).join(' '),
            rect: {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
            element,
          };
        });

      const overlaps = [];
      for (let i = 0; i < elements.length; i += 1) {
        for (let j = i + 1; j < elements.length; j += 1) {
          const a = elements[i];
          const b = elements[j];
          if (a.element.contains(b.element) || b.element.contains(a.element)) continue;

          const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (overlapWidth <= 12 || overlapHeight <= 12) continue;

          const overlapArea = overlapWidth * overlapHeight;
          if (overlapArea < 1500) continue;

          overlaps.push({
            a: { text: a.text, classes: a.classes, rect: a.rect },
            b: { text: b.text, classes: b.classes, rect: b.rect },
            overlapWidth,
            overlapHeight,
            overlapArea,
          });
        }
      }

      overlaps.sort((left, right) => right.overlapArea - left.overlapArea);
      return {
        cardCount: elements.length,
        overlapCount: overlaps.length,
        overlaps: overlaps.slice(0, 12),
      };
    });

    const screenshotPath = await screenshot(name);
    summary.pages.push({ name, screenshotPath, ...audit });
    return audit;
  }

  try {
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
          purpose: 'openplan-production-layout-audit',
          created_by: 'bartholomew',
          created_at: new Date().toISOString(),
        },
      }),
    });
    if (!createUserResult.ok) throw new Error(`Failed to create QA user: ${createUserResult.status} ${JSON.stringify(createUserResult.data)}`);
    summary.ids.userId = createUserResult.data.user?.id ?? null;

    await page.goto(`${productionBaseUrl}/models`, { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/models', { timeout: 20000 }),
      page.getByRole('button', { name: /^sign in$/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    summary.notes.push('Signed into production with dedicated layout-audit user.');

    const projectName = `QA Layout Audit Project ${stamp}`;
    const projectResult = await appFetch('/api/projects', {
      projectName,
      summary: 'Production layout audit workspace created by automation.',
      planType: 'corridor_plan',
      deliveryPhase: 'scoping',
      status: 'active',
    });
    if (projectResult.status !== 201) throw new Error(`Project creation failed: ${projectResult.status} ${JSON.stringify(projectResult.data)}`);
    summary.ids.workspaceId = projectResult.data.workspaceId;
    summary.ids.projectId = projectResult.data.projectRecordId;

    const planTitle = `QA Layout Plan ${stamp}`;
    const planResult = await appFetch('/api/plans', {
      projectId: summary.ids.projectId,
      title: planTitle,
      planType: 'corridor',
      status: 'active',
      geographyLabel: 'QA Layout Corridor',
      horizonYear: 2040,
      summary: 'Plan created for production layout audit.',
      links: [{ linkType: 'project_record', linkedId: summary.ids.projectId }],
    });
    if (planResult.status !== 201) throw new Error(`Plan creation failed: ${planResult.status} ${JSON.stringify(planResult.data)}`);
    summary.ids.planId = planResult.data.planId;

    const modelTitle = `QA Layout Model ${stamp}`;
    const modelResult = await appFetch('/api/models', {
      projectId: summary.ids.projectId,
      title: modelTitle,
      modelFamily: 'accessibility',
      status: 'configuring',
      configVersion: 'qa-layout-v1',
      ownerLabel: 'Bartholomew QA',
      horizonLabel: '2040 pilot',
      assumptionsSummary: 'Production layout audit assumptions.',
      inputSummary: 'Linked to QA layout project and plan.',
      outputSummary: 'Supports layout audit continuity checks.',
      summary: 'Automated production layout audit model.',
      links: [
        { linkType: 'plan', linkedId: summary.ids.planId },
        { linkType: 'project_record', linkedId: summary.ids.projectId },
      ],
    });
    if (modelResult.status !== 201) throw new Error(`Model creation failed: ${modelResult.status} ${JSON.stringify(modelResult.data)}`);
    summary.ids.modelId = modelResult.data.modelId;

    const programTitle = `QA Layout Program ${stamp}`;
    const programResult = await appFetch('/api/programs', {
      projectId: summary.ids.projectId,
      title: programTitle,
      programType: 'rtip',
      status: 'assembling',
      cycleName: 'QA Layout Cycle',
      sponsorAgency: 'Nat Ford QA',
      fiscalYearStart: 2027,
      fiscalYearEnd: 2029,
      summary: 'Automated production layout audit program.',
      links: [
        { linkType: 'plan', linkedId: summary.ids.planId },
        { linkType: 'project_record', linkedId: summary.ids.projectId },
      ],
    });
    if (programResult.status !== 201) throw new Error(`Program creation failed: ${programResult.status} ${JSON.stringify(programResult.data)}`);
    summary.ids.programId = programResult.data.programId;

    const runName = `layout-audit-county-${stamp}`;
    const countyFips = '06057';
    const countyPrefix = 'NEVADA';
    const scaffoldPath = `/tmp/${runName}.csv`;
    const countyRunResult = await appFetch('/api/county-runs', {
      workspaceId: summary.ids.workspaceId,
      geographyType: 'county_fips',
      geographyId: countyFips,
      geographyLabel: 'Nevada County, CA',
      runName,
      countyPrefix,
      runtimeOptions: {},
    });
    if (countyRunResult.status !== 201) throw new Error(`County run creation failed: ${countyRunResult.status} ${JSON.stringify(countyRunResult.data)}`);
    summary.ids.countyRunId = countyRunResult.data.countyRunId;

    const manifestResult = await appFetch(`/api/county-runs/${summary.ids.countyRunId}/manifest`, {
      status: 'completed',
      manifest: buildCountyManifest({ runName, countyFips, countyPrefix, scaffoldPath }),
    });
    if (manifestResult.status !== 200) throw new Error(`County manifest ingest failed: ${manifestResult.status} ${JSON.stringify(manifestResult.data)}`);

    const scaffoldSeedResult = await appFetch(`/api/county-runs/${summary.ids.countyRunId}/scaffold`, {
      csvContent: 'station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n',
    });
    if (scaffoldSeedResult.status !== 200) throw new Error(`County scaffold seed failed: ${scaffoldSeedResult.status} ${JSON.stringify(scaffoldSeedResult.data)}`);

    const pagesToAudit = [
      { name: 'layout-audit-01-projects-list', url: `${productionBaseUrl}/projects` },
      { name: 'layout-audit-02-models-list', url: `${productionBaseUrl}/models` },
      { name: 'layout-audit-03-model-detail', url: `${productionBaseUrl}/models/${summary.ids.modelId}` },
      { name: 'layout-audit-04-plan-detail', url: `${productionBaseUrl}/plans/${summary.ids.planId}` },
      { name: 'layout-audit-05-program-detail', url: `${productionBaseUrl}/programs/${summary.ids.programId}` },
      { name: 'layout-audit-06-county-runs-list', url: `${productionBaseUrl}/county-runs` },
      { name: 'layout-audit-07-county-run-detail', url: `${productionBaseUrl}/county-runs/${summary.ids.countyRunId}` },
      { name: 'layout-audit-08-billing', url: `${productionBaseUrl}/billing` },
    ];

    for (const entry of pagesToAudit) {
      await page.goto(entry.url, { waitUntil: 'networkidle' });
      const result = await auditCurrentPage(entry.name);
      summary.notes.push(`${entry.name}: cardCount=${result.cardCount}, overlapCount=${result.overlapCount}.`);
    }

    const offenders = summary.pages.filter((pageAudit) => pageAudit.overlapCount > 0);
    const reportPath = path.join(repoRoot, `docs/ops/${outputDate}-${viewportTag}-openplan-production-layout-overlap-audit.md`);
    const lines = [
      `# OpenPlan Production Layout Overlap Audit — ${outputDate} (${viewportWidth}×${viewportHeight})`,
      '',
      `- Base URL: ${productionBaseUrl}`,
      `- Viewport: ${viewportWidth}×${viewportHeight}`,
      `- QA user email: ${email}`,
      `- Workspace id: ${summary.ids.workspaceId ?? 'unknown'}`,
      `- Project id: ${summary.ids.projectId ?? 'unknown'}`,
      `- Plan id: ${summary.ids.planId ?? 'unknown'}`,
      `- Model id: ${summary.ids.modelId ?? 'unknown'}`,
      `- Program id: ${summary.ids.programId ?? 'unknown'}`,
      `- County run id: ${summary.ids.countyRunId ?? 'unknown'}`,
      '',
      '## Page audit summary',
      ...summary.pages.map((pageAudit) => `- ${pageAudit.name}: ${pageAudit.cardCount} candidate surfaces scanned; ${pageAudit.overlapCount} overlap(s) detected.`),
      '',
      '## Likely offenders',
      ...(offenders.length
        ? offenders.flatMap((pageAudit) => [
            `### ${pageAudit.name}`,
            ...pageAudit.overlaps.map((overlap, index) => `- Overlap ${index + 1}: area=${overlap.overlapArea.toFixed(0)} between [${overlap.a.classes}] "${overlap.a.text}" and [${overlap.b.classes}] "${overlap.b.text}"`),
            '',
          ])
        : ['- No meaningful container overlap was detected on the audited pages.', '']),
      '## Artifacts',
      ...summary.screenshots.map((filePath) => `- ${path.relative(repoRoot, filePath)}`),
      '',
      '## Notes',
      '- This audit measures actual bounding-box overlap between visible card/section containers, not subjective visual crowding.',
      '- QA production records and auth identities should be removed after the audit via the cleanup harness.',
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
