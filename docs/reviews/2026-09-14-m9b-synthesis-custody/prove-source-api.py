"""Run focused source/API faults, preserve a harmless survivor, and restore owned files."""
from pathlib import Path
import hashlib
import json
import subprocess

review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
server = app / 'src/lib/engagement/synthesis-sources-server.ts'
route = app / 'src/app/api/engagement/campaigns/[campaignId]/synthesis/sources/route.ts'
schema = app / 'src/lib/engagement/synthesis-sources.ts'
originals = {p: p.read_bytes() for p in [server, route, schema]}
tests = ['src/test/engagement-synthesis-sources.test.ts', 'src/test/engagement-synthesis-source-route.test.ts']
cases = [('baseline', None, None, None, []), ('harmless-comment', server, '', '// Harmless source verification comment.\n', [])]

def remove_throw(name, message, expected):
    cases.append((name, server, f'throw new Error("{message}")', f'void "Diagnostic removed: {message}"', expected))
remove_throw('outer-scope', 'Saved synthesis source scope differs', ['receipt from a different workspace'])
remove_throw('source-checksum', 'Saved synthesis source checksum differs', ['changed bytes even when the content would still parse', 'failed or corrupt reads unavailable'])
remove_throw('inner-scope', 'Retained synthesis source scope differs', ['inner workspace', 'campaign owner'])
remove_throw('counts', 'Retained synthesis source counts differ', ['missing counted source', 'campaign total smaller than selection'])
remove_throw('source-duplicates', 'Duplicate retained synthesis source identifiers', ['duplicate source'])
remove_throw('selected-kinds', 'Retained synthesis source selection differs', ['excluded comment kind'])
remove_throw('contribution-scope', 'Retained contribution belongs to another campaign', ['another campaign source'])
remove_throw('unselected-metadata', 'Unselected contact or request metadata in synthesis source', ['unexpected private contact'])
remove_throw('selection-status-dates', 'Retained contribution falls outside selection', ['out-of-scope status', 'out-of-scope date'])
remove_throw('answer-session', 'Retained answer session is missing', ['missing session'])
remove_throw('definition-reference', 'Retained synthesis source definition is missing', ['lost definition'])
remove_throw('definition-integrity', 'Historical definition checksum or scope differs', ['changed historical bytes', 'foreign definition'])
remove_throw('definition-duplicates', 'Duplicate historical definition identifiers', ['duplicate category identities'])
remove_throw('item-category', 'Retained item category falls outside selection', ['unselected category'])
remove_throw('answer-category', 'Retained answer category falls outside historical selection', ['missing selected question'])
cases.extend([
 ('selection-unknown-field', schema, '.strict().superRefine(', '.passthrough().superRefine(', ['unknown/duplicate/empty selection']),
 ('selection-uniqueness', schema, 'context.addIssue({ code: "custom", message: "Selection values must be unique." });', 'void selection;', ['unknown/duplicate/empty selection']),
 ('selection-empty-kinds', schema, 'context.addIssue({ code: "custom", message: "Select comments or survey responses." });', 'void selection;', ['unknown/duplicate/empty selection']),
 ('selection-date-order', schema, 'context.addIssue({ code: "custom", message: "End must follow start." });', 'void selection;', ['unknown/duplicate/empty selection']),
 ('agent-write-refusal', route, '.some(key => request.headers.has(key))', '.some(() => false)', ['unsupported agent write header']),
 ('browser-origin', route, 'requireProviderBrowserOrigin(request);', 'void request;', ['real origin guard']),
 ('request-size', route, 'readBytesWithLimitStreaming(request, 65_536)', 'readBytesWithLimitStreaming(request, 96_000)', ['bounds the selection request']),
 ('receipt-scope', route, 'throw new Error("Source receipt scope differs")', 'void "Diagnostic removed receipt scope"', ['missing or foreign receipt']),
 ('private-cache', route, '"Cache-Control": "private, no-store"', '"Cache-Control": "public, max-age=60"', ['new retained source and an exact replay', 'reads and verifies saved source bytes']),
 ('rpc-request-id', server, 'p_request: scope.requestId', 'p_request: scope.campaignId', ['loads through the scoped RPC', 'reads and verifies saved source bytes']),
])
results = []
try:
    for name, path, old, replacement, expected in cases:
        for file, raw in originals.items(): file.write_bytes(raw)
        if path:
            source = originals[path].decode()
            if old and source.count(old) != 1: raise RuntimeError(f'Missing/ambiguous mutation {name}')
            path.write_text(replacement + source if not old else source.replace(old, replacement))
        run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', *tests, '--reporter=json'], cwd=app, text=True, capture_output=True, timeout=60)
        payload = json.loads(run.stdout[run.stdout.index('{'):])
        failed = [a['fullName'] for f in payload['testResults'] for a in f['assertionResults'] if a['status']=='failed']
        ok = payload['numTotalTests'] == 47 and payload['numPendingTests'] == 0 and (run.returncode == 0 and not failed if not expected else run.returncode == 1 and all(any(e in f for f in failed) for e in expected))
        record = {'case':name,'exitCode':run.returncode,'passed':payload['numPassedTests'],'failed':failed,'expectedOutcome':ok}
        results.append(record); print(json.dumps(record),flush=True)
        if not ok:
            print(run.stdout,run.stderr)
            raise RuntimeError('Unexpected source/API mutation outcome')
finally:
    for file, raw in originals.items(): file.write_bytes(raw)
for file, raw in originals.items():
    if file.read_bytes()!=raw: raise RuntimeError('Failed to restore source')
(review/'source-api-mutations.json').write_text(json.dumps({
 'sourcesRestored':True,'cases':results,
 'sourceSha256':{str(p.relative_to(app)):hashlib.sha256(b).hexdigest() for p,b in originals.items()},
 'testSha256':{p:hashlib.sha256((app/p).read_bytes()).hexdigest() for p in tests},
 'limits':'Real route, selection schema, byte verification and browser-origin guard with mocked authentication/database and audit logger. Native database roles/capture are proved separately. This does not prove browser reachability, complete database query coverage by itself, worker recovery, synthesis quality, reviews or exports.'
},indent=2)+'\n')
