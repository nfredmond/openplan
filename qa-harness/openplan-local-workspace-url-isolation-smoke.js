const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, repoRoot } = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);

const DEFAULT_DENIED_PATTERN =
  '(not found|404|unauthorized|not authorized|forbidden|403|workspace membership|required|no workspace membership|not provisioned|sign in)';

const EXAMPLE_FIXTURE = {
  baseUrl: 'http://localhost:3000',
  users: {
    workspaceA: {
      email: 'openplan-workspace-a@example.test',
      passwordEnv: 'OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD',
      workspaceName: 'Synthetic Workspace A',
    },
    workspaceB: {
      email: 'openplan-workspace-b@example.test',
      passwordEnv: 'OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD',
      workspaceName: 'Synthetic Workspace B',
    },
  },
  checks: [
    {
      name: 'Workspace A project detail is visible to A and blocked for B',
      url: '/projects/00000000-0000-4000-8000-0000000000a1',
      allowedUser: 'workspaceA',
      allowedText: 'Synthetic A Project',
      leakText: ['Synthetic A Project', 'Synthetic Workspace A'],
      deniedPattern: DEFAULT_DENIED_PATTERN,
    },
    {
      name: 'Workspace B project detail is visible to B and blocked for A',
      url: '/projects/00000000-0000-4000-8000-0000000000b1',
      allowedUser: 'workspaceB',
      allowedText: 'Synthetic B Project',
      leakText: ['Synthetic B Project', 'Synthetic Workspace B'],
      deniedPattern: DEFAULT_DENIED_PATTERN,
    },
  ],
};

function printUsage() {
  process.stdout.write(`OpenPlan local workspace URL isolation smoke

Usage:
  node openplan-local-workspace-url-isolation-smoke.js --fixture <path>

Safe defaults:
  - Refuses non-local base URLs unless --allow-nonlocal is passed.
  - Performs browser GET/navigation checks only; it does not seed, insert, update, or delete data.
  - Requires synthetic local users through passwordEnv or storageStatePath; inline passwords are rejected.
  - After a denied cross-workspace URL, verifies the same session still loads its own workspace URL.

Options:
  --fixture <path>       JSON fixture describing users and workspace-scoped URLs.
  --base-url <url>       Override fixture baseUrl. Defaults to fixture baseUrl or http://localhost:3000.
  --allow-nonlocal       Permit a non-local base URL. Use only for preview/prod read-only proof and document it.
  --validate-fixture     Validate fixture contract and required password env only; do not launch a browser.
  --headed               Run Playwright headed.
  --example-fixture      Print a valid fixture template and exit.
  --help                 Show this help.

Fixture shape:
  {
    "baseUrl": "http://localhost:3000",
    "users": {
      "workspaceA": { "email": "...", "passwordEnv": "OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD" },
      "workspaceB": { "email": "...", "passwordEnv": "OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD" }
    },
    "checks": [
      {
        "name": "A project detail is isolated",
        "url": "/projects/<workspace-a-project-id>",
        "allowedUser": "workspaceA",
        "allowedText": "Synthetic A Project",
        "leakText": ["Synthetic A Project", "Synthetic Workspace A"],
        "deniedPattern": "${DEFAULT_DENIED_PATTERN}"
      }
    ]
  }
`);
}

