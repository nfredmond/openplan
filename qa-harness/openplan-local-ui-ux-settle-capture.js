const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const docsOpsRoot = path.join(repoRoot, 'docs', 'ops');
const defaultOutputDir = path.join(docsOpsRoot, '2026-04-29-test-output', 'ui-ux-settle');

const HARD_DENIAL_PATTERN =
  /(not found|404|unauthorized|not authorized|forbidden|403|no workspace membership|not provisioned)/i;
const WORKSPACE_AUTH_PREREQUISITE_PATTERN =
  /(workspace membership (required|missing)|membership required|workspace required|workspace is required|no workspace selected)/i;

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 844 },
};

/**
 * Record-detail routes take their id from the operator's own workspace.
 *
 * These used to be hardcoded UUIDs from a checked-in demo seed, which meant the
 * capture only ever produced screenshots of one agency's data — and 404ed for
 * anybody else. There is no seed now. A detail route with no id supplied is
 * ledgered as `fixture_required` and skipped, which is a non-blocking status:
 * the capture still runs and still says plainly which routes it could not
 * reach and how to reach them.
 *
 * Deliberately NOT self-provisioning: this script authenticates from a storage
 * state the operator hands it, and its job is to photograph whatever workspace
 * it is pointed at. Creating records of its own would duplicate the two local
 * spine smokes and photograph a workspace nobody asked about.
 */
const RECORD_ID_ENV_VARS = {
  project: 'OPENPLAN_UI_UX_PROJECT_ID',
  plan: 'OPENPLAN_UI_UX_PLAN_ID',
  program: 'OPENPLAN_UI_UX_PROGRAM_ID',
  report: 'OPENPLAN_UI_UX_REPORT_ID',
  scenarioSet: 'OPENPLAN_UI_UX_SCENARIO_SET_ID',
  countyRun: 'OPENPLAN_UI_UX_COUNTY_RUN_ID',
  engagementCampaign: 'OPENPLAN_UI_UX_ENGAGEMENT_CAMPAIGN_ID',
  rtpCycle: 'OPENPLAN_UI_UX_RTP_CYCLE_ID',
};

function readRecordId(key) {
  const value = (process.env[RECORD_ID_ENV_VARS[key]] || '').trim();
  return value || null;
}

/**
 * A detail route, resolved against whatever id the operator supplied.
 *
 * When no id is supplied the route keeps a placeholder URL purely so the
 * ledger row reads sensibly; it is never navigated to, because
 * `fixtureRequired` short-circuits capture before navigation.
 */
function detailRoute({ routeKey, recordKey, pathPrefix, visibleTarget, expectedTextAny }) {
  const recordId = readRecordId(recordKey);
  return {
    routeKey,
    stateKey: recordId ? 'operator-record' : 'no-record-supplied',
    url: recordId ? `${pathPrefix}/${recordId}` : `${pathPrefix}/<id>`,
    authWorkspace: "Operator's own workspace",
    seedState: recordId ? 'Supplied record detail visible' : 'No record id supplied',
    visibleTarget,
    expectedTextAny,
    fixtureRequired: !recordId,
    missingDependency: recordId
      ? undefined
      : `No record id supplied. Set ${RECORD_ID_ENV_VARS[recordKey]} to a record in the workspace this storage state belongs to.`,
  };
}

/**
 * Index-route expectations are structural on purpose.
 *
 * They used to assert one agency's record titles, so they could only ever pass
 * against that agency's data. What a capture can honestly assert for ANY
 * workspace is that the module rendered an authorized surface rather than an
 * auth wall or a denial — which `captureRoute` checks before these run — plus
 * the module's own name. Whether a given workspace happens to hold records is
 * that workspace's business, not a pass/fail condition.
 */
