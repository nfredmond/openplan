# Post-freeze fixture retry now uses the captured original command

October 16, 2026. Source-only R2 response to the independent P2 finding.
The author accepts the finding and changes only line 140 of
`openplan/src/test/fixtures/land-use-plans/context-persistence.sql`.
ROOT's separately allocated pure source-intent unit now passes. ROOT authorizes
the local one-line correction checkpoint with hooks and signing disabled.
This implementation lane runs no test, import, compiler, dependency, lock,
manager, native SQL, database, fixture or browser operation. The fresh independent
round2 review remains ROOT-owned before any join.

## The final retry must preserve A's exact bytes

The full independent report at review commit
`bb2bf7f9839902976679a493bd09c60e5820b7e8` is read before editing. Its source is
`/home/nathaniel/.t3/worktrees/openplan/t3-5c638c79/docs/reviews/2026-10-16-land-use-context-geography-independent/REPORT.md`,
17,627 bytes, SHA-256
`caca9b2ff5a11f5a79c07a648c874a28961199cdd26019a803849e67010e41e9`.
Git confirms that reviewer checkout is clean at the supplied review commit.
The review finds one P2 fixture defect, no P1 and no additional production
source defect. Its source-approval hold remains until correction/check/review;
this author response does not grant approval on the reviewer's behalf.

The fixture captures command A in `call_sql` at line 50. It later replaces
`raw_command` with B at line 117. The final retry reused A's command ID and
original null expected hash with B's text. The retained RPC compares exact
`command_text` before returning a receipt, so that source path conflicts.
The production comparison at migration
`20261016000006_land_use_plan_retained_study_area.sql:30–42` remains unchanged.
This is a source finding, not an observed native replay failure.

The sole fixture edit after the frozen-version-save refusal is:

```diff
-  replay := pg_temp.save_context(plan,version,actor,command,NULL,raw_command,NULL);
+  EXECUTE call_sql INTO replay;
```

The earlier identical direct replay at line 107 stays unchanged because it
precedes the B assignment. The captured `call_sql` stays unchanged, including
A's original command ID, null expected hash and original command text. The
A-to-B save, postreplacement captured-A replay, authority/geography checks,
freeze/refusal, cleanup and final original-A receipt assertion all remain
byte-identical. No assertion is added or weakened. No production route,
migration, other test, fixture or old report changes.

## Exact source identity and custody

T3 remains bound to `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8`, branch
`t3/land-use-context-geography-correction`, model `gpt-6.1-sol`, high reasoning.
The starting tree is clean at parent
`8d292caf864a3f66409bef6868fde82ef7a4f82e`, application tree
`64a2c31e768d26c0978a3e0b945d2e1f41de9510`. Other active lanes remain outside
ownership. No binding, branch or checkout changes, fetch, reset or nested agents
occur. Ownership is only the single final fixture line and these new public
and private correction directories.

The old fixture SHA-256 is
`1093f5a175882095b3892520654e1121f98fee05fa70f48924526145a0aff354`.
The corrected fixture SHA-256 is
`5af2e37ba342e8b8bdf3cb84c6e9044cd2fcfb62d9d70bf4ce9671587934292e`,
mode 0664. [fixture.diff](fixture.diff) records the exact one-line change.
[SOURCE_PINS.json](SOURCE_PINS.json) preserves the exact precheck response seal,
including the earlier response report hash. That report version remains in the
new private post-pure-handoff directory. [FINAL_PINS.json](FINAL_PINS.json) binds
the current report, corrected source, review and actual pure-check evidence.
No older manifest is regenerated.

New private evidence lives only in
`/home/nathaniel/.local/state/openplan/land-use-context-replay-fixture-correction-20261016`.
It contains the exact pre-edit fixture, diff, source-read path correction and
new pins. The initial guessed migration-path read returned a missing-file
message; the report's actual filename was then read. That routine text lookup
and its raw diagnostic are retained, with no product/check failure inferred.
All old private proofs, configs, controllers and outputs remain untouched.

## ROOT's pure source-intent check passes within its stated tier

The old `8d292caf` checkpoint and its 31-case/13-fault/type/lint/direction
results retain their original identities and limits. They do not validate this
changed future SQL fixture. The source inventory remains 424 migrations; the
new geography migration remains unapplied. No native tier is promoted.

ROOT dispatches exactly one standard-library source reader in unit
`openplan-land-use-replay-source-20261016-01`, invocation
`d659d3df686c402dbc88e6ddeae8f61a`. The saved terminal returns0
after 0.15489835594780743 seconds with no transport failure. Actual recorded
limits are 536,870,912 memory bytes, zero swap, CPU `50000 100000` and Tasks64.
The manager records service runtime137ms, CPU66ms and rounded peak9.3M with
zero swap. Those are reported manager values, not an invented byte sample.
ROOT reports network/PID isolation, read-only root, new private writable proof,
only `/dev/null` device binding and one nonblocking exclusive compiler lock
released at unit exit. ROOT reports no holder at the exact compiler inode.

The harmless comment runs first and survives. The corrected baseline passes.
An in-memory restoration of the old final mutable-B call fails with exact
`AssertionError:postfreeze-replay-original-A`. The final corrected source passes.
The reader's corresponding comparison is at `check.py:23`; its helper raises
at line11. The intended AssertionError is caught, so no runtime traceback is
emitted or invented. The check performs no actual fixture mutation; the final
source readback is exact SHA-256
`5af2e37ba342e8b8bdf3cb84c6e9044cd2fcfb62d9d70bf4ce9671587934292e`.

The reader checks one A capture before the mutable B assignment, no subsequent
`call_sql` assignment, B before the post-freeze boundary, the exact final
`EXECUTE call_sql INTO replay;` and the unchanged original-A receipt assertion.
ROOT independently derives the same sole-line transform from old Git `8d292caf`.
The reader is fixed-fixture source intent, not a SQL parser or interpreter.
It does not execute or prove stored A/B receipt/current-plan semantics.

Actual ROOT evidence remains untouched at
`/home/nathaniel/.local/state/openplan/land-use-replay-fixture-root-20261016`:
expected-change, grant, check/dispatch sources, unit intent/process/terminal/
streams and result. Grant SHA-256 is
`4613038328b728f1a537bc5791d35e4fd4f4a33d0a972cf4876522811b76aed0`;
result SHA-256 is
`46caef6b575bbbe73b07f0e575113e638ff5a3f1472669841b458c881da12e92`.
The new [pure evidence index](PURE_EVIDENCE.json) records exact paths, hashes,
sizes, modes and the four actual outcomes without copying unrelated mount data.
This lane only reads that saved evidence and does not dispatch a duplicate run.

Original checkpoint `8d292caf` and independent report `bb2bf7f9` remain the
historically blocked subject/finding. The correction does not rewrite either.
The old 31-case/13-fault/type/lint/direction evidence is neither repeated nor
rebased onto this fixture change. ROOT owns a new independent round2 review
bounded to this one-line correction and the combined source identity, including
the original P2. No successor runtime grant follows from this pure result.

Post-freeze receipt recovery and preservation of current B remain native
semantics to test later on a new exclusive ROOT-allocated target. SQL parsing,
permissions/RLS, serialization, frozen-A/fork/save-B custody, desktop/390px
journeys and practitioner acceptance remain unproved. Only the authorized local
fixture/new-docs checkpoint follows. No push, join, PR, main change or release
occurs. The exact commit/tree and postcommit readback are returned separately
in the new private handoff receipt.
