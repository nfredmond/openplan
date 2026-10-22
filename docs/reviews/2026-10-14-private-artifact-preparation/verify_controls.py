"""Challenge private artifact preparation guards and restore every source edit in finally."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code, output, test, diagnostic, kind='failures'):
    marker = 'FAIL:' if kind == 'failures' else 'ERROR:'
    other = 'ERROR:' if kind == 'failures' else 'FAIL:'
    names = re.findall(r'^'+marker+r' ([^ ]+) \(test_runtime_artifact_plan.Checks\.', output, re.MULTILINE)
    return (code == 1 and names and set(names) == {test}
        and diagnostic in output and not re.search(r'^'+other, output, re.MULTILINE)
        and re.search(r'FAILED \('+kind+r'=\d+\)\s*$', output) is not None)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo/'workers/odm_worker/runtime_artifact_plan.py'
    originals = {path: path.read_bytes() for path in [module]}
    text = originals[module].decode()
    cases, controls, oracles = [], [], []

    def replace(label, before, after, test, diagnostic, target=module, kind='failures'):
        original = originals[target].decode()
        if original.count(before) != 1:
            raise ValueError(label+' requires one source binding')
        cases.append((label, target, original.replace(before, after), test, diagnostic, kind))

    def remove(label, message, test, diagnostic='ValueError not raised'):
        tree = ast.parse(text)
        found = [node for node in ast.walk(tree) if isinstance(node, ast.If)
            and any(isinstance(child, ast.Raise) and isinstance(child.exc, ast.Call)
                and child.exc.args and isinstance(child.exc.args[0], ast.Constant)
                and child.exc.args[0].value == message for child in node.body)]
        if len(found) != 1:
            raise ValueError(label+' requires one guard binding')
        found[0].test = ast.Constant(False)
        cases.append((label, module, ast.unparse(tree)+'\n', test, diagnostic, 'failures'))

    original_test = 'test_original_scope_and_descriptors_remain_exact'
    replace('original-task-rebound', "'originalTaskUuid': engine['taskUuid']", "'originalTaskUuid': 'other-task'",
        original_test, 'Preparation keeps every original job and actor binding')
    replace('selected-census-truncated', "'artifacts': rows,", "'artifacts': rows[:1],",
        original_test, 'Preparation preserves the selected ordered product census')
    replace('unselected-kinds-erased', "'unselectedContractKinds': [kind for kind in contract.ARTIFACT_KINDS", "'unselectedContractKinds': [kind for kind in ()",
        original_test, 'Unselected contract kinds cannot disappear or become delivered')
    replace('native-reading-promoted', "'nativeInspectionStatus': tags['status']", "'nativeInspectionStatus': 'read'",
        original_test, 'Preparation preserves each native inspection state')
    replace('original-checksum-replaced', "'checksumSha256': row['sha256']", "'checksumSha256': '0'*64",
        original_test, 'Preparation checksums identify actual original bytes')
    replace('original-size-doubled', "'sizeBytes': row['bytes']", "'sizeBytes': 2*row['bytes'] if row['bytes'] else None",
        original_test, 'Preparation sizes identify actual original bytes')
    replace('tiff-mime-replaced', "'orthomosaic': 'image/tiff'", "'orthomosaic': 'image/png'",
        original_test, 'Original file descriptors use their supported content types')
    replace('absent-size-becomes-zero', "'sizeBytes': row['bytes']", "'sizeBytes': row['bytes'] if row['bytes'] else 0",
        original_test, 'Absent products cannot become zero bytes')
    replace('download-url-issued', "'contentType': CONTENT_TYPES[row['kind']],", "'contentType': CONTENT_TYPES[row['kind']], 'downloadUrl': 'https://example.invalid/private',",
        original_test, 'Private preparation issues no bearer URLs')
    replace('native-tags-become-map-placement', "'contentType': CONTENT_TYPES[row['kind']],", "'contentType': CONTENT_TYPES[row['kind']], 'boundsWgs84': [0, 0, 1, 1],",
        original_test, 'Native declarations cannot become map placement')
    for field, value in [('productReceiptSha256', "inspected['receipt']['sourceReceiptSha256']"),
            ('inspectionReceiptSha256', "hashlib.sha256(json_bytes(inspected['receipt'])).hexdigest()"),
            ('inspectionReportSha256', "inspected['receipt']['reportSha256']")]:
        replace(field+'-not-bound', "'"+field+"': "+value, "'"+field+"': '0'*64",
            original_test, 'Preparation binds exact original '+field)
    replace('manifest-hash-replaced', "'manifestSha256': hashlib.sha256(json_bytes(manifest)).hexdigest()", "'manifestSha256': '0'*64",
        original_test, 'Completion binds exact manifest bytes')
    for key, before, after in [
        ('callback', "'callbackPermission': False", "'callbackPermission': True"),
        ('publication', "'publicationPermission': False", "'publicationPermission': True"),
        ('quality', "'processingQualityVerification': 'unassessed'", "'processingQualityVerification': 'verified'"),
        ('completeness', "'requestedDeliverableCompletenessVerification': 'unassessed'", "'requestedDeliverableCompletenessVerification': 'verified'"),
        ('placement', "'mapPlacementVerification': 'unassessed'", "'mapPlacementVerification': 'verified'"),
    ]:
        replace(key+'-promoted', before, after, original_test, 'Preparation cannot promote ')
    replace('replay-overwrites-original-manifest', "            publish(pack, 'manifest.json', json_bytes(manifest))",
        "            if (pack/'manifest.json').exists(): (pack/'manifest.json').rename(root/'old-manifest.json')\n            publish(pack, 'manifest.json', json_bytes(manifest))",
        'test_replay_keeps_original_records_without_fetch_or_parse', 'Preparation replay keeps original record inodes')
    replace('interrupted-preparation-changes-identity', "        intake._access(request_id, deadline)\n        products._check",
        "        manifest['binding']['observationSha256'] = str(time.monotonic())\n        intake._access(request_id, deadline)\n        products._check",
        'test_interrupted_manifest_recovers_original_bytes', 'Existing source custody record differs', kind='errors')
    replace('existing-manifest-not-compared', "            publish(pack, 'manifest.json', json_bytes(manifest))",
        "            if not (pack/'manifest.json').exists(): publish(pack, 'manifest.json', json_bytes(manifest))",
        'test_altered_manifest_refuses_replacement', 'ValueError not raised')
    replace('existing-completion-not-compared', "            publish(pack, 'receipt.json', json_bytes(receipt))",
        "            if not (pack/'receipt.json').exists(): publish(pack, 'receipt.json', json_bytes(receipt))",
        'test_altered_completion_refuses_replacement', 'ValueError not raised')
    remove('missing-manifest-inferred', 'Artifact preparation has no original manifest',
        'test_lost_manifest_cannot_be_inferred_from_completion')
    remove('product-receipt-not-bound', 'Artifact preparation original product receipt differs',
        'test_product_receipt_change_between_inspection_and_preparation_refuses')
    replace('post-inspection-access-omitted', "        intake._access(request_id, deadline)\n        products._check",
        "        products._check", 'test_revoked_actor_after_inspection_refuses_manifest',
        'Current actor access precedes artifact preparation')
    replace('post-manifest-access-omitted', "            intake._access(request_id, deadline)\n            receipt =",
        "            receipt =", 'test_revoked_actor_after_manifest_refuses_completion',
        'PermissionError not raised')
    cases.append(('preparation-cancellation-ignored', module, text.replace('products._check(request_id, deadline)', 'pass'),
        'test_cancellation_after_manifest_refuses_completion', 'InterruptedError not raised', 'failures'))
    remove('unsupported-descriptor-accepted', 'Artifact preparation has no supported original descriptor',
        'test_unsupported_descriptor_refuses')
    remove('invalid-constructor-accepted', 'Artifact preparation requires original inspection and a finite positive timeout',
        'test_constructor_requires_original_inspection_and_finite_timeout')
    tests = repo/'workers/odm_worker/test_runtime_artifact_plan.py'
    census = {node.name for node in ast.walk(ast.parse(tests.read_bytes()))
        if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    if {case[3] for case in cases} != census:
        raise ValueError('Every changed product test requires an intended fault')

    def execute(label, test=None):
        p = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v',
            'test_runtime_artifact_plan'+('.Checks.'+test if test else '')], cwd=module.parent,
            capture_output=True, text=True, timeout=90,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'-private.log')).write_text(output)
        return p.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0 and 'Ran 12 tests' in output and output.rstrip().endswith('OK'), label
        controls.append({'case': label, 'outcome': 'survived', 'tests': 12})

    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n# Harmless private artifact preparation recovery comment.\n')
        positive('harmless-comment')
        module.write_bytes(originals[module])
        positive('restored-after-harmless')
        for label, target, changed, test, diagnostic, kind in cases:
            try:
                ast.parse(changed)
                target.write_text(changed)
                code, output = execute(label, test)
                assert intended(code, output, test, diagnostic, kind), label+' misses its intended assertion'
                for variant, c, o, t, d, wanted in [
                    ('exact', code, output, test, diagnostic, True),
                    ('success', 0, output, test, diagnostic, False),
                    ('wrong-test', code, output, 'unrelated_test', diagnostic, False),
                    ('wrong-diagnostic', code, output, test, 'absent expected refusal', False),
                    ('syntax-error', code, 'SyntaxError', test, diagnostic, False),
                    ('unrelated-error', code, output+'\nERROR: unrelated\nFAIL: unrelated\n', test, diagnostic, False),
                    ('no-failure', code, 'Ran 1 test\nOK', test, diagnostic, False),
                    ('wrong-exit', 2, output, test, diagnostic, False),
                ]:
                    actual = bool(intended(c, o, t, d, kind))
                    assert actual == wanted, label+' oracle '+variant
                    oracles.append({'case': label, 'oracle': variant, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure', 'test': test, 'diagnostic': diagnostic})
            finally:
                for path, payload in originals.items():
                    path.write_bytes(payload)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'bindings.json').write_text(json.dumps({str(path.relative_to(repo)):
            hashlib.sha256(payload).hexdigest() for path, payload in originals.items()}, indent=2)+'\n')
        group = Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({key: (group/key).read_text().strip() for key in ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.swap.peak', 'memory.events']}, indent=2)+'\n')
        print(json.dumps({'positive': 4, 'faults': len(cases), 'oracles': len(oracles)}), flush=True)
    finally:
        for path, payload in originals.items():
            path.write_bytes(payload)
            assert path.read_bytes() == payload


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