function parseArgs(argv) {
  const args = {
    allowNonlocal: false,
    headed: false,
    validateFixtureOnly: false,
    exampleFixture: false,
    help: false,
    fixturePath: process.env.OPENPLAN_WORKSPACE_ISOLATION_FIXTURE || null,
    baseUrl: process.env.OPENPLAN_BASE_URL || null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--example-fixture') args.exampleFixture = true;
    else if (arg === '--allow-nonlocal') args.allowNonlocal = true;
    else if (arg === '--validate-fixture') args.validateFixtureOnly = true;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--fixture') args.fixturePath = argv[++i];
    else if (arg === '--base-url') args.baseUrl = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function isLocalBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
}

function loadFixture(fixturePath) {
  if (!fixturePath) {
    throw new Error('Missing --fixture <path>. Use --example-fixture to print a starter fixture.');
  }

  const resolved = path.resolve(process.cwd(), fixturePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return { fixture: parsed, resolvedPath: resolved };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function deniedUsersForCheck(check, userKeys) {
  const explicitDeniedUsers = asArray(check.deniedUsers);
  return explicitDeniedUsers.length ? explicitDeniedUsers : userKeys.filter((userKey) => userKey !== check.allowedUser);
}

function resolveUserPassword(userKey, user) {
  if (user.password) {
    throw new Error(`Fixture user ${userKey} uses inline password. Use passwordEnv or storageStatePath instead.`);
  }

  if (user.storageStatePath) {
    return null;
  }

  if (!user.passwordEnv) {
    throw new Error(`Fixture user ${userKey} needs passwordEnv or storageStatePath.`);
  }

  const value = process.env[user.passwordEnv];
  if (!value) {
    throw new Error(`Missing environment variable ${user.passwordEnv} for fixture user ${userKey}.`);
  }

  return value;
}

function validateFixture(fixture, args) {
  const baseUrl = args.baseUrl || fixture.baseUrl || 'http://localhost:3000';
  if (!args.allowNonlocal && !isLocalBaseUrl(baseUrl)) {
    throw new Error(`Refusing non-local base URL ${baseUrl}. Re-run with --allow-nonlocal only for documented read-only proof.`);
  }

  const users = fixture.users || {};
  const userKeys = Object.keys(users);
  if (userKeys.length < 2) {
    throw new Error('Fixture must define at least two synthetic users.');
  }

  for (const userKey of userKeys) {
    const user = users[userKey];
    if (!user || typeof user !== 'object') throw new Error(`Fixture user ${userKey} must be an object.`);
    if (!user.storageStatePath && !user.email) throw new Error(`Fixture user ${userKey} needs email or storageStatePath.`);
    resolveUserPassword(userKey, user);
  }

  if (!Array.isArray(fixture.checks) || fixture.checks.length === 0) {
    throw new Error('Fixture must include at least one URL check.');
  }

  for (const check of fixture.checks) {
    if (!check.name) throw new Error('Every check needs a name.');
    if (!check.url) throw new Error(`Check ${check.name} needs a url.`);
    if (!check.allowedUser || !users[check.allowedUser]) {
      throw new Error(`Check ${check.name} has missing/unknown allowedUser.`);
    }
    if (asArray(check.deniedUsers).some((userKey) => !users[userKey])) {
      throw new Error(`Check ${check.name} references an unknown deniedUser.`);
    }
    if (deniedUsersForCheck(check, userKeys).includes(check.allowedUser)) {
      throw new Error(`Check ${check.name} lists its allowedUser as a denied user.`);
    }
  }

  const usersWithOwnUrl = new Set(fixture.checks.map((check) => check.allowedUser));
  for (const check of fixture.checks) {
    for (const deniedUser of deniedUsersForCheck(check, userKeys)) {
      if (!usersWithOwnUrl.has(deniedUser)) {
        throw new Error(
          `Check ${check.name} denies ${deniedUser}, but no fixture check has ${deniedUser} as allowedUser. ` +
            'Add an own-workspace URL check so the harness can verify session continuity after denial.'
        );
      }
    }
  }

  return { baseUrl, users, userKeys };
}

function absoluteUrl(baseUrl, maybePath) {
  return new URL(maybePath, baseUrl).toString();
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'check';
}

async function writeScreenshot(page, artifacts, name) {
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `${datePart}-${slug(name)}.png`;
  const fullPath = path.join(outputDir, fileName);
  await page.screenshot({ path: fullPath, fullPage: true });
  artifacts.push(`docs/ops/${datePart}-test-output/${fileName}`);
}

async function signInIfNeeded(page, baseUrl, userKey, user, password) {
  if (user.storageStatePath) return;

  await page.goto(absoluteUrl(baseUrl, '/sign-in'), { waitUntil: 'networkidle' });

  const emailInput = page.getByLabel(/work email|email/i).first();
  const passwordInput = page.getByLabel(/password/i).first();
  await emailInput.fill(user.email);
  await passwordInput.fill(password);

  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/sign-in') || Boolean(document.querySelector('[role="alert"]')),
    { timeout: 15_000 }
  );

  if (page.url().includes('/sign-in')) {
    const alertText = await page.locator('[role="alert"]').first().innerText().catch(() => null);
    throw new Error(
      `Synthetic user ${userKey} remained on /sign-in after submit${alertText ? `: ${alertText}` : '.'}`
    );
  }

  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function buildContext(browser, baseUrl, userKey, user) {
  const password = resolveUserPassword(userKey, user);
  const storageState = user.storageStatePath ? path.resolve(process.cwd(), user.storageStatePath) : undefined;
  const context = await browser.newContext(
    buildBrowserContextOptions({
      viewport: { width: 1440, height: 1200 },
      ...(storageState ? { storageState } : {}),
    })
  );
  const page = await context.newPage();
  await signInIfNeeded(page, baseUrl, userKey, user, password);
  return { context, page };
}

function expectTextPresent(bodyText, expected, label) {
  for (const text of asArray(expected)) {
    if (text && !bodyText.includes(text)) {
      throw new Error(`${label}: expected text was not found: ${text}`);
    }
  }
}

function expectTextAbsent(bodyText, forbidden, label) {
  for (const text of asArray(forbidden)) {
    if (text && bodyText.includes(text)) {
      throw new Error(`${label}: forbidden/leaked text was found: ${text}`);
    }
  }
}

async function runAllowedCheck(page, baseUrl, check, artifacts, screenshotLabel) {
  const response = await page.goto(absoluteUrl(baseUrl, check.url), { waitUntil: 'networkidle' });
  const status = response ? response.status() : null;
  const bodyText = await page.locator('body').innerText();

  if (status && status >= 400) {
    throw new Error(`${check.name}: allowed user got HTTP ${status}.`);
  }

  expectTextPresent(bodyText, check.allowedText, `${check.name} allowed view`);
  expectTextAbsent(bodyText, check.forbiddenText, `${check.name} allowed view`);
  await writeScreenshot(page, artifacts, screenshotLabel || `${check.name} allowed ${check.allowedUser}`);
}

async function runDeniedCheck(page, baseUrl, check, deniedUser, artifacts) {
  const response = await page.goto(absoluteUrl(baseUrl, check.url), { waitUntil: 'networkidle' });
  const status = response ? response.status() : null;
  const bodyText = await page.locator('body').innerText();
  const deniedPattern = new RegExp(check.deniedPattern || DEFAULT_DENIED_PATTERN, 'i');
  const denialDetected = Boolean(status && status >= 400) || deniedPattern.test(bodyText) || /\/sign-in(?:\?|$)/.test(page.url());

  expectTextAbsent(bodyText, check.leakText || check.allowedText, `${check.name} denied view for ${deniedUser}`);

  if (!denialDetected) {
    throw new Error(`${check.name}: denied user ${deniedUser} was not clearly denied. HTTP status=${status}, url=${page.url()}`);
  }

  await writeScreenshot(page, artifacts, `${check.name} denied ${deniedUser}`);
}

function firstAllowedCheckByUser(checks) {
  const checksByUser = {};
  for (const check of checks) {
    if (!checksByUser[check.allowedUser]) checksByUser[check.allowedUser] = check;
  }
  return checksByUser;
}

function reportMarkdown({ baseUrl, fixturePath, notes, artifacts, failures }) {
  const lines = [
    `# OpenPlan Local Workspace URL Isolation Smoke — ${datePart}`,
    '',
    `- Base URL: ${baseUrl}`,
    `- Fixture: ${fixturePath}`,
    `- Mutation posture: read-only browser navigation; no Supabase admin/service key used by this harness.`,
    '',
    '## Result',
    failures.length ? '- FAIL' : '- PASS',
    '',
    '## Notes',
    ...notes.map((note) => `- ${note}`),
    '',
    '## Failures',
    ...(failures.length ? failures.map((failure) => `- ${failure}`) : ['- None']),
    '',
    '## Artifacts',
    ...(artifacts.length ? artifacts.map((artifact) => `- ${artifact}`) : ['- None']),
    '',
    '## Preconditions',
    '- Local app is running against local/synthetic Supabase data.',
    '- Fixture users belong to different workspaces and use `passwordEnv` or Playwright `storageStatePath`; no real credentials are required.',
    '- Fixture URLs point to records seeded in only one workspace so cross-user access can be verified without production mutation.',
    '- Every denied user also has an own-workspace URL check, allowing the harness to prove denied navigation did not poison or switch that browser session.',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.exampleFixture) {
    process.stdout.write(`${JSON.stringify(EXAMPLE_FIXTURE, null, 2)}\n`);
    return;
  }

  if (args.help) {
    printUsage();
    return;
  }

  const { fixture, resolvedPath } = loadFixture(args.fixturePath);
  const { baseUrl, users, userKeys } = validateFixture(fixture, args);
  if (args.validateFixtureOnly) {
    process.stdout.write(
      `Validated ${userKeys.length} synthetic users and ${fixture.checks.length} workspace URL checks for ${baseUrl}.\n`
    );
    process.stdout.write('No browser launched and no evidence artifacts written.\n');
    return;
  }

  const artifacts = [];
  const notes = [
    `Loaded fixture ${resolvedPath}.`,
    `Validated ${userKeys.length} synthetic users and ${fixture.checks.length} URL checks.`,
  ];
  const failures = [];
  const sessions = {};
  const sessionContinuityChecks = firstAllowedCheckByUser(fixture.checks);

  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: !args.headed });
  try {
    for (const userKey of userKeys) {
      sessions[userKey] = await buildContext(browser, baseUrl, userKey, users[userKey]);
      notes.push(`Authenticated synthetic user ${userKey}.`);
    }

    for (const check of fixture.checks) {
      try {
        await runAllowedCheck(sessions[check.allowedUser].page, baseUrl, check, artifacts);
        notes.push(`Allowed-view pass: ${check.name} (${check.allowedUser}).`);
      } catch (error) {
        failures.push(`Allowed-view failure for ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
      }

      const deniedUsers = deniedUsersForCheck(check, userKeys);

      for (const deniedUser of deniedUsers) {
        try {
          await runDeniedCheck(sessions[deniedUser].page, baseUrl, check, deniedUser, artifacts);
          notes.push(`Denied-view pass: ${check.name} (${deniedUser}).`);

          const ownCheck = sessionContinuityChecks[deniedUser];
          await runAllowedCheck(
            sessions[deniedUser].page,
            baseUrl,
            ownCheck,
            artifacts,
            `${check.name} session-continuity ${deniedUser}`
          );
          notes.push(`Session-continuity pass: ${deniedUser} still loads own workspace URL after denial.`);
        } catch (error) {
          failures.push(
            `Denied/session-continuity failure for ${check.name} / ${deniedUser}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  } finally {
    await Promise.all(Object.values(sessions).map(({ context }) => context.close().catch(() => undefined)));
    await browser.close();
  }

  const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-local-workspace-url-isolation-smoke.md`);
  fs.writeFileSync(reportPath, reportMarkdown({ baseUrl, fixturePath: resolvedPath, notes, artifacts, failures }));
  process.stdout.write(`Wrote ${reportPath}\n`);

  if (failures.length) {
    throw new Error(`${failures.length} workspace URL isolation check(s) failed. See ${reportPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
