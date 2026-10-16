# Three A0 usage-limit findings corrected in source

October 16, 2026. Local correction candidate based on independent review
`40d8227dc25cb94084de077a4e8f47b107cc7a08`, which contains original implementation
`7048efd372edce210e8af5438aa7775f7d359739`. The assigned clean checkout fast-forwards
locally to that review before editing. Branch `t3/a0-usage-limit-receipt` owns this
work at `/home/nathaniel/.t3/worktrees/openplan/t3-c1880cd3`.

All three P2 findings have source corrections and focused counterfactual controls.
This report does not constitute independent acceptance or native SQL/runtime
acceptance. Migration18 remains unapplied. T1, T15 and the full V1 destination
remain open. Nothing is pushed, released or joined to root's installer lane.
Root607 and the appbed remain outside this work.

## P2-1: ordinary Node entry points own their temporary storage

`usage-limit.test.mjs` creates its own temporary parent with Node's `mkdtemp`.
It verifies the private directory and registers an `after` cleanup immediately.
The optional `OPENPLAN_USAGE_TEST_TMP` override chooses a parent, but the test
still creates and cleans its own child. Absent that variable, the normal platform
temporary directory supplies the parent. No private runner or skip is required.
The existing README, package and QA/CI commands need no changes to load this file.
Root's separate README installer subsection stays untouched.

The ordinary root command `node --test workers/planner_agent_connector/test/usage-limit.test.mjs`
passes five tests with both `OPENPLAN_USAGE_TEST_TMP` and `TMPDIR` absent. Before
and after inventories confirm no owned temporary directory remains. A selected
seven-test invocation from `openplan/`, using the normal package-relative paths,
also passes with both variables absent. These are ordinary target invocations,
not executions of the entire README glob, package connector suite or QA gate.

A fault restoring the environment requirement fails at file load for the named
reason. A separate cleanup fault deliberately removes the after hook. Node itself
still passes; the cleanup oracle raises `Owned temporary parent cleanup assertion
failed` after detecting the leaked owned parent. The control records that distinction,
cleans its own deliberate leak, restores exact source bytes and verifies the
normal target passes and cleans up again. It does not claim Node caught cleanup.

## P2-2: an observed rate window does not establish the failure bucket

The supplied `TurnError` and literal serialized `CodexErrorInfo` contract has no
causal bucket identity. This implementation has no reviewed selected-model-to-bucket
mapping. Therefore every currently supported generic Codex usage/rate/session-budget
failure returns `resetAtUnixSeconds: null` and `resetSource: null`. Even a sole
exhausted default window does not establish that it caused this task's failure.
A `normalModelSlug` or a matching fixture model does not manufacture that binding.

The existing attempt-local tracker keeps bounded default-window observations
separate from its failure signal. The new `defaultWindowObservations()` returns
a copy, explicitly qualified as default-bucket observations. Sparse nulls preserve
those observations; a newly reported window replaces its prior reset, including
unknown values. Other named buckets cannot replace those default observations.
No observation is attached to a generic failure reset, exposed as remaining quota
or used to infer recovery. Account identity, plan, credits and prose stay excluded.

The real session still reads the attempt snapshot before its sole turn, freezes
the structured final signal and preserves thread/turn correlation. New authored
frames use only fields already present in the supplied schema. Tests cover default-only,
a known default followed by known or unknown nondefault windows, and initial
multi-bucket snapshots with known or unknown other resets. All failure resets stay
unknown. The tests also retain sparse observation, bounds, copy isolation, privacy,
literal classification, cancellation and journal replay checks.

A fault restoring the old default-window calculation fails the pure/Node checks
and all five real-adapter scenarios, including both initial multi-bucket cases.
The panel, typed reader, strict receipt validator and native endpoint keep their
reported-reset branch for structurally valid, scoped receipt/contract cases. Their
reported-reset fixtures are not an invented provider protocol extension or proof
that current generic Codex errors supply causal binding. This branch does not
independently authenticate a connector report.

T1 still requires displaying a reported reset when a reviewed structured contract
actually binds it to the task's failure. This correction leaves that implementation
and compatibility proof open. It does not redefine T1 to require unknown resets
forever, infer billing entitlement or reduce the multi-provider destination.
Claude/OpenCode structured classification and reset support remain open. T15 token
and cost collection remains open; unknowns do not become zero.

## P2-3: preserve effective function configuration, including later ALTERs

Both the replacement finish RPC and new validator in SQL18 now explicitly use
`pg_catalog,public,pg_temp`. The replacement retains the finish RPC's hardened
configuration from `20261014000032_application_temporary_schema_order.sql`, rather
than copying only the earlier CREATE body. No function body, grant, state,
authorization, lease, replay or success/proposal semantics change in this correction.

