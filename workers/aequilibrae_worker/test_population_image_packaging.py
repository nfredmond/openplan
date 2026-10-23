"""Project the image COPY layout and import its retained-population sources.

This source control does not build Docker layers or verify hosted settings.
The image recipes also run the same imports inside their installed environment.
"""
import fnmatch
import json
from pathlib import Path, PurePosixPath
import shlex
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest

REPO = Path(__file__).resolve().parents[2]
WORKER = "workers/aequilibrae_worker"
SHARED = "workers/hosted-models"
REQUIRED = (
    f"{WORKER}/model_common_population_package.py",
    "scripts/modeling/common_population.py",
    "scripts/modeling/population_source_registry.py",
    "scripts/modeling/population_source_profiles.v1.json",
    "scripts/modeling/synthetic_population.py",
    "scripts/modeling/census_pums.py",
    "scripts/modeling/population_synthesis.py",
)
IMPORTS = (
    "from model_common_population_package import population_library; "
    "population_library(); from synthetic_population import synthesize_study_area; "
    "assert callable(synthesize_study_area)"
)


def projected_sources(recipe, context, image):
    """Materialize required sources through actual simple COPY/WORKDIR lines.

    Only these source files enter the fixture. No installed checkout, operator
    data, main.py or Docker RUN instruction is executed by this projection.
    """
    workdir = PurePosixPath("/")
    for raw in recipe.splitlines():
        line = raw.strip()
        if line.startswith("WORKDIR "):
            value = PurePosixPath(shlex.split(line)[1])
            workdir = value if value.is_absolute() else workdir / value
        elif line.startswith("COPY "):
            words = shlex.split(line)
            if len(words) != 3 or words[1].startswith("--"):
                raise AssertionError("Update the projection for this COPY syntax")
            source, target = words[1:]
            destination = PurePosixPath(target)
            if not destination.is_absolute():
                destination = workdir / destination
            for relative in REQUIRED:
                path = context / relative
                prefix = source.rstrip("/") + "/"
                if relative.startswith(prefix):
                    suffix = relative[len(prefix):]
                elif fnmatch.fnmatchcase(relative, source):
                    suffix = Path(relative).name
                else:
                    continue
                if not path.is_file():
                    raise AssertionError(f"Build context lacks {relative}")
                copied = image / str(destination / suffix).lstrip("/")
                copied.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, copied)
    return image / str(workdir).lstrip("/")


class PopulationImagePackagingTests(unittest.TestCase):
    def test_both_recipes_import_from_their_projected_image_without_checkout_fallback(self):
        for directory in (WORKER, SHARED):
            with self.subTest(image=directory), tempfile.TemporaryDirectory() as temporary:
                recipe = (REPO / directory / "Dockerfile").read_text()
                image = Path(temporary)
                projected_sources(recipe, REPO, image)
                worker = image / "app" / WORKER
                # Isolated mode removes PYTHONPATH and the checkout from imports.
                # The retained library must resolve inside this projected image.
                code = (
                    f"import sys; from pathlib import Path; sys.path.insert(0, {str(worker)!r}); "
                    + IMPORTS + "; "
                    + f"assert Path(population_library().__file__).resolve() == Path({str(image / 'app/scripts/modeling/common_population.py')!r}); "
                    + f"import synthetic_population; assert Path(synthetic_population.__file__).resolve() == Path({str(image / 'app/scripts/modeling/synthetic_population.py')!r})"
                    + "; import population_source_registry as registry; "
                    + f"assert Path(registry.__file__).resolve() == Path({str(image / 'app/scripts/modeling/population_source_registry.py')!r}); "
                    + f"assert registry.CATALOG_PATH.resolve() == Path({str(image / 'app/scripts/modeling/population_source_profiles.v1.json')!r}); "
                    + "assert len(registry._catalog()) == 2; "
                    + "assert registry.PRODUCTION_REGISTRY.validate(registry._catalog()[1]['profile'], 'new_guided_launch') == registry._catalog()[1]['profile']"
                )
                result = subprocess.run([sys.executable, "-I", "-B", "-c", code],
                    cwd=image, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                commands = [line for line in recipe.splitlines() if line.startswith("RUN ") and IMPORTS in line]
                self.assertEqual(len(commands), 1, "Image must execute its real population import probe")
                self.assertGreater(recipe.index(commands[0]), recipe.index("COPY scripts/modeling"))
                if directory == WORKER:
                    self.assertEqual(projected_sources(recipe, REPO, image), worker,
                        "Standalone main.py must start from the worker directory")
                    self.assertIn('CMD ["python", "main.py"]', recipe)
                else:
                    self.assertIn("/opt/aequilibrae/bin/python", commands[0])

    def test_declared_standalone_contexts_include_shared_sources(self):
        render = (REPO / WORKER / "render.yaml").read_text()
        self.assertIn("    dockerContext: .\n", render)
        self.assertIn(f"    dockerfilePath: ./{WORKER}/Dockerfile\n", render)
        railway = json.loads((REPO / WORKER / "railway.json").read_text())
        self.assertEqual(railway["build"]["dockerfilePath"], f"{WORKER}/Dockerfile")
        self.assertEqual(railway["deploy"]["startCommand"], "python main.py")
        for name in ("fly.toml", "fly.push.toml"):
            config = tomllib.loads((REPO / WORKER / name).read_text())
            self.assertEqual(config["build"]["dockerfile"], f"{WORKER}/Dockerfile")
            self.assertEqual(config["processes"]["worker"], "python main.py")
        workflow = (REPO / ".github/workflows/compact-graph-native.yml").read_text()
        for name, directory in (("standalone", WORKER), ("shared-models", SHARED)):
            self.assertIn(f"- image: {name}\n            dockerfile: {directory}/Dockerfile\n            context: .\n", workflow)
        deploy = (REPO / WORKER / "DEPLOY.md").read_text()
        self.assertIn(f"docker build -f {WORKER}/Dockerfile -t openplan-aeq-worker .", deploy)
        self.assertNotIn("cd workers/aequilibrae_worker", deploy)


if __name__ == "__main__":
    unittest.main()
