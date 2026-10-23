"""Source-layout import controls, without installed geo or assignment packages.

The child loads actual CLI/runtime/helper bytes in an isolated projected tree.
Worker main coverage projects its real helper import statement only. This does
not run a container, worker startup, OSM production, or an assignment.
"""
from __future__ import annotations

import ast
import fnmatch
from pathlib import Path, PurePosixPath
import runpy
import shlex
import shutil
import subprocess
import sys
import tempfile
from types import ModuleType
import unittest


ROOT = Path(__file__).resolve().parents[3]
WORKER = PurePosixPath('workers/aequilibrae_worker')
SCRIPTS = PurePosixPath('scripts/modeling')
SOURCES = tuple(SCRIPTS / name for name in (
    'run_screening_model.py', 'screening_runtime.py', 'screening_boundary.py',
    'screening_bundle.py', 'screening_metrics.py', 'demand_package.py', 'gateway_counts.py',
)) + tuple(WORKER / name for name in (
    'main.py', 'model_fresh_osm_modes.py', 'assignment_settings.py', 'assignment_runtime.py', 'gateways.py',
    'centroid_geometry.py',
))


def excluded(path: PurePosixPath, patterns: list[str]) -> bool:
    """Match current positive ignore rules against a file and its ancestors."""
    candidates = [str(path), *(str(parent) for parent in path.parents if str(parent) != '.')]
    for pattern in patterns:
        if pattern.startswith('!') or '[' in pattern or '\\' in pattern:
            raise AssertionError('Review projection before using new ignore syntax')
        pattern = pattern.strip('/')
        for candidate in candidates:
            if fnmatch.fnmatchcase(candidate, pattern):
                return True
            if pattern.startswith('**/') and fnmatch.fnmatchcase(candidate, pattern[3:]):
                return True
            if '/' not in pattern and any(fnmatch.fnmatchcase(part, pattern)
                                          for part in PurePosixPath(candidate).parts):
                return True
    return False


def project(app: Path, image: str) -> None:
    """Project selected real Python sources through the current COPY rules."""
    if image == 'cli':
        for source in SOURCES:
            target = app / source
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / source, target)
        return
    context = ROOT
    directory = {'standalone': WORKER, 'county': PurePosixPath('workers/county_onramp_worker'),
                 'shared': PurePosixPath('workers/hosted-models')}[image]
    dockerfile = ROOT / directory / 'Dockerfile'
    ignore = context / '.dockerignore'
    patterns = [line.strip() for line in ignore.read_text().splitlines()
                if line.strip() and not line.lstrip().startswith('#')] if ignore.exists() else []
    workdir = PurePosixPath('/')
    for line in dockerfile.read_text().splitlines():
        if not line.strip() or line.split()[0] not in ('WORKDIR', 'COPY'):
            continue
        words = shlex.split(line, comments=True)
        if not words:
            continue
        if words[0] == 'WORKDIR':
            workdir = workdir / words[1]
        if words[0] != 'COPY':
            continue
        if len(words) != 3 or any(word.startswith('--') for word in words[1:]):
            raise AssertionError('Review projection before using new COPY syntax')
        source_rule, destination = words[1:]
        destination = workdir / destination
        for source in SOURCES:
            original = ROOT / source
            if not original.is_relative_to(context):
                continue
            relative = PurePosixPath(original.relative_to(context).as_posix())
            if excluded(relative, patterns):
                continue
            source_path = PurePosixPath(source_rule)
            if source_rule == '.':
                suffix = relative
            elif source_path in relative.parents:
                suffix = relative.relative_to(source_path)
            elif fnmatch.fnmatchcase(str(relative), source_rule):
                suffix = PurePosixPath(relative.name)
            else:
                continue
            # These probes cover Python sources copied beneath /app only.
            target = app / destination.relative_to('/app') / suffix
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)


