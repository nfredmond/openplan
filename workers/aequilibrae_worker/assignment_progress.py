#!/usr/bin/env python3
"""Stream the assignment's own progress into the run's stage log.

=========================================================== WHY THIS EXISTS

`assig.execute()` is one blocking call that can run for minutes. Nothing was
written to the stage log while it ran, so a planner watching a run in OpenPlan
saw the console box freeze on "Running assignment..." and had no way to tell a
healthy long run from a hung one. The stuck-run banner only fires after ten
minutes, which is longer than many assignments take in total.

AequilibraE already logs a line per iteration — `iteration,rgap,stepsize` — so
there is real progress to show. This forwards it. It does NOT invent a
percentage: how many iterations an equilibrium assignment needs is not known
until it converges, and a bar that fills at a rate nobody can predict is a
worse lie than no bar at all. What a reader gets is the iteration count, the
gap the engine has actually reached, and the gap it is aiming for — from which
the distance left is visible without anyone pretending to know the time.

======================================================= WHAT IT PROTECTS AGAINST

**Warnings are never throttled.** "Descent direction stepsize finder has not
converged" means the assignment is struggling, and it is exactly what a
throttle would drop while forwarding the routine iteration line either side of
it.

**The final line always goes out.** A throttled stream whose last update is
swallowed leaves the log ending mid-run, which reads as a crash.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Callable

# AequilibraE's per-iteration line: three comma-separated numbers, no labels
# (linear_approximation.py logs `f"{self.iter},{self.rgap},{self.stepsize}"`).
_ITERATION_LINE = re.compile(
    r"^\s*(\d+)\s*,\s*([0-9eE.+-]+)\s*,\s*([0-9eE.+-]+)\s*$"
)

DEFAULT_INTERVAL_SECONDS = 5.0


class AssignmentProgress(logging.Handler):
    """A logging handler that forwards assignment progress to a callback.

    ``emit_line`` is called with a ready-to-append line of text. It is called at
    most once per ``interval_seconds`` for routine iterations, immediately for
    warnings and errors, and once more on ``close()`` if the most recent
    iteration has not been sent.
    """

    def __init__(
        self,
        emit_line: Callable[[str], None],
        *,
        target_gap: float | None = None,
        max_iterations: int | None = None,
        interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__(level=logging.INFO)
        self._emit_line = emit_line
        self._target_gap = target_gap
        self._max_iterations = max_iterations
        self._interval = interval_seconds
        self._now = now
        self._last_sent_at: float | None = None
        self._pending: str | None = None
        self.iterations_seen = 0

    def describe(self, iteration: int, gap: float, stepsize: float) -> str:
        parts = [f"Assignment iteration {iteration:,}"]
        if self._max_iterations:
            parts[0] += f" of at most {self._max_iterations:,}"
        parts.append(f"relative gap {gap:.6g}")
        if self._target_gap:
            parts.append(f"target {self._target_gap:.6g}")
        parts.append(f"step {stepsize:.4g}")
        return " — ".join([parts[0], ", ".join(parts[1:])])

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage().strip()
        except Exception:  # pragma: no cover - a broken record must not kill a run
            return

        if record.levelno >= logging.WARNING:
            # Never throttled: this is the line that explains a bad result.
            self._send(f"Assignment warning: {message}")
            return

        match = _ITERATION_LINE.match(message)
        if not match:
            return
        try:
            iteration = int(match.group(1))
            gap = float(match.group(2))
            stepsize = float(match.group(3))
        except ValueError:
            return

        self.iterations_seen += 1
        line = self.describe(iteration, gap, stepsize)
        moment = self._now()
        if self._last_sent_at is None or (moment - self._last_sent_at) >= self._interval:
            self._send(line)
        else:
            # Held back rather than dropped, so `close()` can still report where
            # the run actually got to.
            self._pending = line

    def _send(self, line: str) -> None:
        self._pending = None
        self._last_sent_at = self._now()
        try:
            self._emit_line(line)
        except Exception:  # pragma: no cover - progress reporting must never fail a run
            pass

    def close(self) -> None:
        if self._pending:
            self._send(self._pending)
        super().close()


def stream_assignment_progress(
    emit_line: Callable[[str], None],
    *,
    logger_name: str = "aequilibrae",
    **kwargs,
):
    """Context manager attaching the handler to AequilibraE's logger.

    Detaches on the way out even if the assignment raised — a handler left
    attached would keep writing into a finished run's log.
    """
    from contextlib import contextmanager

    @contextmanager
    def _attached():
        logger = logging.getLogger(logger_name)
        handler = AssignmentProgress(emit_line, **kwargs)
        previous_level = logger.level
        # The engine logs iterations at INFO; a worker whose root logger is at
        # WARNING would otherwise see nothing at all.
        if logger.level > logging.INFO or logger.level == logging.NOTSET:
            logger.setLevel(logging.INFO)
        logger.addHandler(handler)
        try:
            yield handler
        finally:
            logger.removeHandler(handler)
            handler.close()
            logger.setLevel(previous_level)

    return _attached()
