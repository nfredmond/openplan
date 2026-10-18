"""Small unittest checks. Shell tests use inert interpreters, never real workers.

Run: PYTHONDONTWRITEBYTECODE=1 python3 -B workers/aequilibrae_worker/test_local_launchers.py
The real preflight reads fixture distribution metadata and imports inert modules.
No environment install, database connection, scientific data or model run occurs.
"""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from importlib import metadata


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
spec = importlib.util.spec_from_file_location("local_dependencies", HERE / "check_local_dependencies.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

LAUNCHERS = ("scripts/run-local-modeling.sh", "workers/aequilibrae_worker/run.sh")
VALID = {"aequilibrae": "1.6.2", "numpy": "2.0.2", "pandas": "2.3.3"}


class RequirementsTests(unittest.TestCase):
    def requirements(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requirements.txt"
            path.write_text(text)
            return preflight.read_requirements(path)

    def test_actual_requirements_and_comments(self):
        requirements = preflight.read_requirements(HERE / "requirements.txt")
        lines = (HERE / "requirements.txt").read_text().splitlines()
        for name, requirement in requirements.items():
            line = next(line for line in lines if line.startswith(name))
            self.assertEqual({str(item) for item in requirement.specifier}, set(line[len(name):].split(",")))
            self.assertEqual(name, requirement.name.lower())
        self.assertEqual(preflight.check_versions(requirements, VALID.__getitem__), [])
        for name, invalid in (("aequilibrae", "1.7.0"), ("numpy", "2.5.1"), ("pandas", "3.0.3")):
            with self.subTest(name=name):
                versions = dict(VALID, **{name: invalid})
                errors = preflight.check_versions(requirements, versions.__getitem__)
                self.assertEqual(len(errors), 1)
                self.assertIn(f"{name}: installed {invalid}; requires", errors[0])

    def test_pep440_specifiers(self):
        requirements = self.requirements(
            "# comments and whitespace\n  AequilibraE ~= 1.6.2 # retained minor\n"
            "numpy >= 1.26, < 2.1, != 2.0.1\npandas == 2.3.*\nrequests>=2.31\n"
        )
        for version, allowed in (("1.25.2", False), ("1.26", True), ("2.0.1", False),
                                 ("2.0.2", True), ("2.1", False), ("2.1rc1", False)):
            with self.subTest(version=version):
                errors = preflight.check_versions(requirements, dict(VALID, numpy=version).__getitem__)
                self.assertEqual(errors == [], allowed)
        self.assertTrue(preflight.check_versions(requirements, dict(VALID, aequilibrae="1.7.0").__getitem__))
        self.assertEqual(preflight.check_versions(requirements, dict(VALID, pandas="2.3.9").__getitem__), [])
        requirements = self.requirements("aequilibrae==1!1.6.2\nnumpy>=2.0rc1,<2.1\npandas==2.3.3.post1\n")
        self.assertEqual(preflight.check_versions(requirements, {
            "aequilibrae": "1!1.6.2", "numpy": "2.0rc1", "pandas": "2.3.3.post1",
        }.__getitem__), [])

    def test_missing_and_unknown_versions_refused(self):
        requirements = preflight.read_requirements(HERE / "requirements.txt")
        for unknown in (None, "", "unknown"):
            with self.subTest(unknown=unknown):
                errors = preflight.check_versions(requirements, dict(VALID, pandas=unknown).__getitem__)
                self.assertEqual(len(errors), 1)
                self.assertIn("pandas: installed version is unknown or invalid", errors[0])

        def missing(name):
            if name == "numpy":
                raise metadata.PackageNotFoundError(name)
            return VALID[name]

        errors = preflight.check_versions(requirements, missing)
        self.assertEqual(len(errors), 1)
        self.assertIn("numpy: installed distribution metadata is missing", errors[0])

    def test_ambiguous_or_unreadable_requirements_refused(self):
        base = "aequilibrae==1.6.2\nnumpy>=1.26,<2.1\npandas==2.3.3\n"
        for content, reason in (
            (base.replace("pandas==2.3.3\n", ""), "missing numerical requirements: pandas"),
            (base + "pandas==3.0.3\n", "duplicate numerical requirement: pandas"),
            (base.replace("pandas==2.3.3", "pandas"), "unconditional numerical version constraint"),
            (base.replace("pandas==2.3.3", 'pandas==2.3.3; python_version < "3.12"'), "unconditional numerical version constraint"),
            (base.replace("pandas==2.3.3", "pandas @ https://example.invalid/pandas.whl"), "unconditional numerical version constraint"),
            (base.replace("pandas==2.3.3", "pandas[test]==2.3.3"), "unconditional numerical version constraint"),
            (base + "-r other.txt\n", "invalid requirement"),
        ):
            with self.subTest(reason=reason, content=content):
                with self.assertRaisesRegex(ValueError, reason):
                    self.requirements(content)


# Each fixture interpreter runs the real helper, but records worker entry instead
# of executing main.py or supabase_poll.py. ActivitySim probes have controlled
# import outcomes so an installed system package cannot change the test.
INTERPRETER = '''#!{python}
import json, os, sys
from pathlib import Path
config = json.loads(Path(__file__ + ".json").read_text())
args = sys.argv[1:]
with open(config["calls"], "a") as handle:
    handle.write(json.dumps({{"interpreter": str(Path(__file__).resolve()), "args": args}}) + "\\n")
if args and args[0] == "-B":
    env = dict(os.environ, PYTHONPATH=config["modules"], PYTHONDONTWRITEBYTECODE="1")
    os.execve(sys.executable, [sys.executable, *args], env)
if args and args[0] == "-c":
    sys.exit(0 if args[1] in config["imports"] else 1)
if args and args[0] == "-u":
    with open(config["entries"], "a") as handle:
        handle.write(json.dumps({{
            "interpreter": str(Path(__file__).resolve()), "worker": args[1],
            "AEQ_CALIBRATE": os.getenv("AEQ_CALIBRATE"),
            "COUNT_AUTO_INGEST": os.getenv("COUNT_AUTO_INGEST"),
            "ACTIVITYSIM_CLI": os.getenv("ACTIVITYSIM_CLI"),
            "ACTIVITYSIM_CLI_TEMPLATE": os.getenv("ACTIVITYSIM_CLI_TEMPLATE"),
        }}) + "\\n")
    sys.exit(0)
raise SystemExit("Unexpected fixture invocation: " + repr(args))
'''


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="openplan launcher ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for relative in (*LAUNCHERS, "workers/aequilibrae_worker/check_local_dependencies.py",
                         "workers/aequilibrae_worker/requirements.txt"):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / relative, target)
        self.calls = self.root / "calls.jsonl"
        self.entries = self.root / "entries.jsonl"
        self.environment = {
            "PATH": str(self.root / "bin") + os.pathsep + os.defpath,
            "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1",
        }
        self.interpreter("bin/python3", imports=["import requests, dotenv"])

    def interpreter(self, relative, versions=None, imports=None, broken_import=None):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        modules = path.parent / (path.name + "-modules")
        modules.mkdir(exist_ok=True)
        for name, version in (VALID if versions is None else versions).items():
            (modules / f"{name}.py").write_text(
                "raise ImportError('fixture broken numerical import')\n" if name == broken_import else "# inert numerical module\n"
            )
            info = modules / f"{name}-{version}.dist-info"
            info.mkdir(exist_ok=True)
            (info / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n")
        path.write_text(INTERPRETER.format(python=sys.executable))
        path.chmod(0o700)
        Path(str(path) + ".json").write_text(json.dumps({
            "modules": str(modules), "imports": imports or [],
            "entries": str(self.entries), "calls": str(self.calls),
        }))
        return path

    def records(self, path):
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def clear_records(self):
        self.entries.unlink(missing_ok=True)
        self.calls.unlink(missing_ok=True)

    def launch(self, launcher, environment=None, args=()):
        return subprocess.run(
            ["bash", str(self.root / launcher), *args], cwd=self.root.parent,
            env=dict(self.environment, **(environment or {})),
            text=True, capture_output=True, timeout=15,
        )

    def assert_launches(self, result, interpreter, count):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entries = self.records(self.entries)
        self.assertEqual(len(entries), count, entries)
        aeq = [entry for entry in entries if Path(entry["worker"]).name == "main.py"]
        self.assertEqual(len(aeq), 1, entries)
        self.assertEqual(aeq[0]["interpreter"], str(interpreter))
        return entries

    def test_explicit_external_path_with_spaces(self):
        external = self.interpreter("external execution env/bin/python")
        self.interpreter("workers/aequilibrae_worker/.venv311/bin/python")
        for launcher, count in zip(LAUNCHERS, (2, 1)):
            with self.subTest(launcher=launcher):
                self.clear_records()
                result = self.launch(launcher, {"OPENPLAN_AEQUILIBRAE_PYTHON": str(external)})
                entries = self.assert_launches(result, external, count)
                self.assertTrue(all(entry["AEQ_CALIBRATE"] is None and entry["COUNT_AUTO_INGEST"] is None for entry in entries))

    def test_compatible_automatic_selection(self):
        first = self.interpreter("workers/aequilibrae_worker/.venv311/bin/python")
        second = self.interpreter("workers/aequilibrae_worker/.venv/bin/python")
        for launcher, count in zip(LAUNCHERS, (2, 1)):
            with self.subTest(launcher=launcher):
                self.clear_records()
                self.assert_launches(self.launch(launcher), first, count)
                self.assertFalse(any(call["interpreter"] == str(second) for call in self.records(self.calls)))

    def test_unsupported_automatic_candidate_is_disclosed_and_skipped(self):
        self.interpreter("workers/aequilibrae_worker/.venv311/bin/python", dict(VALID, pandas="3.0.3"))
        second = self.interpreter("workers/aequilibrae_worker/.venv/bin/python")
        for launcher, count in zip(LAUNCHERS, (2, 1)):
            with self.subTest(launcher=launcher):
                self.clear_records()
                result = self.launch(launcher)
                self.assert_launches(result, second, count)
                self.assertIn("pandas: installed 3.0.3; requires pandas==2.3.3", result.stderr)
                self.assertIn("rejecting incompatible AequilibraE interpreter", result.stderr)

    def test_unsupported_versions_refused_before_any_worker_entry(self):
        for name, invalid in (("aequilibrae", "1.7.0"), ("numpy", "2.5.1"), ("pandas", "3.0.3")):
            for launcher in LAUNCHERS:
                with self.subTest(name=name, launcher=launcher):
                    self.clear_records()
                    # Replace the entire candidate directory to avoid stale metadata.
                    candidate = self.root / "workers/aequilibrae_worker/.venv311"
                    if candidate.exists():
                        shutil.rmtree(candidate)
                    self.interpreter("workers/aequilibrae_worker/.venv311/bin/python", dict(VALID, **{name: invalid}))
                    result = self.launch(launcher)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(f"{name}: installed {invalid}; requires", result.stderr)
                    self.assertIn("no AequilibraE interpreter satisfies", result.stderr)
                    self.assertEqual(self.records(self.entries), [])

    def test_explicit_invalid_selection_never_falls_back(self):
        self.interpreter("workers/aequilibrae_worker/.venv311/bin/python")
        bad = self.interpreter("external unsupported/bin/python", dict(VALID, pandas="3.0.3"))
        for selected in (str(bad), str(self.root / "missing python"), "", "relative/bin/python"):
            for launcher in LAUNCHERS:
                with self.subTest(selected=selected, launcher=launcher):
                    self.clear_records()
                    result = self.launch(launcher, {"OPENPLAN_AEQUILIBRAE_PYTHON": selected})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("ERROR:", result.stderr)
                    self.assertEqual(self.records(self.entries), [])
                    self.assertTrue(all(call["interpreter"] == str(bad) for call in self.records(self.calls)))
                    if selected == str(bad):
                        self.assertIn("no fallback", result.stderr)
                        self.assertIn("pandas: installed 3.0.3", result.stderr)

    def test_import_failure_refused_even_with_compatible_versions(self):
        self.interpreter("workers/aequilibrae_worker/.venv311/bin/python", broken_import="aequilibrae")
        for launcher in LAUNCHERS:
            with self.subTest(launcher=launcher):
                self.clear_records()
                result = self.launch(launcher)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("fixture broken numerical import", result.stderr)
                self.assertEqual(self.records(self.entries), [])

    def test_missing_packaging_refused_before_worker_entry(self):
        candidate = self.interpreter("workers/aequilibrae_worker/.venv311/bin/python")
        (candidate.parent / "python-modules/packaging.py").write_text("raise ImportError('fixture missing packaging')\n")
        for launcher in LAUNCHERS:
            with self.subTest(launcher=launcher):
                self.clear_records()
                result = self.launch(launcher)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("dependency preflight needs packaging", result.stderr)
                self.assertEqual(self.records(self.entries), [])

    def test_requirements_file_controls_acceptance(self):
        candidate = self.interpreter("workers/aequilibrae_worker/.venv311/bin/python", dict(VALID, pandas="3.0.3"))
        result = self.launch(LAUNCHERS[1])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.records(self.entries), [])
        path = self.root / "workers/aequilibrae_worker/requirements.txt"
        path.write_text(path.read_text().replace("pandas==2.3.3", "pandas==3.0.3"))
        self.clear_records()
        self.assert_launches(self.launch(LAUNCHERS[1]), candidate, 1)

    def test_activitysim_preflight_fallback_preserves_cli_configuration(self):
        candidate = self.interpreter("workers/aequilibrae_worker/.venv311/bin/python", imports=["import requests, dotenv"])
        result = self.launch(LAUNCHERS[0], {"ACTIVITYSIM_CLI": 'custom-cli --option "two words"',
                                          "ACTIVITYSIM_CLI_TEMPLATE": "custom template {data_dir}"})
        entries = self.assert_launches(result, candidate, 2)
        activity = next(entry for entry in entries if Path(entry["worker"]).name == "supabase_poll.py")
        self.assertEqual(activity["interpreter"], str(candidate))
        self.assertEqual(activity["ACTIVITYSIM_CLI"], 'custom-cli --option "two words"')
        self.assertEqual(activity["ACTIVITYSIM_CLI_TEMPLATE"], "custom template {data_dir}")
        self.assertIn("PREFLIGHT-ONLY", result.stdout)

    def test_activitysim_missing_or_unusable_exec_uses_python3_fallback(self):
        candidate = self.interpreter("workers/aequilibrae_worker/.venv311/bin/python")
        for unusable in (False, True):
            with self.subTest(unusable=unusable):
                if unusable:
                    self.interpreter("workers/activitysim_worker/.venv-exec/bin/python")
                self.clear_records()
                result = self.launch(LAUNCHERS[0])
                entries = self.assert_launches(result, candidate, 2)
                activity = next(entry for entry in entries if Path(entry["worker"]).name == "supabase_poll.py")
                self.assertEqual(activity["interpreter"], str(self.root / "bin/python3"))
                self.assertIsNone(activity["ACTIVITYSIM_CLI"])
                self.assertIn("PREFLIGHT-ONLY", result.stdout)

    def test_activitysim_exec_binding_and_calibrate_option_unchanged(self):
        candidate = self.interpreter("workers/aequilibrae_worker/.venv311/bin/python")
        execution = self.interpreter("workers/activitysim_worker/.venv-exec/bin/python", imports=["import activitysim, requests, dotenv"])
        result = self.launch(LAUNCHERS[0], {"ACTIVITYSIM_CLI": "previous-cli"}, args=("--calibrate",))
        entries = self.assert_launches(result, candidate, 2)
        activity = next(entry for entry in entries if Path(entry["worker"]).name == "supabase_poll.py")
        self.assertEqual(activity["interpreter"], str(execution))
        self.assertEqual(activity["ACTIVITYSIM_CLI"], str(execution.with_name("activitysim")))
        self.assertIn("EXECUTION", result.stdout)
        for entry in entries:
            self.assertEqual(entry["AEQ_CALIBRATE"], "1")
            self.assertEqual(entry["COUNT_AUTO_INGEST"], "1")

    def test_help_and_unknown_argument_do_not_enter_workers(self):
        help_result = self.launch(LAUNCHERS[0], args=("--help",))
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("OPENPLAN_AEQUILIBRAE_PYTHON", help_result.stdout)
        bad_result = self.launch(LAUNCHERS[0], args=("--unknown",))
        self.assertEqual(bad_result.returncode, 2)
        self.assertEqual(self.records(self.entries), [])
        self.assertEqual(self.records(self.calls), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