const ROUTES = [
  {
    routeKey: 'dashboard',
    stateKey: 'workspace-overview',
    url: '/dashboard',
    authWorkspace: "Operator's own workspace",
    seedState: 'Command board and overview rendered',
    visibleTarget: 'Shell rails visible',
    expectedTextAny: ['Command board', 'Overview'],
  },
  {
    routeKey: 'projects-index',
    stateKey: 'workspace-projects',
    url: '/projects',
    authWorkspace: "Operator's own workspace",
    seedState: 'Project registry rendered',
    visibleTarget: 'Registry/list worksurface',
    expectedTextAny: ['Projects'],
  },
  detailRoute({
    routeKey: 'project-detail',
    recordKey: 'project',
    pathPrefix: '/projects',
    visibleTarget: 'Project posture/detail regions',
    expectedTextAny: ['Project', 'Aerial evidence'],
  }),
  {
    routeKey: 'plans-index',
    stateKey: 'workspace-plans',
    url: '/plans',
    authWorkspace: "Operator's own workspace",
    seedState: 'Plan registry rendered',
    visibleTarget: 'Plan registry surface',
    expectedTextAny: ['Plans'],
  },
  detailRoute({
    routeKey: 'plan-detail',
    recordKey: 'plan',
    pathPrefix: '/plans',
    visibleTarget: 'Plan detail surface',
    expectedTextAny: ['Plan'],
  }),
  {
    routeKey: 'programs-index',
    stateKey: 'workspace-programs',
    url: '/programs',
    authWorkspace: "Operator's own workspace",
    seedState: 'Program registry rendered',
    visibleTarget: 'Program registry surface',
    expectedTextAny: ['Programs'],
  },
  detailRoute({
    routeKey: 'program-detail',
    recordKey: 'program',
    pathPrefix: '/programs',
    visibleTarget: 'Program detail/funding lane surface',
    expectedTextAny: ['Program'],
  }),
  {
    routeKey: 'reports-index',
    stateKey: 'workspace-reports',
    url: '/reports',
    authWorkspace: "Operator's own workspace",
    seedState: 'Report registry rendered',
    visibleTarget: 'Report registry surface',
    expectedTextAny: ['Reports'],
  },
  detailRoute({
    routeKey: 'report-detail',
    recordKey: 'report',
    pathPrefix: '/reports',
    visibleTarget: 'Report detail/artifact state',
    expectedTextAny: ['Report'],
  }),
  {
    routeKey: 'scenarios-index',
    stateKey: 'workspace-scenarios',
    url: '/scenarios',
    authWorkspace: "Operator's own workspace",
    seedState: 'Scenario registry rendered',
    visibleTarget: 'Scenario registry surface',
    expectedTextAny: ['Scenarios'],
  },
  detailRoute({
    routeKey: 'scenario-detail',
    recordKey: 'scenarioSet',
    pathPrefix: '/scenarios',
    visibleTarget: 'Scenario comparison surface',
    expectedTextAny: ['Scenario'],
  }),
  {
    routeKey: 'models-index',
    stateKey: 'workspace-models',
    url: '/models',
    authWorkspace: "Operator's own workspace",
    seedState: 'Modeling readiness/run history rendered',
    visibleTarget: 'Modeling workbench surface',
    expectedTextAny: ['Models'],
  },
  {
    routeKey: 'county-runs-index',
    stateKey: 'workspace-runs',
    url: '/county-runs',
    authWorkspace: "Operator's own workspace",
    seedState: 'County run registry rendered',
    visibleTarget: 'Run registry surface',
    expectedTextAny: ['County'],
  },
  detailRoute({
    routeKey: 'county-run-detail',
    recordKey: 'countyRun',
    pathPrefix: '/county-runs',
    visibleTarget: 'Run detail/evidence panel',
    expectedTextAny: ['County run', 'County'],
  }),
  {
    routeKey: 'data-hub',
    stateKey: 'workspace-data',
    url: '/data-hub',
    authWorkspace: "Operator's own workspace",
    seedState: 'Data Hub connectors and datasets rendered',
    visibleTarget: 'Data hub worksurface',
    expectedTextAny: ['Data Hub'],
  },
  {
    routeKey: 'explore-map',
    stateKey: 'map-layers-ready',
    url: '/explore',
    authWorkspace: "Operator's own workspace",
    seedState: 'Mapbox map and layers loaded',
    visibleTarget: 'Map controls/inspector visible',
    expectedSelector: '.mapboxgl-canvas',
    missingDependency: 'Mapbox token or local map layer state missing.',
  },
  {
    routeKey: 'engagement-index',
    stateKey: 'workspace-campaigns',
    url: '/engagement',
    authWorkspace: "Operator's own workspace",
    seedState: 'Engagement registry rendered',
    visibleTarget: 'Engagement registry/workflow surface',
    expectedTextAny: ['Campaigns', 'Engagement'],
  },
  detailRoute({
    routeKey: 'engagement-detail',
    recordKey: 'engagementCampaign',
    pathPrefix: '/engagement',
    visibleTarget: 'Campaign detail/workflow',
    expectedTextAny: ['Campaign', 'Engagement'],
  }),
  {
    routeKey: 'grants',
    stateKey: 'workspace-grants',
    url: '/grants',
    authWorkspace: "Operator's own workspace",
    seedState: 'Grants operating lanes rendered',
    visibleTarget: 'Grants operating lanes',
    expectedTextAny: ['Grants'],
  },
  {
    routeKey: 'rtp-index',
    stateKey: 'workspace-rtp',
    url: '/rtp',
    authWorkspace: "Operator's own workspace",
    seedState: 'RTP registry rendered',
    visibleTarget: 'RTP registry/document flow',
    expectedTextAny: ['RTP'],
  },
  detailRoute({
    routeKey: 'rtp-detail',
    recordKey: 'rtpCycle',
    pathPrefix: '/rtp',
    visibleTarget: 'Cycle detail/document flow',
    expectedTextAny: ['RTP'],
  }),
];

