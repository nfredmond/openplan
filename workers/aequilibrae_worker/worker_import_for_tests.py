"""Import `main.py` from a test, in the environment CI actually provides.

NOT PRODUCTION CODE. Nothing in the worker imports this; it exists so that the
suites which need a function out of `main.py` can reach it without a Supabase
project or the AequilibraE engine behind them.

Two separate things stand between a test and that import, and BOTH have made
this repository red on main:

  1. **Credentials.** `main.py` raises at import when SUPABASE_URL and
     SUPABASE_SERVICE_ROLE_KEY are absent. Right for a worker process, which
     cannot do its job without them; a trap for a test, which passes on a
     machine holding `openplan/.env.local` and fails in CI. Placeholders are
     safe because nothing at import time contacts a project — main.py reads the
     two strings, formats a headers dict, and builds every request URL lazily
     inside the function that makes the call. The host below is deliberately
     unroutable, so a regression that DID reach out at import fails loudly
     rather than finding a real project.

  2. **The engine.** `main.py` imports `OSMBuilder` at module level, and both
     CI python jobs deliberately install a lightweight environment without
     AequilibraE — keeping the heavy engine out of CI is those jobs' own
     recorded decision. That single import boundary is stubbed, and nothing
     else: a test that actually executes the engine must not be running here.

WHY THIS IS A MODULE AND NOT TWO COPIES. Both halves already existed inside
`test_activitysim_assignment_handoff.py`, which is exactly the shape CLAUDE.md
warns about — a shared capability living inside one of its two callers gets
reimplemented, wrongly, by the second. The second caller
(`scripts/modeling/tests/test_assignment_convergence_settings.py`) arrived on
2026-08-20 with half of it and went red in CI on the other half.

VERIFYING A CHANGE HERE. `env -i` is NOT enough: main.py also calls
`load_dotenv` on an absolute path to `openplan/.env.local`, so the credentials
arrive from disk and the check passes either way. Stub the loader too — see
`docs/modeling/COUNT_FACILITY_MATCHING_2026-08-20.md` and the
`env-i-is-not-a-credential-free-run` note.
"""
from __future__ import annotations

import os
import sys
import types
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent


def stub_engine_import_boundary() -> bool:
    """Supply `aequilibrae`'s module-load surface when the engine is absent.

    Returns True when a stub was installed, so a caller can say which it got.
    Only the OSM builder is provided, because that is the only thing main.py
    imports at module level; every other engine use is inside a function and
    stays a real import for whoever actually runs it.
    """
    try:
        import aequilibrae  # noqa: F401, PLC0415

        return False
    except ImportError:
        pass

    class OSMBuilder:  # noqa: D401 - the boundary, not a reimplementation
        pass

    osm_builder = types.ModuleType("aequilibrae.project.network.osm.osm_builder")
    osm_builder.OSMBuilder = OSMBuilder
    for module_name in (
        "aequilibrae",
        "aequilibrae.project",
        "aequilibrae.project.network",
        "aequilibrae.project.network.osm",
    ):
        sys.modules.setdefault(module_name, types.ModuleType(module_name))
    sys.modules["aequilibrae.project.network.osm.osm_builder"] = osm_builder
    return True


def import_worker_main():
    """`main.py`, imported with placeholder credentials and no engine required."""
    if str(WORKER_DIR) not in sys.path:
        sys.path.insert(0, str(WORKER_DIR))

    # Two literal calls rather than a loop, so that
    # scripts/modeling/tests/test_suites_import_main_without_credentials.py can
    # read the names out of the AST. A loop over a dict hides them from every
    # reader, guard and human alike.
    os.environ.setdefault("SUPABASE_URL", "http://worker-import-only.invalid")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "import-only-not-a-key")

    stub_engine_import_boundary()

    import assignment_settings  # noqa: PLC0415

    if assignment_settings.installed_assignment_engine_version() is None:
        assignment_settings.installed_assignment_engine_version = lambda: "test-only-aequilibrae"

    import main  # noqa: PLC0415

    return main
