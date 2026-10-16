# Separate source approvals for usage-limit corrections and install-check

October 16, 2026. This new independent bounded review finds no P1 or P2 source
finding in either assigned subject. Each verdict applies to its exact commit.
The two candidates are not integrated or tested together here. T1, T15 and the
full v1 destination remain incomplete.

## Subject A resolves the three earlier P2 findings

**Verdict: approve the bounded source candidate, with no new P1 or P2 finding.**
Subject A is `4b65f0484f45a38c746e37789979351e990837c5`, sole parent
`40d8227dc25cb94084de077a4e8f47b107cc7a08`. That parent contains original
implementation `7048efd372edce210e8af5438aa7775f7d359739`. This review reads the
original implementation, full independent review, full correction STATUS,
correction delta, tests, retained controls and evidence manifests. The original
STATUS describes historical behavior; the correction STATUS governs the revised
reset and configuration claims.

1. **P2-1, ordinary test integration: resolved in source.** The worker test uses
   its own `mkdtemp` child, immediately registers cleanup, and verifies privacy.
   `OPENPLAN_USAGE_TEST_TMP` chooses an optional parent. Its absence no longer
   prevents test loading. README, package and CI still include this file through
   their ordinary commands. The retained root five-test and nested seven-test
   logs and receipts show both that variable and `TMPDIR` absent. This reviewer
   independently runs the 18 selected Node tests with the custom variable absent
   and `TMPDIR` set to owned private storage. Baseline and restored runs pass;
   the optional-parent restored run passes too. Restoring the old prerequisite
   fails at module load for its named reason. Removing cleanup lets Node pass
   but leaks one owned parent; the external inventory detects it and removes
   that deliberate leak. This is not a Node assertion kill. No full glob, package
   suite or QA gate runs here.
2. **P2-2, causal reset attribution: resolved in source.** Every currently
   classified generic failure returns null reset and source, even with a known
   exhausted default bucket. Default-window observations remain bounded, copied
   and separate. Neither selected-model wording nor another bucket supplies
   causal binding. The supplied `TurnError` schema has no causal bucket field.
   Independent controls reproduce the named failures for borrowed default reset,
   sparse observations, reset bounds and mutable observation copies. The retained
   real-adapter test replaces launch construction alone with synthetic Node frames.
   Its five scenarios cover default-only, later known/unknown other buckets and
   initial known/unknown multiple buckets. The retained old-reset mutation fails
   all five on the expected null-versus-1800000600 comparison. No new protocol
   fields or provider recording are invented. The receipt/API/panel reported-reset
   branch remains a structurally scoped contract branch, not evidence that current
   generic Codex failures bind such a reset. Reviewed causal reported-reset support
   remains a T1 requirement, not a requirement waived by this correction.
3. **P2-3, effective function configuration: resolved in source.** SQL18 gives
   both functions `pg_catalog,public,pg_temp`. The replacement finish function
   preserves the intervening hardening ALTER from migration
   `20261014000032_application_temporary_schema_order.sql:60`. The source test
   scans CREATE headers and later ALTER SET statements across all 420 preceding
   files, rather than comparing the previous CREATE alone. Independent inventory
   finds the same three prior files mentioning finish. Removing explicit
   `pg_temp` separately from finish and validator fails the respective named
   assertions. Harmless tracker and SQL comments survive, and exact bytes restore.
   The validator retains its immutable invoker declaration and service-only
   grants; finish retains SECURITY DEFINER and its service-only grants.

The scanner is a bounded source check, not a PostgreSQL parser. Its comment
removal and regexes do not model arbitrary quoted/dollar-quoted SQL, overload
identity, dynamic SQL, every ALTER/RESET spelling or live role/configuration
state. Its grant assertions also inspect text, not installed ACLs. The current
finite history and actual headers receive source inspection independently of
those assertions. The checks do not establish SQL compilation, name resolution,
privileges, RLS or a privilege-escalation exploit.