function printUsage() {
  process.stdout.write(`OpenPlan local UI/UX settle capture

Usage:
  BASE_URL=http://localhost:3000 OPENPLAN_UI_UX_STORAGE_STATE=/path/to/local-storage-state.json \\
    npm run local-ui-ux-settle-capture

Safe defaults:
  - Browser navigation and screenshots only; no users, seeds, Supabase writes, email, billing, or token persistence.
  - BASE_URL defaults to http://localhost:3000 and must be localhost or 127.0.0.1.
  - Vercel and production-looking URLs are always refused.
  - Output is confined to docs/ops/2026-04-29-test-output/ui-ux-settle/ unless --output-dir or
    OPENPLAN_UI_UX_SETTLE_OUTPUT_DIR points to another directory under docs/ops/.
  - Record-detail routes are ledgered and skipped (status "fixture_required", non-blocking) unless
    you supply an id from your own workspace. This script ships no demo data and creates none.

Record ids (optional; each unset id skips one detail route with an explicit note):
  OPENPLAN_UI_UX_PROJECT_ID              /projects/<id>
  OPENPLAN_UI_UX_PLAN_ID                 /plans/<id>
  OPENPLAN_UI_UX_PROGRAM_ID              /programs/<id>
  OPENPLAN_UI_UX_REPORT_ID               /reports/<id>
  OPENPLAN_UI_UX_SCENARIO_SET_ID         /scenarios/<id>
  OPENPLAN_UI_UX_COUNTY_RUN_ID           /county-runs/<id>
  OPENPLAN_UI_UX_ENGAGEMENT_CAMPAIGN_ID  /engagement/<id>
  OPENPLAN_UI_UX_RTP_CYCLE_ID            /rtp/<id>

Options:
  --base-url <url>          Local app URL. Env: BASE_URL.
  --storage-state <path>    Existing Playwright storage state for an already-authenticated local session.
                            Env: OPENPLAN_UI_UX_STORAGE_STATE.
  --output-dir <path>       Output directory under docs/ops/.
                            Env: OPENPLAN_UI_UX_SETTLE_OUTPUT_DIR.
  --allow-local-network     Permit explicit private/LAN local URLs such as 192.168.x.x.
  --viewports <list>        Comma-separated viewport keys. Default: desktop,mobile.
  --route <route-key>       Capture only selected route keys. May be repeated.
  --headed                  Run Playwright headed.
  --help                    Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    storageStatePath: process.env.OPENPLAN_UI_UX_STORAGE_STATE || null,
    outputDir: process.env.OPENPLAN_UI_UX_SETTLE_OUTPUT_DIR || null,
    allowLocalNetwork: process.env.OPENPLAN_ALLOW_LOCAL_NETWORK_URL === '1',
    headed: false,
    help: false,
    routeKeys: [],
    viewportKeys: ['desktop', 'mobile'],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--allow-local-network') args.allowLocalNetwork = true;
    else if (arg === '--base-url') args.baseUrl = argv[++i];
    else if (arg === '--storage-state') args.storageStatePath = argv[++i];
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--route') args.routeKeys.push(argv[++i]);
    else if (arg === '--viewports') args.viewportKeys = argv[++i].split(',').map((key) => key.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1';
}

function isPrivateLocalHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (normalized === '0.0.0.0' || normalized === 'host.docker.internal' || normalized.endsWith('.local')) {
    return true;
  }

  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;

  const private172 = normalized.match(/^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

function isForbiddenProductionHost(hostname) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized.endsWith('vercel.app') ||
    normalized.includes('vercel') ||
    normalized === 'openplan-natford.vercel.app' ||
    normalized === 'openplan-zeta.vercel.app'
  );
}

function validateBaseUrl(value, allowLocalNetwork) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid BASE_URL: ${value}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Refusing BASE_URL with embedded credentials.');
  }

  if (isForbiddenProductionHost(parsed.hostname)) {
    throw new Error(`Refusing production/Vercel URL: ${parsed.origin}`);
  }

  const local = isLoopbackHostname(parsed.hostname);
  const privateLocal = allowLocalNetwork && isPrivateLocalHostname(parsed.hostname);
  if (!local && !privateLocal) {
    throw new Error(
      `Refusing non-local BASE_URL ${parsed.origin}. Use localhost/127.0.0.1, or --allow-local-network for an explicit private local URL.`
    );
  }

  return parsed.origin;
}

function resolveOutputDir(candidate) {
  const resolved = candidate ? path.resolve(repoRoot, candidate) : defaultOutputDir;
  const docsRoot = path.resolve(docsOpsRoot);
  if (resolved !== docsRoot && !resolved.startsWith(`${docsRoot}${path.sep}`)) {
    throw new Error(`Refusing output directory outside docs/ops: ${resolved}`);
  }
  return resolved;
}

function safeOutputPath(outputDir, fileName) {
  const fullPath = path.resolve(outputDir, fileName);
  const resolvedDir = path.resolve(outputDir);
  if (!fullPath.startsWith(`${resolvedDir}${path.sep}`)) {
    throw new Error(`Refusing output path outside capture directory: ${fileName}`);
  }
  return fullPath;
}

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function validateStorageState(storageStatePath) {
  if (!storageStatePath) return { ok: false, reason: 'Missing --storage-state or OPENPLAN_UI_UX_STORAGE_STATE.' };

  const resolved = path.resolve(process.cwd(), storageStatePath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, reason: `Storage state file not found: ${resolved}` };
  }

  return { ok: true, resolved };
}

function selectViewports(viewportKeys) {
  return viewportKeys.map((key) => {
    if (!VIEWPORTS[key]) {
      throw new Error(`Unknown viewport "${key}". Valid viewports: ${Object.keys(VIEWPORTS).join(', ')}`);
    }
    return { key, size: VIEWPORTS[key] };
  });
}

function selectRoutes(routeKeys) {
  if (!routeKeys.length) return ROUTES;

  const byKey = new Map(ROUTES.map((route) => [route.routeKey, route]));
  return routeKeys.map((key) => {
    const route = byKey.get(key);
    if (!route) {
      throw new Error(`Unknown route "${key}". Valid routes: ${ROUTES.map((candidate) => candidate.routeKey).join(', ')}`);
    }
    return route;
  });
}

function screenshotName(route, viewportKey) {
  return `${route.routeKey}--${viewportKey}--${route.stateKey}.png`;
}

function absoluteUrl(baseUrl, routePath) {
  return new URL(routePath, baseUrl).toString();
}

function rowForRoute(route, viewportKey, fields = {}) {
  return {
    routeKey: route.routeKey,
    routeUrl: route.url,
    viewportKey,
    viewport: `${VIEWPORTS[viewportKey].width}x${VIEWPORTS[viewportKey].height}`,
    authWorkspace: route.authWorkspace,
    seedState: route.seedState,
    visibleTarget: route.visibleTarget,
    missingDependency: route.missingDependency || route.optionalState || '',
    screenshot: null,
    status: 'pending',
    notes: '',
    ...fields,
  };
}

function isMissingAuth(pageUrl, bodyText) {
  let pathname = '';
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    pathname = pageUrl;
  }

  return (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/auth') ||
    (/work email/i.test(bodyText) && /password/i.test(bodyText) && /sign in/i.test(bodyText))
  );
}

async function bodyText(page) {
  return await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
}

function expectedTextMatched(route, text) {
  if (route.expectedTextAll?.length && route.expectedTextAll.every((expected) => text.includes(expected))) {
    return true;
  }

  return Boolean(route.expectedTextAny?.length && route.expectedTextAny.some((expected) => text.includes(expected)));
}

function deniedOrEmptyAuth(route, text) {
  if (HARD_DENIAL_PATTERN.test(text)) return true;

  // The proof pack includes legitimate civic-workbench copy that uses the word
  // "required" for compliance/readiness fields. Treat only workspace/auth
  // prerequisite phrases as denial signals, and do not let them override a page
  // that has already rendered the route-specific expected content.
  return WORKSPACE_AUTH_PREREQUISITE_PATTERN.test(text) && !expectedTextMatched(route, text);
}

async function waitForRouteState(page, route) {
  const text = await bodyText(page);

  if (isMissingAuth(page.url(), text)) {
    return {
      ok: false,
      status: 'missing_auth',
      missingDependency: 'Authenticated local storage state is missing, expired, or not valid for this route.',
      notes: 'No screenshot captured.',
    };
  }

  if (deniedOrEmptyAuth(route, text)) {
    return {
      ok: false,
      status: 'blocked_or_denied',
      missingDependency: 'Route did not render an authorized workspace state.',
      notes: 'No screenshot captured.',
    };
  }

  if (route.expectedSelector) {
    const selectorVisible = await page.locator(route.expectedSelector).first().waitFor({ timeout: 12_000 }).then(
      () => true,
      () => false
    );
    if (!selectorVisible) {
      return {
        ok: false,
        status: 'missing_expected_state',
        missingDependency: route.missingDependency || `Expected selector not visible: ${route.expectedSelector}`,
        notes: 'No screenshot captured.',
      };
    }
  }

  if (route.expectedTextAny && route.expectedTextAny.length) {
    const textAfterWait = await bodyText(page);
    const matched = expectedTextMatched(route, textAfterWait);
    if (!matched) {
      return {
        ok: false,
        status: 'missing_expected_state',
        missingDependency: route.missingDependency || `Expected one of: ${route.expectedTextAny.join(' | ')}`,
        notes: 'No screenshot captured.',
      };
    }
  }

  if (route.expectedTextAll && route.expectedTextAll.length) {
    const textAfterWait = await bodyText(page);
    const missing = route.expectedTextAll.filter((expected) => !textAfterWait.includes(expected));
    if (missing.length) {
      return {
        ok: false,
        status: 'missing_expected_state',
        missingDependency: route.missingDependency || `Expected all of: ${route.expectedTextAll.join(' | ')}`,
        notes: `No screenshot captured. Missing: ${missing.join(' | ')}`,
      };
    }
  }

  return { ok: true };
}

async function captureRoute(page, baseUrl, outputDir, route, viewportKey) {
  const row = rowForRoute(route, viewportKey);
  const response = await page.goto(absoluteUrl(baseUrl, route.url), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(350);

  const httpStatus = response ? response.status() : null;
  if (httpStatus && httpStatus >= 400) {
    return {
      ...row,
      status: 'navigation_error',
      missingDependency: `HTTP ${httpStatus}`,
      notes: 'No screenshot captured.',
    };
  }

  const state = await waitForRouteState(page, route);
  if (!state.ok) {
    return {
      ...row,
      status: state.status,
      missingDependency: state.missingDependency,
      notes: state.notes,
    };
  }

  const fileName = screenshotName(route, viewportKey);
  const fullPath = safeOutputPath(outputDir, fileName);
  await page.screenshot({ path: fullPath, fullPage: true });

  return {
    ...row,
    status: route.optionalState ? 'captured_watch' : 'captured',
    screenshot: relativeToRepo(fullPath),
    missingDependency: route.optionalState || '',
    notes: route.optionalState || 'Captured populated/authenticated local route state.',
  };
}

function rowsForMissingAuth(routes, viewports, reason) {
  const rows = [];
  for (const viewport of viewports) {
    for (const route of routes) {
      if (route.fixtureRequired) {
        rows.push(
          rowForRoute(route, viewport.key, {
            status: 'fixture_required',
            notes: route.missingDependency,
          })
        );
      } else {
        rows.push(
          rowForRoute(route, viewport.key, {
            status: 'missing_auth',
            missingDependency: reason,
            notes: 'No browser launched and no screenshots captured.',
          })
        );
      }
    }
  }
  return rows;
}

function statusCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
}

function markdownTableCell(value) {
  return String(value || '-').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderLedgerMarkdown({ baseUrl, outputDir, rows, generatedAt, storageStateSupplied }) {
  const counts = statusCounts(rows);
  const lines = [
    '# OpenPlan Local UI/UX Settle Capture Ledger',
    '',
    `Generated: ${generatedAt}`,
    `Base URL: ${baseUrl}`,
    `Output directory: ${relativeToRepo(outputDir)}`,
    `Storage state supplied: ${storageStateSupplied ? 'yes' : 'no'}`,
    'Mutation posture: read-only browser navigation/screenshots only; no users, seeds, Supabase writes, email, billing, or credential/token persistence.',
    '',
    '## No-Go Guard Result',
    '',
    '- Production/Vercel URLs refused before browser launch.',
    '- Output path confined to `docs/ops/`.',
    '- Fixture-required routes are marked below and skipped until populated local fixtures exist.',
    '',
    '## Status Counts',
    '',
    '| Status | Count |',
    '| --- | ---: |',
    ...Object.keys(counts).sort().map((status) => `| ${status} | ${counts[status]} |`),
    '',
    '## Ledger',
    '',
    '| Screenshot | Route URL | Viewport | Status | Auth/workspace | Seed/demo state | Visible target | Missing dependency | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) =>
      [
        row.screenshot || '-',
        row.routeUrl,
        row.viewport,
        row.status,
        row.authWorkspace,
        row.seedState,
        row.visibleTarget,
        row.missingDependency,
        row.notes,
      ]
        .map(markdownTableCell)
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |')
    ),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function writeLedger(outputDir, payload) {
  fs.mkdirSync(outputDir, { recursive: true });
  const markdownPath = safeOutputPath(outputDir, 'local-ui-ux-settle-capture-ledger.md');
  const jsonPath = safeOutputPath(outputDir, 'local-ui-ux-settle-capture-ledger.json');

  fs.writeFileSync(markdownPath, renderLedgerMarkdown({ ...payload, outputDir }));
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        schemaVersion: 'openplan.local_ui_ux_settle_capture.v1',
        generatedAt: payload.generatedAt,
        baseUrl: payload.baseUrl,
        outputDir: relativeToRepo(outputDir),
        storageStateSupplied: payload.storageStateSupplied,
        rows: payload.rows,
      },
      null,
      2
    )}\n`
  );

  return { markdownPath, jsonPath };
}

