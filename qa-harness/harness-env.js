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
  appRoot,
  buildBrowserContextOptions,
  getOpenplanBaseUrl,
  getOutputDir,
  getVercelProtectionBypassHeaders,
  loadEnv,
  readEnv,
  repoRoot,
  resolveEnvPath,
  resolveVercelProtectionBypassSecret,
  stripOuterQuotes,
  workspaceRoot,
};
