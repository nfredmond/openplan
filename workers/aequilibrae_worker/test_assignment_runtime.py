"""Refuse the unsupported interpreter before numerical imports or assignment."""
import contextlib
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
import assignment_settings
import check_local_dependencies as preflight
import assignment_runtime


class RuntimeAdmissionTests(unittest.TestCase):
    def test_unreviewed_interpreters_are_refused(self):
        for version, implementation in (((3, 12, 0), 'CPython'), ((3, 11, 0), 'PyPy')):
            with self.subTest(version=version, implementation=implementation), \
                 patch.object(sys, 'version_info', version), \
                 patch.object(assignment_runtime.platform, 'python_implementation', return_value=implementation), \
                 self.assertRaisesRegex(ValueError, 'CPython 3.11'):
                assignment_runtime.require_assignment_python()

    def test_builder_refuses_python314_before_engine_construction(self):
        with patch.object(assignment_settings, 'installed_assignment_engine_version', return_value='1.6.2'):
            profile = assignment_settings.resolve_assignment_profile({})
            factory = Mock(side_effect=AssertionError('Engine factory must not run'))
            with patch.object(sys, 'version_info', (3, 14, 4)), self.assertRaisesRegex(ValueError, 'CPython 3.11'):
                assignment_settings.build_traffic_assignment(factory, [], profile=profile)
            factory.assert_not_called()

    def test_preflight_refuses_python314_before_numerical_import(self):
        importer = Mock()
        with patch.object(sys, 'version_info', (3, 14, 4)), \
             patch.object(preflight, 'check_versions', return_value=[]), \
             patch.object(preflight, 'import_module', importer), \
             contextlib.redirect_stderr(io.StringIO()) as errors:
            result = preflight.main()
        self.assertEqual(result, 1, 'Unsupported interpreter must fail preflight')
        self.assertIn('CPython 3.11', errors.getvalue())
        importer.assert_not_called()

    def test_supported_preflight_still_checks_packages_and_imports(self):
        importer = Mock()
        with patch.object(sys, 'version_info', (3, 11, 15)), \
             patch.object(preflight, 'check_versions', return_value=[]), \
             patch.object(preflight, 'import_module', importer), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(preflight.main(), 0)
        self.assertEqual([call.args[0] for call in importer.call_args_list], list(preflight.NUMERICAL_DISTRIBUTIONS))


if __name__ == '__main__':
    unittest.main()