def isolate_heavy_imports() -> None:
    """Supply unused third-party import names; accidental calls fail loudly."""
    def unused(*args, **kwargs):
        raise AssertionError('Import-path probe reached unrelated geo/model computation')

    for name in ('geopandas', 'numpy', 'pandas', 'requests', 'shapely',
                 'shapely.wkt', 'shapely.geometry'):
        module = ModuleType(name)
        if name == 'shapely':
            module.__path__ = []
        sys.modules[name] = module
    sys.modules['shapely'].wkt = sys.modules['shapely.wkt']
    for name in ('box', 'shape', 'Point'):
        setattr(sys.modules['shapely.geometry'], name, unused)
    for name in ('get', 'post', 'request'):
        setattr(sys.modules['requests'], name, unused)
    # The patch caller imports this class before reaching the real installer.
    # No engine distribution is supplied, so that installer must refuse.
    for name in ('aequilibrae', 'aequilibrae.project', 'aequilibrae.project.network',
                 'aequilibrae.project.network.osm',
                 'aequilibrae.project.network.osm.osm_builder'):
        module = ModuleType(name)
        module.__path__ = []
        sys.modules[name] = module
    sys.modules['aequilibrae.project.network.osm.osm_builder'].OSMBuilder = type('OSMBuilder', (), {})


def probe(app: Path, image: str) -> None:
    """Let the CLI/runtime arrange paths, then probe worker script semantics."""
    isolate_heavy_imports()
    worker = app / WORKER
    expected = worker / 'model_fresh_osm_modes.py'
    if image in ('cli', 'county', 'standalone', 'shared'):
        cli = app / SCRIPTS / 'run_screening_model.py'
        runtime_path = app / SCRIPTS / 'screening_runtime.py'

        class ReachedModel(Exception):
            pass

        def stop_before_model(frame, event, arg):
            if (event == 'call' and frame.f_code.co_name == 'run_screening_model'
                    and Path(frame.f_code.co_filename) == runtime_path):
                raise ReachedModel
            return stop_before_model

        sys.argv = [str(cli), '--name', 'import-only', '--boundary-geojson', 'not-read.geojson']
        sys.settrace(stop_before_model)
        try:
            runpy.run_path(str(cli), run_name='__main__')
        except ReachedModel:
            pass
        else:
            raise AssertionError('CLI did not dispatch to the real screening runtime')
        finally:
            sys.settrace(None)
        runtime = sys.modules['screening_runtime']
        assert Path(runtime.__file__) == runtime_path
        # The runtime, rather than this probe, must arrange the worker path.
        assert str(worker) in sys.path
        try:
            runtime.patch_osm_builder()
        except ValueError as error:
            assert str(error) == 'Fresh OSM mode producer requires the supported engine'
        else:
            raise AssertionError('Real installer did not refuse the absent engine distribution')
    # Execute the actual worker helper import, with normal Python resolution.
    # Other worker startup code (credentials, pollers, native stages) is outside
    # this projection; its stage_setup call remains separate source evidence.
    # Reload independently of the CLI's module cache and path bootstrap.
    sys.modules.pop('model_fresh_osm_modes', None)
    sys.path[:] = [entry for entry in sys.path if not Path(entry).is_relative_to(app)]
    sys.path.insert(0, str(worker))  # python main.py script-directory semantics
    main = worker / 'main.py'
    tree = ast.parse(main.read_text(), filename=str(main))
    imports = [node for node in tree.body if isinstance(node, ast.ImportFrom)
               and node.module == 'model_fresh_osm_modes']
    assert len(imports) == 1
    namespace = {}
    exec(compile(ast.Module(body=imports, type_ignores=[]), str(main), 'exec'), namespace)
    helper = sys.modules['model_fresh_osm_modes']
    assert Path(helper.__file__) == expected
    assert namespace['install_fresh_osm_modes'] is helper.install
    assert helper.install.__code__.co_filename == str(expected)
    assert helper._installed == {}


class FreshModeImportPathTests(unittest.TestCase):
    def test_real_imports_in_cli_and_current_image_layouts(self):
        for image in ('cli', 'county', 'standalone', 'shared'):
            with self.subTest(image=image), tempfile.TemporaryDirectory() as directory:
                app = Path(directory) / 'app'
                app.mkdir()
                project(app, image)
                # -I removes inherited PYTHONPATH/cwd, -S removes site packages,
                # and -B avoids stale bytecode during later mutation controls.
                result = subprocess.run(
                    [sys.executable, '-I', '-S', '-B', str(Path(__file__).resolve()),
                     '--probe', str(app), image], cwd=directory, env={},
                    text=True, capture_output=True, timeout=15,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--probe':
        probe(Path(sys.argv[2]), sys.argv[3])
    else:
        unittest.main()
