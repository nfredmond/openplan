"""Explicit native graph-only lane. Missing dependencies or skipped tests fail."""
import importlib.metadata
import os
from pathlib import Path
import platform
import sys
import unittest

HOME = Path(__file__).resolve().parent
WORKER = HOME.parent


def declared_versions():
    versions = {}
    for line in (HOME / 'requirements.txt').read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        name, version = line.split('==')
        if not name or not version or name in versions:
            raise ValueError('Invalid exact native dependency declaration: ' + line)
        versions[name] = version
    return versions


def verify_environment(version=importlib.metadata.version):
    if (sys.implementation.name != 'cpython' or sys.version_info[:3] != (3, 11, 15)
            or platform.system() != 'Linux' or platform.machine() != 'x86_64'):
        raise RuntimeError('Native graph controls require tested CPython 3.11.15 Linux x86_64; no other 1.6.2 binary is admitted')
    for name, expected in declared_versions().items():
        try:
            actual = version(name)
        except importlib.metadata.PackageNotFoundError as exc:
            raise RuntimeError('Missing native graph dependency: ' + name) from exc
        if actual != expected:
            raise RuntimeError(f'Native graph dependency differs: {name} expected={expected} actual={actual}')


def main():
    verify_environment()
    sys.path.insert(0, str(WORKER))
    from model_assignment_graph_adapter import supported_engine
    supported_engine()
    loader = unittest.TestLoader()
    suite = loader.discover(str(HOME), pattern='test_*.py', top_level_dir=str(HOME))
    suite.addTests(loader.loadTestsFromName('test_assignment_compact_graph'))
    if suite.countTestCases() < 23:
        raise RuntimeError('Native graph-control inventory is incomplete')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(f'Native graph-only tests={result.testsRun}; skips={len(result.skipped)}; threads={len(list(Path("/proc/self/task").iterdir()))}; affinity={sorted(os.sched_getaffinity(0))}', flush=True)
    return 0 if result.wasSuccessful() and not result.skipped else 1


if __name__ == '__main__':
    sys.exit(main())
