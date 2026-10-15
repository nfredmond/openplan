# Synthesis journal fixture under restrictive umasks

The fixture defect is confirmed and corrected. This change touches one test file. Production privacy policy and worker code remain byte-identical to the assigned base. No production defect is established by this investigation.

The assigned branch is `t3/synthesis-journal-umask-fixture`, in `/home/nathaniel/.t3/worktrees/openplan/t3-bb278a60`. The checkout starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards locally to `b4dbcac21a58f61bd480ccade4dec69383dacbc7`. Ownership covers `openplan/src/test/engagement-synthesis-generation-worker.test.ts`, this review directory and private probes. The parent checkout `t3-0f743997` remains at the assigned base. Its test, worker and connector hashes match the base; no command writes there. Its original QA cohort continues independently.

The nested `product:direction:check` exits zero. It reports the existing registry, matrix, version and intervening-change reminders, with review deadline November 6. The repository instructions, contract, roadmap, capability matrix, current direction review, known issues and architecture guide this bounded repair. No product claim or milestone changes.

The original test creates `{}` using `writeFile` with mode `0644`. The parent runner's `run_qa_after_oom.py` sets umask `0077`. Native creation therefore produces mode `0600`. The worker correctly reaches schema validation, while the test incorrectly expects `connector_file_not_private`. The independent native mode receipts show the same result: [0077](evidence/native-mode-0077.json) creates `0600`; [0022](evidence/native-mode-0022.json) creates `0644`. Explicit `chmod` produces `0644` and then `0600` under both masks.

The corrected fixture first creates a private file, explicitly applies `0644`, and checks its actual permission bits before invoking the real worker. It then applies and checks `0600`, invokes the worker again and requires the journal schema's missing-phase issue. Both branches assert that `f.from` remains uncalled. The mode checks establish fixture preconditions; they do not replace the worker refusal assertions.

The retained results are:

- Original source, umask `0077`: 39 pass, one fails at the named privacy refusal assertion. [Receipt](evidence/original-0077/result.json)
- Original source, umask `0022`: all 40 pass. [Receipt](evidence/original-0022/result.json)
- Final source, umask `0077`: all 40 pass. [Receipt](evidence/fixed-final-fixed-0077/result.json)
- Final source, umask `0022`: all 40 pass. [Receipt](evidence/fixed-final-fixed-0022/result.json)
- Final controls: two harmless survivors and eight expected failures, with one focused case and 39 skipped per process. [Summary](evidence/controls-summary.json)
- Scoped ESLint: exits zero with no warnings. [Receipt](evidence/static.json)

Each control runs under both masks. A comment added to the connector survives. Replacing its group/world mode check with `false` fails the expected `connector_file_not_private` assertion. Bypassing `journalSchema.parse` fails the malformed journal's `toMatchObject` assertion because a later job error lacks the journal's phase issue. Inserting `service.from` before reading the private file fails the first no-read assertion. Inserting it after reading but before parsing fails the second no-read assertion. Raw logs and JSON reports sit beside each receipt.

An earlier assertion requiring only `ZodError` lets the schema-bypass mutant survive: the later job validator throws the same error class. [Survivor receipt](evidence/controls-schema-bypass-0077/result.json) preserves that finding. The final phase-specific assertion closes this test gap. The initial private mount launch fails before Vitest starts because the mount point is absent; [log](evidence/startup-mount-failure/run.log) preserves the error. A subsequent startup attempt encounters an existing cache directory. Another controller attempt miscounts Vitest's `skipped` status as `pending`. A later schema-control attempt correctly fails the test, but its controller looks for `phase` in an abbreviated JSON error message. Its [raw log](evidence/fixed-final-controls-schema-bypass-0077/run.log) retains the full diff. These are harness failures, not additional production failures. Final controls check the actual test name and failing assertion and exit zero.

The [runner](check.py) uses child-process `umask` arguments, not a process-global test change. Every Vitest process uses one worker, no file concurrency, a private cache, a 640 MiB Node heap, `MemoryMax=1073741824` and `MemorySwapMax=0`. Bubblewrap mounts the assigned source and borrowed canonical dependencies read-only. Mutation files live in `/home/nathaniel/.local/state/openplan/synthesis-journal-umask-fixture-20261015/` and overlay only the test process's mount namespace. Each mutation restores the private copy's exact original bytes in `finally`. The final summary confirms original source bytes and restored private copies. Temporary fixture files use a private `/tmp` mount. The empty ignored dependency mount point is removed after checks.

The original suite scope peaks at 345,083,904 bytes. The final suite and partial-control scope peaks at 346,284,032 bytes; the final control scope peaks at 245,096,448 bytes. The lint/native-mode scope peaks at 291,483,648 bytes. All retained resource records report zero swap peak and zero OOM events. These measurements describe these bounded processes, not application capacity.

[Source bindings](evidence/source-bindings.json) record SHA-256 values for the original and final test, unchanged worker, connector, API implementation, native fixture, setup, lockfile and runner/config. The final test SHA-256 is `a7e6a23ec6038cd53f7bc1d4e77bd16c62dd6d74b654d23c9c17c806008c67c2`. The worker SHA-256 remains `92544532a249a470b69d496b34f007360540999122f30c79cfd9394e035651f2`; the connector client remains `6a26291c3ed01de49e46096024e3caf753e73532659556b4cab3b735e44bf4ce`.

To repeat a fresh cohort, use an unused evidence/cache namespace and an empty ignored `openplan/node_modules` mount point. Run from the repository root:

```bash
systemd-run --user --scope --quiet \
  -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 -B docs/reviews/2026-10-15-synthesis-journal-umask-fixture/check.py fixed
```

The `original` phase requires the original test source. The runner refuses to overwrite existing cohort directories. The private native-mode/lint driver has its hash recorded in `static.json`; its native mode probe uses Node's actual `writeFile`, `stat` and `chmod` calls.

The evidence has these limits:

- The mode assertions inspect POSIX permission bits. This case does not establish ACL behavior, other ownership, symlink handling, other operating systems or all possible umasks.
- The refusal checks cover this `{}` journal and its missing phase. They do not establish every malformed journal case or all recovery schemas.
- The no-read checks observe the supplied service's mocked `from` method. They do not establish live database policy, RLS or every possible external side effect.
- The 40-case suite retains real filesystem journals, locks, worker logic and local synthetic HTTP API calls. Database responses and provider content remain synthetic. No external provider is used.
- These scoped results do not establish the parent's full-suite outcome, browser acceptance, production readiness or scientific validity. No full suite, database, application service, build, browser, install, hosted mutation, PR, push or merge runs for this task. Integration belongs to the parent after its original cohort ends.
