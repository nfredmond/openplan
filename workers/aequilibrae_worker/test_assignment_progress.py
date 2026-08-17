#!/usr/bin/env python3
"""Assignment progress streaming — what must reach the planner, and what must not.

The failure this guards is a console box that sits frozen for minutes while a
healthy run works, which is indistinguishable from a hung one. The opposite
failure is a stream so chatty it hammers the database once per iteration.
"""
from __future__ import annotations

import logging
import sys
import unittest
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from assignment_progress import AssignmentProgress, stream_assignment_progress


class FakeClock:
    def __init__(self) -> None:
        self.value = 1000.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def record(message: str, level: int = logging.INFO) -> logging.LogRecord:
    return logging.LogRecord("aequilibrae", level, __file__, 1, message, None, None)


class Throttling(unittest.TestCase):
    def setUp(self) -> None:
        self.lines: list[str] = []
        self.clock = FakeClock()
        self.handler = AssignmentProgress(
            self.lines.append, interval_seconds=5.0, now=self.clock,
            target_gap=0.0005, max_iterations=3000,
        )

    def test_the_first_iteration_is_sent_immediately(self) -> None:
        self.handler.emit(record("1,0.5,1.0"))
        self.assertEqual(len(self.lines), 1)
        self.assertIn("iteration 1", self.lines[0])

    def test_iterations_inside_the_interval_are_held_back(self) -> None:
        for i in range(1, 60):
            self.handler.emit(record(f"{i},0.5,1.0"))
        self.assertEqual(len(self.lines), 1, "a line per iteration would hammer the database")
        self.assertEqual(self.handler.iterations_seen, 59)

    def test_a_line_goes_out_once_the_interval_passes(self) -> None:
        self.handler.emit(record("1,0.5,1.0"))
        self.clock.advance(5.0)
        self.handler.emit(record("2,0.4,0.9"))
        self.assertEqual(len(self.lines), 2)
        self.assertIn("iteration 2", self.lines[1])

    def test_the_last_iteration_is_never_lost(self) -> None:
        """A stream whose final update is swallowed ends mid-run, which reads
        as a crash."""
        self.handler.emit(record("1,0.5,1.0"))
        for i in range(2, 40):
            self.handler.emit(record(f"{i},0.1,0.5"))
        self.handler.close()
        self.assertIn("iteration 39", self.lines[-1])

    def test_close_does_not_repeat_an_already_sent_line(self) -> None:
        self.handler.emit(record("1,0.5,1.0"))
        self.handler.close()
        self.assertEqual(len(self.lines), 1)


class WhatGetsThrough(unittest.TestCase):
    def setUp(self) -> None:
        self.lines: list[str] = []
        self.clock = FakeClock()
        self.handler = AssignmentProgress(
            self.lines.append, interval_seconds=5.0, now=self.clock,
            target_gap=0.0005, max_iterations=3000,
        )

    def test_a_warning_is_never_throttled(self) -> None:
        """'Descent direction stepsize finder has not converged' is exactly the
        line a throttle would drop while forwarding the routine ones either
        side of it."""
        self.handler.emit(record("1,0.5,1.0"))
        self.handler.emit(record("Descent direction stepsize finder has not converged", logging.WARNING))
        self.assertEqual(len(self.lines), 2)
        self.assertIn("Assignment warning", self.lines[1])
        self.assertIn("has not converged", self.lines[1])

    def test_chatter_that_is_not_progress_is_ignored(self) -> None:
        for noise in ("Traffic Class specification", "Iteration, RelativeGap, stepsize", ""):
            self.handler.emit(record(noise))
        self.assertEqual(self.lines, [])

    def test_the_line_carries_the_gap_and_the_target_it_aims_for(self) -> None:
        self.handler.emit(record("137,0.0034,0.21"))
        line = self.lines[0]
        self.assertIn("iteration 137", line)
        self.assertIn("0.0034", line)
        self.assertIn("0.0005", line)  # the target, so the distance left is visible
        self.assertIn("3,000", line)   # the ceiling it will stop at

    def test_no_percentage_is_invented(self) -> None:
        # How many iterations equilibrium needs is unknown until it converges;
        # a bar filling at an unpredictable rate is worse than none.
        self.handler.emit(record("137,0.0034,0.21"))
        self.assertNotIn("%", self.lines[0])

    def test_a_malformed_iteration_line_is_skipped_not_crashed_on(self) -> None:
        self.handler.emit(record("not,a,number"))
        self.assertEqual(self.lines, [])

    def test_a_failing_callback_never_breaks_the_run(self) -> None:
        """Progress reporting is a courtesy; it must not be able to fail an
        assignment that is otherwise fine."""
        def explode(_line: str) -> None:
            raise RuntimeError("supabase is down")

        handler = AssignmentProgress(explode, now=self.clock)
        handler.emit(record("1,0.5,1.0"))  # must not raise
        handler.close()


class AttachingToTheEngine(unittest.TestCase):
    def test_it_receives_real_logger_output_and_detaches_afterwards(self) -> None:
        lines: list[str] = []
        logger = logging.getLogger("aequilibrae")
        before = len(logger.handlers)
        with stream_assignment_progress(lines.append, target_gap=0.001, max_iterations=500):
            logger.info("12,0.02,0.4")
        self.assertEqual(len(lines), 1)
        self.assertIn("iteration 12", lines[0])
        self.assertEqual(len(logger.handlers), before, "handler left attached after the run")
        logger.info("13,0.01,0.3")
        self.assertEqual(len(lines), 1, "a detached handler must stop writing")

    def test_it_detaches_even_when_the_assignment_raises(self) -> None:
        logger = logging.getLogger("aequilibrae")
        before = len(logger.handlers)
        with self.assertRaises(RuntimeError):
            with stream_assignment_progress(lambda _line: None):
                raise RuntimeError("assignment blew up")
        self.assertEqual(len(logger.handlers), before)

    def test_it_raises_the_logger_level_so_info_lines_are_seen(self) -> None:
        """A worker whose logger sits at WARNING would otherwise stream nothing
        while appearing to work."""
        lines: list[str] = []
        logger = logging.getLogger("aequilibrae")
        logger.setLevel(logging.WARNING)
        try:
            with stream_assignment_progress(lines.append):
                logger.info("5,0.05,0.5")
            self.assertEqual(len(lines), 1)
            self.assertEqual(logger.level, logging.WARNING, "the level must be put back")
        finally:
            logger.setLevel(logging.NOTSET)


if __name__ == "__main__":
    unittest.main()
