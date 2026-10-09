"""Execute the actual diagnostic block with controlled database and write failures."""
import ast
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from test_model_skip_dispatch import aeq


class SelectLinkCustody(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)
        counts=self.root/'counts.csv';counts.write_text('station_id\nsynthetic\n')
        self.db=Mock()
        self.db.execute.return_value.fetchall.return_value=[(1,'Synthetic','default',0,0)]
        self.patch=Mock()
        self.screenlines=Mock(return_value={'synthetic':[1]})
        self.env=dict(vars(aeq),COUNT_VALIDATION_ENABLED=True,counts_path=str(counts),
            proj_dir=str(self.root),sqlite3=SimpleNamespace(connect=Mock(return_value=self.db)),
            SPATIALITE_PATH='synthetic',select_link=SimpleNamespace(select_link_screenlines=self.screenlines),
            graph=SimpleNamespace(graph={'link_id':SimpleNamespace(values=[1])}),
            resident_class=Mock(),external_class=Mock(),log='',select_link_sets={},
            sb_patch_stage=self.patch,stage_id='synthetic-stage')

    def execute(self):
        tree=ast.parse(Path(aeq.__file__).read_text())
        stage=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='stage_assignment')
        block=next(n for n in ast.walk(stage) if isinstance(n,ast.Try) and any(
            isinstance(x,ast.Constant) and isinstance(x.value,str) and 'Select-link setup warning' in x.value
            for h in n.handlers for x in ast.walk(h)))
        exec(compile(ast.Module(body=[block],type_ignores=[]),'main.py','exec'),self.env)

    def test_unconfirmed_stage_write_escapes_diagnostic_handler(self):
        failure=aeq.WorkerStateWriteUnconfirmed('Synthetic lost receipt')
        self.patch.side_effect=failure
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as caught:self.execute()
        self.assertIs(caught.exception,failure)
        self.patch.assert_called_once()
        self.db.close.assert_called_once()

    def test_ordinary_diagnostic_failure_remains_a_warning(self):
        self.screenlines.side_effect=ValueError('Synthetic unsupported screenline')
        self.execute()
        self.assertEqual(self.env['select_link_sets'],{})
        self.assertIn('Select-link setup warning',self.env['log'])
        self.patch.assert_not_called()
        self.db.close.assert_called_once()

    def test_extension_failure_still_closes_database(self):
        self.db.load_extension.side_effect=RuntimeError('Synthetic extension failure')
        self.execute()
        self.db.close.assert_called_once()
        self.patch.assert_not_called()
        self.assertIn('Select-link setup warning',self.env['log'])


if __name__=='__main__':unittest.main()
