"""Targeted source probes. Commands and sockets are mocked before subject calls."""
from contextlib import ExitStack
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
OUT = Path('/home/nathaniel/.local/state/openplan/rest-uri-recovery-independent-20261015')
sys.path.insert(0, str(ROOT))
import rest_uri_recovery_01_launcher as l
import rest_uri_recovery_01_controller as c

ROWS = []


def blocked(*args, **kwargs):
    raise AssertionError('unexpected-command-or-socket')


def replacement(module, name, before, after):
    source = Path(module.__file__).read_text()
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == name)
    body = ast.get_source_segment(source, node)
    assert body.count(before) == 1
    namespace = {}
    exec(compile(body.replace(before, after), '<independent-private-function-copy>', 'exec'), module.__dict__, namespace)
    return namespace[name]


def stage_trial(label, fault=False, lost=False):
    directory = OUT / label
    directory.mkdir(mode=0o700)
    receipt = l.read('service-receipts-private.json')['rest']
    calls = []
    argv = ['docker', 'stop', '--time', '10', c.OLD_ID]
    def runner(args, **kwargs):
        assert args == argv
        assert (directory / 'stop-intent-private.json').is_file()
        calls.append(args)
        if lost:
            raise RuntimeError('independent-lost-ack')
        return b'ack'
    with ExitStack() as stack:
        stack.enter_context(patch.object(l, 'RECOVERY', directory))
        stack.enter_context(patch.object(l, 'run', runner))
        if fault:
            stack.enter_context(patch.object(l, 'write', replacement(l, 'write', "path.open('x')", "path.open('w')")))
        try:
            c.mutate('stop', argv, receipt)
        except RuntimeError as error:
            assert lost and str(error) == 'independent-lost-ack'
        assert len(calls) == 1
        try:
            c.mutate('stop', argv, receipt)
        except FileExistsError:
            pass
        except RuntimeError as error:
            assert lost and str(error) == 'independent-lost-ack'
        if len(calls) != 1:
            raise AssertionError('stage-intent-allowed-second-command')
        assert not lost or not (directory / 'stop-ack-private.json').exists()
    ROWS.append({'case': label, 'outcome': 'survived', 'commandCount': len(calls)})


def exclusive_campaign():
    saved = l.write
    # First establish a harmless source mutation can survive this same subject.
    harmless = replacement(l, 'write', 'path=RECOVERY/name', '# Independent harmless comment.\n    path=RECOVERY/name')
    try:
        with patch.object(l, 'write', harmless):
            stage_trial('exclusive-harmless')
        for lost in [False, True]:
            stage_trial('exclusive-baseline-' + str(lost), lost=lost)
            label = 'exclusive-overwrite-' + str(lost)
            try:
                stage_trial(label, fault=True, lost=lost)
            except AssertionError as error:
                assert str(error) == 'stage-intent-allowed-second-command'
                ROWS.append({'case': label, 'outcome': 'killed', 'reason': str(error)})
            else:
                raise AssertionError('exclusive-overwrite-fault-survived')
            stage_trial('exclusive-restored-' + str(lost), lost=lost)
    finally:
        assert l.write is saved


def consumer_boundaries():
    # Read the real fixed files and keep the real environment filter.
    env = l.clean_env(l.read('app-env-private.json'), 6144)
    assert env.get('HOME') == os.environ.get('HOME')
    assert 'npm_config_cache' not in env and 'NPM_CONFIG_CACHE' not in env
    launcher = Path(l.__file__).read_text()
    functions = {n.name: ast.get_source_segment(launcher, n) for n in ast.parse(launcher).body if isinstance(n, ast.FunctionDef)}
    assert "subprocess.run(['npm','run','build']" in functions['build']
    assert "os.execve('/usr/bin/npm'" in functions['start']
    assert 'bwrap' not in launcher and 'ro-bind' not in launcher
    recipe = (Path(__file__).parent.parent / '2026-10-15-final-preview-rest-uri-recovery/README.md').read_text()
    assert 'bwrap' not in recipe and 'ReadOnlyPaths' not in recipe
    dep = l.APP / 'node_modules'
    assert dep.is_symlink()
    ROWS.append({'case': 'actual-build-start-recipe-boundary', 'outcome': 'observed-gap',
                 'bareNpmBuildAndExec': True, 'dependencySymlink': True,
                 'privateNpmCacheInChildEnvironment': False, 'readOnlyDependencyMountInRecipe': False})


def uri_campaign():
    original = l.read('envs-private.json')
    active = l.read('rest-uri-recovery-01/envs-v1-private.json')
    l.pinned_files()
    saved = l.p.native_rest_uri
    def campaign(prefix):
        fixed = active['rest']['PGRST_DB_URI']
        l.p.native_rest_uri(fixed)
        l.p.native_rest_uri(fixed.replace('%3D', '%3d').replace('%2C', '%2c'))
        for suffix, value in [('literal-plus', original['rest']['PGRST_DB_URI']),
                              ('encoded-plus', fixed.replace('%20', '%2B')),
                              ('duplicate-option', fixed + '&options=-c%20search_path%3Dpublic%2Cextensions'),
                              ('double-percent-space', fixed.replace('%20', '%2520')),
                              ('malformed', fixed.replace('%20', '%2G'))]:
            try:
                l.p.native_rest_uri(value)
            except ValueError as error:
                assert str(error) in ['native-rest-uri:value', 'native-rest-uri:syntax']
            else:
                raise AssertionError('native-subject-accepted-' + suffix)
        ROWS.append({'case': prefix, 'outcome': 'survived', 'accepted': 2, 'refused': 5})
    try:
        with patch.object(l.p, 'native_rest_uri', replacement(l.p, 'native_rest_uri',
                'query = urlsplit(uri).query', '# Independent harmless comment.\n    query = urlsplit(uri).query')):
            campaign('native-harmless')
        campaign('native-baseline')
        with patch.object(l.p, 'native_rest_uri', replacement(l.p, 'native_rest_uri',
                "unquote(value, errors='strict')", "unquote(value.replace('+', ' '), errors='strict')")):
            try:
                campaign('native-form-regression')
            except AssertionError as error:
                assert str(error) == 'native-subject-accepted-literal-plus'
                ROWS.append({'case': 'native-form-regression', 'outcome': 'killed', 'reason': str(error)})
            else:
                raise AssertionError('native-form-regression-survived')
        campaign('native-restored')
    finally:
        assert l.p.native_rest_uri is saved
        l.pinned_files()


def main():
    os.umask(0o077)
    hashes = {name: l.sha(ROOT / name) for name in ['rest_uri_recovery_01_launcher.py', 'rest_uri_recovery_01_policy.py', 'rest_uri_recovery_01_controller.py']}
    with patch.object(l.subprocess, 'run', blocked), patch.object(l.socket, 'socket', blocked):
        exclusive_campaign()
        uri_campaign()
        consumer_boundaries()
    assert hashes == {name: l.sha(ROOT / name) for name in hashes}
    with (OUT / 'independent-probes.json').open('x') as stream:
        json.dump({'rows': ROWS, 'templateHashes': hashes, 'exactRestoration': True,
                   'blindCategories': ['Mocks cannot establish Docker daemon or durable disk behavior.',
                       'URI parsing is separate from readiness.',
                       'Recipe inspection proves missing enforcement, not an actual dependency write.']}, stream, indent=2)
    print(json.dumps({'observations': len(ROWS), 'killed': sum(x['outcome'] == 'killed' for x in ROWS), 'exactRestoration': True}))


if __name__ == '__main__': main()
