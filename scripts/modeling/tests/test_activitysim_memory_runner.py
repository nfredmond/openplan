"""Check the preparation runner's engine pins without executing a model."""
import hashlib,runpy,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
RUNNER=Path(__file__).resolve().parents[3]/'docs/modeling/activitysim-tbi2019-2026-10-23/integration-evidence/activitysim-memory-runner.py'
EXPECTED='39a8624e73cad1a3b38acfc769fbbb330aa792b115ec16b047c04631fd9e82c5'
class PinTests(unittest.TestCase):
    def execute(self,version,digest):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'location_choice.py';source.write_text('# fixture\n')
            original=lambda value:value
            engine=types.SimpleNamespace(__file__=str(source),run_location_logsums=original)
            module=types.ModuleType('activitysim.abm.models');module.location_choice=engine
            with patch.dict(sys.modules,{'activitysim.abm.models':module}),patch('importlib.metadata.version',return_value=version),patch('hashlib.sha256') as sha,patch('runpy.run_module') as start,patch.object(sys,'argv',['runner','run']):
                sha.return_value.hexdigest.return_value=digest
                try:runpy.run_path(str(RUNNER),run_name='__main__')
                except RuntimeError:
                    start.assert_not_called();self.assertIs(engine.run_location_logsums,original);raise
                start.assert_called_once_with('activitysim',run_name='__main__')
                value=object();self.assertIs(engine.run_location_logsums(value),value)
    def test_version_refusal(self):
        with self.assertRaisesRegex(RuntimeError,'Unadmitted ActivitySim'):self.execute('1.5.2',EXPECTED)
    def test_source_refusal(self):
        with self.assertRaisesRegex(RuntimeError,'Unadmitted ActivitySim'):self.execute('1.5.1','0'*64)
    def test_pinned_call(self):self.execute('1.5.1',EXPECTED)
if __name__=='__main__':unittest.main()
