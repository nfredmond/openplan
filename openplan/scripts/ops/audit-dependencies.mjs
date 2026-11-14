import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The dependency audit gate. Every advisory `npm audit` reports fails the gate
// unless audit-exceptions.json names it, and an exception holds only while
// all of these stay true:
//   - every installed copy of the package is development-only in the lockfile,
//     so nothing a deployment runs can reach it;
//   - its review date has not passed, so an exception cannot outlive its reason;
//   - the advisory is still reported, so a fixed advisory leaves the list.
// Severity does not matter: a low advisory fails the same as a high one, as
// `npm audit --audit-level=low` did before exceptions existed.

const ADVISORY_URL = /^https:\/\/github\.com\/advisories\/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every (advisory, package) pair in an `npm audit --json` report. */
export function reportedAdvisories(report) {
  const found = new Map();
  for (const [name, entry] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const match = ADVISORY_URL.exec(via.url ?? '');
      const advisory = match ? match[1] : `npm-${via.source}`;
      found.set(`${advisory} ${via.name ?? name}`, {
        advisory,
        package: via.name ?? name,
        severity: via.severity,
        title: via.title,
        url: via.url,
      });
    }
  }
  return [...found.values()];
}

/** Lockfile entries for one package name, wherever npm nested them. */
function lockedCopies(lock, name) {
  const suffix = `node_modules/${name}`;
  return Object.entries(lock?.packages ?? {}).filter(([path]) => path === suffix || path.endsWith(`/${suffix}`));
}

/**
 * Problems that fail the gate, as sentences that say what to do. Empty means
 * the audit passes.
 */
export function auditProblems({ report, exceptions, lock, today }) {
  const problems = [];
  const reported = reportedAdvisories(report);
  const listed = new Map();

  for (const exception of exceptions) {
    const key = `${exception.advisory} ${exception.package}`;
    if (listed.has(key)) problems.push(`${key}: listed twice in audit-exceptions.json.`);
    listed.set(key, exception);
    if (!exception.reason || !String(exception.reason).trim()) problems.push(`${key}: the exception gives no reason.`);
    if (!DATE.test(exception.reviewBy ?? '')) problems.push(`${key}: reviewBy must be a YYYY-MM-DD date.`);
    else if (exception.reviewBy < today) problems.push(`${key}: the exception expired on ${exception.reviewBy}. Fix the advisory or renew the exception with a current reason.`);
    const copies = lockedCopies(lock, exception.package);
    if (copies.length === 0) problems.push(`${key}: the lockfile has no copy of ${exception.package}. Remove the exception.`);
    for (const [path, entry] of copies) {
      if (entry.dev !== true) problems.push(`${key}: ${path} is installed for production, so a deployment can reach it. Development-only exceptions cannot cover it.`);
    }
  }

  for (const finding of reported) {
    const key = `${finding.advisory} ${finding.package}`;
    if (!listed.has(key)) problems.push(`${key} (${finding.severity}): ${finding.title}. Update the dependency, or add a dated development-only exception with its reason.`);
  }
  for (const key of listed.keys()) {
    if (!reported.some((finding) => `${finding.advisory} ${finding.package}` === key)) {
      problems.push(`${key}: no longer reported by npm audit. Remove the exception.`);
    }
  }
  return problems;
}

function runAudit(root) {
  try {
    // Under `npm run`, npm_execpath names npm's own script, which avoids a
    // shell on Windows, where npm is a .cmd wrapper.
    const options = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
    const npmScript = process.env.npm_execpath;
    return npmScript
      ? execFileSync(process.execPath, [npmScript, 'audit', '--json'], options)
      : execFileSync('npm', ['audit', '--json'], { ...options, shell: process.platform === 'win32' });
  } catch (error) {
    // npm audit exits 1 when it finds advisories; the JSON is still on stdout.
    if (error && typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const report = JSON.parse(runAudit(root));
  if (report.error) {
    console.error(`npm audit could not run: ${report.error.summary ?? JSON.stringify(report.error)}`);
    process.exit(1);
  }
  const exceptions = JSON.parse(readFileSync(join(root, 'audit-exceptions.json'), 'utf8')).exceptions;
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const problems = auditProblems({ report, exceptions, lock, today });
  const counts = report.metadata?.vulnerabilities ?? {};
  if (problems.length) {
    console.error(`Dependency audit failed (${JSON.stringify(counts)}):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(`Dependency audit passed: ${reportedAdvisories(report).length} reported advisories, all covered by ${exceptions.length} development-only exceptions reviewed by their dates.`);
}
