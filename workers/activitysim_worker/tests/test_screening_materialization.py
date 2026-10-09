"""Screening preparation never replaces a retained directory or path alias."""
from pathlib import Path
import tempfile
import unittest
from test_supabase_poll import supabase_poll


class ScreeningMaterializationTests(unittest.TestCase):
    def test_existing_screening_evidence_is_preserved_before_input_access(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);screening=root/'screening';screening.mkdir()
            marker=screening/'bundle_manifest.json';marker.write_text('retained evidence')
            with self.assertRaises(FileExistsError):
                supabase_poll._materialize_screening_dir('synthetic','absent','absent','absent',str(root),source_artifacts=[],consumer_stage_id='synthetic')
            self.assertEqual(marker.read_text(),'retained evidence')

    def test_dangling_screening_alias_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);alias=root/'screening';alias.symlink_to(root/'absent-target')
            with self.assertRaises(FileExistsError):
                supabase_poll._materialize_screening_dir('synthetic','absent','absent','absent',str(root),source_artifacts=[],consumer_stage_id='synthetic')
            self.assertTrue(alias.is_symlink());self.assertFalse((root/'absent-target').exists())