function hasBlockingStatus(rows) {
  return rows.some((row) =>
    ['missing_auth', 'blocked_or_denied', 'missing_expected_state', 'navigation_error', 'capture_error'].includes(row.status)
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const baseUrl = validateBaseUrl(args.baseUrl, args.allowLocalNetwork);
  const outputDir = resolveOutputDir(args.outputDir);
  const routes = selectRoutes(args.routeKeys);
  const viewports = selectViewports(args.viewportKeys);
  const storageState = validateStorageState(args.storageStatePath);
  const generatedAt = new Date().toISOString();

  if (!storageState.ok) {
    const rows = rowsForMissingAuth(routes, viewports, storageState.reason);
    const { markdownPath } = writeLedger(outputDir, {
      baseUrl,
      rows,
      generatedAt,
      storageStateSupplied: false,
    });
    process.stdout.write(`Wrote missing-auth prerequisite report: ${relativeToRepo(markdownPath)}\n`);
    process.stdout.write(`${storageState.reason}\n`);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  const browser = await chromium.launch({ headless: !args.headed, executablePath: process.env.OPENPLAN_QA_CHROME || undefined });
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: viewport.size,
        storageState: storageState.resolved,
      });
      const page = await context.newPage();

      try {
        for (const route of routes) {
          if (route.fixtureRequired) {
            rows.push(
              rowForRoute(route, viewport.key, {
                status: 'fixture_required',
                notes: route.missingDependency,
              })
            );
            continue;
          }

          try {
            rows.push(await captureRoute(page, baseUrl, outputDir, route, viewport.key));
          } catch (error) {
            rows.push(
              rowForRoute(route, viewport.key, {
                status: 'capture_error',
                missingDependency: error instanceof Error ? error.message : String(error),
                notes: 'No screenshot captured.',
              })
            );
          }
        }
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const { markdownPath, jsonPath } = writeLedger(outputDir, {
    baseUrl,
    rows,
    generatedAt,
    storageStateSupplied: true,
  });

  process.stdout.write(`Wrote ledger: ${relativeToRepo(markdownPath)}\n`);
  process.stdout.write(`Wrote JSON ledger: ${relativeToRepo(jsonPath)}\n`);

  if (hasBlockingStatus(rows)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
