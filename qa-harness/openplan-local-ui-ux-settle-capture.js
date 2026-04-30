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

const ROUTES = [
  {
    routeKey: 'dashboard',
    stateKey: 'workspace-overview',
    url: '/dashboard',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'Command board and overview populated',
    visibleTarget: 'Shell rails visible',
    expectedTextAny: ['Nevada County Transportation Commission', 'NCTC', 'Command board'],
  },
  {
    routeKey: 'projects-index',
    stateKey: 'nctc-project-visible',
    url: '/projects',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC project row visible',
    visibleTarget: 'Registry/list worksurface',
    expectedTextAny: ['NCTC 2045 RTP', 'proof-of-capability'],
  },
  {
    routeKey: 'project-detail',
    stateKey: 'nctc-project',
    url: '/projects/d0000001-0000-4000-8000-000000000003',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC project detail visible',
    visibleTarget: 'Project posture/detail regions',
    expectedTextAny: ['NCTC 2045 RTP', 'proof-of-capability'],
  },
  {
    routeKey: 'plans-index',
    stateKey: 'nctc-plan-visible',
    url: '/plans',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC local proof plan visible',
    visibleTarget: 'Plan registry/detail surface',
    expectedTextAny: ['NCTC 2045 RTP local proof plan'],
    missingDependency: 'Updated local NCTC plan fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'plan-detail',
    stateKey: 'nctc-plan',
    url: '/plans/d0000001-0000-4000-8000-000000000015',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'Linked NCTC local proof plan detail visible',
    visibleTarget: 'Plan detail surface',
    expectedTextAny: ['NCTC 2045 RTP local proof plan'],
    missingDependency: 'Updated local NCTC plan fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'programs-index',
    stateKey: 'nctc-program-visible',
    url: '/programs',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC programming pipeline visible',
    visibleTarget: 'Program registry surface',
    expectedTextAny: ['NCTC 2045 RTP programming pipeline'],
    missingDependency: 'Updated local NCTC program fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'program-detail',
    stateKey: 'nctc-program',
    url: '/programs/d0000001-0000-4000-8000-000000000016',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'Linked NCTC program detail visible',
    visibleTarget: 'Program detail/funding lane surface',
    expectedTextAny: ['NCTC 2045 RTP programming pipeline', 'Rural RTP implementation readiness call'],
    missingDependency: 'Updated local NCTC program fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'reports-index',
    stateKey: 'nctc-report-visible',
    url: '/reports',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC report packet visible',
    visibleTarget: 'Report registry surface',
    expectedTextAny: ['NCTC 2045 RTP settle board packet'],
    missingDependency: 'Updated local NCTC report fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'report-detail',
    stateKey: 'nctc-report',
    url: '/reports/d0000001-0000-4000-8000-000000000019',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC report packet detail visible',
    visibleTarget: 'Report detail/artifact state',
    expectedTextAny: ['NCTC 2045 RTP settle board packet', 'Latest HTML packet'],
    missingDependency: 'Updated local NCTC report fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'scenarios-index',
    stateKey: 'nctc-scenario-visible',
    url: '/scenarios',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC scenario set and comparison entries visible',
    visibleTarget: 'Scenario registry surface',
    expectedTextAny: ['NCTC 2045 RTP scenario comparison', 'SR-49 safety package'],
    missingDependency: 'Updated local NCTC scenario fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'scenario-detail',
    stateKey: 'nctc-scenario',
    url: '/scenarios/d0000001-0000-4000-8000-000000000030',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC scenario comparison detail visible',
    visibleTarget: 'Scenario comparison surface',
    expectedTextAny: [
      'NCTC 2045 RTP scenario comparison',
      'SR-49 safety package vs Existing conditions baseline',
      'SR-49 safety package comparison snapshot',
    ],
    missingDependency: 'Updated local NCTC scenario fixture missing; rerun the local NCTC seed before capture.',
  },
  {
    routeKey: 'models-index',
    stateKey: 'workspace-models',
    url: '/models',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'Modeling readiness/run history visible',
    visibleTarget: 'Modeling workbench surface',
    expectedTextAny: ['Model', 'County', 'run'],
  },
  {
    routeKey: 'county-runs-index',
    stateKey: 'workspace-runs',
    url: '/county-runs',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'County run registry visible',
    visibleTarget: 'Run registry surface',
    expectedTextAny: ['County', 'run', 'nevada-county-runtime'],
  },
  {
    routeKey: 'county-run-detail',
    stateKey: 'nctc-run',
    url: '/county-runs/d0000001-0000-4000-8000-000000000005',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'County run evidence visible',
    visibleTarget: 'Run detail/evidence panel',
    expectedTextAny: ['nevada-county-runtime-norenumber-freeze-20260324', 'County run'],
  },
  {
    routeKey: 'data-hub',
    stateKey: 'workspace-data',
    url: '/data-hub',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'Connector/dataset rows preferred',
    visibleTarget: 'Data hub worksurface',
    expectedTextAny: ['Data hub', 'Data Hub', 'Dataset', 'Connector'],
    optionalState: 'Dataset fixture may be missing; record actual local state.',
  },
  {
    routeKey: 'explore-map',
    stateKey: 'nctc-layers-ready',
    url: '/explore',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'Mapbox map and layers loaded',
    visibleTarget: 'Map controls/inspector visible',
    expectedSelector: '.mapboxgl-canvas',
    missingDependency: 'Mapbox token or local map layer state missing.',
  },
  {
    routeKey: 'engagement-index',
    stateKey: 'workspace-campaigns',
    url: '/engagement',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC engagement campaign visible',
    visibleTarget: 'Engagement registry/workflow surface',
    expectedTextAny: ['NCTC 2045 RTP community input map', 'community input'],
  },
  {
    routeKey: 'engagement-detail',
    stateKey: 'nctc-campaign',
    url: '/engagement/d0000001-0000-4000-8000-000000000010',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'Campaign and approved items visible',
    visibleTarget: 'Campaign detail/workflow',
    expectedTextAny: ['NCTC 2045 RTP community input map', 'community input'],
  },
  {
    routeKey: 'grants',
    stateKey: 'fixture-required',
    url: '/grants',
    authWorkspace: 'Workspace fixture TBD',
    seedState: 'Opportunity/award/reimbursement state required',
    visibleTarget: 'Grants operating lanes',
    fixtureRequired: true,
    missingDependency: 'Local grants fixture missing; do not use empty-state proof.',
  },
  {
    routeKey: 'rtp-index',
    stateKey: 'nctc-cycle-visible',
    url: '/rtp',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'NCTC RTP cycle visible',
    visibleTarget: 'RTP registry/document flow',
    expectedTextAny: ['NCTC 2045 RTP', 'demo cycle'],
  },
  {
    routeKey: 'rtp-detail',
    stateKey: 'nctc-cycle',
    url: '/rtp/d0000001-0000-4000-8000-000000000004',
    authWorkspace: 'NCTC demo workspace',
    seedState: 'RTP cycle and chapter visible',
    visibleTarget: 'Cycle detail/document flow',
    expectedTextAny: ['NCTC 2045 RTP', 'demo cycle'],
  },
  {
    routeKey: 'admin-index',
    stateKey: 'authenticated-admin',
    url: '/admin',
    authWorkspace: 'Authenticated operator workspace',
    seedState: 'Admin route reachable',
    visibleTarget: 'Admin module surface',
    expectedTextAny: ['Admin', 'Operations', 'Readiness'],
  },
  {
    routeKey: 'pilot-readiness',
    stateKey: 'local-doc-status',
    url: '/admin/pilot-readiness',
    authWorkspace: 'Authenticated operator workspace',
    seedState: 'Local proof docs visible as readiness inputs',
    visibleTarget: 'Readiness status list',
    expectedTextAny: ['Pilot readiness', 'readiness', 'proof'],
  },
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
  - Fixture-required routes are ledgered and skipped until local populated fixtures exist.

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
  return Boolean(
    route.expectedTextAny?.length && route.expectedTextAny.some((expected) => text.includes(expected))
  );
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
  const browser = await chromium.launch({ headless: !args.headed });
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
