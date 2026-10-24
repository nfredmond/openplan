# Pre-chunk allocation investigation

This successor starts from `009fc68dc01889014fd6d8d8da15c9b0725665c5`.
It reads no TBI outcomes. The original split, consumed opening records, inputs,
coefficients, installed engine and prior failures remain unchanged.

The branch is checked out in another retained worktree. This task uses a
separate detached checkout and pushes its verified descendant to the existing
remote branch. No other worktree, Docker stack or hosted service changes.

The product-direction command fails with `spawnSync git ENOBUFS` at
`product-direction-review.mjs:572`. The changed-path listing contains 1,070,317
bytes, exceeding the subprocess default buffer. No review date, checker or
product direction changes. This failure is not a passing direction check.

The new diagnostic reuses the frozen 20,000-household allocation fixture with
49,094 persons and all 634 destinations. It is not a full arm. The profiler
uses Python line tracing and records shape, dtype, storage and RSS metadata.
It neither replaces engine functions nor exports modeled person values.
Deep bytes include index accounting and may count shared storage repeatedly.
They must not be added to process RSS or treated as a physical-memory total.
Profiler timing includes instrumentation overhead.

The source-packet copy initially uses the wrong shadow-pricing path. Its
FileNotFoundError occurs after diagnostic completion, outside model execution.
The corrected source path is `abm/tables/shadow_pricing.py`. No model retry
follows from that packaging error.

Input-column screening scans every effective CSV and YAML in the bundle and
stock configuration, including conservative extra stock specs. All household
and person inputs remain required or part of the frozen output schema.
`source_geoid` has no configured expression/spec token and no installed engine
Python/CSV/YAML reference. The existing `keep_columns` already discards it.
The successor removes that raw land-use column with the standard CSV reader
and writer, preserving the text of every retained cell. It saves input bytes,
not a large live table. The original file stays intact. Both arms must pass
exact comparison before the next reduction is tried.

ActivitySim's installed `core/configuration/top.py:759-775` documents
`downcast_int` and the separate `downcast_float`. The integer setting is false
by default and explicitly calls for regional consistency testing. The successor
sets only `downcast_int: true`, with `downcast_float: false`. The implementation
in `core/util.py:409-462` skips floating and categorical columns and minimizes
signed integer storage subject to its range checks. It exposes no automatic
categorical-conversion setting. Existing categorical periods remain intact.
No float precision or categorical encoding change is proposed.

The location settings expose inner `explicit_chunk` and chooser-column filters.
`location_choice.py:558-581` filters and joins all sampled rows before calling
`logsums.py:242-267`. That helper preprocesses the full join before calling the
chunked simulator. Neither inner target nor `explicit_chunk` defers that join
or preprocessing. No setting in the installed `TourLocationComponentSettings`
or `TourModeComponentSettings` chunks this merged-table construction. General
multiprocessing partitions the population into concurrent pipelines, changes
execution structure, and is not a deferred join option in this single-process
hybrid path. It is not silently enabled.

All source line numbers refer to the retained installed ActivitySim 1.5.1
snapshots. Upstream references:

- [Integer settings](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/configuration/top.py)
- [Location join](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/location_choice.py#L558-L581)
- [Logsum preprocessing](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/util/logsums.py#L242-L267)
- [Assignment result construction](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/assign.py)

The exact comparator is the existing `compare_tables`, which admits no logsum
or utility tolerance. Seven complete output tables, every column, row identity
and value must match each arm's own fully unchunked reference. CSV dtype and
column order also match. The disabled suffix preserves legacy trip scheduling.

## Recorded reduction decisions

The raw-column removal saves 7,621 CSV bytes. Both 2,000-household arms pass
exact equality in all seven tables, including every accessibility and logsum
value. All seven CSV files are also byte-identical to each arm's own reference.
Current tours/trips remain 6,763/17,377; SEMCOG remains 6,764/17,464. Both have
274 joint-tour participants. Prefixes split actual choosers and suffixes use
chunk size zero. Prefix/suffix scope peaks are 1,785,372,672/344,584,192 bytes
for current and 1,787,961,344/426,106,880 bytes for SEMCOG.

The global integer setting fails the current-arm exact check. Five accessibility
columns change from float64 to float32, despite `downcast_float: false`.
The resulting 2,630 differing cells occur in `auPkRetail` (634), `auOpRetail`
(634), `trPkRetail` (388), `trOpRetail` (375), and `nmRetail` (599).
All six other exported tables remain exact. This is still a failed seven-table
proof. The retained checkpoint shows `RETEMPN` narrowing from int64 to int16;
the accessibility spec multiplies it by a float32 decay vector. A synthetic
NumPy 1.25.2 demonstration confirms that this integer change changes the
multiplication result's promotion and value. The failed setting is rejected.
The SEMCOG integer probe and all integer-enabled full runs remain unexecuted.
`integer-failure-analysis.json` retains the complete differing-field census,
first modeled example per field, checkpoint hashes and dtype evidence.

No automatic categorical conversion setting or single-process deferred join
setting is found in the installed configuration classes. No such setting is
invented. Per-column input dtype declarations, stage-specific dtype changes
and a multiprocessing redesign are not tested or admitted by this packet.
The global-setting failure does not prove that every possible integer storage
strategy would fail. No full-scale rerun follows the 9 GiB resource stop.

The diagnostic uses `profile-engine.baseline.py` bytes. The full-run observer
adds pandas allocation-frame visibility and explicit shadow-pricing state in
`profile-engine.py`. No pandas result-frame constructor is reached in the full
failure. The outside scope observer starts during high-school location and
preserves the later kernel peak and OOM event before the cgroup disappears.
It changes no engine setting and runs outside the measured model scope.
