# Sealed study execution protocol

This protocol is for future one-opening research studies. It does not reopen the closed 2017
mandatory-tour study and does not authorize inspection of the sealed 2009 source.

Run a frozen study from the repository root:

```bash
python3 -B scripts/research/sealed_study.py run path/to/study-lock.json
```

If the runner dies after its receipt is durable, wait until the host lease is free, then close the
study:

```bash
python3 -B scripts/research/sealed_study.py finalize-interrupted path/to/study-lock.json
```

There are no CLI flags for evaluator arguments, paths, validators, timeouts, or privacy rules. The
lock is the only source for those values. An unknown flag is an error.

## Four versioned records

The machine-readable contracts live in `schemas/research/`.

- `openplan.sealed-study.lock.v1` freezes the command and arguments, working and scratch
  directories, code closure, source archive hashes and selected members, both result paths, the
  validator, and prohibited output fields.
- `openplan.sealed-study.lease.v1` records the process holding the Linux `flock`. The lock protects
  one host only. This tool does not coordinate work across hosts.
- `openplan.sealed-study.receipt.v1` is written to an exclusive temporary inode, fsynced, then
  linked to its final name without replacement. The runner fsyncs the directory before it starts
  the evaluator. Its presence means the opening is consumed.
- `openplan.sealed-study.aggregate-result.v1` is the only published result. The runner uses the
  same fsync-then-exclusive-link sequence, so a killed writer cannot leave a partial final JSON
  file.

The evaluator writes a candidate JSON file below the locked scratch directory. The runner limits
that file to 10 MiB, rejects non-finite JSON, checks its study and schema versions, rejects every
configured identifier and replicate-level array, and runs the frozen study-specific validator.
The validator may inspect the candidate but may not change it. The runner deletes the candidate
after normal completion. Recovery deletes an interrupted candidate without opening it.

Evaluator stdout and stderr go to unnamed temporary files. The aggregate record retains only their
byte counts and SHA-256 hashes. It also records evaluator exit status or signal, candidate byte
count and hash when valid, and Linux peak RSS. It never copies stream content into an artifact.

## Execution order

1. Parse the lock and acquire its non-blocking host lease.
2. Refuse existing receipt, candidate, or aggregate paths.
3. Hash every frozen evaluator and validator file and verify both closure hashes.
4. Hash each source archive and inspect only its ZIP directory to verify selected members.
5. Require free scratch space of `3 * selected uncompressed bytes + 1 GiB`.
6. Create and fsync the exclusive receipt.
7. Start the evaluator as a child with no timeout and no memory-triggered cancellation.
8. Validate the candidate and run the frozen validator.
9. Create and fsync one aggregate result, then remove the scratch candidate.

The child inherits the lease file descriptor. If the parent dies, Linux keeps the lease held until
the evaluator also exits. Recovery therefore cannot race a late evaluator write.

Accepted and rejected decisions come only from a valid evaluator result. The runner copies them
without reinterpretation. A nonzero exit, signal, missing or oversized candidate, invalid schema,
prohibited content, or validator failure becomes `inconclusive`. Integrity and path failures found
before the receipt create no result because no source has been consumed. The runner never changes
a rejection into acceptance.

`finalize-interrupted` verifies only the lock, receipt, and evaluator and validator closure. It
does not hash, parse, or otherwise open a source archive. It publishes the fixed
`RunnerInterruptedAfterReceipt` inconclusive result and never invokes the evaluator or validator.

## Streaming source helper

`scripts/research/streaming_zip_csv.py` stages configured CSV members into a new SQLite database.
It reads one CSV row at a time and inserts batches of 2,000 rows. A batch is the largest complete
set of source rows retained in Python memory. The helper never calls `list(reader)` and never keeps
a complete source table in memory. Evaluators query the temporary SQLite tables for later passes.

On the already-consumed 2022 NHTS archive with SHA-256
`64530c396d5f164d2259a22f7042f27bee5147babcd367568ddbfafe6c8bf34c`, a local spool-only run of
all four CSV members on 2026-08-24 used 35,028 KiB peak RSS. It computed no study
outcome. The synthetic allocation check used 10,000 and 100,000 rows. The larger input stayed below
256 MiB and below twice the smaller run's peak Python allocation.

## Why this exists

The 2017 mandatory-tour evaluator wrote its receipt, then terminated before it committed an
aggregate result. It had loaded complete CSV members into Python lists. The operating-system record
showed memory pressure nearby but did not identify the evaluator as the killed process, so the
direct cause remains unknown. The receipt consumed that opening. The result is permanently
inconclusive, no candidate was registered, and no default changed.

The closed files are pinned by
`data/modeling/mandatory-tour-frequency-2017-successor-custody-lock-2026-08-24.json`. Its guard
hashes only committed evaluator and evidence files. It contains no archive paths, and the guard
cannot open either 2017 acceptance archive.

## What the checks do not prove

The tests prove bounded Python allocation under synthetic growth, exclusive same-host execution,
and honest recovery after process termination. They do not prove survival of a kernel OOM, sudden
power loss, storage-controller failure, filesystem corruption, or multi-host races. File and
directory fsync reduce the crash window. Only a destructive machine-level exercise could test the
remaining failure modes, and this checkpoint does not perform one.