The NEW configuration probe and runtime-boundary document remain **PREPARATION
ONLY**. They explicitly require a new root-owned wrapper that establishes actual
disposable target identity, source/function pins, a fresh fixture, bounded
fail-stop transaction handling and rollback proof. No such wrapper exists in this
candidate. Neither the JSON setting nor the historical synthetic flag establishes
target identity. This is a future runtime admission constraint, not a reason to
reject the corrected source verdict. No probe or migration runs here.

## Subject A preserves the scoped receipt and approval boundaries

The production provider still correlates thread and turn before classification.
Literal structured error codes, not prose, select the limited outcome. A new
session owns each tracker. The session freezes its narrow signal at the final
event; with generic resets now always null, this review does not reuse the old
reset-change mutation as new proof that every final-event race is covered.

Worker delivery remains synced before transport. The independent Node replay
case verifies identical delivery after lost acknowledgement, one inspection and
one generation, scoped-receipt refusal and cancellation remaining interruption.
It uses injected transport/generation and synthetic Node frames. The local owner
can still change a valid reset to another valid reset without violating shape
and scope. These guards are not cryptographic authenticity or universal tamper
detection.

The route and retained reader bind all ten custody fields. The inspected mocked
route tests assert both the actual projection and required selected columns,
then assert that changed custody never calls finish. They also reject extra
receipt/signal data, invalid reset bounds, answer/failure mismatches and success
reuse before finish. The panel selects limited status only from a validated
retained failure, preserves reset/token/cost unknowns, states recovery is
unconfirmed, and retains the success-only proposal review control.

A complete source comparison against the prior finish definition changes only
failure-receipt validation/storage plus the corrected search path. Connection
and token checks, current scope authorization, lock order, attempt identity,
lease/cancellation, terminal equality, version 1 success/proposal and API checks
remain. This is source equivalence for those branches, not native acceptance.
No approval route, business action, provider substitution or retry is added.

## Subject A evidence is preserved without promoting earlier failures

All 18 current source pins, 10 review/protocol input entries, 83 historical and
donor entries, 51 new private evidence entries and seven new public entries
match. Original-commit source and evidence pins also match. These are manifest
entries with overlap, not counts of distinct artifacts. The original donor-cache
violation remains recorded and unrepaired. This reviewer reads hashes only and
uses no dependency cache.

The retained terminal results support 18 Node tests, 114 Vitest tests, scoped
TypeScript and scoped lint. This reviewer independently reruns the 18 Node tests
and source controls only. The private Vitest configuration sets a private cache
before execution; the recorded TypeScript scope names the six candidate files
and their imports. Empty compiler/lint logs alone are not execution proof; their
exit-zero claims come from the retained check receipts. No independent compiler,
lint or Vitest rerun occurs here.

All 12 correction trials are inspected: three harmless survivors, eight intended
test-process failures and one cleanup-oracle rejection with Node exit zero. The
initial sparse trial raises TypeError while evaluating an assertion argument.
It remains retained and does not count as a named kill. The corrected test uses
optional access and its later log fails `Sparse update cleared a qualified
observation` through ERR_ASSERTION. The independent campaign reproduces that
named assertion. The cleanup driver separately raises its named external
assertion, removes its owned leak, restores source and records a restored pass.

## Subject B exposes the reviewed inspector without broadening its authority

**Verdict: approve the bounded source candidate, with no P1 or P2 finding.**
Subject B is `1831c8449f7273ab18d505e0e2db366e56edac08`, sole parent
`82d33de8d3d2d901e2feddad757ee9aaaec9daba`. Exact git objects establish the
seven-file delta: connector, focused test, README subsection and four integration
review files. The inherited helper candidate is
`e41f3cb75ae61feabf8ce89b5bc8ed8fcdec600c`. Its full implementation and independent
reports are read. All eight inherited source/report pins still match Subject B.
The earlier source approval remains limited to synthetic npm/Linux inspection.

`install-check --config PATH` validates the saved connection and uses its saved
provider and binary. Version-one configurations retain Codex interpretation.
The parser preserves `npm` literally, resolves the supplied root, requires the
installer/root pair, and rejects unsupported declarations, duplicates and unknown
flags. It returns guidance immediately after configuration read, before connector
directory creation, locks, native inspection, polling, models or map work.
Configuration read resolves the saved binary and profile paths, but does not read
profile contents. Fixed CLI errors exclude raw exception and credential text.

