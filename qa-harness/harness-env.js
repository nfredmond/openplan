const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
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

module.exports = {
  appRoot,
  getOutputDir,
  loadEnv,
  readEnv,
  repoRoot,
  resolveEnvPath,
  stripOuterQuotes,
};
