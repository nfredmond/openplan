const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(repoRoot, '..');
const appRoot = path.join(repoRoot, 'openplan');

function stripOuterQuotes(value) {
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

function readEnv(filePath) {
  const env = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const rawValue = line.slice(idx + 1).trim();
    env[key] = stripOuterQuotes(rawValue);
  }
  return env;
}

function resolveEnvPath() {
  const candidates = [
    process.env.OPENPLAN_ENV_PATH,
    path.join(appRoot, '.env.local'),
    path.join(repoRoot, '.env.local'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadEnv() {
  const envPath = resolveEnvPath();
  if (!envPath) {
    return { env: { ...process.env }, envPath: 'process.env' };
  }

  return {
    env: {
      ...readEnv(envPath),
      ...process.env,
    },
    envPath,
  };
}

function getOutputDir(datePart) {
  return path.join(repoRoot, `docs/ops/${datePart}-test-output`);
}

function getOpenplanBaseUrl() {
  return process.env.OPENPLAN_BASE_URL || 'https://openplan-natford.vercel.app';
}

function parseTargetUrl(value, label = 'Target URL') {
  if (!value) {
    throw new Error(`${label} is required.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https. Received ${value}.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include embedded credentials.`);
  }

  return parsed;
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
}

function isLocalHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0.0.0.0'
  );
}

function isVercelHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === 'vercel.app' || normalized.endsWith('.vercel.app') || normalized.includes('vercel');
}

function isSupabaseCloudHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === 'supabase.co' || normalized.endsWith('.supabase.co');
}

function assertLocalTargetUrl(value, label = 'Target URL') {
  const parsed = parseTargetUrl(value, label);

  if (isVercelHostname(parsed.hostname)) {
    throw new Error(`${label} refuses Vercel URLs for local-only mutating proof. Received ${value}.`);
  }

  if (isSupabaseCloudHostname(parsed.hostname)) {
    throw new Error(`${label} refuses Supabase cloud URLs for local-only mutating proof. Received ${value}.`);
  }

  if (!isLocalHostname(parsed.hostname)) {
    throw new Error(`${label} refuses non-local URLs for local-only mutating proof. Received ${value}.`);
  }

  return parsed;
}

function guardLocalMutationTargets({ appUrl, supabaseUrl, scriptName = 'Local smoke harness' }) {
  const guardedTargets = [];

  if (appUrl) {
    const parsedAppUrl = assertLocalTargetUrl(appUrl, `${scriptName} app URL`);
    guardedTargets.push(`app=${parsedAppUrl.origin}`);
  }

  if (supabaseUrl) {
    const parsedSupabaseUrl = assertLocalTargetUrl(supabaseUrl, `${scriptName} Supabase URL`);
    guardedTargets.push(`supabase=${parsedSupabaseUrl.origin}`);
  }

  if (!guardedTargets.length) {
    throw new Error(`${scriptName} local guard requires at least one target URL.`);
  }

  return `Local guard passed for ${scriptName}: ${guardedTargets.join(', ')}.`;
}

function readFirstSecretValue(filePath, key) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const env = readEnv(filePath);
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveVercelProtectionBypassSecret() {
  const explicit =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
    process.env.VERCEL_PROTECTION_BYPASS_SECRET ||
    process.env.OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET;

  if (explicit) {
    return explicit;
  }

  const secretFile = path.join(workspaceRoot, 'secrets', 'openplan_vercel_protection_bypass.env');
  return readFirstSecretValue(secretFile, 'OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET');
}

function getVercelProtectionBypassHeaders() {
  const secret = resolveVercelProtectionBypassSecret();

  if (!secret) {
    return {};
  }

  return {
    'x-vercel-protection-bypass': secret,
    'x-vercel-set-bypass-cookie': 'true',
  };
}

function buildBrowserContextOptions(baseOptions = {}) {
  const bypassHeaders = getVercelProtectionBypassHeaders();
  if (!Object.keys(bypassHeaders).length) {
    return baseOptions;
  }

  return {
    ...baseOptions,
    extraHTTPHeaders: {
      ...(baseOptions.extraHTTPHeaders || {}),
      ...bypassHeaders,
    },
  };
}

module.exports = {
  assertLocalTargetUrl,
  appRoot,
  buildBrowserContextOptions,
  getOpenplanBaseUrl,
  getOutputDir,
  getVercelProtectionBypassHeaders,
  guardLocalMutationTargets,
  isLocalHostname,
  isSupabaseCloudHostname,
  isVercelHostname,
  loadEnv,
  normalizeHostname,
  parseTargetUrl,
  readEnv,
  repoRoot,
  resolveEnvPath,
  resolveVercelProtectionBypassSecret,
  stripOuterQuotes,
  workspaceRoot,
};
