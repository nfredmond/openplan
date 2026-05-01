const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildBrowserContextOptions, getOutputDir, loadEnv, repoRoot } = require('./harness-env');

const datePart = new Date().toISOString().slice(0, 10);
const outputDir = getOutputDir(datePart);
const DEFAULT_BASE_URL = 'https://openplan-natford.vercel.app';
const REVIEWER_EMAIL_ENV = 'OPENPLAN_ADMIN_OPERATIONS_SMOKE_REVIEWER_EMAIL';
const MAGIC_LINK_APPROVAL_ENV = 'OPENPLAN_PROD_ADMIN_OPERATIONS_ALLOW_MAGIC_LINK';

function usage() {
  return [
    'OpenPlan production admin operations authenticated browser smoke',
    '',
    'Usage:',
    `  ${MAGIC_LINK_APPROVAL_ENV}=1 ${REVIEWER_EMAIL_ENV}=<allowlisted-email> node openplan-prod-admin-operations-auth-smoke.js`,
    '',
    'Environment:',
    '  OPENPLAN_BASE_URL                                  Optional origin; defaults to production alias',
    `  ${REVIEWER_EMAIL_ENV}       Required allowlisted reviewer email`,
    `  ${MAGIC_LINK_APPROVAL_ENV}       Required explicit approval flag; must be 1`,
    '  OPENPLAN_ENV_PATH                                  Optional private env file with Supabase keys',
    '',
    'This smoke creates an admin-generated Supabase magic-link session for the reviewer,',
    'loads /admin/operations, and does not click triage/provision buttons or print request rows.',
  ].join('\n');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return '<invalid>';
  return `${local.slice(0, 1)}***@${domain}`;
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OPENPLAN_BASE_URL must be a valid URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Production admin operations smoke requires an https origin.');
  }

  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function projectRefFromSupabaseUrl(supabaseUrl) {
  const hostname = new URL(supabaseUrl).hostname;
  return hostname.split('.')[0];
}

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

function sessionCookieValue(session) {
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;
}

