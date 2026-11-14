import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { auditProblems, reportedAdvisories } from './audit-dependencies.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const advisory = (name, id, severity = 'moderate') => ({
  source: 1,
  name,
  severity,
  title: `${name} test advisory`,
  url: `https://github.com/advisories/${id}`,
});
const report = (...findings) => ({
  vulnerabilities: Object.fromEntries(findings.map((finding) => [finding.name, { via: [finding] }])),
});
const lock = (packages) => ({ packages: { '': {}, ...packages } });
const exception = (pkg, id, reviewBy = '2026-12-01') => ({ advisory: id, package: pkg, reviewBy, reason: 'Development tooling only.' });
const devLock = lock({ 'node_modules/minimatch': { version: '3.1.4', dev: true }, 'node_modules/x/node_modules/minimatch': { version: '10.2.3', dev: true } });
const MM = 'GHSA-g3hv-75wg-m249';

test('a listed development-only advisory inside its review date passes', () => {
  assert.deepEqual(auditProblems({ report: report(advisory('minimatch', MM)), exceptions: [exception('minimatch', MM)], lock: devLock, today: '2026-11-02' }), []);
});

test('an unlisted advisory fails, whatever its severity', () => {
  for (const severity of ['low', 'moderate', 'high', 'critical']) {
    const problems = auditProblems({ report: report(advisory('qs', 'GHSA-6pq8-jhm2-2vcw', severity)), exceptions: [], lock: devLock, today: '2026-11-02' });
    assert.equal(problems.length, 1, severity);
    assert.match(problems[0], /GHSA-6pq8-jhm2-2vcw qs/);
  }
});

test('an exception past its review date fails', () => {
  const problems = auditProblems({ report: report(advisory('minimatch', MM)), exceptions: [exception('minimatch', MM, '2026-11-01')], lock: devLock, today: '2026-11-02' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expired on 2026-11-01/);
});

test('an exception cannot cover a copy installed for production', () => {
  const mixed = lock({ 'node_modules/minimatch': { version: '3.1.4', dev: true }, 'node_modules/x/node_modules/minimatch': { version: '10.2.3' } });
  const problems = auditProblems({ report: report(advisory('minimatch', MM)), exceptions: [exception('minimatch', MM)], lock: mixed, today: '2026-11-02' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /x\/node_modules\/minimatch is installed for production/);
});

test('an exception the audit no longer reports fails as stale', () => {
  const problems = auditProblems({ report: report(), exceptions: [exception('minimatch', MM)], lock: devLock, today: '2026-11-02' });
  assert.deepEqual(problems.map((p) => /no longer reported/.test(p)), [true]);
});

test('an exception must name its reason, a real date and an installed package', () => {
  const bad = { advisory: MM, package: 'minimatch', reviewBy: 'soon', reason: ' ' };
  const problems = auditProblems({ report: report(advisory('minimatch', MM)), exceptions: [bad], lock: lock({}), today: '2026-11-02' });
  assert.equal(problems.length, 3);
});

test('an exception for one package does not cover the same advisory id on another', () => {
  const problems = auditProblems({ report: report(advisory('other-pkg', MM)), exceptions: [exception('minimatch', MM)], lock: devLock, today: '2026-11-02' });
  assert.ok(problems.some((p) => /GHSA-g3hv-75wg-m249 other-pkg/.test(p)));
});

test('reported advisories are read from via objects and skip package-name links', () => {
  const found = reportedAdvisories({ vulnerabilities: { eslint: { via: ['minimatch'] }, minimatch: { via: [advisory('minimatch', MM)] } } });
  assert.deepEqual(found.map((f) => `${f.advisory} ${f.package}`), [`${MM} minimatch`]);
});

test('the checked-in exceptions are well formed and development-only in the real lockfile', () => {
  const { exceptions } = JSON.parse(readFileSync(join(root, 'audit-exceptions.json'), 'utf8'));
  const realLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const realReport = report(...exceptions.map((e) => advisory(e.package, e.advisory)));
  assert.deepEqual(auditProblems({ report: realReport, exceptions, lock: realLock, today: '2026-11-02' }), []);
});
