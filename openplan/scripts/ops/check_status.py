"""
THE RULE BEHIND THE CONTROL PANEL'S "AUTOMATED CHECKS" ROW.

Kept in its own module, free of any GUI import, for one reason: the defect this
now refuses was invisible because nothing could exercise it. The verdict was
computed inline between a `gh` subprocess call and a Tk label, so testing it
meant having GitHub and a display. `scripts/ops/tests/test_automated_checks.py`
imports this and nothing else.
"""

# Status colours, beside the rule that chooses between them.
OK, WARN, BAD, IDLE = "#1a7f37", "#b8860b", "#b42318", "#6b7280"

# A conclusion GitHub can report that means the workflow is FINE. Everything
# else — failure, timed_out, cancelled, startup_failure, action_required, and
# anything GitHub adds later — is not fine, and this row must say so.
#
# "skipped" is a real answer for Production Health: there is no hosted OpenPlan
# to poll, so it skips itself on purpose.
HEALTHY_CONCLUSIONS = frozenset({"success", "skipped"})


def summarize_check_conclusions(by_workflow: dict[str, list[str]]) -> tuple[str, str]:
    """
    Turn per-workflow run conclusions into this row's colour and sentence.

    Split out from the `gh` call so it can be tested: the defect it now refuses
    was invisible precisely because nothing could exercise it without GitHub.

    THE RULE IS AN ALLOW-LIST, and that is the fix. It used to ask
    `conclusion == "failure"` for broken and `== "success"` for passing, so a
    workflow that TIMED OUT was counted in neither: the row printed "all 3
    checks passing" with the sick one silently absent from the count. The
    45-minute nightly needs a whole stack and eight minutes of smokes, so
    timing out is one of its likeliest failures — and this row exists because a
    red check went unread for ten days. Naming the conclusions that are fine,
    rather than the ones that are not, means a conclusion nobody anticipated
    reads as broken rather than as green.
    """
    latest = {name: results[0] for name, results in by_workflow.items()}
    if not latest:
        return IDLE, "cannot check — no finished runs reported yet"

    streak: dict[str, int] = {}
    for name, results in by_workflow.items():
        count = 0
        for conclusion in results:
            if conclusion in HEALTHY_CONCLUSIONS:
                break
            count += 1
        streak[name] = count

    broken = {n: c for n, c in latest.items() if c not in HEALTHY_CONCLUSIONS}
    if broken:
        parts = []
        for name in sorted(broken):
            failed = streak.get(name, 1)
            # The sample is the last 40 runs across ALL workflows, so a nightly
            # gets only a handful of slots in it. When every run we can see has
            # failed, the true streak is longer than the number — say "at least"
            # rather than printing a figure that understates how long something
            # has been broken. This row exists because a red check was ignored
            # for ten days; a reassuringly small number here would be its own
            # version of that.
            seen_all = failed >= len(by_workflow[name])
            count = f"at least {failed}" if seen_all else str(failed)
            # NAME THE CONCLUSION when it is not a plain failure. "timed out"
            # and "cancelled" send a maintainer somewhere different from a real
            # test failure, and the row has room to say which.
            how = "" if broken[name] == "failure" else f", {broken[name].replace('_', ' ')}"
            parts.append(f"{name} ({count} run{'s' if failed != 1 else ''} in a row{how})")
        return BAD, "FAILING: " + ", ".join(parts)

    passing = [n for n, c in latest.items() if c == "success"]
    skipped = [n for n, c in latest.items() if c == "skipped"]
    if not passing:
        return IDLE, "nothing has actually run — every check was skipped"
    tail = f", {len(skipped)} skipped on purpose" if skipped else ""
    return OK, f"all {len(passing)} checks passing{tail}"
