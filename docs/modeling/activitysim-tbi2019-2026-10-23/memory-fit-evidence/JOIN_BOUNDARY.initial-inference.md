# The remaining allocation precedes the chunker

The completed 20,000-household diagnosis and the retained full failures identify
a boundary that the production chunk target does not directly control. This is
run-health evidence. It does not establish scientific accuracy or authorize
outcome access.

In the installed ActivitySim 1.5.1 source, `run_location_logsums` first filters
person columns, logs the number of sampled locations at line 563, then executes
`location_sample_df.join(persons_merged_df, how="left")` at line 565. Only after
that full-table join does it call `compute_location_choice_logsums` at line 571.
The helper logs its entry and performs preprocessing before passing choosers to
`simple_simulate_logsums`, which applies the inner chunker. See the pinned
[location-choice source](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/location_choice.py#L558-L581)
and [logsum helper](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/util/logsums.py#L54-L270).
`engine-custody.before.json` pins the installed source bytes; final preservation
is reported separately.

The full failures log 10,717,604 grade-school sampled rows. They stop before the
helper's `Running compute_logsums` entry message and before its inner chunk
message. The source and log sequence therefore bounds the failure around the
full join. This is an inference from ordered logging and source, not a captured
Python stack at the kernel OOM kill. Smaller inner chunks cannot themselves
split this earlier join.

The 20,000-household fixture has 49,094 persons. At the grade-school boundary,
pipeline DataFrames account for 37,547,489 deep bytes, including 25,898,372 for
merged persons. The sampled-location frame has 205,048 rows and 4,100,960 deep
bytes at entry. The joined chooser frame has 15,993,744 deep bytes on entry to
the logsum helper. The helper's returned prepared chooser frame accounts for
90,474,318 deep bytes. These are separate snapshots; shared objects and indexes
can overlap. Do not add them to RSS or to one another as a physical total.

With the 256 MiB target, grade-school logsums use 40 chunks. A full inner chunk
contains 5,194 choosers; its chooser DataFrame accounts for 934,920 deep bytes
and its utility DataFrame for 914,144 deep bytes. The profiler records other
local tables and arrays in `profile-20000-reduced.profile.jsonl`. Call/return
RSS and one-second cgroup samples do not measure every transient allocation.
The exact scope lifetime peak comes from `memory.peak` when the terminal
receipt survives.

All 826 matrices remain float32 on the full 634-zone destination domain. Their
file-backed cache occupies 1,328,062,624 bytes. `JitMemMapSkimData` maps and closes
that cache on each lookup; it does not retain all matrices in a permanent heap
array. The v1.5.1 factory filters unconfigured period labels, but this study uses
all five configured periods. The inspected factory and network settings expose
no configured-model-read selector for this path. No matrix, dtype or skim value
changes. At the current-arm OOM samples, anonymous memory exceeds 9.56 billion
bytes while file cache falls to roughly 8 to 13 MB. Skim file cache does not
explain that anonymous allocation.

The allocator successor fixes the mapping threshold at 128 KiB, sets the trim
threshold to zero and limits arenas to two. These process-local GNU C Library
settings release free storage sooner; they do not change the join's live-data
requirement. Both 2,000-household arms pass exact exported-value equality before
any allocator-enabled full attempt. The current allocator-enabled full arm
still exceeds 9 GiB before the inner grade-school logsum chunker. Its failure
remains retained. The SEMCOG successor result is recorded in
`allocator-full-runs.json` when that attempt terminates.

No sampled population substitutes for a full arm. No suffix chunking, engine
patch, precision reduction, coefficient adjustment, scalar fitting or outcome
comparison occurs. This record does not prove that every possible unmodified
engine configuration is impossible; it identifies the measured boundary of the
paths actually tested.