The new Node source test reads all 420 preceding migration files and examines
CREATE headers and intervening ALTER SET search_path statements for the finish
function. The effective last amendment is the hardening migration. A separate
header check requires trusted schemas before explicit `pg_temp` in the new
validator, preserves its invoker/immutable declaration and checks the service-only
grant/revoke statements. `intervening-configuration.json` pins the inventory and
all three files mentioning the earlier finish function.

A harmless SQL comment survives. Removing `pg_temp` from the replacement finish
header fails `Finish must preserve explicit pg_temp last`. Removing it from the
validator header fails `Validator must keep explicit pg_temp last`. The source
tests strip SQL comments and inspect function headers rather than accepting prose.
They are bounded regex/source checks, not a general PostgreSQL parser or installed
configuration oracle. They cannot establish resolution, compilation or privileges
in a running database.

The NEW `NATIVE_CONFIGURATION_PROBE.sql` prepares installed proconfig/function-hash,
actual role-denial and temporary table/type shadowing checks. It requires a NEW
root-owned identity-bound wrapper and fresh synthetic fixture; it is not an
executable admission packet. `NATIVE_RUNTIME_BOUNDARY.md` specifies the actual
container/stack/database identity, pinned sources/definitions, private custody,
timeouts, fresh backend, fail-stop execution and rollback proof that wrapper must
establish first. A manually populated JSON setting is not target identity proof.
The historical probe stays unchanged and is not reused as an authorization gate.
No SQL fragment, role change, database operation or runtime probe executes here.

## Checks and counterfactual evidence

All heavier checks and mutations use the shared
`/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`, a
1024 MB Node heap and one serial test worker. Every Vitest invocation uses the NEW
private configuration/cache before execution. No cache configuration or logs in
the original implementation directory change.

Final selected checks pass:

- Node: 18 tests across usage-limit, usage-limit-source and codex-session files.
- Vitest: 114 tests across the adapter, usage-limit route/reader/panel, existing
  provider routes and existing provider panel files. Five adapter scenarios replace
  the original single case. No provider binary is invoked; only launch construction
  is replaced with an owned synthetic Node frame process.
- Scoped TypeScript: the six original candidate TS/TSX files and their imports,
  using the new private configuration, pass. Scoped lint on the changed adapter
  test passes with no output. These are scoped checks, not a full project gate.
- Nested product direction check passes with its dated review reminders intact.

The 12 control trials comprise three harmless survivors, eight intended Node or
Vitest test failures, and one cleanup-oracle rejection. `controls.json` records
each process exit code, assertion and restored source hash. The extra cleanup
receipt records Node's zero exit and the real failing cleanup assertion separately.
Every source mutation restores its exact original bytes in finally cleanup;
current source hashes match every restoration. Restored unset/default, override
and app tests pass. Owned deliberate cleanup leaks are removed by their control.

The first sparse-observation fault produced a TypeError while evaluating an
assertion argument. The driver refused to count that as its intended assertion.
The test now tolerates a missing observation in that argument and fails its named
assertion instead. The first trial, driver, logs and result remain under NEW private
`trial1/`; this correction does not erase or reclassify it as a valid named kill.

## Preservation and remaining boundaries

The full independent review, evidence and private pure observations are read and
pinned. All original candidate source pins and private review observation pins
match before edits. A snapshot of 83 historical report/private evidence/donor-cache
files remains byte-identical after checks. The original donor-cache incident and
all earlier failed trials remain in their historical report and evidence. This
run uses private caches from its first Vitest invocation; it does not repeat that
write or attempt to repair the historical donor cache.

The source and deterministic tests cannot establish provider authenticity, current
account entitlement, causal quota binding, installed CLI compatibility, actual
account changes, PostgreSQL compilation/configuration, native PostgREST/RLS,
concurrency, lock behavior or physical interruption durability. The journal guard
checks shape and scope, not a cryptographic seal against its local owner changing
a valid reset to another valid reset. Exact terminal replay still depends on the
existing database contract, which has no native acceptance in this work.

DOM tests cannot establish navigation, desktop/390px geometry, console behavior,
keyboard or assistive-technology acceptance. No native CLI, account/model call,
provider recording, database/SQL, service, browser, full suite, build, CI, cloud,
protected target, push, PR or release runs. New provider recording still requires
the account owner's separate consent. No automatic retry, provider substitution,
credit/account/email action or installer operation is added.

Private evidence lives at
`/home/nathaniel/.local/state/openplan/a0-usage-limit-corrections-20261016`.
`checks.json` records exact selected commands and terminal results.
`source-integrity.json` pins the complete current usage-limit source/receipt path,
new source check and prepared native fragment. `evidence-integrity.json` pins
review inputs, preserved history, logs, control drivers and public evidence.
The final candidate commit is reported separately to avoid a self-referential hash.
