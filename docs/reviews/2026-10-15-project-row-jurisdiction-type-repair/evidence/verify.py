from pathlib import Path
import subprocess, json, hashlib
state = Path(__file__).parent
app = state / 'app'
types = app / 'src/app/(app)/projects/[projectId]/_components/_types.ts'
page = app / 'src/app/(app)/projects/[projectId]/page.tsx'
originals = {p: p.read_bytes() for p in (types, page)}
results = []
tsc = ['/usr/bin/node', str(state/'scoped-check.cjs'), 'src/app/(app)/projects/[projectId]/page.tsx', 'src/app/(app)/projects/[projectId]/_components/_types.ts']
vitest = ['/usr/bin/node', 'node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1', '--no-file-parallelism']
focused = vitest + ['src/test/project-detail-page.test.tsx', '-t', 'passes selected raw jurisdiction context|keeps the ordinary empty states']
def run(name, cmd, expected, required=()):
    result = subprocess.run(cmd, cwd=app, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (state / (name + '.log')).write_text(result.stdout)
    ok = (result.returncode == 0) if expected == 'survived' else (result.returncode != 0 and all(s in result.stdout for s in required))
    entry = {'name':name, 'exit':result.returncode, 'expected':expected, 'matched':ok, 'required':required}
    results.append(entry)
    (state/'results.json').write_text(json.dumps(results, indent=2)+'\n')
    print(json.dumps(entry), flush=True)
    if not ok: raise RuntimeError(name + ' failed its expected outcome')
try:
    types.write_bytes(originals[types] + b'\n// Harmless compiler-control comment.\n')
    run('ts-harmless-comment', tsc, 'survived')
    types.write_bytes(originals[types].replace(b'  jurisdiction_context: unknown;\n',b''))
    run('ts-remove-jurisdiction-field', tsc, 'killed', ("page.tsx(1337,46): error TS2339: Property 'jurisdiction_context' does not exist on type 'ProjectRow'.",))
    types.write_bytes(originals[types])
    for group, roots in [('consumers', ['src/app/(app)/projects/[projectId]/_components/project-delivery-board.tsx', 'src/app/(app)/projects/[projectId]/_components/project-posture-header.tsx']), ('page-test', ['src/test/project-detail-page.test.tsx']), ('fixtures', ['src/test/the-deliverable-update-control-is-reachable.test.tsx', 'src/test/the-record-reassignment-control-is-reachable.test.tsx', 'src/test/a-rejected-claim-is-not-money-you-drew.test.tsx']), ('jurisdiction-tests', ['src/test/project-jurisdiction.test.ts', 'src/test/project-jurisdiction-editor.test.tsx'])]:
        run('ts-'+group, ['/usr/bin/node', str(state/'scoped-check.cjs')] + roots, 'survived')
    run('focused-project-jurisdiction', vitest + ['src/test/project-detail-page.test.tsx','src/test/project-jurisdiction.test.ts','src/test/project-jurisdiction-editor.test.tsx','src/test/the-deliverable-update-control-is-reachable.test.tsx','src/test/the-record-reassignment-control-is-reachable.test.tsx','src/test/a-rejected-claim-is-not-money-you-drew.test.tsx'], 'survived')
    page.write_bytes(originals[page] + b'\n// Harmless page-control comment.\n')
    run('page-harmless-comment', focused, 'survived')
    page.write_bytes(originals[page].replace(b'context: project.jurisdiction_context', b'context: null'))
    assert page.read_bytes() != originals[page]
    run('page-force-legacy-null', focused, 'killed', ('passes selected raw jurisdiction context', 'Study-place fallback is disabled.'))
    page.write_bytes(originals[page].replace(b'rtp_posture_updated_at, jurisdiction_context, latitude', b'rtp_posture_updated_at, latitude'))
    assert page.read_bytes() != originals[page]
    run('page-omit-selected-jurisdiction', focused, 'killed', ('passes selected raw jurisdiction context', 'jurisdiction_context'))
finally:
    for path, content in originals.items(): path.write_bytes(content)
    (state/'restoration.json').write_text(json.dumps({str(p.relative_to(app)):{'restored':p.read_bytes()==b, 'sha256':hashlib.sha256(b).hexdigest()} for p,b in originals.items()},indent=2)+'\n')
