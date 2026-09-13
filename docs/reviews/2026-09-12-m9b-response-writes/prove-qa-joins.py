"""Check the audit, anchor and schema-accounting joins without altering the DB."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
app = root.parents[2] / 'openplan'
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/qa-join-mutations')
private.mkdir(mode=0o700, exist_ok=True)
paths = {
    'adapter': app/'src/lib/engagement/response-write-route.ts',
    'builder': app/'src/components/engagement/close-loop-builder.tsx',
    'notice': app/'src/components/engagement/response-broadcast-notice.tsx',
    'columns': app/'src/test/a-column-nothing-reads-is-a-question.test.ts',
    'cleanup': app/'supabase/migrations/20261014000006_engagement_response_rpc_policy_cleanup.sql',
    'schema': app/'supabase/migrations/20261014000005_engagement_delivery_authority_locks.sql',
}
original = {key: path.read_text() for key, path in paths.items()}
all_tests = ['engagement-response-write-route.test.ts','every-api-route-audits.test.ts','page-tabs-anchors-have-elements.test.ts','page-tabs-guard-panels-are-grouped.test.ts','a-column-nothing-reads-is-a-question.test.ts','a-policy-without-a-grant-is-a-locked-door.test.ts','migrations/inventory.test.ts','migrations/release-ordering.test.ts']
cases = [
    ('baseline', {}, all_tests, None),
    ('harmless-comment', {'adapter': original['adapter']+'\n// Harmless join control.\n'}, all_tests, None),
    ('audit-never-created', {'adapter': original['adapter'].replace('const audit = auditForRequest(request);','const audit = { info() {}, warn() {}, error() {} };')}, ['engagement-response-write-route.test.ts'], "passes the caller's exact identity"),
    ('confirmed-outcome-not-recorded', {'adapter': original['adapter'].replace('audit.info("response_write_confirmed",','audit.warn("response_write_confirmed",')}, ['engagement-response-write-route.test.ts'], "passes the caller's exact identity"),
    ('publication-anchor-renamed', {key: original[key].replace('closeloop-broadcast-notice-${','broken-publication-${') for key in ['builder','notice']}, ['page-tabs-anchors-have-elements.test.ts','page-tabs-guard-panels-are-grouped.test.ts'], 'renders an element for each engagement console anchor'),
    ('retained-column-unaccounted', {'columns': original['columns'].replace('"engagement_response_broadcasts.prepared_at"','"synthetic_missing_column"')}, ['a-column-nothing-reads-is-a-question.test.ts'], 'finds no unread column'),
    ('obsolete-policy-left-promising-direct-write', {'cleanup': original['cleanup'].replace('DROP POLICY IF EXISTS engagement_closeloop_entries_delete ON public.engagement_closeloop_entries;', '')}, ['a-policy-without-a-grant-is-a-locked-door.test.ts'], 'grants every command'),
    ('extra-table-not-accounted', {'schema': original['schema']+'\nCREATE TABLE public.synthetic_inventory_negative_control (id uuid);\n'}, ['migrations/inventory.test.ts'], 'reads every relation'),
    ('extra-policy-not-accounted', {'schema': original['schema']+'\nCREATE POLICY synthetic_inventory_negative_control ON public.engagement_response_write_receipts FOR SELECT TO authenticated USING (false);\n'}, ['migrations/inventory.test.ts'], 'counts what the database actually has'),
]
results = []
try:
    for name, edits, tests, expected in cases:
        for key, source in edits.items():
            assert source != original[key]
            paths[key].write_text(source)
        report = private/(name+'.json')
        run = subprocess.run(['npm','exec','--','vitest','run',*['src/test/'+test for test in tests],'--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=90)
        data = json.loads(report.read_text())
        failed = [test['fullName'] for file in data['testResults'] for test in file['assertionResults'] if test['status']=='failed']
        matched = run.returncode==0 and data['numPassedTests']>=148 if expected is None else run.returncode!=0 and any(expected in title for title in failed)
        row = {'name':name,'matched':matched,'outcome':'survived' if run.returncode==0 else 'killed','expected':expected,'failedTests':failed,'passedTests':data['numPassedTests'],'failedTestCount':data['numFailedTests']}
        results.append(row)
        (root/'qa-join-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
        for key in edits: paths[key].write_text(original[key])
        print(name,row['outcome'],matched,flush=True)
        assert matched,row
finally:
    for key,path in paths.items():path.write_text(original[key])
    (root/'qa-join-restoration.json').write_text(json.dumps({str(path.relative_to(app)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths.values()},indent=2)+'\n')
