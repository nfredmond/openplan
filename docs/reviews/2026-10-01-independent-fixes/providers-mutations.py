"""Mutate only provider-owned files, restore their exact current bytes after each run."""
from pathlib import Path
import json
import subprocess

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
evidence = Path(__file__).parent
financial = ['src/test/financial-agent-payload-binding.test.ts']
native = ['src/test/provider-native-recovery-composition.test.ts', 'src/test/provider-routes.test.ts']
def vitest(files):
    return ([str(app / 'node_modules/.bin/vitest'), 'run', *files], app)
node = (['node', '--test', 'workers/planner_agent_connector/test/connector-worker.test.mjs'], root)
profile = 'openplan/src/app/api/projects/[projectId]/funding-profile/route.ts'
opportunity = 'openplan/src/app/api/funding-opportunities/route.ts'
decision = 'openplan/src/app/api/funding-opportunities/[opportunityId]/route.ts'
invoice = 'openplan/src/app/api/invoicing/invoices/[invoiceId]/route.ts'
route = 'openplan/src/app/api/assistant/providers/native/route.ts'
worker = 'workers/planner_agent_connector/connector-worker.mjs'
registry = 'openplan/src/lib/runtime/action-registry.ts'
paths = [profile, opportunity, decision, invoice, route, worker, registry]
originals = {name: (root / name).read_bytes() for name in paths}
results = []
def run(name, commands, expected_failure=None):
    text = ''; codes = []
    for command, cwd in commands:
        result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
        text += result.stdout; codes.append(result.returncode)
    (evidence / f'providers-mutation-{name}.txt').write_text(text)
    if expected_failure is None:
        assert all(code == 0 for code in codes), (name, codes, text[-3000:])
        outcome = 'survived'
    else:
        assert any(code != 0 for code in codes), (name, 'mutation survived')
        assert expected_failure in text and ('AssertionError' in text or 'connector_request_refused' in text), (name, 'wrong failure', text[-3000:])
        outcome = 'detected'
    results.append({'mutation': name, 'outcome': outcome, 'expectedFailure': expected_failure, 'exitCodes': codes})
def restore():
    for name, value in originals.items(): (root / name).write_bytes(value)
try:
    for name in paths: (root / name).write_bytes(originals[name] + b'\n// Harmless provider review mutation.\n')
    run('noop', [vitest(financial + native), node])
    restore()
    mutations = [
        ('profile-scope', profile, 'if (scopeRefusal) {', 'if (false && scopeRefusal) {', vitest(financial), 'refuses profile extra fields'),
        ('opportunity-scope', opportunity, 'if (scopeRefusal) {', 'if (false && scopeRefusal) {', vitest(financial), 'refuses opportunity extra fields'),
        ('decision-scope', decision, 'if (scopeRefusal) {', 'if (false && scopeRefusal) {', vitest(financial), 'refuses decision extra fields'),
        ('invoice-scope', invoice, 'if (scopeRefusal) {', 'if (false && scopeRefusal) {', vitest(financial), 'refuses invoice extra fields'),
        ('profile-overwrite', profile, ': profiles.insert(upsertPayload);', ': profiles.upsert(upsertPayload, { onConflict: "project_id" });', vitest(financial), 'refuses an existing profile'),
        ('registry-unsigned-default', registry, 'notes: action.notes,', 'notes: action.notes ?? "Unsigned fallback note",', vitest(financial), 'without inventing unsigned fallback notes'),
        ('invoice-unlink', invoice, 'executionSource !== "manual" && !parsed.data.fundingAwardId', 'false && executionSource !== "manual" && !parsed.data.fundingAwardId', vitest(financial), 'refuses agent unlink'),
        ('profile-manual-refusal', profile, '      executionSource,', '      executionSource: "planner_agent_quick_link",', vitest(financial), 'preserves manual profile fields'),
        ('native-output-terminal', route, 'failureCode = "native_invalid_output";', 'throw error;', vitest(native), 'retains invalid native output as a failure'),
        ('native-rejected-envelope', worker, 'if (![400, 409].includes(error.status)) throw error;', 'if (error.status !== 409) throw error;', node, 'a rejected completed result is retained'),
        ('native-attempt-mismatch', worker, 'if (current?.id !== pending.job.id || current?.attemptId !== pending.job.attemptId) throw error;', 'if (false) throw error;', node, 'invalid result recovery never adopts another attempt'),
        ('native-failure-journal', worker, '      await writeConnectorJournal(directory, pending);\n      saved = await request', '      // mutation: no durable failure journal\n      saved = await request', node, 'a rejected completed result is retained'),
        ('native-terminal-ack', worker, '(error.status === 400 && ["succeeded", "failed"].includes(current?.state))', 'false', node, 'a rejected result acknowledges only its already-terminal attempt'),
        ('native-connection-mismatch', worker, 'pending.connectionId !== config.setup.connectionId || pending.appUrl !== config.setup.appUrl ||', '', node, 'a changed connection cannot recover'),
        ('native-unknown-outcome', worker, 'if (![400, 409].includes(error.status)) throw error;', '// mutation: allow unknown outcomes to reach status reconciliation', node, 'unauthorized, unavailable and unknown delivery outcomes'),
    ]
    for name, path, old, new, command, failure in mutations:
        source = originals[path].decode()
        assert source.count(old) >= 1, (name, 'missing mutation target')
        if name == 'native-unknown-outcome':
            source = source.replace('error.status === 400 && current?.state === "running"', 'current?.state === "running"')
        (root / path).write_text(source.replace(old, new, 1))
        try: run(name, [command], failure)
        finally: restore()
finally:
    restore()
    (evidence / 'providers-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
