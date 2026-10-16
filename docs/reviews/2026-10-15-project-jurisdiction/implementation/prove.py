"""Serial reversible behavior mutations. No services, databases or browser targets.

Run inside a parent-owned 1 GiB/no-swap cgroup. This controls TypeScript assertions,
not PostgreSQL execution, live authorization, rendered usability or legal coverage.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / 'openplan'
OUT = Path(__file__).resolve().parent
CASES = []
def case(label, source, before, after, suite, test, survives=False):
    CASES.append(dict(label=label, source=source, before=before, after=after, suite=suite, test=test, survives=survives))
lib = 'src/lib/projects/project-jurisdiction.ts'
payload = 'src/lib/jurisdiction-readiness/payload.ts'
route = 'src/app/api/projects/[projectId]/route.ts'
editor = 'src/components/projects/project-jurisdiction-editor.tsx'
unit = 'project-jurisdiction.test.ts'
routes = 'project-jurisdiction-route.test.ts'
ui = 'project-jurisdiction-editor.test.tsx'
artifact = 'project-jurisdiction-artifacts.test.ts'
case('harmless comment survivor', lib, 'Missing projection is an error.', 'An omitted projection is an error.', unit, 'distinguishes invalid or unread context', True)
case('strict input provenance', lib, 'entries: z.array(jurisdictionEntryInputSchema).min(1).max(12) }).strict()', 'entries: z.array(jurisdictionEntryInputSchema).min(1).max(12) })', unit, 'bounds and strictly validates')
case('bounded declaration count', lib, 'entries: z.array(jurisdictionEntryInputSchema).min(1).max(12)', 'entries: z.array(jurisdictionEntryInputSchema).min(1).max(13)', unit, 'bounds and strictly validates')
case('reference guard', lib, 'const reference = z.string().regex(/^[a-z][a-z0-9._-]*:[^\\s]{1,180}$/).nullable();', 'const reference = z.string().nullable();', unit, 'bounds and strictly validates')
case('resolver metadata', lib, 'subdivisionCode: place.place_subdivision_code, kind:', 'subdivisionCode: null, kind:', unit, 'resolves exact supported identity')
case('resolver identity match', lib, 'boundary.kind !== entry.kind || boundary.geoid !== entry.geoid', 'false', unit, 'refuses failed or mismatched resolver')
case('unread projection', lib, 'if (!("jurisdiction_context" in row))', 'if (false)', unit, 'distinguishes invalid or unread context')
case('stored metadata strictness', lib, '}).strict().refine(value => value.state', '}).refine(value => value.state', unit, 'distinguishes invalid or unread context')
case('explicit unresolved suppresses fallback', payload, 'const legacy = context === null;', 'const legacy = context === null || context.state === "unresolved";', unit, 'suppresses study-place fallback')
case('staff declaration cannot become supported', payload, 'declaration.identity === "server_resolved" && administrative', 'administrative', unit, 'preserves multistate territory')
case('resolved administrative guidance', payload, 'const resolved = declaration.identity === "server_resolved" && administrative;', 'const resolved = false;', unit, 'resolves exact supported identity')
case('retain every context', payload, 'context.entries.map(declaration =>', 'context.entries.slice(0, 1).map(declaration =>', unit, 'preserves multistate territory')
case('freeze same revision', payload, 'projectRevision: project.updated_at ?? null,', 'projectRevision: null,', unit, 'freezes identical same-revision')
case('payload hash', payload, '.update(canonicalizeActionPayload(payload))', '.update("wrong payload")', unit, 'freezes identical same-revision')
case('server actor provenance', lib, 'recordedBy: actorId, recordedAt:', 'recordedBy: "11111111-1111-4111-8111-111111111111", recordedAt:', routes, 'writes only jurisdiction')
case('CAS predicate', route, '.eq("updated_at", payload.data.expectedRevision!)', '.eq("updated_at", "wrong-revision")', routes, 'writes only jurisdiction')
case('workspace write predicate', route, '.eq("workspace_id", project.workspace_id).eq("updated_at"', '.eq("workspace_id", "wrong-workspace").eq("updated_at"', routes, 'writes only jurisdiction')
case('write projection', route, '.select("id, updated_at, jurisdiction_context").maybeSingle()', '.select("id, updated_at").maybeSingle()', routes, 'writes only jurisdiction')
case('independent command boundary', route, 'Boolean(value.expectedRevision && Object.keys(value).length === 2)', 'Boolean(value.expectedRevision)', routes, 'rejects forged provenance')
case('assistant execution refusal', route, '].some(key => request.headers.has(key))) {', '].some(key => false)) {', routes, 'refuses assistant execution headers')
case('browser origin refusal', route, 'requireProviderBrowserOrigin(request);', 'void request;', routes, 'requires matching browser origin')
case('expected account refusal', route, 'request.headers.get("x-openplan-expected-user") !== userId', 'false', routes, 'requires matching browser origin')
case('expected workspace refusal', route, 'request.headers.get("x-openplan-expected-workspace") !== project.workspace_id', 'false', routes, 'requires matching browser origin')
case('role authorization', route, '!access.membership || !access.allowed', '!access.membership', routes, 'refuses forbidden roles')
case('preflight revision conflict', route, 'if (project.updated_at !== payload.data.expectedRevision)', 'if (false)', routes, 'returns 409 on stale')
case('concurrent revision conflict', route, 'if (!saved.data) return NextResponse.json', 'if (false) return NextResponse.json', routes, 'returns 409 on stale')
case('failed identity HTTP status', route, 'catch { return NextResponse.json({ error: "Jurisdiction identity could not be resolved. Keep your draft." }, { status: 503 }); }', 'catch { return NextResponse.json({ error: "Jurisdiction identity could not be resolved. Keep your draft." }, { status: 200 }); }', routes, 'returns unavailable on failed lookup')
case('geometry preservation boundary', route, '.update({ jurisdiction_context: jurisdiction })', '.update({ jurisdiction_context: jurisdiction, place_geometry_geojson: null })', routes, 'clears explicitly without changing')
case('cancel local only', editor, 'setEditing(false); setDraft([]); setError(null);', 'void save([]); setEditing(false); setDraft([]); setError(null);', ui, 'cancels a local jurisdiction')
case('editor exact revision', editor, 'expectedRevision: baseRevision,', 'expectedRevision: "wrong-revision",', ui, 'saves references independently')
case('retain conflict draft', editor, 'setError(body.error ??', 'setDraft([]); setError(body.error ??', ui, 'retains the draft on conflict')
case('explicit clear', editor, 'onClick={() => void save([])}>Clear to unresolved', 'onClick={() => void save(draft)}>Clear to unresolved', ui, 'retains the draft on conflict')
case('staff entry mode', editor, 'mode: "staff", label: label.trim()', 'mode: "resolved", label: label.trim()', ui, 'offers explicitly unverified staff')
case('search-only no geometry', 'src/components/models/study-area-picker.tsx', 'if (!searchOnly) emitCorridorText', 'if (true) emitCorridorText', 'project-jurisdiction-picker.test.tsx', 'reuses the search front door')
case('agent registry refusal', 'src/lib/runtime/action-metadata.ts', 'export const ACTION_METADATA: ActionMetadataRegistry = {', 'export const ACTION_METADATA: ActionMetadataRegistry = { set_project_jurisdiction_context: {},', 'refused-project-jurisdiction-action.test.ts', 'keeps project jurisdiction mutations')
case('GeoPackage independent context', 'src/lib/projects/project-geopackage.ts', 'canonicalizeActionPayload(jurisdiction));', 'canonicalizeActionPayload(null));', artifact, 'exports a separate jurisdiction manifest')
case('HTML declaration and hash', 'src/lib/reports/html.ts', 'if (payload.schema === "openplan.project-jurisdiction-readiness-response.v2") {', 'if (payload.schema === "openplan.project-jurisdiction-readiness-response.v2") { return "";', artifact, 'renders each declaration')
case('legacy readiness evidence claim', payload, 'subdivisionCode: project.place_subdivision_code ?? null, label:', 'subdivisionCode: null, label:', 'jurisdiction-readiness-evidence-bundle.test.ts', 'freezes the same full-hash')
case('unknown context remains unassessed', payload, 'countryCode: project.place_country_code ?? null, subdivisionCode: project.place_subdivision_code ?? null,', 'countryCode: "US", subdivisionCode: "CA",', 'jurisdiction-readiness-evidence-bundle.test.ts', 'freezes an unknown place')
case('read API projection', 'src/lib/projects/project-jurisdiction.ts', 'id, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code";', 'id, updated_at, place_label, place_country_code, place_subdivision_code";', 'jurisdiction-readiness-routes.test.ts', 'uses the project place')
case('GeoPackage registered manifest', 'src/lib/projects/project-geopackage.ts', 'registerContents(db, { table: "project_jurisdiction_context",', 'registerContents(db, { table: "project_jurisdiction_context_omitted",', 'project-geopackage.test.ts', 'creates a valid SQLite GeoPackage')
case('report context projection', 'src/app/api/reports/[reportId]/generate/route.ts', 'longitude, jurisdiction_context, ${PROJECT_PLACE_COLUMNS}', 'longitude, ${PROJECT_PLACE_COLUMNS}', 'report-generate-route.test.ts', 'persists an html artifact')
case('bundle context read', 'src/lib/project-evidence-bundles/generated-records.ts', '.select("*")', '.select("id, updated_at")', 'project-evidence-generated-pagination.test.ts', 'preserves every model')

case('busy editor protects request draft', editor, '<fieldset disabled={saving} className="space-y-3">', '<fieldset className="space-y-3">', ui, 'saves references independently')
case('invalid stored read status', 'src/app/api/projects/[projectId]/jurisdiction-readiness/route.ts', 'Readiness is unavailable." }, { status: 500 });', 'Readiness is unavailable." }, { status: 200 });', routes, 'keeps invalid stored metadata')

case('server timestamp', lib, 'recordedAt: new Date().toISOString()', 'recordedAt: "2000-01-01T00:00:00.000Z"', unit, 'resolves exact supported identity')
case('country descriptor format', lib, 'const countryCode = z.string().regex(/^[A-Z]{2}$/).nullable();', 'const countryCode = z.string().nullable();', unit, 'bounds and strictly validates')
case('old bundle review becomes stale', 'src/lib/project-evidence-bundles/decision-package-readiness.ts', 'return "The project record changed after this bundle was frozen.";', 'return null;', unit, 'freezes identical same-revision')

case('stored resolved source integrity', lib, 'if (entry.identity === "server_resolved") {', 'if (false) {', unit, 'distinguishes invalid or unread context')

case('HTML declared geography provenance', 'src/lib/reports/html.ts', 'esc(entry.declaration.countryCode ?? "Unspecified")', 'esc("Unspecified")', artifact, 'renders each declaration')

# Give every selected assertion group its own harmless survivor as well as its
# behavior defect, including UI, routes and artifact adapters.
seen_survivors = {(c['suite'], c['test']) for c in CASES if c['survives']}
for target_case in list(CASES):
    pair = (target_case['suite'], target_case['test'])
    if pair in seen_survivors:
        continue
    source_text = (APP / target_case['source']).read_text()
    lines = source_text.splitlines(keepends=True)
    length = 1
    first_line = ''.join(lines[:length])
    while source_text.count(first_line) != 1:
        length += 1
        first_line = ''.join(lines[:length])
    case('harmless survivor: ' + target_case['test'], target_case['source'], first_line,
         '// Harmless semantic-preservation control.\n' + first_line,
         target_case['suite'], target_case['test'], True)
    seen_survivors.add(pair)

# Every result needs actual selected assertions, not a runner/import error.
def outcome(report, code, selected, survives):
    assertions = [a for t in report.get('testResults', []) for a in t.get('assertionResults', []) if a.get('status') != 'pending']
    failures = [a for a in assertions if a.get('status') == 'failed']
    if survives:
        return code == 0 and any(a.get('status') == 'passed' and selected in a.get('fullName', '') for a in assertions) and not failures
    return code != 0 and any(selected in a.get('fullName', '') and any('AssertionError' in message or 'expected ' in message or 'instead of rejecting' in message for message in a.get('failureMessages', [])) for a in failures)

if __name__ == '__main__':
    campaign = sys.argv[1] if len(sys.argv) > 1 else 'controls-01'
    target = OUT / campaign
    target.mkdir(exist_ok=False)
    files = {APP / c['source'] for c in CASES}
    original = {p: p.read_bytes() for p in files}
    results = []
    # An import failure, skipped selection or wrong named test cannot be a kill/survivor.
    oracle_controls = {
        'runner_error_rejected': not outcome({}, 1, 'target', False),
        'empty_selection_rejected': not outcome({'testResults': []}, 0, 'target', True),
        'wrong_test_rejected': not outcome({'testResults': [{'assertionResults': [{'status': 'failed', 'fullName': 'other', 'failureMessages': ['AssertionError: expected true to be false']}]}]}, 1, 'target', False),
    }
    assert all(oracle_controls.values())
    (target / 'oracle-controls.json').write_text(json.dumps(oracle_controls, indent=2) + '\n')
    try:
        for index, c in enumerate(CASES):
            path = APP / c['source']; before = path.read_text()
            if before.count(c['before']) != 1: raise RuntimeError(f"Ambiguous anchor: {c['label']} count={before.count(c['before'])}")
            log = target / f'{index:02d}.log'; receipt = target / f'{index:02d}.json'
            try:
                path.write_text(before.replace(c['before'], c['after'], 1))
                run = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', '--config', str(OUT / 'vitest.config.mts'), 'src/test/' + c['suite'], '-t', c['test'], '--reporter=json', '--outputFile=' + str(receipt)], cwd=APP, capture_output=True, text=True)
                log.write_text(run.stdout + run.stderr)
                report = json.loads(receipt.read_text()) if receipt.exists() else {}
                valid = outcome(report, run.returncode, c['test'], c['survives'])
                result = {key: c[key] for key in ['label', 'source', 'suite', 'test', 'survives']}
                result.update(exitCode=run.returncode, expectedObserved=valid,
                    failures=[dict(name=a['fullName'], messages=a.get('failureMessages')) for t in report.get('testResults', []) for a in t.get('assertionResults', []) if a.get('status') == 'failed'])
                results.append(result)
                (target / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
                print(c['label'] + ': ' + ('SURVIVED' if c['survives'] else 'ASSERTION FAILED') + (' as expected' if valid else ' UNEXPECTED'), flush=True)
                if not valid: raise RuntimeError('Unexpected mutation outcome ' + c['label'])
            finally: path.write_bytes(original[path])
    finally:
        assert all(p.read_bytes() == data for p, data in original.items()), 'Source restoration failed'
        (target / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(ROOT)): hashlib.sha256(data).hexdigest() for p, data in original.items()}, indent=2) + '\n')
