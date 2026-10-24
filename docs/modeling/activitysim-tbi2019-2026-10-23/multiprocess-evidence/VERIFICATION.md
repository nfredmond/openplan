# Four-process parity verification

October 24, 2026 UTC. The current arm fails exact native parity. SEMCOG and
both full arms do not run after that failure. No survey outcomes are read.

## Commands and results

Run from the repository root with
`/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B`.
That interpreter and `/home/nathaniel/.local/bin/python3.11` resolve to the same
CPython 3.11.15 installation.

- `multiprocess-evidence/test-run.py`: 12 tests pass, zero skips.
- `multiprocess-evidence/test-resume.py`: six tests pass, zero skips.
- `-m unittest discover -s scripts/modeling/tests -p 'test_activitysim_*parity.py'`:
  14 tests pass, zero skips.
- `multiprocess-evidence/mutate.py`: nine accepted controls, one harmless
  comment survivor and eight intended assertion failures.
- `multiprocess-evidence/mutate-resume.py`: five accepted controls, one harmless
  comment survivor and four intended assertion failures.
- `npm run product:direction:check --prefix openplan`: passes with the existing
  dated review reminders. No review date changes.
- `git diff --check`: passes before the checkpoint commit.

The abbreviated script paths above are relative to this study directory.
Mutation receipts contain each test census, failure and skip count. The controls
compile changed source in isolated namespaces. They never overwrite admitted
controller bytes; before/after source hashes match.

One initial cache-guard control reaches a missing downstream fixture file.
`mutations.initial.json` retains that incidental error, which does not count as
an accepted mutation. The corrected test supplies downstream logs and a mocked
comparison, so removing the cache guard fails because the expected refusal
does not occur. The source guard does not change.

## Native execution and retained failures

The first current prefix completes with four household workers. Its suffix
requests an absent model-named checkpoint and fails before scheduling. The
failed restore resets the checkpoint inventory to `init`. The copied-checkpoint
attempt then fails because that inventory also lacks `mp_households`.

The corrected controller repeats the same prefix into a new directory, checks
its coalesced checkpoint inventory, and completes the unsliced, unchunked suffix.
The comparator fails on six exact logsum cells. Read-only analysis checks all
seven final tables and existing intermediate checkpoints after that stop.
No model run follows the numerical failure. The strict gate stays unchanged.

The installed `mp_tasks.py`, example settings and version-specific documentation
match upstream v1.5.1 hashes. All 27 pre-run pinned installed files and all 117
original frozen study files retain their hashes. The original split and consumed
holdouts remain unchanged.

## Limits

Source tests protect configuration, reference custody, cache refusal, suffix
isolation and stop sequencing. They do not prove ActivitySim parity, aggregate
full-population memory fit or scientific accuracy. The full current and SEMCOG
arms remain unexecuted. No full-output hashes or full MODELED shares exist.

The global chooser-split guard sees two accessibility chunks. Each household
worker remains at chunk ordinal one on its 500-household slice. The configured
production target and cache do not establish parity across multiple chunks
inside a household worker. This is an additional unproved boundary, separate
from the six-cell exact failure. No new run attempts to fill that gap.

The resource monitor samples all scope PIDs once per second. Its sampled RSS and
observed VmHWM can miss terminal process peaks, and shared pages overlap across
PIDs. Kernel cgroup lifetime peaks remain separate. The stage-label parser misses
`#run_model` boundaries; stage-group memory attribution remains unproved.

The retained checkpoints locate the first differing model components. They do
not capture the exact NumPy instruction that rounds differently. Batching and
coalesced row order explain the changed computational layout; assigning the
ULP differences to a specific dot, exponential or logarithm requires a later
authorized investigation.

No Next.js build, Vitest run, Docker operation, hosted operation, database
operation, ActivitySim source patch, float downcast or default change occurs.
The PR remains draft. Raw logs, telemetry, modeled outputs, checkpoints, initial
failed mutation receipt and the complete private inventory stay outside Git.
`OUTPUT_CUSTODY.json` supplies their location, counts, bytes and inventory hash.
