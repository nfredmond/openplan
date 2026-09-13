"""Run only in the owned checkout, without browser acceptance or other edits.

Real SDK requests are intercepted in-process. These checks do not prove a live
provider, database claim, worker restart, authorization or publication workflow.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review = Path(__file__).resolve().parent
app = review.parents[2] / "openplan"
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/generation-controls') / time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True, exist_ok=False)
paths = {
    'generation': app / 'src/lib/engagement/translation-generation.ts',
    'credential': app / 'src/lib/integrations/translation-credentials.ts',
    'workspace': app / 'src/lib/integrations/workspace-keys.ts',
    'legacy': app / 'src/lib/engagement/translation.ts',
}
originals = {key: path.read_text() for key, path in paths.items()}
tests = ['src/test/translation-generation.test.ts', 'src/test/translation-generation-credentials.test.ts', 'src/test/engagement-translation.test.ts']
cases = [('baseline', 'generation', originals['generation'], None)]
for key in paths:
    cases.append(('harmless-' + key, key, originals[key] + '\n// Harmless generation custody control.\n', None))
def mutation(name, key, old, new, failure):
    assert originals[key].count(old) == 1, (name, old, originals[key].count(old))
    cases.append((name, key, originals[key].replace(old, new, 1), failure))

g = 'generation'; c = 'credential'; w = 'workspace'
mutation('sdk-retries', g, 'maxRetries: 0', 'maxRetries: 1', 'does not retry a provider 429')
mutation('legacy-sdk-retries', 'legacy', 'maxRetries: 0', 'maxRetries: 1', 'sends the entire valid long source')
mutation('reuse-attempt', g, 'if (consumed) throw', 'if (false && consumed) throw', 'consumes success exactly once')
mutation('expired-dispatch', g, 'leaseRemaining <= 0 || parentSignal.aborted', 'parentSignal.aborted', 'consumes an expired attempt')
mutation('late-lease-completion', g, 'if (Date.now() >= Date.parse(binding.leaseExpiresAt)) throw new TranslationGenerationError("translation_attempt_interrupted");', 'void binding.leaseExpiresAt;', 'refuses completion after the durable lease deadline')
mutation('trim-source', g, '${packet.sourceText}', '${packet.sourceText.trim()}', 'uses the exact captured source')
mutation('trim-output', g, 'const output = generation.text;', 'const output = generation.text.trim();', 'uses the exact captured source')
mutation('complete-truncated', g, 'generation.finishReason === "stop" && ', '', 'retains incomplete output and usage')
mutation('publish-empty', g, 'output.trim().length > 0 &&', 'true &&', 'keeps unpublishable words')
mutation('publish-oversize', g, '[...output].length <= 8000 &&', 'true &&', 'keeps unpublishable words')
mutation('publish-nul', g, '!output.includes("\\0")', 'true', 'keeps unpublishable words')
mutation('publish-unpaired', g, 'output.isWellFormed() &&', 'true &&', 'keeps unpublishable words')
mutation('wrong-output-unit', g, '[...output].length <= 8000', 'output.length <= 8000', 'counts supplementary characters')
mutation('unknown-usage-zero', g, ' ? raw : null;', ' ? raw : 0;', 'preserves invalid token counts')
mutation('wrong-source-hash', g, 'sourceHash: sha256(packet.sourceText)', 'sourceHash: sha256(output)', 'uses the exact captured source')
mutation('wrong-output-hash', g, 'outputHash: sha256(output)', 'outputHash: sha256(packet.sourceText)', 'uses the exact captured source')
mutation('ambient-payer', g, 'createAnthropic({ apiKey })', 'createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })', 'uses the exact captured source')
mutation('caller-binding-mutation', g, 'binding = bindingSchema.parse(args.binding);', 'bindingSchema.parse(args.binding); binding = args.binding;', 'does not use changed caller objects')
mutation('caller-credential-mutation', g, 'credential = translationCredentialSchema.parse(args.credential);', 'translationCredentialSchema.parse(args.credential); credential = args.credential;', 'does not use changed caller objects')
mutation('changed-packet', g, 'sha256(args.packetCanonical) !== binding.packetHash', 'false', 'refuses source without spending')
mutation('noncanonical-packet', g, 'JSON.stringify(packet) !== args.packetCanonical', 'false', 'refuses noncanonical without spending')
mutation('oversized-source', g, 'Buffer.byteLength(text, "utf8") <= 32000', 'true', 'refuses oversize without spending')
mutation('empty-source', g, 'text.trim().length > 0 &&', 'true &&', 'refuses empty without spending')
mutation('unpaired-source', g, 'text.isWellFormed() &&', 'true &&', 'refuses unpaired_source without spending')
mutation('unavailable-language', g, '.refine(supportsMachineTranslation)', '', 'refuses unavailable_language without spending')
for field in ('requestId', 'credentialId', 'configurationHash'):
    mutation('binding-' + field, g, f'credential.{field} !== binding.{field}', 'false', f'refuses changed binding {field}')
for field in ('campaignId', 'fieldId'):
    mutation('binding-' + field, g, f'packet.{field} !== binding.{field}', 'false', f'refuses changed binding {field}')
# Both independently captured resources must agree with the workspace in the receipt.
body = originals[g].replace('credential.workspaceId !== binding.workspaceId', 'false').replace('packet.workspaceId !== binding.workspaceId', 'false')
cases.append(('binding-workspaceId', g, body, 'refuses changed binding workspaceId'))
for field in ('workspaceId', 'requestId', 'credentialId', 'source'):
    mutation('envelope-' + field, c, f'value.{field} !== stored.{field}', 'false', f'refuses replaced {field} without fallback')
mutation('envelope-recipe', c, 'value.configurationHash !== stored.configurationHash', 'false', 'refuses a replaced recipe even when')
mutation('configuration-hash', c, 'if (configurationHash(stored.configuration) !== stored.configurationHash) throw new Error();', 'void stored.configuration;', 'refuses replaced configuration without fallback')
mutation('plaintext-storage', c, 'apiKey: key.parse(args.apiKey)', 'apiKey: key.parse(args.apiKey)', None)  # Deliberate exact no-op, must survive.
mutation('query-projection', w, '.select("workspace_id, provider, key_ciphertext")', '.select("provider, key_ciphertext")', 'asserts the complete query projection')
mutation('ignore-read-error', w, 'if (error || !Array.isArray(data) || data.length > 1)', 'if (!Array.isArray(data) || data.length > 1)', 'refuses error rather than changing the payer')
mutation('allow-duplicate-selection', w, 'data.length > 1', 'false', 'refuses duplicate rather than changing the payer')
mutation('wrong-workspace-row', w, 'row.workspace_id !== workspaceId ||', 'false ||', 'refuses wrong_workspace rather than changing the payer')
mutation('wrong-provider-row', w, 'row.provider !== "anthropic" ||', 'false ||', 'refuses wrong_provider rather than changing the payer')
mutation('decrypt-fallback', w, 'apiKey = decryptIntegrationKey(row.key_ciphertext);', 'apiKey = decryptIntegrationKey(row.key_ciphertext) || process.env.ANTHROPIC_API_KEY || null;', 'refuses undecryptable rather than changing the payer')
mutation('capture-request-too-late', w, 'credential: prepareTranslationCredential({ workspaceId, requestId, credentialId, modelId,', 'credential: prepareTranslationCredential({ workspaceId, requestId: args.requestId, credentialId, modelId: args.modelId,', 'captures request identity before waiting')

results = []
report = review / 'translation-generation-controls.json'
baseline_count = None
try:
    for name, key, body, failure in cases:
        path = paths[key]; assert path.read_text() == originals[key]
        output = private / (name + '.json')
        path.write_text(body)
        try:
            command = ['npm', 'exec', '--', 'vitest', 'run', *tests, '--reporter=json', '--outputFile=' + str(output)]
            if failure: command += ['-t', failure]
            run = subprocess.run(command, cwd=app, capture_output=True, text=True, timeout=60)
        finally:
            path.write_text(originals[key])
        (private / (name + '.log')).write_text(run.stdout + run.stderr)
        data = json.loads(output.read_text())
        failed = [a['fullName'] for suite in data['testResults'] for a in suite['assertionResults'] if a['status'] == 'failed']
        if baseline_count is None: baseline_count = data['numPassedTests']; assert baseline_count >= 60
        expected = run.returncode == 0 and data['numPassedTests'] == baseline_count if failure is None else run.returncode != 0 and any(failure in title for title in failed)
        results.append({'case': name, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'expectedFailure': failure, 'failedAssertions': failed, 'expectedOutcome': expected})
        report.write_text(json.dumps({'sourceSha256': {key: hashlib.sha256(value.encode()).hexdigest() for key, value in originals.items()}, 'testCount': baseline_count, 'privateEvidence': str(private), 'results': results,
            'limits': 'Real SDK with intercepted fetch, mocked scoped credential query. Does not establish live provider behavior, database authorization/leases, durable dispatch reservation, restart recovery, UI reachability or publication.'}, indent=2) + '\n')
        print(name, results[-1]['outcome'], 'expected' if expected else 'UNEXPECTED', flush=True)
        assert expected, (name, failed)
finally:
    for key, path in paths.items(): path.write_text(originals[key])
