import hashlib, json, os, pathlib, subprocess, sys

app = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=False)
source = app / 'src/lib/land-use-plans/public.ts'
original = source.read_text()
report = {'sourceSha256': hashlib.sha256(original.encode()).hexdigest(), 'controls': []}
env = dict(os.environ, NODE_OPTIONS='--max-old-space-size=6144')
command = ['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/test/land-use-plan-public-identity.test.ts', '--maxWorkers=1']

def check(name, text, expected, title=None):
    source.write_text(text)
    run = subprocess.run(command, cwd=app, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (out / (name + '.log')).write_text(run.stdout)
    report['controls'].append({'name': name, 'exitCode': run.returncode, 'expected': expected, 'target': title})
    if expected == 'pass' and run.returncode != 0:
        raise RuntimeError(name + ' did not pass')
    if expected == 'fail' and (run.returncode == 0 or title not in run.stdout or 'AssertionError' not in run.stdout):
        raise RuntimeError(name + ' did not detect intended failure')

try:
    check('harmless-comment', '// Harmless verification comment.\n' + original, 'pass')
    legacy = subprocess.check_output(['git', 'show', '3e54ecc3f1a8159d6e26c03b1428d34b285100fc:openplan/src/lib/land-use-plans/public.ts'], cwd=app, text=True)
    check('legacy-live-identity', legacy, 'fail', 'uses the reviewed identity and descriptor after later draft edits')
    mutations = [
        ('skip-checksum', ' || hashFrozenRecord(snapshot) !== contentHash', '', 'refuses changed frozen content'),
        ('skip-plan-identity', ' || parsed.data.plan.id !== planId', '', 'self-hashed snapshot for another plan'),
        ('skip-version-identity', ' || parsed.data.version.id !== versionId', '', 'self-hashed snapshot for another version'),
        ('skip-version-number', 'parsed.data.version.versionNumber !== versionNumber || ', '', 'self-hashed snapshot for another number'),
        ('skip-row-owner', 'version.plan_id !== plan.id || ', '', 'version row belonging to another plan'),
        ('omit-frozen-column', 'content_hash, frozen_snapshot, frozen_at', 'content_hash, frozen_at', 'uses the reviewed identity and descriptor after later draft edits'),
        ('skip-owner-query', '.eq("plan_id", plan.id)', '', 'uses the reviewed identity and descriptor after later draft edits'),
    ]
    for name, before, after, title in mutations:
        if before not in original: raise RuntimeError('Mutation missing: ' + name)
        check(name, original.replace(before, after), 'fail', title)
finally:
    source.write_text(original)
    report['restored'] = hashlib.sha256(source.read_bytes()).hexdigest() == report['sourceSha256']
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