The inherited helper requires explicit npm declaration, matching bounded regular
metadata and the exact selected package entry. It binds an inert structured npm
command to the inspected prefix and pinned tested provider version. No declaration
keeps the installer unknown and command null. Metadata does not authenticate npm
ownership, establish native version/compatibility or authorize an update. The
registry's unchanged historical/scripted evidence tiers do not become live
provider acceptance through this integration. The README and help disclose these
limits and leave command execution to the operator.

The new tests invoke the actual Node connector command against private synthetic
configurations, profiles and package entries. Positive cases cover all three
saved providers, exact executable/arguments, token/profile canaries, and file and
directory content/mode inventories. Legacy/unknown and invalid-argument cases
cover the documented branches. The marker shells do not run in these cases.

The independent private replay reproduces all 14 trials: baseline, harmless
comment and restored runs pass all three new tests; 11 faults fail selected
assertions. Command enrollment and literal-installer faults fail the successful
command assertion with the expected fixed refusal. Other faults expose crossed
provider, connection disclosure, inferred npm ownership, missing pair, unsupported
declaration, accepted write flag, accepted duplicate, unexpected directory and
missing read-only help text. Each source fault restores in `finally`, and tests
remain unchanged. Original and replay log hashes and assertions are inspected.
The only driver adaptation changes its private output path.

An additional independent focused run passes 11 tests, the three new command
cases and eight inherited helper cases. The retained owner's 15-test completion
records its four existing CLI cases too. Those include a local HTTP fixture and
are not rerun under this review's no-network restriction. The retained completion
log lacks its first two output lines but includes the aggregate 15-pass result;
this review does not describe it as the complete raw run.

Source inspection and synthetic inventories support the stated limited absence
of effects. They do not observe every filesystem read, external/transient effect
or network syscall. Native compatibility, installed-provider/account operation,
actual updating, hostile concurrent filesystem changes and browser behavior
remain outside the evidence. No universal no-effects or authenticity claim is
accepted.

## Custody and integration constraints

The assigned review checkout is
`/home/nathaniel/.t3/worktrees/openplan/t3-5fd04097`, branch
`t3/a0-corrections-install-check-review`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. After an ancestor check it advances
locally, fast-forward only, to Subject A. Subject B is read through exact git
objects and never merged or checked out here. Both subject checkouts remain
unchanged. Mutation subjects are new private exact-object copies only. Final
copy inventories match their assigned objects, except the documented private
output-path adaptation of B's driver. Hashes bind bytes, not the truth of earlier
process actions.

Ownership covers this new report directory and
`/home/nathaniel/.local/state/openplan/a0-corrections-and-install-check-independent-20261016`.
Tests run serially under the shared compiler flock, in short owned test units
with 1 GiB maximum memory, zero swap, 50 percent CPU and 256 MiB Node heap.
No application/database service starts. Review reads AGENTS.md, planner-writing,
prove-it, Supabase and relevant Postgres guidance. User source-only restrictions
exclude their operational/documentation-network steps. This review selects no new
product lane and reads existing direction results rather than rerunning npm.

The report commit adds documentation/evidence only. It does not join either
candidate to root or main. Integration must preserve the two source identities,
reviewed helper/registry pins, ordinary test entry points, strict receipts,
authorization and approval contracts. Migration18 remains unapplied and requires
separately authorized isolated native validation before any corresponding runtime
acceptance claim. The earlier review's role, cross-scope, token/revocation,
lease/stale-attempt, concurrency, version 1/API replay and route/database checks
remain open. Do not use a protected target to fill those gaps.

No real provider/account/model/binary use, provider-frame recording, SQL/database,
RLS/PostgREST, browser, full suite, build, cloud, push, PR, candidate integration or release occurs.
No SDK no-replay or official418 collection work is duplicated. Consented native
recordings, provider compatibility and desktop/390px navigation/artifact acceptance
remain separate work. Claude/OpenCode structured limit support and T15 usage
collection remain incomplete. Neither source approval closes T1 or v1.
