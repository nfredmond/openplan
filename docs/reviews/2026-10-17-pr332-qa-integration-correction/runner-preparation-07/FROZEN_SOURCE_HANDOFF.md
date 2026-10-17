# NEW07 source handoff, F02 Vite oracle metadata only

NEW07 changes one oracle. `F02-no-byte-pin-vite` replaces the unsupported
`native_cli_registry_unreviewed` token with the exact message
`expected [Function] to throw an error`. It adds exact **string** fields
`actual="undefined"` and `expected="null"`. AssertionError class, full name,
line50, failed-set equality, passed-baseline requirement and collection guards
stay unchanged. The reader performs no coercion and accepts no generic failure.

Vitest expect index1549–1553 delegates string `toThrow` to Chai `throws`.
Chai index2787–2834 moves the string into the message matcher, sets
`errorLike=null`, then asserts that an error was thrown before matching its
message. The unchanged byte-pin omission returns normally. ROOT08 records this
exact assertion and string pair. [ROOT08 audit](/home/nathaniel/.local/state/openplan/pr332-qa-gate-3d62558-20261017-root-review/subject-window-08/ROOT_ORACLE_FAILURE_AUDIT_08.json)
SHA256 `f374aa91f6f7a550ba49eeab08a6c1c2cca61a688d2dd2997730675a71d1e571`.

TEST04 remains **PERMANENT_HARNESS_ORACLE_FAILURE1**. Its harmless/baseline and
F01 accepted prefix is partial evidence. Node F02, later faults, final restoration
phase and original five suites were not reached. No result is regraded or resumed.
See the [full06 handoff](../runner-preparation-06/FROZEN_SOURCE_HANDOFF.md) for
unchanged context, ownership policy, readers, guard26 limits and blind categories.

Public source is this `runner-preparation-07` directory. Private preparation is
`/home/nathaniel/.local/state/openplan/pr332-qa-integration-correction-20261017/runner-preparation-07`.
Future output is its `TEST05` child; future unit is
`openplan-pr332-qa-pure-20261017-05`. All path changes are mechanical. Donor equals
`TEST05/tree/openplan/node_modules`, with the canonical named donor bound read only
at that final destination. No old execution tree supplies active paths.

All eight candidate descriptors stay exact. All 4,490 seed files retain v2 bytes
in new physical files. All 15 payloads, every runner function, reporters and IO
helper retain bytes, including accepted03 guard bodies. The 4,592 prior06 source,
seed and actual evidence files remain in place, with descriptors recorded before
preparation. Prior pins and v1 snapshots remain literal historical records.

The proposed fresh window requires H00 first and a full baseline: **20 calls,
12 faults, seven core files, then five intact original suites after restoration**.
The unchanged budget is480seconds including15cleanup,465manager,1GiB,0swap,
CPU50,Tasks64 and one worker. Call ceilings total435seconds with30work overhead.
Cost fit remains unmeasured. Guard26 is not repeated. No command has run here.

[Exact request proposal](REQUEST.proposal.json) SHA256
`ccb97daeee4abf78733f28951e4ca821a51e8b3eef66064cf4a408fd35280f08`.
Private `COMPLETE_INPUT_INDEX.final.json` SHA256
`a6e07a94cbdaa5ad44b02e73bdaf259bbd259b39a2c991d9b500e5f784d8bfa0` pins 56,299 regular inputs and63 aliases.
Private `REQUEST_COMPARISON.json` reconstructs every key and records every scalar
delta; `PATH_ROLE_MAP.json` covers all active nested command/source/destination,
cache/report/env and guard paths. `SOURCE_DELTA.json` rechecks all chosen oracles.
`SOURCE_PREPARATION_INDEX.json` seals full descriptors for ROOT reread.

No final REQUEST, grant, epoch or attempt exists in NEW07. This handoff grants no
operation, CI retry, native acceptance, Next webpack/build/deployed compatibility
or release. A future exact ROOT grant remains separate.
