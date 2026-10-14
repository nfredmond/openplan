"""Challenge private raster inspection guards and restore every source edit in finally."""
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
    names = re.findall(r'^'+marker+r' ([^ ]+) \(test_runtime_georef.Checks\.', output, re.MULTILINE)
    return (code == 1 and names and set(names) == {test}
        and diagnostic in output and not re.search(r'^'+other, output, re.MULTILINE)
        and re.search(r'FAILED \('+kind+r'=\d+\)\s*$', output) is not None)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo/'workers/odm_worker/runtime_georef.py'
    source = repo/'workers/odm_worker/georef.py'
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

    replace('missing-product-reported-as-failed', "'status': 'unavailable', 'reason': row['reason']", "'status': 'failed', 'reason': row['reason']",
        'test_original_readable_failed_absent_and_unassessed_remain_distinct', 'Frozen absent raster declaration differs', kind='errors')
    replace('rotated-vector-doubled', 'pixel_size = (math.hypot(a, e), math.hypot(b, f))',
        'pixel_size = (2*math.hypot(a, e), 2*math.hypot(b, f))',
        'test_rotated_spacing_uses_original_raster_vectors', 'Recovered inspection uses both nonzero quarter-turn vectors', source)
    replace('unsupported-format-labelled-failed', "status='unsupported' if unsupported else 'failed'", "status='failed'",
        'test_unsupported_bigtiff_keeps_bytes_without_zero_metadata', 'BigTIFF is explicitly unsupported by this reader')
    reparse = "                self._inspect(root/'private-products/objects', products['products'][0], request_id, deadline)\n                plan = read_json(pack, 'plan.json')"
    for label, test, diagnostic in [
        ('saved-report-reparsed', 'test_saved_report_replay_does_not_parse_again', 'Frozen inspection cannot parse again'),
        ('interrupted-report-recomputed', 'test_report_publication_interruption_recovers_frozen_interpretation', 'Interrupted interpretation cannot be recomputed'),
    ]:
        replace(label, "                plan = read_json(pack, 'plan.json')", reparse, test, diagnostic)
    remove('raster-content-hash-ignored', 'Inspected original raster bytes differ', 'test_changed_raster_during_inspection_refuses')
    replace('post-read-access-omitted', '                intake._access(request_id, deadline)\n                plan =',
        '                plan =', 'test_current_access_after_reading_refuses_plan', 'Current access must precede interpretation freezing')
    replace('saved-report-not-compared', "            publish(pack, 'report.json', plan['reportText'].encode())",
        "            if not (pack/'report.json').exists(): publish(pack, 'report.json', plan['reportText'].encode())",
        'test_changed_saved_report_refuses_without_replacing_it', 'ValueError not raised')
    remove('original-product-plan-not-compared', 'Raster inspection original plan differs', 'test_original_product_plan_change_refuses')
    remove('missing-plan-inferred', 'Raster inspection has no original plan', 'test_lost_original_plan_refuses')
    remove('frozen-claim-limits-ignored', 'Frozen raster inspection identity or claim limits differ', 'test_claim_promotion_refuses')
    remove('frozen-code-profile-ignored', 'Frozen raster inspection identity or claim limits differ',
        'test_invalid_reader_or_inspection_profile_refuses')
    remove('product-census-ignored', 'Frozen raster inspection product census differs', 'test_altered_product_census_refuses')
    remove('original-member-binding-ignored', 'Frozen raster inspection original product differs', 'test_altered_original_member_binding_refuses')
    remove('absence-promoted', 'Frozen absent raster declaration differs', 'test_absence_cannot_be_reported_as_read')
    remove('cloud-reading-promoted', 'Frozen point cloud assessment differs', 'test_point_cloud_cannot_gain_a_raster_reader_result')
    assert text.count("'declared_native_coordinates'") == 2
    cases.append(('native-units-relabelled', module, text.replace("'declared_native_coordinates'", "'metres'"),
        'test_native_coordinates_cannot_be_relabelled_as_metres', 'ValueError not raised', 'failures'))
    remove('failed-read-keeps-coordinates', 'Frozen unsuccessful raster reading differs', 'test_failed_read_cannot_keep_native_coordinate_values')
    remove('invalid-native-dimensions-accepted', 'Native raster dimensions and CRS code must be positive integers',
        'test_nonfinite_and_degenerate_native_values_are_failed_reads')
    remove('invalid-native-vectors-accepted', 'Native raster declarations must be finite and nondegenerate',
        'test_nonfinite_and_degenerate_native_values_are_failed_reads')
    remove('invalid-constructor-accepted', 'Raster inspection requires private products and a finite positive timeout',
        'test_constructor_requires_real_products_and_finite_timeout')
    for key, before, after in [
        ('callbackPermission', "'callbackPermission': False", "'callbackPermission': True"),
        ('publicationPermission', "'publicationPermission': False", "'publicationPermission': True"),
        ('processingQualityVerification', "'processingQualityVerification': 'unassessed'", "'processingQualityVerification': 'verified'"),
        ('mapPlacementVerification', "'mapPlacementVerification': 'unassessed'", "'mapPlacementVerification': 'verified'"),
    ]:
        replace(key+'-promoted', before, after,
            'test_original_readable_failed_absent_and_unassessed_remain_distinct',
            'True != False' if 'Permission' in key else "'verified' != 'unassessed'")
    tests = repo/'workers/odm_worker/test_runtime_georef.py'
    census = {node.name for node in ast.walk(ast.parse(tests.read_bytes()))
        if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    if {case[3] for case in cases} != census:
        raise ValueError('Every changed product test requires an intended fault')

    def execute(label, test=None):
        p = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v',
            'test_runtime_georef'+('.Checks.'+test if test else '')], cwd=module.parent,
            capture_output=True, text=True, timeout=90,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'-private.log')).write_text(output)
        return p.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0 and 'Ran 20 tests' in output and output.rstrip().endswith('OK'), label
        controls.append({'case': label, 'outcome': 'survived', 'tests': 20})

    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n# Harmless private raster inspection recovery comment.\n')
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
