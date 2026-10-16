"""Serial bounded source controls. No app, database server or browser targets."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / 'openplan'
HERE = Path(__file__).resolve().parent
CASES = []
def case(label, source, before, after, suite, test, diagnostic):
    CASES.append(dict(label=label, source=source, before=before, after=after, suite=suite, test=test, diagnostic=diagnostic, survives=False))
editor = 'src/components/projects/project-jurisdiction-editor.tsx'
payload = 'src/lib/jurisdiction-readiness/payload.ts'
gpkg = 'src/lib/projects/project-geopackage.ts'
records = 'src/lib/project-evidence-bundles/generated-records.ts'
api = 'src/app/api/projects/[projectId]/jurisdiction-readiness/route.ts'
report = 'src/app/api/reports/[reportId]/generate/route.ts'
html = 'src/lib/reports/html.ts'
ui = 'project-jurisdiction-editor.test.tsx'
art = 'project-jurisdiction-artifacts.test.ts'
exports = 'project-jurisdiction-export-corrections.test.ts'
stale = next(line for line in (APP / editor).read_text().splitlines() if 'const staleDraft = ' in line)
for name in ['account', 'workspace', 'permission', 'project', 'revision']:
    case(name + ' scope retention', editor, stale, '  const staleDraft = false;', ui, f'retains original draft and blocks {name} props changes until explicit restart', 'Stale draft submission blocked')
    case(name + ' in-flight confirmation', editor, 'const scopeStillCurrent = () => currentScope.current.epoch === requestScope.epoch && currentScope.current.canWrite;', 'const scopeStillCurrent = () => true;', ui, f'keeps draft when an in-flight save returns after {name} changes', 'Earlier-scope response disclosed')
case('account round-trip epoch', editor, 'epoch: previous.epoch + (changed ? 1 : 0)', 'epoch: 0', ui, 'blocks an in-flight confirmation even when account changes away and back', 'Earlier-scope response disclosed')
case('parsed response scope', editor, '        if (!scopeStillCurrent()) { setError("The save response belongs to an earlier scope. Keep the original draft for comparison."); return; }', '', ui, 'does not publish a prior-scope error after deferred response parsing', 'Parsed error stays with original scope')
# An event forced through a disabled fieldset must still refuse at the handler.
case('handler stale refusal', editor, 'if (staleDraft) { setError(', 'if (false) { setError(', ui, 'retains original draft and blocks account props changes until explicit restart', 'Stale draft emits no request')
case('restart reads saved context', editor, 'setDraft(jurisdictionDraft(saved)); setDraftScope', 'setDraftScope', ui, 'retains original draft and blocks account props changes until explicit restart', 'Restart uses current saved context')
canonical_test = 'hashes a versioned external representation after strict internal validation'
case('external actor minimization', payload, 'state: internal.context.state,', 'recordedBy: internal.context.recordedBy, state: internal.context.state,', exports, canonical_test, 'External canonical material excludes internal actor UUID')
case('recorded time retained', payload, 'recordedAt: internal.context.recordedAt,', 'recordedAt: null,', exports, canonical_test, 'External attribution keeps time and source')
case('explicit external schema', payload, 'schema: "openplan.project-jurisdiction-readiness-export.v3" as const,', 'schema: "openplan.project-jurisdiction-readiness-export.v0" as const,', exports, canonical_test, 'External schema is explicit')
case('explicit external scope', payload, 'scope: "external_handoff" as const,', 'scope: "internal" as const,', exports, canonical_test, 'External scope is explicit')
case('strict internal parser before export', 'src/lib/projects/project-jurisdiction.ts', 'recordedBy: z.string().uuid(),', 'recordedBy: z.string().uuid().optional(),', exports, canonical_test, 'Export cannot bypass strict internal authorship validation')
case('external canonical hash', payload, '    entries: internal.entries,\n  };\n  return { ...payload, payloadSha256: createHash("sha256").update(canonicalizeActionPayload(payload))', '    entries: internal.entries,\n  };\n  return { ...payload, payloadSha256: createHash("sha256").update("wrong bytes")', exports, canonical_test, 'External hash covers its actual canonical bytes')
case('registry identity', payload, 'registryVersion: JURISDICTION_READINESS_REGISTRY.registryVersion,', 'registryVersion: null,', exports, canonical_test, 'Registry identity retained')
file_test = 'carries minimized same-revision canonical material through real generated files and SQLite at different clocks'
case('generated project context export', records, 'jurisdiction_context: externalReadiness.context };', 'jurisdiction_context: trustedProject.jurisdiction_context };', exports, file_test, 'Generated project record minimizes actor')
case('GeoPackage canonical hash record', gpkg, 'readiness?.payloadSha256 ?? null);', '"wrong-hash");', exports, file_test, 'standalone canonical hash parity')
case('GeoPackage canonical payload bytes', gpkg, 'readiness ? canonicalizeActionPayload(readiness) : null,', 'readiness ? canonicalizeActionPayload({}) : null,', exports, file_test, 'standalone canonical byte parity')
case('GeoPackage registry hash', gpkg, 'readiness?.registrySha256 ?? null,', '"wrong-registry",', exports, file_test, 'standalone registry hash')
case('GeoPackage registry version', gpkg, 'readiness?.registryVersion ?? null,', '"wrong-version",', exports, file_test, 'standalone registry version')
case('GeoPackage payload schema', gpkg, 'readiness?.schema ?? null,', '"wrong-schema",', exports, file_test, 'standalone schema')
case('GeoPackage context record', gpkg, 'canonicalizeActionPayload(jurisdiction),', 'canonicalizeActionPayload(null),', art, 'exports a separate jurisdiction manifest without changing project_area attributes or WKB', 'expected null to deeply equal')
case('external report rendering', html, 'payload.schema === "openplan.project-jurisdiction-readiness-export.v3") {', 'payload.schema === "openplan.project-jurisdiction-readiness-export.v3") { return "";', art, 'renders each declaration and its payload hash with escaped labels and no authority inference', 'Report discloses external schema')
case('report time disclosure', html, 'esc(payload.context?.recordedAt ?? "No separate declaration")', 'esc("time omitted")', art, 'renders each declaration and its payload hash with escaped labels and no authority inference', 'Report retains recorded time')
case('external frozen payload', 'src/lib/jurisdiction-readiness/evidence-bundle.ts', 'const payload = buildProjectJurisdictionReadinessExportPayload(project, registrySha256);', 'const payload = { ...buildProjectJurisdictionReadinessExportPayload(project, registrySha256), schema: "wrong" };', 'project-jurisdiction.test.ts', 'freezes identical same-revision context and payload hashes without changing old bytes', 'Frozen JSON uses shared external canonical contract')
case('download version', api, 'const download = new URL(request.url).searchParams.get("download") === "1";', 'const download = false;', 'jurisdiction-readiness-routes.test.ts', "uses the project place and keeps Puerto Rico's unavailable claims visible", 'Download selects external v3')
case('internal API custody retained', api, '(download ? buildProjectJurisdictionReadinessExportPayload : buildProjectJurisdictionReadinessPayload)', '(download ? buildProjectJurisdictionReadinessExportPayload : buildProjectJurisdictionReadinessExportPayload)', 'jurisdiction-readiness-routes.test.ts', 'distinguishes authenticated internal custody from minimized download bytes', 'Authenticated API retains internal v2')
case('download actor minimization', api, '(download ? buildProjectJurisdictionReadinessExportPayload : buildProjectJurisdictionReadinessPayload)', '(download ? buildProjectJurisdictionReadinessPayload : buildProjectJurisdictionReadinessPayload)', 'jurisdiction-readiness-routes.test.ts', 'distinguishes authenticated internal custody from minimized download bytes', 'Download omits internal actor')
for test, diagnostic in [('persists an html artifact and updates report status', 'Report freezes external readiness version'), ('freezes non-null export-safe report readiness with canonical hash parity', 'Report metadata shares external canonical material')]:
    case('report export payload: ' + test, report, 'const jurisdictionReadiness = buildProjectJurisdictionReadinessExportPayload(projectRow, jurisdictionReadinessRegistrySha256());', 'const jurisdictionReadiness = { ...buildProjectJurisdictionReadinessExportPayload(projectRow, jurisdictionReadinessRegistrySha256()), schema: "openplan.project-jurisdiction-readiness-response.v2" };', 'report-generate-route.test.ts', test, diagnostic)
case('recordedBy sanitizer guard', records, '"user_id", "userId", "recorded_by", "recordedBy",', '"user_id", "userId", "recorded_by",', exports, file_test, 'Generated project record minimizes actor')
case('recorded_by sanitizer guard', records, '"user_id", "userId", "recorded_by", "recordedBy",', '"user_id", "userId", "recordedBy",', exports, file_test, 'Generated project record minimizes actor')
case('trusted row projection', records, '.select("*")', '.select("id, updated_at")', exports, file_test, 'Adapter reads full trusted jurisdiction projection')
for name, field in [('account', 'userId'), ('workspace', 'workspaceId'), ('permission', 'canWrite'), ('project', 'projectId'), ('revision', 'revision')]:
    case(name + ' scope epoch tracking', editor, f'previous.{field} !== {field}', 'false', ui, 'blocks confirmation after permission is revoked and restored during a save' if name == 'permission' else f'keeps draft when an in-flight save returns after {name} changes', 'Intervening permission loss invalidates confirmation' if name == 'permission' else 'Earlier-scope response disclosed')
case('clock independence', payload, 'scope: "external_handoff" as const,', 'scope: "external_handoff" as const, generatedAt: new Date().toISOString(),', exports, file_test, 'Separate JSON canonical parity across clocks')
case('actual report GeoPackage parity', gpkg, 'readiness?.payloadSha256 ?? null);', '"wrong-hash");', 'report-generate-route.test.ts', 'freezes non-null export-safe report readiness with canonical hash parity', 'Actual report JSON and both GeoPackages share a hash across clocks')
# Each changed test group first receives a harmless survivor.
paired = set()
ordered = []
for c in CASES:
    pair = (c['suite'], c['test'])
    if pair not in paired:
        text = (APP / c['source']).read_text()
        prefix = ''.join(text.splitlines(keepends=True)[:3])
        assert text.count(prefix) == 1
        ordered.append({**c, 'label': 'harmless survivor: ' + c['test'], 'before': prefix, 'after': '// Harmless correction control.\n' + prefix, 'survives': True})
        paired.add(pair)
    ordered.append(c)
CASES = ordered
if len(sys.argv) > 2 and sys.argv[2] == 'supplemental':
    selected_labels = {'permission scope epoch tracking', 'project scope epoch tracking', 'revision scope epoch tracking', 'clock independence', 'actual report GeoPackage parity'}
    selected_tests = {c['test'] for c in CASES if c['label'] in selected_labels}
    CASES = [c for c in CASES if c['label'] in selected_labels or c['survives'] and c['test'] in selected_tests]

def outcome(report, code, selected, survives, diagnostic):
    assertions = [a for result in report.get('testResults', []) for a in result.get('assertionResults', []) if a.get('status') in ['passed', 'failed']]
    if len(assertions) != 1 or not assertions[0].get('fullName', '').endswith(selected):
        return False
    assertion = assertions[0]
    if survives:
        return code == 0 and assertion.get('status') == 'passed' and report.get('numFailedTests') == 0
    return code == 1 and assertion.get('status') == 'failed' and report.get('numFailedTests') == 1 and any('AssertionError' in message and diagnostic in message for message in assertion.get('failureMessages', []))

def classifier_controls():
    def report(name='target', message='AssertionError: named diagnostic', status='failed'):
        return {'numFailedTests': 1 if status == 'failed' else 0, 'testResults': [{'assertionResults': [{'fullName': name, 'status': status, 'failureMessages': [message]}]}]}
    return {
        'named_assertion_accepted': outcome(report(), 1, 'target', False, 'named diagnostic'),
        'harmless_survivor_accepted': outcome(report(status='passed'), 0, 'target', True, ''),
        'generic_failure_rejected': not outcome(report(message='TypeError: named diagnostic'), 1, 'target', False, 'named diagnostic'),
        'wrong_assertion_rejected': not outcome(report(message='AssertionError: other diagnostic'), 1, 'target', False, 'named diagnostic'),
        'wrong_test_rejected': not outcome(report(name='other'), 1, 'target', False, 'named diagnostic'),
        'empty_selection_rejected': not outcome({}, 1, 'target', False, 'named diagnostic'),
        'crash_exit_rejected': not outcome(report(), 134, 'target', False, 'named diagnostic'),
        'skipped_selection_rejected': not outcome(report(status='pending'), 0, 'target', True, ''),
    }

def resources():
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    return {key: (group / key).read_text().strip() for key in ['memory.max', 'memory.swap.max', 'memory.peak', 'memory.events']}

if __name__ == '__main__':
    out = HERE / (sys.argv[1] if len(sys.argv) > 1 else 'controls-01')
    out.mkdir(exist_ok=False)
    controls = classifier_controls()
    (out / 'classifier.json').write_text(json.dumps(controls, indent=2) + '\n')
    assert all(controls.values())
    original = {APP / c['source']: (APP / c['source']).read_bytes() for c in CASES}
    results = []
    try:
        for index, c in enumerate(CASES):
            path = APP / c['source']
            before = original[path].decode()
            assert before.count(c['before']) == 1, ('ambiguous anchor', c['label'], before.count(c['before']))
            receipt = out / f'{index:02d}.json'
            try:
                path.write_text(before.replace(c['before'], c['after'], 1))
                run = subprocess.run(['node', '--max-old-space-size=640', 'node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', '--config', str(HERE / 'vitest.config.mts'), 'src/test/' + c['suite'], '-t', re.escape(c['test']) + '$', '--reporter=json', '--outputFile=' + str(receipt)], cwd=APP, capture_output=True, text=True)
                (out / f'{index:02d}.log').write_text(run.stdout + run.stderr)
                report = json.loads(receipt.read_text()) if receipt.exists() else {}
                valid = outcome(report, run.returncode, c['test'], c['survives'], c['diagnostic'])
                result = {key: value for key, value in c.items() if key not in ['before', 'after']}
                result.update(exitCode=run.returncode, expectedObserved=valid, failures=[{'name': a['fullName'], 'messages': a.get('failureMessages')} for t in report.get('testResults', []) for a in t.get('assertionResults', []) if a.get('status') == 'failed'])
                results.append(result)
                (out / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
                print(c['label'], 'SURVIVED' if c['survives'] else 'INTENDED ASSERTION', valid, flush=True)
                if not valid:
                    raise RuntimeError('Unexpected mutation outcome: ' + c['label'])
            finally:
                path.write_bytes(original[path])
    finally:
        assert all(path.read_bytes() == value for path, value in original.items())
        (out / 'source-bindings.json').write_text(json.dumps({str(path.relative_to(ROOT)): hashlib.sha256(value).hexdigest() for path, value in original.items()}, indent=2) + '\n')
        (out / 'resources.json').write_text(json.dumps(resources(), indent=2) + '\n')
