"""Prove every preflight predicate against changed observations and omitted guards."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile

import preflight_scope as scope

SOURCE = Path(scope.__file__)


def fixture():
    helpers = {path: 'a' * 64 for path in scope.HELPERS}
    return {
        'head': scope.HEAD, 'sourceEdits': False,
        'pointPath': str(scope.POINT), 'outputPath': str(scope.OUT),
        'sourceProject': scope.SOURCE_PROJECT, 'targetProject': scope.TARGET_PROJECT,
        'sourceVolume': scope.SOURCE_VOLUME, 'targetVolume': scope.TARGET_VOLUME,
        'existingContainers': [], 'existingVolumes': [], 'toolSha256': scope.TOOL_SHA,
        'imageId': scope.IMAGE,
        'retainedPoint': {'state': 'passed-native-source-point', 'snapshotId': scope.SNAPSHOT,
                          'sourceHead': '9446f76af65106897eb8a693c5aff9817de5de7f',
                          'capturedFiles': 1549, 'capturedBytes': 644725324},
        'helperHashes': helpers, 'scopeSha256': 'a' * 64, 'controlsScopeSha256': 'a' * 64,
        'databaseMemoryBytes': 1024 ** 3,
        'databaseSwapBytes': 1024 ** 3, 'driverMemoryBytes': 1024 ** 3,
        'driverSwapBytes': 0, 'restMemoryBytes': 128 * 1024 ** 2,
        'cpuQuotaPercent': 100, 'freeDiskBytes': 12 * 1024 ** 3,
        'availableMemoryBytes': 5 * 1024 ** 3,
    }, helpers


CASES = [
    ('head', 'foreign', 'model-point-source-build'),
    ('sourceEdits', True, 'model-point-source-build'),
    ('pointPath', '/foreign', 'model-point-private-roots'),
    ('outputPath', '/foreign', 'model-point-private-roots'),
    ('sourceProject', 'foreign', 'model-point-projects'),
    ('targetProject', 'foreign', 'model-point-projects'),
    ('sourceVolume', 'foreign', 'model-point-volumes'),
    ('targetVolume', 'foreign', 'model-point-volumes'),
    ('existingContainers', ['foreign'], 'model-point-existing-resources'),
    ('existingVolumes', ['foreign'], 'model-point-existing-resources'),
    ('toolSha256', '0' * 64, 'model-point-backup-tool'),
    ('imageId', 'foreign', 'model-point-cached-image'),
    ('retainedPoint.state', 'failed', 'model-point-retained-input'),
    ('retainedPoint.snapshotId', 'foreign', 'model-point-retained-input'),
    ('retainedPoint.sourceHead', 'foreign', 'model-point-retained-input'),
    ('retainedPoint.capturedFiles', 1540, 'model-point-retained-input'),
    ('retainedPoint.capturedBytes', 644693865, 'model-point-retained-input'),
    ('helperHashes', {}, 'model-point-helper-identity'),
    ('controlsScopeSha256', 'b' * 64, 'model-point-control-source'),
    ('databaseMemoryBytes', 0, 'model-point-resource-caps'),
    ('databaseSwapBytes', -1, 'model-point-resource-caps'),
    ('driverMemoryBytes', 0, 'model-point-resource-caps'),
    ('driverSwapBytes', -1, 'model-point-resource-caps'),
    ('restMemoryBytes', 0, 'model-point-resource-caps'),
    ('cpuQuotaPercent', 200, 'model-point-resource-caps'),
    ('freeDiskBytes', 10 * 1024 ** 3 - 1, 'model-point-resource-headroom'),
    ('availableMemoryBytes', 4 * 1024 ** 3 - 1, 'model-point-resource-headroom'),
]


def changed(field, value):
    observed, helpers = fixture()
    target = observed
    parts = field.split('.')
    for part in parts[:-1]:
        target = target[part]
    target[parts[-1]] = copy.deepcopy(value)
    return observed, helpers


def require_refusal(verify, observed, helpers, reason):
    try:
        verify(observed, helpers)
    except ValueError as error:
        if str(error) == reason:
            return
        raise AssertionError('Wrong refusal: ' + str(error)) from error
    raise AssertionError('Missing refusal: ' + reason)


def run(out):
    original = SOURCE.read_bytes()
    records = []
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='scope-control-', dir=out) as root:
        copied = Path(root) / 'preflight_scope.py'
        def load(text):
            copied.write_text(text)
            namespace = {'__file__': str(copied)}
            exec(compile(text, str(copied), 'exec'), namespace)
            return namespace['verify']
        try:
            verify = load(original.decode())
            for name, text in [('baseline', original.decode()),
                               ('harmless-comment', original.decode() + '\n# Fixture metadata is advisory.\n'),
                               ('harmless-serialization', original.decode()),
                               ('restored', original.decode())]:
                observed, helpers = fixture()
                if name == 'harmless-serialization':
                    observed = json.loads(json.dumps(observed, sort_keys=True, indent=4))
                    observed['operatorNote'] = 'synthetic'
                load(text)(observed, helpers)
                records.append({'case': name, 'accepted': True})
            for field, value, reason in CASES:
                require_refusal(verify, *changed(field, value), reason)
                records.append({'case': field, 'refusedBy': reason})
            observed, helpers = fixture()
            helpers = {**helpers, 'foreign': 'a' * 64}
            observed['helperHashes'] = helpers
            require_refusal(verify, observed, helpers, 'model-point-helper-identity')
            records.append({'case': 'foreign-expected-helper', 'refusedBy': 'model-point-helper-identity'})
            tree = ast.parse(original.decode())
            function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'verify')
            guards = [node for node in function.body if isinstance(node, ast.If)]
            for index, guard in enumerate(guards):
                reason = guard.body[0].exc.args[0].value
                field, value, _ = next(row for row in CASES if row[2] == reason)
                mutated = copy.deepcopy(tree)
                fn = next(node for node in mutated.body if isinstance(node, ast.FunctionDef) and node.name == 'verify')
                selected = [node for node in fn.body if isinstance(node, ast.If)][index]
                selected.test = ast.Constant(False)
                text = ast.unparse(ast.fix_missing_locations(mutated))
                mutant = load(text)
                try:
                    require_refusal(mutant, *changed(field, value), reason)
                except AssertionError as error:
                    if str(error) != 'Missing refusal: ' + reason:
                        raise
                    records.append({'case': 'omit-' + reason, 'intendedAssertion': str(error)})
                else:
                    raise AssertionError('Omitted guard survived: ' + reason)
                finally:
                    copied.write_bytes(original)
        finally:
            copied.write_bytes(original)
            if copied.read_bytes() != original or SOURCE.read_bytes() != original:
                raise AssertionError('Preflight source restoration failed')
    result = {'positiveControls': 4, 'badObservations': len(CASES) + 1,
              'omittedGuards': len(guards), 'cases': records,
              'sourceSha256': hashlib.sha256(original).hexdigest(),
              'blindCategory': 'Pure observation predicates only. These controls do not launch resources or prove native resource identity, snapshot completeness, writer fencing or recovery.'}
    (out / 'preflight-controls.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    result = run(Path(sys.argv[1]))
    print(json.dumps({key: result[key] for key in ('positiveControls', 'badObservations', 'omittedGuards')}))
