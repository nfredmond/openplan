# Full multiprocessing continuation verification

October 24, 2026 UTC. These checks protect the continuation controller and
retained custody. Native parity and full-run results remain separate evidence.

## Source checks

Commands use `/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B`.
Its resolved interpreter is the same CPython 3.11.15 installation as
`/home/nathaniel/.local/bin/python3.11`.

- `test-run.py` in this directory: 11 tests pass, zero skips.
- `../multiprocess-evidence/test-run.py`: 12 tests pass, zero skips.
- `../multiprocess-evidence/test-resume.py`: six tests pass, zero skips.
- Repository `-m unittest discover -s scripts/modeling/tests -p 'test_activitysim_*parity.py'`:
  14 tests pass, zero skips.
- `mutate.py`: ten accepted controls, one harmless comment survivor and nine
  intended assertion failures. Every control runs all 11 tests with zero skips.
  Isolated namespaces preserve the source bytes. The monitor mutation supplies
  changed text through a read mock; no running monitor file changes.
- `npm run product:direction:check --prefix openplan`: passes with retained
  dated reminders. No review date changes.

The initial mutation receipt remains in `mutations.initial.json`. Removing the
parity admission guard first reached a mock-value JSON serialization error.
The corrected fixture supplies an ordinary empty hash map, producing the
intended missing-refusal assertion. The initial monitor mutation produced a
KeyError; the test now asserts the missing label through `dict.get`, yielding
an assertion failure. Neither incidental error counts as a successful control.
No model replays follow from these source-test corrections.

## Native execution boundary

The current-arm comparison reuses its retained four-process outputs. The
successor runs SEMCOG parity, then permits the current full arm followed by the
SEMCOG full arm. It retains the original coefficients, inputs, trained cache,
chunk target, household slicing and unchunked coalesced suffix. The additional
wrapper requires identical CSV-inferred dtypes as well as the inherited
choice-level comparator. It does not alter the historic exact comparator.

The source tests do not establish full-scale memory fit, scientific accuracy,
observed/model correspondence or browser acceptance. CSV-inferred dtype parity
does not establish every internal checkpoint dtype. The 2,000-household parity
runs do not establish a full-population single-process reference. Stage/RSS
measurements sample once per second and can miss short peaks. Observed process
VmHWM may precede the terminal maximum; cgroup kernel peaks are separate.

The pre-run memory forecast uses a school-stage proxy and assumed reserves.
It is not a demonstrated bound for workplace, coalescence or the full suffix.
The all-descendant 16 GiB cap controls execution. A cap failure stops later arms.
No outcome access, engine patch, float downcast, Next.js build, Docker operation,
hosted operation, database operation, coefficient change or default change is
part of this continuation.

## Custody checks and final outcome

`test-finalize.py` passes four tests with zero skips. `mutate-finalize.py` adds
three accepted controls: one harmless survivor and two intended assertion
failures covering frozen/engine custody and the second output-inventory check.
All four tests run in every custody control with zero skips and unchanged
source bytes. The combined source census is 47 passing tests, zero skips;
13 accepted controls comprise two harmless survivors and 11 targeted failures.
These fixtures do not establish that every possible storage corruption is caught.

The current full prefix stops at an observed 17,179,869,184-byte peak after
287.863 seconds. The external observer retains four OOM events, one OOM kill
and zero swap; the journal separately confirms `oom-kill`. No suffix or full
SEMCOG run follows. The smaller parity results remain passes under the adopted
criterion. The full-output hash maps and modeled health remain unavailable.

All 117 frozen records and 27 installed source/configuration/pandas files pass
opaque hash rechecks. The private inventory contains 400 files and
2,855,177,618 bytes. Its second byte-length/hash check passes without mismatch.
The manifest SHA-256 is
`aedf2fdea951ae431e0614e65cb1f83755b46b4ca7b94437880f714b6b615cf3`.
It includes failed-attempt checkpoints, not completed full-arm outputs.
