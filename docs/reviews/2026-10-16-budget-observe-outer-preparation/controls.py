#!/usr/bin/python3
"""Four focused NEW source controls. No wrapper or retained collector process runs."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import sys
import types

REAL_RUN_PATH = runpy.run_path
REASONS = {
    'wrapper-exclusive': 'wrapper-one-nb-exclusive-fd9',
    'definitions-only': 'outer-load-definitions-only',
    'bounded-globals': 'outer-parameterization-335-streams',
    'nonzero-terminal': 'outer-nonzero-cannot-report-success',
}


def check(value, reason):
    if not value:
        raise AssertionError(reason)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n')
    path.chmod(0o600)


def wrapper_intent(path):
    text = path.read_text()
    check(text.count('/usr/bin/flock -n -x 9') == 1 and
          text.count('exec 9<>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock') == 1 and
          'exec 9>&-' not in text and
          text.index('/usr/bin/flock -n -x 9') < text.index('/usr/bin/systemd-run') <
          text.index('/usr/bin/systemctl') < text.index('exit "$observe_manager_code"'),
          REASONS['wrapper-exclusive'])
    check('--unit=openplan-budget-settings-v2-observe' in text and
          'RuntimeMaxSec=300' in text and 'MemoryMax=512M' in text and
          'MemorySwapMax=0' in text and 'CPUQuota=50%' in text and 'TasksMax=64' in text and
          '--run observe' in text and 'INVOCATION_ID=' not in text,
          'wrapper-fixed-manager-intent')


def supplied_collect(folder):
    check(ARGV == EXPECT_ARGV, 'outer-fixed-wrapper-argv')
    check(DEADLINE == 335 and BOUNDS == {'stdout':1048576, 'stderr':65536},
          REASONS['bounded-globals'])
    intent = READ(folder/'intent.json')
    check(intent['argv'] == EXPECT_ARGV and intent['deadlineSeconds'] == 335 and
          intent['rootIntentSHA256'] == ROOT_INTENT_SHA and
          type(intent['parentPID']) is int and intent['parentPID'] > 0,
          'outer-durable-intent-before-supplied-process')
    CALLS.append('supplied-wrapper-process-result')
    terminal = {'parentPID': os.getpid(), 'wrapperPID':31337,
        'returncode':REPLY[0], 'failure':REPLY[1],
        'backendDeath':'UNASSESSED', 'classification':'SUPPLIED_INERT_FIXTURE'}
    RECORD(folder/'terminal.json', terminal)
    return terminal


def case(parent, wrapper, root, label, reply=(0, None), bad_intent=False):
    folder = root/label
    folder.mkdir(mode=0o700)
    opaque = folder/'opaque-admission.json'
    write(opaque, {'fixture':True, 'exclusive':False, 'nativeOperationGranted':False})
    subject = REAL_RUN_PATH(str(parent), run_name='inert_new_observe_parent')
    globs = subject['main'].__globals__
    fixed_wrapper = folder/'run-observe-window.sh'
    fixed_wrapper.write_bytes(wrapper.read_bytes())
    fixed_wrapper.chmod(0o600)
    argv = ['/bin/bash', str(fixed_wrapper)]
    globs.update(ROOT=folder, WRAPPER=fixed_wrapper, ARGV=argv,
                 FILES={'fixtureSHA256':opaque}, KNOWN={'fixtureSHA256':sha(opaque)})
    calls = []
    intent_path = folder/'root-observe-outer-intent.json'
    uid = os.getuid()
    intent = {'schema':1, 'purpose':'RECORD_ONE_ROOT_ADMITTED_OBSERVE_NO_AUTHORITY',
        'stage':'observe', 'argv':argv, 'environment':{'PATH':'/usr/bin:/bin',
        'HOME':'/home/nathaniel','LANG':'C.UTF-8','XDG_RUNTIME_DIR':f'/run/user/{uid}',
        'DBUS_SESSION_BUS_ADDRESS':f'unix:path=/run/user/{uid}/bus'},
        'deadlineSeconds':335, 'stdoutLimit':1048576, 'stderrLimit':65536,
        'retry':'FORBIDDEN', 'recorderGrantsNativeAuthority':False,
        'recorderSHA256':globs['RECORDER_SHA'], 'wrapperSHA256':sha(fixed_wrapper),
        'parentSourceSHA256':sha(parent), 'fixtureSHA256':sha(opaque)}
    if bad_intent:
        intent['wrapperSHA256'] = '0'*64
    write(intent_path, intent)

    def forbidden(*args, **kwargs):
        raise AssertionError('old-entry-or-native-contact-forbidden')

    def load(path, *, run_name):
        check(path == str(globs['RECORDER']) and
              run_name == 'openplan_observe_collect_definitions',
              REASONS['definitions-only'])
        namespace = REAL_RUN_PATH(path, run_name=run_name)
        for name in ('main','ready','correlate','source_pins'):
            namespace[name] = forbidden
        supplied = types.FunctionType(supplied_collect.__code__, {
            'check':check, 'REASONS':REASONS, 'EXPECT_ARGV':argv,
            'READ':namespace['read'], 'RECORD':namespace['record'],
            'ROOT_INTENT_SHA':sha(intent_path), 'CALLS':calls, 'REPLY':reply, 'os':os})
        namespace['collect'] = supplied
        return namespace

    globs['runpy'] = types.SimpleNamespace(run_path=load)
    saved_argv = sys.argv[:]
    sys.argv = [str(parent), '--record-once']
    error = None
    try:
        globs['main']()
    except ValueError as exc:
        error = str(exc)
    finally:
        sys.argv = saved_argv
    if bad_intent:
        check(error == 'root-observe-intent:wrapperSHA256' and not calls,
              'outer-intent-pin-refuses-before-process')
    elif reply != (0, None):
        check(error == 'outer-transport-refused', REASONS['nonzero-terminal'])
        check(not (folder/'native-observe-parent/recorder-result.json').exists(),
              'outer-refusal-does-not-publish-result')
    else:
        check(error is None and calls == ['supplied-wrapper-process-result'],
              'outer-zero-supplied-terminal')
        result = json.loads((folder/'native-observe-parent/recorder-result.json').read_bytes())
        check(result['status'] == 'RECORDED_TRANSPORT_ONLY' and
              result['nativeAcceptance'].startswith('UNASSESSED') and
              result['successorGranted'] is False, 'outer-transport-not-native-acceptance')


def baseline(parent, wrapper, root):
    root.mkdir(mode=0o700)
    wrapper_intent(wrapper)
    case(parent, wrapper, root, 'zero')
    case(parent, wrapper, root, 'nonzero', (7, None))
    case(parent, wrapper, root, 'unknown', (None, {'type':'TimeoutError','reason':'supplied'}))
    case(parent, wrapper, root, 'intent-pin', bad_intent=True)


def run(root, source):
    work = root/'work'
    work.mkdir(mode=0o700)
    originals = {name:(source/name).read_bytes() for name in
                 ('parent-recorder.py','run-observe-window.sh')}
    modes = {name:(source/name).stat().st_mode & 0o777 for name in originals}
    for name, data in originals.items():
        (work/name).write_bytes(data)
        (work/name).chmod(modes[name])
    parent, wrapper = work/'parent-recorder.py', work/'run-observe-window.sh'
    mutations = [
      ('wrapper-exclusive', 'run-observe-window.sh',
       '/usr/bin/flock -n -x 9', '/usr/bin/flock -n -s 9'),
      ('definitions-only', 'parent-recorder.py',
       "run_name='openplan_observe_collect_definitions'", "run_name='__main__'"),
      ('bounded-globals', 'parent-recorder.py',
       "globs['DEADLINE'] = 335", "globs['DEADLINE'] = 115"),
      ('nonzero-terminal', 'parent-recorder.py',
       "require(terminal.get('returncode') == 0 and terminal.get('failure') is None,",
       "require(True,")]
    result = {'baseline':None, 'harmless':None, 'mutations':[],
              'restoredBaseline':None, 'suppliedIdentitiesNotNative':True}
    try:
        wrapper.write_bytes(originals['run-observe-window.sh']+b'# harmless source annotation\n')
        baseline(parent, wrapper, root/'harmless')
        result['harmless'] = 'SURVIVED'
        wrapper.write_bytes(originals['run-observe-window.sh'])
        baseline(parent, wrapper, root/'baseline')
        result['baseline'] = 'PASS'
        for name, filename, old, new in mutations:
            path = work/filename
            data = originals[filename].decode()
            check(data.count(old) == 1, 'unique-new-source-fault:'+name)
            path.write_text(data.replace(old, new, 1))
            path.chmod(modes[filename])
            try:
                baseline(parent, wrapper, root/('fault-'+name))
            except AssertionError as exc:
                check(str(exc) == REASONS[name], 'unexpected-new-control-reason:'+name+':'+str(exc))
                result['mutations'].append({'name':name,'reason':str(exc),'outcome':'KILLED'})
            else:
                raise AssertionError('new-source-fault-survived:'+name)
            finally:
                path.write_bytes(originals[filename])
                path.chmod(modes[filename])
        baseline(parent, wrapper, root/'restored-baseline')
        result['restoredBaseline'] = 'PASS'
    finally:
        for name, data in originals.items():
            (work/name).write_bytes(data)
            (work/name).chmod(modes[name])
        result['exactRestoration'] = all((work/name).read_bytes() == data and
            (work/name).stat().st_mode & 0o777 == modes[name] for name, data in originals.items())
        result['sourceExact'] = all((source/name).read_bytes() == data and
            (source/name).stat().st_mode & 0o777 == modes[name] for name, data in originals.items())
        write(root/'controls.json', result)
    check(result['exactRestoration'] and result['sourceExact'], 'new-source-restoration')
    return result
