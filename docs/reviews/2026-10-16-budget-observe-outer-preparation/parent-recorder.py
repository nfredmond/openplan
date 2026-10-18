#!/usr/bin/python3
"""Record one wrapper only. Native authority remains controller.ready."""
import hashlib
import os
from pathlib import Path
import runpy
import sys

ROOT = Path("/home/nathaniel/.local/state/openplan/budget-observe-outer-preparation-20261016")
WRAPPER = ROOT/'run-observe-window.sh'
RECORDER = Path('/home/nathaniel/.local/state/openplan/budget-catalog-outer-transport-20261016/collector.py')
RECORDER_SHA = '05bc862604ebc65bf52ae5f58565cf30f765080d8df5bc14b142ba481d8066cc'
ARGV = ['/bin/bash', str(WRAPPER)]
FILES = {
    "controllerSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/controller.py"),
    "journalSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/journal.py"),
    "policySHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/policy.py"),
    "sqlSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/sql.py"),
    "packageSHA256": Path("/home/nathaniel/.t3/worktrees/openplan/t3-e4106cfb/docs/reviews/2026-10-16-budget-catalog-settings-correction/source-pins.json"),
    "planSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/plan.json"),
    "inputSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/observe-input.json"),
    "catalogSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/capture-attempt/catalog.json"),
    "scopeSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/capture-attempt/original-scope.json"),
    "captureAckSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/capture-attempt/manager-ack.json"),
    "captureCompleteSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/capture-attempt/complete.json"),
    "captureCollectedSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/outer-v2/native-capture-parent/complete.json"),
    "captureManagerTerminalSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/capture-manager-terminal.json"),
    "captureOuterTerminalSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/capture-outer-terminal.json"),
    "captureAcceptanceSHA256": Path("/home/nathaniel/.local/state/openplan/budget-settings-native-capture-root-decision-20261016/acceptance.json"),
    "admissionSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/admissions/observe.json"),
    "reviewSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/reviews/observe.md"),
    "windowSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/windows/observe.json"),
    "publicationSHA256": Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/publications/observe.json")
}
KNOWN = {
    "controllerSHA256": "328b1f84a12925345f95aa6d52996f0b1d980bd7ac84de6571f44d8eb6e6788e",
    "journalSHA256": "18ea275bf28c931979af1ef774ab5e40ec8aca2277308f77695a6c9883905eb6",
    "policySHA256": "87918149e6a20accac0fc5d7be2decbe7a75929c5ca7deb74a1f2caf4b4d2d4c",
    "sqlSHA256": "f9f612ed9f411f4347566b0d0d0d442049e89be0af81882f5014c1e04352df90",
    "packageSHA256": "b9c0e7c418df4a295f44f1374a539e6e33dbd242a210c2840dd07831a6b1a35c",
    "planSHA256": "d0ad2a5fc8e738d0b0f2c696199a7509009aa273c724dfc1217853459383e33d",
    "inputSHA256": "1a31911a7072d2c2b8684f34e68dff464118deededa31df54798b0ab0b8469ca",
    "catalogSHA256": "2e4ef8a7287ac532d6f546e3939d2ffbe4d1ad27ca846126585c82b4109fc2aa",
    "scopeSHA256": "6b662207002833fc5b9dee820cc628d0313689810d42f1f977e731a4f2435c65",
    "captureAckSHA256": "757422de49bbcfffc27f229fc70ee5df0b2ca1537f326eaea71b2acb4f3c73a1",
    "captureCompleteSHA256": "62152a732385a9499e27f0c913d55d801ae7482d3e50e22c6dc175efacf85a08",
    "captureCollectedSHA256": "0b999332cea61652b95055ff733fcca6fdf1fb1e1d7f7daeb34189a3f35b56f1",
    "captureManagerTerminalSHA256": "0dc22041b96cf4896aadc1d5041da8419caf3975bc0edce4d1875acfa760f94e",
    "captureOuterTerminalSHA256": "1324255e4505af526a7de912cd366bfd9c1922b60029d7c381f66d48776992d5",
    "captureAcceptanceSHA256": "1358666689e0346bb888d5b55631d194c737e79245258a8ab3b64b34e29bc2a7"
}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def configure(namespace):
    collect = namespace['collect']
    globs = collect.__globals__
    globs['ARGV'] = list(ARGV)
    globs['DEADLINE'] = 335
    globs['BOUNDS'] = {'stdout': 1048576, 'stderr': 65536}
    return collect


