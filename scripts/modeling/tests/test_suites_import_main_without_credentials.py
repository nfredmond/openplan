#!/usr/bin/env python3
"""A test that needs a Supabase project is a test that only runs on one laptop.

`workers/aequilibrae_worker/main.py` raises at IMPORT time when SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY are absent. That is right for a worker process, which
cannot do its job without them, and it sets a trap for every test that imports
the module to reach a function inside it:

    a developer machine has the credentials in .env.local, so the test passes;
    CI has none, so the same test fails with "Missing Supabase credentials".

The failure is therefore invisible exactly where it is introduced, and it lands
on main as a red gate caused by the test rather than by the code. It has
happened TWICE — `test_gateways.py` on 2026-08-18, and
`test_assignment_convergence_settings.py` on 2026-08-20 — and both times the
person who wrote it had run the suite and seen it pass.

The fix each time was the same three lines the older worker suites already use:
set placeholder credentials with `os.environ.setdefault` before importing. Safe
because nothing at import time contacts a project — main.py reads the two
strings, formats a headers dict, and builds every request URL lazily inside the
function that makes the call.

So this is the tracked half of that convention. Twice is a pattern, and a
pattern that only exists in a commit message will be repeated by whoever has not
read it.

WHY AST RATHER THAN A TEXT SCAN. A guard that greps for the credential names is
satisfied by a COMMENT mentioning them — including the comment above the very
import it is meant to police, which is how five guards in this repository were
broken in a single day. Parsing puts comments and docstrings structurally out of
reach: an import is an import node, and a call is a call node.

WHAT THIS DOES NOT PROVE: that a suite passes without credentials, only that it
can reach `import main` without them. Running the suites is what proves the
rest, and `env -i` is how to do it honestly.
"""
from __future__ import annotations

import ast
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SUITE_DIRECTORIES = (
    REPO_ROOT / "scripts" / "modeling" / "tests",
    REPO_ROOT / "scripts" / "modeling",
    REPO_ROOT / "workers" / "aequilibrae_worker",
)
CREDENTIAL_VARIABLES = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")


def test_suites() -> list[Path]:
    found: list[Path] = []
    for directory in SUITE_DIRECTORIES:
        if directory.is_dir():
            found.extend(sorted(directory.glob("test_*.py")))
    return found


def imports_worker_main(tree: ast.AST) -> bool:
    """True when the module imports the worker entry point, at any depth.

    Checks nested scopes too: the 2026-08-20 instance was a function-local
    `import main as worker_main`, which a module-scope-only check would have
    called clean.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(alias.name == "main" for alias in node.names):
                return True
        elif isinstance(node, ast.ImportFrom) and node.module == "main":
            return True
    return False


def credentials_defaulted(tree: ast.AST) -> set[str]:
    """Which credential variables the module gives a placeholder value.

    Accepts `os.environ.setdefault(NAME, ...)` and the `environ.setdefault`
    spelling, because both appear in the suites that already do this. Requires a
    literal name — a variable would leave this guard unable to see what was set.
    """
    defaulted: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr != "setdefault":
            continue
        target = node.func.value
        target_name = (
            target.attr if isinstance(target, ast.Attribute)
            else target.id if isinstance(target, ast.Name)
            else ""
        )
        if target_name != "environ":
            continue
        if node.args and isinstance(node.args[0], ast.Constant):
            value = node.args[0].value
            if value in CREDENTIAL_VARIABLES:
                defaulted.add(value)
    return defaulted


class ASuiteThatImportsTheWorkerSuppliesItsOwnCredentials(unittest.TestCase):
    def test_the_detector_can_see_the_suites(self) -> None:
        """A floor, not an equality — suites get added. But if the glob breaks,
        this guard would pass by finding nothing, which is the vacuous-test
        failure this repository keeps rediscovering."""
        suites = test_suites()
        self.assertGreaterEqual(len(suites), 60, "suite discovery collapsed")
        importers = [path for path in suites if imports_worker_main(ast.parse(path.read_text()))]
        self.assertGreaterEqual(
            len(importers),
            5,
            "no suite imports main.py any more. If that is true this guard is obsolete and "
            "should be deleted rather than left passing on an empty set.",
        )

    def test_every_suite_importing_main_defaults_both_credentials(self) -> None:
        offenders: list[str] = []
        for path in test_suites():
            tree = ast.parse(path.read_text())
            if not imports_worker_main(tree):
                continue
            missing = sorted(set(CREDENTIAL_VARIABLES) - credentials_defaulted(tree))
            if missing:
                offenders.append(f"{path.relative_to(REPO_ROOT)} does not default {missing}")
        self.assertEqual(
            offenders,
            [],
            "These suites import workers/aequilibrae_worker/main.py, which raises at import "
            "when Supabase credentials are absent. They pass on a machine holding .env.local "
            "and fail in CI. Add, before the import:\n"
            '    os.environ.setdefault("SUPABASE_URL", "http://worker-import-only.invalid")\n'
            '    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "import-only-not-a-key")\n'
            "then verify with `env -i HOME=/tmp PATH=/usr/bin:/bin <venv>/bin/python <suite>`.\n"
            + "\n".join(offenders),
        )


if __name__ == "__main__":
    unittest.main(verbosity=1)
