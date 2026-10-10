"""Observe a native borrowed matrix view across the owned child boundary."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'
sys.path.insert(0, str(WORKER))
from model_engine_process import EngineProcess, EngineStillRunning
from test_model_engine_process import EngineProcessTests

CHILD = '''
import json,time
from pathlib import Path
from aequilibrae.matrix import AequilibraeMatrix
from model_engine_scope import matrix_scope
with matrix_scope() as own:
 matrix=own(AequilibraeMatrix())
 matrix.create_empty(file_name='native.aem',zones=2,matrix_names=['demand'])
 matrix.index[:]=[1,2]
 matrix.computational_view(['demand'])
 matrix.matrix_view[:]=[[0,17],[23,0]]
 matrix.export('native.omx')
 borrowed=matrix.matrix_view
assert borrowed.tolist()==[[0,17],[23,0]]
Path('ready.json').write_text(json.dumps({'borrowed_values':borrowed.tolist()}))
deadline=time.monotonic()+30
while not Path('release').exists():
 if time.monotonic()>deadline:raise RuntimeError('Supervisor did not release child')
 time.sleep(0.02)
# The borrowed native view intentionally remains live until process exit.
'''
READER = '''
import json
from aequilibrae.matrix import AequilibraeMatrix
m=AequilibraeMatrix();m.load('native.omx')
try:
 m.computational_view(['demand'])
 assert m.matrix_view.tolist()==[[0,17],[23,0]]
 assert m.index.tolist()==[1,2]
 print(json.dumps(m.matrix_view.tolist()))
finally:m.close()
'''


def main():
    source = (WORKER / 'model_engine_process.py').read_bytes()
    results = []
    original = EngineProcess.confirm_exit
    for control in ('baseline', 'harmless', 'premature-exit', 'restored'):
        case = EngineProcessTests('test_completed_child_records_original_identity')
        case.setUp()
        handle = None
        try:
            case.prepared()
            env = dict(os.environ, PYTHONPATH=str(WORKER))
            handle = EngineProcess(case.writer, [sys.executable, '-B', '-c', CHILD], env=env)
            deadline = time.monotonic() + 30
            ready = case.writer.files.path / 'ready.json'
            while not ready.exists():
                if handle.process.poll() is not None:
                    raise AssertionError('Native child exited before barrier: ' + (handle.directory / 'engine.log').read_text())
                if time.monotonic() > deadline:
                    raise AssertionError('Native child did not reach barrier')
                time.sleep(0.02)
            if control == 'harmless':
                # An equivalent wrapper changes no observation behavior.
                EngineProcess.confirm_exit = lambda self: original(self)
            elif control == 'premature-exit':
                EngineProcess.confirm_exit = lambda self: {'returncode': 0}
            refused = False
            try:
                handle.confirm_exit()
            except EngineStillRunning:
                refused = True
            try:
                assert refused, 'Live native child was falsely accepted'
            except AssertionError as error:
                if control != 'premature-exit':
                    raise
                results.append({'control': control, 'detected': True, 'reason': str(error)})
            else:
                assert control != 'premature-exit', 'Fault did not reach the observed boundary'
                assert not (handle.directory / 'observed-exit.json').exists()
            EngineProcess.confirm_exit = original
            (case.writer.files.path / 'release').touch(exist_ok=False)
            handle.process.wait(timeout=30)
            receipt = handle.confirm_exit()
            assert receipt['returncode'] == 0 and receipt['execution_ready'] is False
            reader = subprocess.run([sys.executable, '-B', '-c', READER], cwd=case.writer.files.path,
                                    env=env, capture_output=True, text=True, timeout=30)
            assert reader.returncode == 0, reader.stderr
            assert json.loads(reader.stdout) == [[0, 17], [23, 0]]
            if control != 'premature-exit':
                results.append({'control': control, 'live_child_refused': refused,
                                'exit_code': receipt['returncode'], 'separate_native_reopen': True})
        finally:
            EngineProcess.confirm_exit = original
            if handle is not None:
                if handle.process.poll() is None:
                    handle.process.terminate()
                handle.process.wait(timeout=10)
            case.doCleanups()
    report = {'engine_process_sha256': hashlib.sha256(source).hexdigest(), 'controls': results,
              'limits': 'Synthetic native 2x2 matrix; borrowed view remains alive at the barrier. Managed registration fixtures are mocked. No full assignment, escaped-descendant containment, supervisor recovery, capture authority or scientific acceptance.'}
    content = json.dumps(report, indent=2) + '\n'
    (ROOT / 'native-engine-process.json').write_text(content)
    print(content)


if __name__ == '__main__':
    main()