def main():
    os.umask(0o077)
    require(sys.argv[1:] == ['--record-once'], 'fixed-observe-recorder-entry')
    require(sha(RECORDER) == RECORDER_SHA, 'exact-retained-recorder')
    namespace = runpy.run_path(str(RECORDER), run_name='openplan_observe_collect_definitions')
    private, read, record = namespace['private'], namespace['read'], namespace['record']
    private(ROOT, True)
    private(Path(__file__))
    private(WRAPPER)
    intent_path = ROOT/'root-observe-outer-intent.json'
    intent = read(intent_path)
    expected = {'schema': 1, 'purpose': 'RECORD_ONE_ROOT_ADMITTED_OBSERVE_NO_AUTHORITY',
        'stage': 'observe', 'argv': ARGV, 'environment': namespace['manager_env'](),
        'deadlineSeconds': 335, 'stdoutLimit': 1048576, 'stderrLimit': 65536,
        'retry': 'FORBIDDEN', 'recorderGrantsNativeAuthority': False,
        'recorderSHA256': RECORDER_SHA, 'wrapperSHA256': sha(WRAPPER),
        'parentSourceSHA256': sha(Path(__file__))}
    for key, path in FILES.items():
        private(path)
        actual = sha(path)
        if key in KNOWN:
            require(actual == KNOWN[key], 'pinned-file:'+key)
        expected[key] = actual
    for key, value in expected.items():
        require(type(intent.get(key)) is type(value) and intent.get(key) == value,
                'root-observe-intent:'+key)
    folder = ROOT/'native-observe-parent'
    folder.mkdir(mode=0o700)
    namespace['sync'](ROOT)
    record(folder/'intent.json', dict(expected, rootIntentSHA256=sha(intent_path),
        parentPID=os.getpid(), uid=os.getuid(), nativeAcceptance='UNASSESSED'))
    terminal = configure(namespace)(folder)
    final = {'recorderSHA256': sha(RECORDER), 'wrapperSHA256': sha(WRAPPER),
        'parentSourceSHA256': sha(Path(__file__)), 'rootIntentSHA256': sha(intent_path),
        'files': {key: sha(path) for key, path in FILES.items()}}
    exact = (final['recorderSHA256'] == RECORDER_SHA and
        final['wrapperSHA256'] == expected['wrapperSHA256'] and
        final['parentSourceSHA256'] == expected['parentSourceSHA256'] and
        final['rootIntentSHA256'] == read(folder/'intent.json')['rootIntentSHA256'] and
        all(final['files'][key] == expected[key] for key in FILES))
    record(folder/'source-final-readback.json', dict(final, sourceExact=exact))
    require(exact, 'observe-recorder-input-drift')
    require(terminal.get('returncode') == 0 and terminal.get('failure') is None,
            'outer-transport-refused')
    record(folder/'recorder-result.json', {'status': 'RECORDED_TRANSPORT_ONLY',
        'terminalSHA256': sha(folder/'terminal.json'), 'backendDeath': 'UNASSESSED',
        'nativeAcceptance': 'UNASSESSED_REQUIRES_INDEPENDENT_ROOT_ACK_STAGE_AUDIT',
        'successorGranted': False})


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print('STOP: retain intent/partial streams; no replay or successor', file=sys.stderr)
        raise SystemExit(1)
