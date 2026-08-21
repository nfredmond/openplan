#!/usr/bin/env python3
"""A test written below `if __name__ == "__main__":` never runs, and says so to nobody.

There is no pytest here. Most suites in both python trees end with a
hand-rolled runner that collects `test_*` callables out of `globals()` and
reports how many passed. Collection therefore happens at the moment the runner
executes, so anything defined AFTER it is invisible: the file grows, the count
does not, and the run prints a cheerful "N checks passed" either way.

That happened on 2026-08-20 — two new tests appended to
`test_count_validation.py`, a green run, and 33 checks reported against 35 test
functions in the file. Two characters of vertical position decided whether a
guard existed. It is the repository's signature defect in miniature: a check
that silently covers less than it claims and keeps answering "the tests passed".

WHAT THIS CHECKS: for every suite that uses the collect-from-globals runner, no
`test_*` function is defined below the runner block. Parsed, not grepped —
positions come from the AST, so a `__main__` string inside a docstring or a
comment cannot move the line the check uses.

WHAT IT DOES NOT CHECK: that a suite has a runner at all, or that its assertions
are any good. A file with no runner is somebody else's convention (unittest.main
collects by class), and this stays silent about it.
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


def suite_paths() -> list[Path]:
    found: list[Path] = []
    for directory in SUITE_DIRECTORIES:
        if directory.is_dir():
            found.extend(sorted(directory.glob("test_*.py")))
    return found


def main_guard_line(tree: ast.Module) -> int | None:
    """Line of the module-level `if __name__ == "__main__":`, if there is one."""
    for node in tree.body:
        if not isinstance(node, ast.If):
            continue
        test = node.test
        if not isinstance(test, ast.Compare) or not test.comparators:
            continue
        left, right = test.left, test.comparators[0]
        if (
            isinstance(left, ast.Name)
            and left.id == "__name__"
            and isinstance(right, ast.Constant)
            and right.value == "__main__"
        ):
            return node.lineno
    return None


def collects_at_runner_time(tree: ast.Module, source: str) -> bool:
    """Whether the runner can only see what exists when it executes.

    BOTH idioms in this repository are exposed, and the second was excluded from
    this guard until 2026-08-21, when it was found hiding six tests.

      * `globals()` collection: sees the names bound so far, so anything below
        it is invisible.
      * `unittest.main()`: gathers TestCase classes off the module object AS IT
        RUNS. A class defined after the call has not been created yet, so it is
        equally invisible — `test_link_vmt.py` carried a six-test
        `VmtByRoadClass` below its runner and reported "Ran 6 tests" for months.

    The earlier version of this function reasoned that unittest.main collects
    "after the whole file has executed". That is wrong: the module executes top
    to bottom and the call is a statement like any other.
    """
    return "globals()" in source and "unittest.main" not in source


def tests_below(tree: ast.Module, line: int) -> list[str]:
    """Every test the runner cannot see: bare functions AND TestCase classes.

    Classes were missed until 2026-08-21. A `unittest.TestCase` below the runner
    holds however many tests it likes and none of them run, which is the larger
    version of the same defect.
    """
    hidden: list[str] = []
    for node in tree.body:
        if node.lineno <= line:
            continue
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            hidden.append(node.name)
        elif isinstance(node, ast.ClassDef):
            methods = [
                child.name for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                and child.name.startswith("test_")
            ]
            hidden.extend(f"{node.name}::{name}" for name in methods)
    return hidden


class NoTestIsDefinedBelowTheRunnerThatCollectsIt(unittest.TestCase):
    def test_the_detector_finds_suites_that_use_this_runner(self) -> None:
        """A floor. If the detector matches nothing it would pass forever while
        proving nothing, which is the failure this whole file is about."""
        using = [
            path
            for path in suite_paths()
            if (tree := ast.parse(source := path.read_text())) is not None
            and main_guard_line(tree) is not None
            and collects_at_runner_time(tree, source)
        ]
        self.assertGreaterEqual(len(using), 10, "the collect-from-globals runner detector broke")

    def test_no_suite_defines_a_test_below_its_runner(self) -> None:
        offenders: list[str] = []
        for path in suite_paths():
            source = path.read_text()
            tree = ast.parse(source)
            line = main_guard_line(tree)
            if line is None or not collects_at_runner_time(tree, source):
                continue
            for name in tests_below(tree, line):
                offenders.append(f"{path.relative_to(REPO_ROOT)}::{name}")
        self.assertEqual(
            offenders,
            [],
            "These tests are defined below the runner that collects them, so they never execute "
            "and the suite still reports a pass. Move them above the "
            '`if __name__ == "__main__":` block.\n' + "\n".join(offenders),
        )


if __name__ == "__main__":
    unittest.main(verbosity=1)