async function generateReviewerSession({ supabaseUrl, serviceRoleKey, anonKey, reviewerEmail, baseUrl }) {
  const adminHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const linkResult = await jsonFetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      type: 'magiclink',
      email: reviewerEmail,
      options: {
        redirect_to: `${baseUrl}/admin/operations`,
      },
    }),
  });

  if (!linkResult.ok) {
    throw new Error(`Supabase admin generate_link failed with status ${linkResult.status}.`);
  }

  const actionLink = linkResult.data?.properties?.action_link || linkResult.data?.action_link || '';
  let tokenHash = linkResult.data?.properties?.hashed_token || linkResult.data?.hashed_token || '';
  if (!tokenHash && actionLink) {
    tokenHash = new URL(actionLink).searchParams.get('token_hash') || '';
  }
  const emailOtp = linkResult.data?.properties?.email_otp || linkResult.data?.email_otp || '';

  const verifyPayloads = [];
  if (tokenHash) {
    verifyPayloads.push({ type: 'magiclink', token_hash: tokenHash });
  }
  if (emailOtp) {
    verifyPayloads.push({ type: 'magiclink', email: reviewerEmail, token: emailOtp });
  }
  assertOk(verifyPayloads.length > 0, 'Supabase generate_link did not return a verifiable token shape.');

  const verifyHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  };
  let lastStatus = null;
  for (const payload of verifyPayloads) {
    const verifyResult = await jsonFetch(`${supabaseUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: verifyHeaders,
      body: JSON.stringify(payload),
    });
    lastStatus = verifyResult.status;
    if (verifyResult.ok && verifyResult.data?.access_token) {
      return verifyResult.data;
    }
  }

  throw new Error(`Supabase magic-link verification failed; last status ${lastStatus ?? 'unknown'}.`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  if (process.env[MAGIC_LINK_APPROVAL_ENV] !== '1') {
    throw new Error(`${MAGIC_LINK_APPROVAL_ENV}=1 is required because this creates a reviewer auth session.`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const baseUrl = parseOrigin(process.env.OPENPLAN_BASE_URL || DEFAULT_BASE_URL);
  const reviewerEmail = normalizeEmail(process.env[REVIEWER_EMAIL_ENV]);
  if (!reviewerEmail || !isLikelyEmail(reviewerEmail)) {
    throw new Error(`${REVIEWER_EMAIL_ENV} must be set to the allowlisted reviewer email.`);
  }

  const { env, envPath } = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    throw new Error('Missing Supabase URL, anon key, or service-role key.');
  }

  const notes = [];
  const checks = {};
  const session = await generateReviewerSession({
    supabaseUrl,
    serviceRoleKey,
    anonKey,
    reviewerEmail,
    baseUrl,
  });
  notes.push('Generated a Supabase admin magic-link reviewer session without changing the reviewer password.');

  const cookieName = `sb-${projectRefFromSupabaseUrl(supabaseUrl)}-auth-token`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    buildBrowserContextOptions({
      viewport: { width: 1440, height: 1500 },
    })
  );

  try {
    await context.addCookies([
      {
        name: cookieName,
        value: sessionCookieValue(session),
        url: baseUrl,
        secure: true,
        httpOnly: false,
        sameSite: 'Lax',
      },
    ]);

    const page = await context.newPage();
    await page.goto(`${baseUrl}/admin/operations`, { waitUntil: 'networkidle', timeout: 30_000 });
    checks.finalPath = new URL(page.url()).pathname;

    const bodyText = await page.locator('body').innerText({ timeout: 10_000 });
    checks.warningWatchboard = /Warning watchboard/.test(bodyText);
    checks.serviceLaneQueue = /Service lane intake queue/.test(bodyText);
    checks.actionActivity =
      /Assistant action activity/.test(bodyText) || /Recent audited operator actions/.test(bodyText);
    checks.locked = /Access request review is locked|Review locked/.test(bodyText);

    assertOk(checks.finalPath === '/admin/operations', `Expected /admin/operations, landed on ${checks.finalPath}.`);
    assertOk(checks.warningWatchboard, 'Warning watchboard did not render.');
    assertOk(checks.serviceLaneQueue, 'Service lane intake queue did not render.');
    assertOk(checks.actionActivity, 'Assistant action activity did not render.');
    assertOk(!checks.locked, 'Access-request lane rendered locked for the reviewer.');
    notes.push('Loaded /admin/operations as the allowlisted reviewer and found the warning watchboard.');
    notes.push('Found the service lane intake queue without the review-locked notice.');
    notes.push('Found the recent audited operator action activity section.');
    notes.push('Did not click triage controls, provision workspaces, send email, or record prospect row contents.');
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const reportPath = path.join(repoRoot, `docs/ops/${datePart}-openplan-production-admin-operations-authenticated-smoke.md`);
  const lines = [
    `# OpenPlan Production Admin Operations Authenticated Smoke — ${datePart}`,
    '',
    `- Base URL: ${baseUrl}`,
    `- Reviewer: ${maskEmail(reviewerEmail)}`,
    `- Env source: ${envPath === 'process.env' ? 'process.env' : path.relative(repoRoot, envPath)}`,
    '',
    '## Result',
    '',
    '- PASS: Production `/admin/operations` rendered for the allowlisted reviewer.',
    '- PASS: Warning watchboard, service lane intake queue, and recent audited operator action activity all rendered.',
    '- PASS: Access-request review lane was not locked for the reviewer.',
    '- PASS: Smoke did not click triage/provision controls, send email, create workspaces, or record prospect row contents.',
    '',
    '## Checks',
    '',
    `- Final path: ${checks.finalPath}`,
    `- Warning watchboard rendered: ${checks.warningWatchboard ? 'yes' : 'no'}`,
    `- Service lane intake queue rendered: ${checks.serviceLaneQueue ? 'yes' : 'no'}`,
    `- Recent audited operator action activity rendered: ${checks.actionActivity ? 'yes' : 'no'}`,
    `- Review locked notice present: ${checks.locked ? 'yes' : 'no'}`,
    '',
    '## Pass/Fail Notes',
    ...notes.map((note) => `- PASS: ${note}`),
    '',
    '## Guardrails',
    '',
    '- The reviewer session was created with Supabase admin magic-link verification; the real reviewer password was not changed.',
    '- No auth token, magic-link token, service-role key, Vercel secret, request row, prospect contact detail, or screenshot was written to the repo.',
    '- The private env file used for the run is ignored under `.operator-private/` and must not be committed.',
    '',
    '## Verdict',
    '',
    '- PASS: Production authenticated browser smoke confirms the configured reviewer can load the Admin Operations page and see the service-lane intake surface unlocked.',
    '',
  ];

  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(`Wrote ${path.relative(repoRoot, reportPath)}`);
  console.log(
    JSON.stringify(
      {
        reportPath,
        reviewer: maskEmail(reviewerEmail),
        checks,
        notes,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
