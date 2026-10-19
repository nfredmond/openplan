"""Lightweight producer refusals and exact retained-source reader controls.

The native producer, persistence and graph controls live in native_tests.
Run from the worker directory with: python -B -m unittest test_fresh_osm_modes
"""
import ast
import builtins
import hashlib
from pathlib import Path
import sqlite3
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import model_fresh_osm_modes as modes
import model_assignment_network_source as source


FIXTURE = '''class OSMBuilder:
    def __init__(self):
        self.calls = 0

    def __establish_modes_for_all_links(self, connection, frame):
        self.calls += 1
        return frame
'''


class Series(list):
    def map(self, function):
        return Series(function(value) for value in self)


class Frame(dict):
    @property
    def columns(self):
        return list(self)

    def copy(self):
        return Frame({name: Series(values) for name, values in self.items()})


class Connection:
    def __init__(self, codes=('b', 'c', 't', 'w', 'C')):
        self.codes = codes

    def execute(self, query):
        if query != 'SELECT mode_id FROM modes ORDER BY mode_id':
            raise AssertionError('Producer issued an unexpected registry query')
        return SimpleNamespace(fetchall=lambda: [(code,) for code in self.codes])


class FreshModeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'osm_builder.py'
        self.path.write_text(FIXTURE)
        self.module = ModuleType(modes.BUILDER_MODULE)
        self.module.__file__ = str(self.path)
        exec(compile(FIXTURE, str(self.path), 'exec'), self.module.__dict__)
        self.builder = self.module.OSMBuilder()
        for guard in (patch.object(modes, '_installed', {}),
                      patch.object(modes, 'BUILDER_SHA256', hashlib.sha256(self.path.read_bytes()).hexdigest()),
                      patch.object(modes.importlib.metadata, 'version', return_value=modes.ENGINE_VERSION),
                      patch.object(modes.importlib, 'import_module', return_value=self.module)):
            guard.start()
            self.addCleanup(guard.stop)

    def call(self, values, connection=None):
        return getattr(self.builder, modes.METHOD)(connection or Connection(),
            Frame(modes=Series(values), source_marker=Series(['preserve'] * len(values))))

    def test_install_is_idempotent_and_keeps_actual_native_reference(self):
        original = getattr(self.module.OSMBuilder, modes.METHOD)
        modes.install()
        installed = getattr(self.module.OSMBuilder, modes.METHOD)
        modes.install()
        self.assertIs(getattr(self.module.OSMBuilder, modes.METHOD), installed)
        self.assertIs(installed.__wrapped__, original)
        result = self.call(['tcwb', 'twbc', 'tCwc', 'c'])
        self.assertEqual(result['modes'], ['bctw', 'bctw', 'Cctw', 'c'])
        self.assertEqual(result['source_marker'], ['preserve'] * 4)
        self.assertEqual(self.builder.calls, 1)

    def test_emitted_membership_refuses_without_dropping_unknown_codes(self):
        modes.install()
        for value in ('cc', 'cq', 'car', '', None, 12, 'c w', 'cé'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'invalid or unregistered'):
                self.call([value])

    def test_registry_requires_unique_single_ascii_letters_before_native_call(self):
        modes.install()
        for codes in ((), ('c', 'c'), ('car',), ('é',), (None,), ('1',), ('_',)):
            with self.subTest(codes=codes), self.assertRaisesRegex(ValueError, 'unique registered single-letter'):
                self.call(['c'], Connection(codes))
        self.assertEqual(self.builder.calls, 0)

    def test_uninstalled_custom_frames_stay_verbatim(self):
        frame = Frame(modes=Series(['wc', 'unknown ordered input']))
        modes.install()
        self.assertEqual(frame['modes'], ['wc', 'unknown ordered input'])
        generated = Frame(modes=Series(['wc']))
        result = getattr(self.builder, modes.METHOD)(Connection(), generated)
        self.assertEqual(result['modes'], ['cw'])
        self.assertEqual(generated['modes'], ['wc'])

    def test_missing_modes_column_refuses(self):
        modes.install()
        with self.assertRaisesRegex(ValueError, 'no unique modes column'):
            getattr(self.builder, modes.METHOD)(Connection(), Frame(link_id=Series([1])))

    def test_version_and_file_pins_refuse_at_install_and_at_call(self):
        with patch.object(modes.importlib.metadata, 'version', return_value='1.6.3'):
            with self.assertRaisesRegex(ValueError, 'unsupported engine version'):
                modes.install()
        modes.install()
        with patch.object(modes.importlib.metadata, 'version', return_value='1.6.3'):
            with self.assertRaisesRegex(ValueError, 'unsupported engine version'):
                self.call(['c'])
        self.path.write_text(FIXTURE + '\n# different unreviewed source\n')
        with self.assertRaisesRegex(ValueError, 'unsupported builder source'):
            self.call(['c'])
        with self.assertRaisesRegex(ValueError, 'unsupported builder source'):
            modes.install()
        self.assertEqual(self.builder.calls, 0)

    def test_preexisting_replacement_refuses_even_with_copied_names(self):
        original = getattr(self.module.OSMBuilder, modes.METHOD)
        def replacement(self, connection, frame):
            return frame
        replacement.__name__ = original.__name__
        replacement.__qualname__ = original.__qualname__
        replacement.__module__ = original.__module__
        setattr(self.module.OSMBuilder, modes.METHOD, replacement)
        with self.assertRaisesRegex(ValueError, 'unexpected native method replacement'):
            modes.install()

    def test_replacement_after_install_refuses_on_install_and_stale_alias(self):
        modes.install()
        installed = getattr(self.module.OSMBuilder, modes.METHOD)
        setattr(self.module.OSMBuilder, modes.METHOD, lambda self, connection, frame: frame)
        with self.assertRaisesRegex(ValueError, 'installed method was replaced'):
            modes.install()
        with self.assertRaisesRegex(ValueError, 'builder or installed method changed'):
            installed(self.builder, Connection(), Frame(modes=Series(['c'])))

    def test_retained_reader_still_detects_permutation_and_install_writes_nothing(self):
        database = self.path.parent / 'retained.sqlite'
        with sqlite3.connect(database) as connection:
            connection.executescript("CREATE TABLE nodes(node_id INTEGER); INSERT INTO nodes VALUES(1);"
                "CREATE TABLE links(link_id INTEGER,modes TEXT); INSERT INTO links VALUES(1,'cw');")
        retained = source.identity(database)
        before = database.read_bytes()
        modes.install()
        self.assertEqual(database.read_bytes(), before)
        self.assertEqual(source.identity(database), retained)
        with sqlite3.connect(database) as connection:
            connection.execute("UPDATE links SET modes='wc'")
        self.assertNotEqual(source.identity(database), retained)

    def test_screening_fresh_path_installs_supported_mode_producer(self):
        # Execute the actual patch function with only its external imports
        # supplied. Native producer behavior has a separate binary test.
        script = Path(__file__).resolve().parents[2] / 'scripts/modeling/screening_runtime.py'
        tree = ast.parse(script.read_text(), filename=str(script))
        functions = [node for node in tree.body
                     if isinstance(node, ast.FunctionDef) and node.name == 'patch_osm_builder']
        self.assertEqual(len(functions), 1)
        namespace = {}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(script), 'exec'), namespace)
        installer = unittest.mock.Mock()
        builder = type('OSMBuilder', (), {})
        original_import = builtins.__import__
        def supplied_import(name, *args, **kwargs):
            if name == 'aequilibrae.project.network.osm.osm_builder':
                return SimpleNamespace(OSMBuilder=builder)
            if name == 'model_fresh_osm_modes':
                return SimpleNamespace(install=installer)
            return original_import(name, *args, **kwargs)
        with patch.object(builtins, '__import__', side_effect=supplied_import):
            namespace['patch_osm_builder']()
        installer.assert_called_once_with()
        self.assertTrue(callable(builder._OSMBuilder__define_link_type))


if __name__ == '__main__':
    unittest.main()
