#!/usr/bin/env python3
"""
THE CONTROL-PANEL ROW MUST NEVER SHOW GREEN WHEN IT DOES NOT KNOW.

That sentence is the row's own docstring, and it exists because two GitHub
checks were red and unread — the tenant-isolation proof for three and a half
days and 48 pushes, and the nightly browser walk-through for its entire life.
One of them had been trying to say, for ten days, that residents' comments were
being posted before anyone could read them back.

The row still had a hole. It asked `conclusion == "failure"` for broken and
`== "success"` for passing, so a workflow whose latest run TIMED OUT was counted
in neither: the row printed "all 3 checks passing" with the sick workflow
silently absent from the count. The 45-minute nightly needs a whole stack and
eight minutes of smokes, so timing out is among its likeliest failures — the row
would have gone green on exactly the check it was built for.

Run directly (`python3 test_automated_checks.py`) — this repository has no
pytest, and these suites are scripts. Stdlib only.
"""

import sys
from pathlib import Path

# Imports `check_status`, NOT the panel: the rule lives in its own module
# precisely so this test needs neither a display nor GitHub.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import check_status as panel

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label}{': ' + detail if detail else ''}")
        print(f"  FAIL {label}{': ' + detail if detail else ''}")


def test_all_green():
    colour, text = panel.summarize_check_conclusions(
        {"CI": ["success", "success"], "RLS Isolation": ["success"]}
    )
    check("all successes read as passing", colour == panel.OK, text)
    check("and say how many", "all 2 checks passing" in text, text)


def test_skipped_is_not_broken():
    colour, text = panel.summarize_check_conclusions(
        {"CI": ["success"], "Production Health": ["skipped", "skipped"]}
    )
    check("a deliberately skipped workflow is not broken", colour == panel.OK, text)
    check("and is named as skipped on purpose", "skipped on purpose" in text, text)


def test_everything_skipped_is_not_green():
    colour, text = panel.summarize_check_conclusions({"Production Health": ["skipped"]})
    check("nothing having run is not 'passing'", colour == panel.IDLE, text)


def test_failure_is_broken():
    colour, text = panel.summarize_check_conclusions({"CI": ["failure", "failure", "success"]})
    check("a failure is broken", colour == panel.BAD, text)
    check("with its streak", "2 runs in a row" in text, text)


def test_timed_out_is_broken():
    """THE DEFECT. A timed-out nightly used to be counted as neither."""
    colour, text = panel.summarize_check_conclusions(
        {"CI": ["success"], "QA Harness Nightly": ["timed_out", "success"]}
    )
    check("a timed-out workflow is BROKEN, not absent", colour == panel.BAD, text)
    check("it is named", "QA Harness Nightly" in text, text)
    check("and the row never claims everything passes", "checks passing" not in text, text)
    check("the conclusion is spelled out, not just 'failed'", "timed out" in text, text)


def test_cancelled_and_startup_failure_are_broken():
    for conclusion in ("cancelled", "startup_failure", "action_required"):
        colour, text = panel.summarize_check_conclusions({"CI": [conclusion]})
        check(f"{conclusion} is broken", colour == panel.BAD, text)


def test_an_unknown_future_conclusion_is_broken():
    """
    The rule is an ALLOW-list on purpose: a conclusion GitHub adds after this
    was written must read as broken, not as green. A deny-list would have to be
    updated by someone who already knew about the new value.
    """
    colour, text = panel.summarize_check_conclusions({"CI": ["some_future_conclusion"]})
    check("an unrecognised conclusion is broken", colour == panel.BAD, text)


def test_no_runs_at_all():
    colour, text = panel.summarize_check_conclusions({})
    check("no finished runs says so", colour == panel.IDLE, text)


for fn in [
    test_all_green,
    test_skipped_is_not_broken,
    test_everything_skipped_is_not_green,
    test_failure_is_broken,
    test_timed_out_is_broken,
    test_cancelled_and_startup_failure_are_broken,
    test_an_unknown_future_conclusion_is_broken,
    test_no_runs_at_all,
]:
    print(fn.__name__)
    fn()

if failures:
    print(f"\n{len(failures)} check(s) failed")
    sys.exit(1)
print("\nall checks passed")
