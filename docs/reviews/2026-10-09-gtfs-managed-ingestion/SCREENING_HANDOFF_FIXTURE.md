# Screening handoff fixture correction

The serial installed worker runner discovers 188 Python suites. At source `f6394f05ef03011679ee34e1c11dd9f0a242cb6e`, 187 pass and one fails. [The retained result](candidate-current-worker-checks.json) records the nonzero exit and 374,042,624-byte memory peak. No suite is skipped.

`activitysim_worker/test_screening_handoff.py` passes a nonexistent `materialized` directory to the materializer. Production first calls `create_run_workspace`, which creates its execution directory. The materializer deliberately uses exclusive creation for the child screening directory to preserve earlier evidence. The fixture now creates its parent directory with private permissions, matching that production caller. No worker implementation, model settings, coefficients, input adapters or scientific claim changes.

The fixture also compares exact network setup bytes and requires a second materialization into the same workspace to refuse the existing directory while preserving its manifest. [The controls](screening-handoff-fixture-controls.json) pass baseline, harmless comment and restored source. A deliberate newline appended to the copied JSON preserves its parsed value but fails the exact-byte assertion. A deliberate replacement of exclusive directory creation with reusable creation fails the predecessor-refusal assertion. The harness restores worker source in `finally`; Python runs with bytecode disabled.

These checks exercise local synthetic files. They do not establish live model execution, same-host artifact authorization, hosted commissioning, output validity or independent scientific accuracy. Earlier scientific limitations remain unchanged.
