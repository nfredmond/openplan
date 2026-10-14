"""Bind a migration capture to immutable selected Git objects and a clean scope."""
from pathlib import Path
import re
import subprocess

SCOPE = 'openplan/supabase/migrations'


def capture_destination(repo, out):
    """Keep protected capture files outside the source checkout and its parents."""
    repo, out = Path(repo).resolve(), Path(out).resolve()
    if out.is_relative_to(repo) or repo.is_relative_to(out):
        raise ValueError('Capture output must stay outside the repository')


def committed_migrations(repo, commit):
    """Refuse dirty migration scope, including index edits and untracked SQL."""
    repo = Path(repo)
    if not isinstance(commit, str) or re.fullmatch('[0-9a-f]{40}', commit) is None:
        raise ValueError('Migration source requires a full selected commit')
    for flags, diagnostic in [([], 'worktree'), (['--cached'], 'index')]:
        result = subprocess.run(['git', 'diff', *flags, '--quiet', commit, '--', SCOPE],
            cwd=repo, capture_output=True, timeout=30)
        if result.returncode != 0:
            raise ValueError('Selected migration '+diagnostic+' differs')
    listing = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', '-z', commit, '--', SCOPE],
        cwd=repo, timeout=30)
    paths = [row.decode() for row in listing.split(b'\0') if row]
    if any(str(Path(path).parent) != SCOPE for path in paths if path.endswith('.sql')):
        raise ValueError('Selected migration paths must be direct members')
    selected = {Path(path).name: path for path in paths if path.endswith('.sql')}
    actual = {path.name for path in (repo/SCOPE).glob('*.sql')}
    if not selected or actual != set(selected):
        raise ValueError('Selected migration file inventory differs')
    return {name: subprocess.check_output(['git', 'show', commit+':'+path], cwd=repo, timeout=30)
        for name, path in sorted(selected.items())}
