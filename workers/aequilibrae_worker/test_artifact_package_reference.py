"""Execute the actual zone-artifact registration with conflicting package files."""
import ast
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from worker_import_for_tests import import_worker_main
main = import_worker_main()


class PackageReferenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.legacy = self.root / 'package'
        self.selected = self.root / 'retained-package'
        self.legacy.mkdir()
        self.selected.mkdir()
        (self.legacy / 'zone_attributes.csv').write_bytes(b'zone,population\n1,900\n')
        (self.selected / 'zone_attributes.csv').write_bytes(b'zone,population\n1,123\n')

    def register(self, metadata, source=None):
        tree = ast.parse(source or Path(main.__file__).read_text())
        stage = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'stage_artifacts')
        start = next(i for i,n in enumerate(stage.body) if isinstance(n, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == 'zone_package_dir' for t in n.targets))
        end = next(i for i,n in enumerate(stage.body) if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'kpis' for t in n.targets))
        writer = Mock()
        scope = dict(vars(main), work_dir=str(self.root), package_meta=metadata,
                     run_id='run', stage_id='stage', _ws_id='workspace', sb_record_retained_artifact=writer)
        exec(compile(ast.Module(body=stage.body[start:end], type_ignores=[]), main.__file__, 'exec'), scope)
        return writer

    def test_recorded_package_controls_path_and_bytes(self):
        writer = self.register({'package_dir': str(self.selected)})
        writer.assert_called_once()
        record = writer.call_args.args[0]
        content = (self.selected / 'zone_attributes.csv').read_bytes()
        self.assertEqual(record['file_url'], 'local://' + str(self.selected / 'zone_attributes.csv'))
        self.assertEqual(record['content_hash'], hashlib.sha256(content).hexdigest())
        self.assertEqual(record['file_size_bytes'], len(content))

    def test_missing_recorded_file_does_not_substitute_legacy(self):
        (self.selected / 'zone_attributes.csv').unlink()
        self.register({'package_dir': str(self.selected)}).assert_not_called()

    def test_legacy_metadata_keeps_existing_path(self):
        writer = self.register(None)
        self.assertEqual(writer.call_args.args[0]['file_url'], 'local://' + str(self.legacy / 'zone_attributes.csv'))

    def test_harmless_control_and_wrong_package_fault(self):
        source = Path(main.__file__).read_text()
        harmless = self.register({'package_dir': str(self.selected)}, source + '\n# Harmless comment.\n')
        expected = 'local://' + str(self.selected / 'zone_attributes.csv')
        self.assertEqual(harmless.call_args.args[0]['file_url'], expected)
        anchor = '(package_meta or {}).get("package_dir") or os.path.join(work_dir, "package")'
        self.assertEqual(source.count(anchor), 1)
        broken = self.register({'package_dir': str(self.selected)}, source.replace(anchor, 'os.path.join(work_dir, "package")'))
        with self.assertRaises(AssertionError):
            self.assertEqual(broken.call_args.args[0]['file_url'], expected)
