"""Prove queue, recovery, configuration and CLI refusal checks can fail."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

here = Path(__file__).resolve().parent
root = here.parents[2]
paths = [root/'openplan/src/lib/gtfs/managed-worker-queue.ts', root/'openplan/scripts/workers/gtfs-ingestion.ts']
originals = [path.read_text() for path in paths]
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=False)

def change(before, after, index=0, count=1):
    assert originals[index].count(before) == count, before
    sources = originals.copy(); sources[index] = sources[index].replace(before, after); return sources

variants = [
    ('baseline', originals, None),
    ('harmless', [source+'\n// Harmless queue control.\n' for source in originals], None),
    ('no-retained-scan', change('if (!job.settled) versions.push(version);', '// Only poll database candidates.'), 'lost terminal reply'),
    ('terminal-not-settled', change('if (settled) { job.settled = true;', 'if (settled) { job.settled = false;'), 'identities before claims'),
    ('replacement-disabled', change('attempt: randomUUID(), settled: false };\n            await writeConnectorJournal', 'attempt: job.attempt, settled: false };\n            await writeConnectorJournal'), 'replaces an expired attempt'),
    ('replacement-without-hint', change('if (!eligible.has(versionId)) {', 'if (false) {'), 'absent from candidate eligibility'),
    ('delete-old-history', change('job = { ...job, attempt: randomUUID(), settled: false };', 'await import("node:fs/promises").then(fs => fs.rm(attemptDirectory, {recursive:true,force:true}));\n            job = { ...job, attempt: randomUUID(), settled: false };'), 'retains its original files'),
    ('replacement-source-path', change('source: join(jobDirectory, "source")', 'source: join(attemptDirectory, "source")'), 'replaces an expired attempt'),
    ('terminal-observation', change('if (!snapshot.active && ["ready", "failed", "cancelled"].includes(snapshot.state) && snapshot.claim.attempt < snapshot.attempts)', 'if (false)'), 'later terminal attempt'),
    ('queue-fairness', change('const priority = root.next === "retained" ? [retained, candidates] : [candidates, retained];', 'const priority = [retained, candidates];'), 'rotates retained errors'),
    ('discovery-cursor', change('root.discovery = candidates.filter(version => considered.has(version)).at(-1) ?? root.discovery;', '// Repeat the first candidate page.'), 'first eligible page persistently fails'),
    ('discovery-input', change('maxJobs, signal, root.discovery)', 'maxJobs, signal, null)'), 'first eligible page persistently fails'),
    ('queue-binding', change('root.installationId === binding.installationId && root.target === binding.target', 'true'), 'changed installationId queue binding'),
    ('attempt-scope', change('identity.target === binding.target && identity.installationId === binding.installationId && identity.versionId === versionId', 'true'), 'journal rebound'),
    ('job-scope', change('requireMatch(job.versionId === version, "GTFS queue job scope differs");', '// Ignore inventory scope.'), 'mismatched job identity'),
    ('private-directory', change('info.uid === globalThis.process.getuid?.() && (info.mode & 0o077) === 0', 'true'), 'public job directories'),
    ('directory-symlink', change('entry.isDirectory() && !entry.isSymbolicLink()', 'true'), 'symlink job directories'),
    ('inventory-cap', change('entries.length <= maxRecords + 2', 'true'), 'inventory beyond its installation cap'),
    ('queue-relative', change('isAbsolute(options.directory)', 'true'), 'relative queue directories'),
    ('shutdown-signal', change('signal,\n          work:', 'signal: new AbortController().signal,\n          work:'), 'shutdown cancels active work'),
    ('installation-lock', change('const lock = await acquireConnectorLock(directory), ending = new AbortController();', 'await privateConnectorDirectory(directory);\n  const lock = { signal: new AbortController().signal, release: async () => {} }, ending = new AbortController();'), 'second process'),
    ('once-status', change('if (options.once) return result.pendingCount > 0 || unavailable ? "unconfirmed" as const : "pass_complete" as const;', 'if (options.once) return "unconfirmed" as const;'), 'successful --once pass'),
    ('poll-stop', change('if (options.signal.aborted) return "stopped" as const;', 'if (options.signal.aborted) return "error" as const;'), 'polling exits'),
    ('error-report', change('options.reportError(); if (options.once)', 'if (options.once)'), 'queue transport errors'),
    ('diagnostic-drop', change('options.onUnconfirmed?.(versionId, error);', '// Drop the private diagnostic.'), 'optional error diagnostics'),
    ('help-refusal', change('if (argv.length === 1 && argv[0] === "--help") return { help: true as const };', '// Require normal configuration for help.'), 'CLI prints help'),
    ('target-directory', change('createHash("sha256").update(normalized).digest("hex")', '"shared-target"'), 'binds the durable directory'),
    ('arguments', change('argv.length <= 1 && (argv.length === 0 || argv[0] === "--once")', 'true'), 'invalid arguments configuration'),
    ('relative-config', change('isAbsolute(directory)', 'true'), 'invalid relative configuration'),
    ('credential-url', change('["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash', 'true', count=2), 'invalid credentials configuration'),
    ('installation-config', change('id.parse(env.OPENPLAN_GTFS_INSTALLATION_ID)', 'String(env.OPENPLAN_GTFS_INSTALLATION_ID)'), 'invalid installation configuration'),
    ('build-config', change('z.string().regex(/^[a-f0-9]{40,64}$/).parse(env.OPENPLAN_GTFS_PARSER_BUILD)', 'String(env.OPENPLAN_GTFS_PARSER_BUILD)'), 'invalid build configuration'),
    ('cli-help-creds', change('  const options = gtfsQueueOptions(process.argv.slice(2), process.env);', '  createServiceRoleClient();\n  const options = gtfsQueueOptions(process.argv.slice(2), process.env);', 1), 'CLI prints help'),
    ('submission-hook', change('options.recoverSubmissions ? await options.recoverSubmissions() : { pendingCount: 0 }', '{ pendingCount: 0 }'), 'recovers submissions before queue discovery'),
    ('submission-pending', change('result.pendingCount += pending;', '// Drop unconfirmed submissions.'), 'recovers submissions before queue discovery'),
    ('submission-bound', change('const pending = z.number().int().nonnegative().safe().parse(submission.pendingCount);', 'const pending = submission.pendingCount;'), 'invalid submission pending counts'),
    ('submission-unavailable', change('const unavailable = z.boolean().parse(submission.unavailable ?? false);', 'const unavailable = false;'), 'unavailable submission inventory'),
    ('restored', originals, None),
]
records = []
try:
    for name, sources, assertion in variants:
        for path, source in zip(paths, sources): path.write_text(source)
        report = out/f'{name}.json'
        result = subprocess.run([str(root/'openplan/node_modules/.bin/vitest'), 'run', 'src/test/gtfs-managed-worker-queue.test.ts',
                                 '--maxWorkers=1', '--reporter=json', f'--outputFile={report}'], cwd=root/'openplan', capture_output=True, text=True, timeout=30)
        (out/f'{name}.log').write_text(result.stdout+result.stderr)
        data = json.loads(report.read_text())
        failures = [c['fullName'] for s in data['testResults'] for c in s['assertionResults'] if c['status']=='failed']
        if assertion: assert result.returncode != 0 and any(assertion in case for case in failures), (name, failures)
        else: assert result.returncode == 0 and not failures, (name, failures)
        records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures})
        print(name, records[-1]['result'], flush=True)
finally:
    for path, source in zip(paths, originals): path.write_text(source)
summary = {'sourceSha256':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
           'testSha256':hashlib.sha256((root/'openplan/src/test/gtfs-managed-worker-queue.test.ts').read_bytes()).hexdigest(),'records':records}
(out/'result.json').write_text(json.dumps(summary,indent=2)+'\n')
