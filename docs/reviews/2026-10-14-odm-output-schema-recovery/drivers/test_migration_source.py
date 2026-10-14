"""Use real Git index/worktree differences to protect capture provenance."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

from migration_source import capture_destination, committed_migrations


class Checks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'source-test@example.invalid')
        self.git('config', 'user.name', 'Isolated migration source test')
        self.folder = self.repo/'openplan/supabase/migrations'
        self.folder.mkdir(parents=True)
        self.file = self.folder/'20261017000005_example.sql'
        self.original = b'SELECT 1;\n'
        self.file.write_bytes(self.original)
        self.git('add', '.')
        self.git('commit', '-qm', 'Selected fixture')
        self.commit = self.git('rev-parse', 'HEAD').decode().strip()

    def git(self, *arguments):
        return subprocess.check_output(['git', *arguments], cwd=self.repo, stderr=subprocess.PIPE)

    def test_exact_selected_git_bytes_survive_nonmigration_edits(self):
        (self.repo/'notes.md').write_text('Harmless nonmigration worktree change.\n')
        self.git('add', 'notes.md')
        self.assertEqual(committed_migrations(self.repo, self.commit), {self.file.name: self.original})

    def test_unstaged_migration_change_refuses(self):
        self.file.write_bytes(self.original+b'-- Changed worktree.\n')
        with self.assertRaisesRegex(ValueError, 'Selected migration worktree differs'):
            committed_migrations(self.repo, self.commit)

    def test_staged_change_refuses_even_when_worktree_matches_commit(self):
        self.file.write_bytes(self.original+b'-- Changed index.\n')
        self.git('add', str(self.file.relative_to(self.repo)))
        self.file.write_bytes(self.original)
        with self.assertRaisesRegex(ValueError, 'Selected migration index differs'):
            committed_migrations(self.repo, self.commit)

    def test_untracked_migration_refuses(self):
        (self.folder/'20261017000006_untracked.sql').write_text('SELECT 2;\n')
        with self.assertRaisesRegex(ValueError, 'Selected migration file inventory differs'):
            committed_migrations(self.repo, self.commit)

    def test_missing_selected_migration_refuses(self):
        self.file.unlink()
        with self.assertRaisesRegex(ValueError, 'Selected migration (worktree|file inventory) differs'):
            committed_migrations(self.repo, self.commit)

    def test_selected_commit_identity_is_explicit(self):
        with self.assertRaisesRegex(ValueError, 'full selected commit'):
            committed_migrations(self.repo, 'HEAD')

    def test_selected_bytes_come_from_git_objects(self):
        # A controlled dirty-diff blind spot must not substitute mutable bytes.
        from unittest.mock import patch
        original = subprocess.run
        self.file.write_bytes(self.original+b'-- Worktree differs.\n')
        def blind_diff(arguments, **kwargs):
            if arguments[:2] == ['git', 'diff']:
                return subprocess.CompletedProcess(arguments, 0)
            return original(arguments, **kwargs)
        with patch('migration_source.subprocess.run', side_effect=blind_diff):
            captured = committed_migrations(self.repo, self.commit)
        self.assertEqual(captured[self.file.name], self.original, 'Captured bytes must come from selected Git objects')
        self.assertNotEqual(hashlib.sha256(captured[self.file.name]).hexdigest(), hashlib.sha256(self.file.read_bytes()).hexdigest())

    def test_nested_migration_cannot_shadow_a_direct_member(self):
        nested = self.folder/'nested'
        nested.mkdir()
        (nested/self.file.name).write_text('SELECT 2;\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Nested fixture')
        commit = self.git('rev-parse', 'HEAD').decode().strip()
        with self.assertRaisesRegex(ValueError, 'direct members'):
            committed_migrations(self.repo, commit)

    def test_capture_destination_refuses_checkout_overlap(self):
        capture_destination(self.repo, self.repo.parent/(self.repo.name+'-separate-capture'))
        for target in [self.repo, self.repo/'inside', self.repo.parent]:
            with self.subTest(target=str(target)), self.assertRaisesRegex(ValueError, 'outside the repository'):
                capture_destination(self.repo, target)


if __name__ == '__main__':
    unittest.main()
