"""Challenge private product guards and restore every source edit in finally."""
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
    names = re.findall(r'^'+marker+r' ([^ ]+) \(test_runtime_products.Checks\.', output, re.MULTILINE)
    return (code == 1 and names and set(names) == {test}
        and diagnostic in output and not re.search(r'^'+other, output, re.MULTILINE)
        and re.search(r'FAILED \('+kind+r'=\d+\)\s*$', output) is not None)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo/'workers/odm_worker/runtime_products.py'
    source = repo/'workers/odm_worker/retained_source.py'
    originals = {path: path.read_bytes() for path in [module, source]}
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

    replace('early-access-omitted', '        self.intake._access(request_id, deadline)\n        pack =',
        '        pack =', 'test_exact_original_products_and_absence_grant_no_delivery',
        'Current access must bracket private materialization')
    replace('saved-object-replaced', '        expected = {key: row[key] for key in (\'bytes\', \'sha256\')}\n',
        '        expected = {key: row[key] for key in (\'bytes\', \'sha256\')}\n        if target.exists(): target.unlink()\n',
        'test_replay_preserves_files_without_another_external_get', 'Product recovery cannot replace original objects')
    remove('saved-hash-ignored', 'Saved original product bytes differ', 'test_changed_saved_product_refuses_without_overwriting_it')
    replace('original-plan-not-compared', "            publish(pack, 'plan.json', json_bytes(plan))",
        "            if not (pack/'plan.json').exists(): publish(pack, 'plan.json', json_bytes(plan))",
        'test_original_plan_change_refuses', 'ValueError not raised')
    replace('required-member-ignored', '                if required:', '                if False:',
        'test_missing_required_orthomosaic_refuses_before_product_plan', 'ValueError not raised')
    remove('empty-member-ignored', 'Original product member must be a nonempty regular file',
        'test_empty_selected_member_refuses')
    replace('interruption-ignores-known-copy', "            temporary = objects/('.'+filename+'.partial')",
        "            temporary = objects/('.'+filename+'.alternate-partial')",
        'test_mid_copy_interruption_recovers_without_another_get', 'InterruptedError not raised')
    replace('publication-alias-not-reconciled', '        self._partial(objects, filename)',
        '        # Deliberately ignore original publication alias.',
        'test_interrupted_publication_alias_recovers', 'Source file must be private and owned without aliases', kind='errors')
    remove('unknown-object-ignored', 'Private product object inventory differs', 'test_unknown_object_refuses')
    replace('file-alias-ignored', ' or info.st_nlink != 1', '', 'test_aliased_product_refuses',
        'ValueError not raised', source)
    remove('missing-plan-inferred', 'Private products have no original plan', 'test_lost_plan_refuses')
    replace('final-access-omitted', '            self.intake._access(request_id, deadline)\n            receipt =',
        '            receipt =', 'test_current_access_after_copy_refuses_completion', 'PermissionError not raised')
    replace('copy-cancellation-late', '                            self._check(request_id, deadline)\n', '',
        'test_cancellation_precedes_member_writing', 'Cancellation must stop before member bytes are written')
    remove('expanded-size-ignored', 'Original product exceeds its retained member size',
        'test_inflated_member_cannot_exceed_retained_size', 'does not match')
    remove('member-hash-ignored', 'Original product differs from its retained member',
        'test_changed_member_cannot_be_published', 'does not match')
    replace('receipt-not-compared', "            publish(pack, 'receipt.json', json_bytes(receipt))",
        "            if not (pack/'receipt.json').exists(): publish(pack, 'receipt.json', json_bytes(receipt))",
        'test_changed_receipt_refuses', 'ValueError not raised')
    remove('unrelated-alias-deleted', 'Interrupted product publication alias differs',
        'test_unrelated_partial_cannot_be_deleted_as_publication_alias')
    remove('invalid-constructor-accepted', 'Private products require original intake and a finite timeout',
        'test_arguments_require_real_intake_and_finite_positive_timeout')
    remove('disk-shortage-ignored', 'Insufficient free space for remaining original products',
        'test_shortage_refuses_before_any_product_bytes')
    replace('cumulative-space-understated', '            remaining = sum(row[\'bytes\'] for row in rows',
        '            remaining = max(row[\'bytes\'] for row in rows',
        'test_space_check_covers_all_missing_products', 'ValueError not raised')
    replace('completed-products-budgeted-again', "                    and not (objects/row['filename']).exists())",
        '                    )', 'test_resume_budgets_only_missing_products',
        'Insufficient free space for remaining original products', kind='errors')
    replace('completed-replay-needs-new-space', '            if shutil.disk_usage(pack).free < 2*remaining:',
        '            if shutil.disk_usage(pack).free < 2*remaining+1:',
        'test_saved_replay_requires_no_new_product_space',
        'Insufficient free space for remaining original products', kind='errors')
    for key in ['callbackPermission', 'publicationPermission']:
        replace(key+'-promoted', "'"+key+"': False", "'"+key+"': True",
            'test_exact_original_products_and_absence_grant_no_delivery',
            'Private products cannot authorize '+('callbacks' if key == 'callbackPermission' else 'publication'))
    for key in ['processingQualityVerification', 'requestedDeliverableCompletenessVerification', 'archiveTaskProvenanceVerification']:
        replace(key+'-promoted', "'"+key+"': 'unassessed'", "'"+key+"': 'verified'",
            'test_exact_original_products_and_absence_grant_no_delivery', 'Private products cannot promote '+key)
    tests = repo/'workers/odm_worker/test_runtime_products.py'
    census = {node.name for node in ast.walk(ast.parse(tests.read_bytes()))
        if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    if {case[3] for case in cases} != census:
        raise ValueError('Every changed product test requires an intended fault')

    def execute(label, test=None):
        p = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v',
            'test_runtime_products'+('.Checks.'+test if test else '')], cwd=module.parent,
            capture_output=True, text=True, timeout=90,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'-private.log')).write_text(output)
        return p.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0 and 'Ran 22 tests' in output and output.rstrip().endswith('OK'), label
        controls.append({'case': label, 'outcome': 'survived', 'tests': 22})

    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n# Harmless private product recovery comment.\n')
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
