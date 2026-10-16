# Apply17 remains in preparation with one P2 history-custody finding

October 16, 2026. New independent SOURCE/METADATA ONLY review of subject
`b35dd7126939d7e1ad24e9ddbf887653275317c1` and one exact apply17 proposal.

**Disposition for the captured preceding finish function: conditional support
as an exact preservation descriptor for this stage. Its complete body matches
the pinned predecessor source. Named-role and default-privilege acceptance
remain unestablished by these records.**

**Disposition for the exact apply17 proposal: retain PREPARATION ONLY.
P2-APPLY17-1 leaves exact migration-history text dependent on an unverified
session setting. No P1 finding is established. Resolve that bounded prerequisite
and review the resulting exact candidate before publication or dispatch.**

This report approves no admission, SQL17 operation, SQL18, provider recording,
automatic successor, hosted change or release. Earlier source and admission
approvals retain their subjects and do not approve this stage by proxy.

## P2-APPLY17-1: History text depends on unverified string-literal semantics

Locations in the reviewed R6 runtime are `runtime/controller.py:273`,
`runtime/fixture.py:6` and `runtime/policy.py:59`. The private templates match
those authored bytes. SQL17 contains backslashes at lines 80, 113, 220, 221,
233, 234, 237 and 269.

`apply(17)` appends the original migration text directly as the executable
body, then inserts that same Python string into the history `statements` array
through `f.literal(sql)`. That encoder doubles apostrophes but leaves backslashes
unchanged. It emits an ordinary single-quoted SQL literal, without an explicit
escape mode or an independently delimited dollar-quoted history value.

With `standard_conforming_strings=on`, this preserves these pinned bytes. With
the setting off, ordinary string literals interpret backslashes. For example,
the migration's `\s+` and `\.` text can lose the backslash in the history value.
The dollar-quoted function body sent earlier and its single-quoted history copy
therefore need not retain the same text. This is a concrete source/SQL-semantics
counterexample, not a claimed native failure on the retained target.

The sanitized process environment does not set this PostgreSQL setting.
`identity_guard()`, BOUNDS, the actual nonsuperuser role check and the history
lock/digest check neither set nor validate it. The retained native projections,
captured finish proconfig, proposal and restored history metadata do not report
its effective value for the future migration backend. PostgreSQL's normal
default is not evidence of this particular session's effective value.

After commit, `policy.history()` checks versions, count and latest only. The
complete before/after map deliberately excludes `schema_migrations`. The new
history digest is retained but has no independently computed expected value.
Consequently, altered history text can escape both checks while the migration
body itself succeeds. ON_ERROR_STOP does not turn an escape warning into an
exact-byte assertion.

Before admission, establish the required literal semantics in the same owned
migration backend before parsing the dependent text, or use an encoding that
preserves this exact value independently of that setting. Preserve the original
SQL17 source bytes. A read on another connection, an unbound default assumption
or changing the recorded migration to match altered text does not resolve this
finding. A parent-owned correction needs its own exact seals and review. Any
changed guard/test also needs harmless-survivor, named-failure and restoration
evidence under a separately granted bounded window.

I change no implementation and run no native parser or new pure campaign. An
inert fake that merely repeats this interpretation would not establish actual
PostgreSQL behavior. No additional test window is needed for this source finding.

## The actual preceding finish body matches the retained source through16

The actual copied definitions file is byte-identical to
`<R6 packet>/stages/restore419/definitions.json`. Its parsed object matches actual
restore request023's retained definition capture. Its file SHA-256 is
`51ee25e367f5b665a090011c6b8a173b6c0bb5db6d3f2a731ae6a5fab4a1808a`.
There is exactly one function, with signature
`finish_assistant_provider_turn(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)`.
The SQL18 validator is absent, as expected before 18.

I read the entire actual definition, not just its hash. Recomputed definition
SHA-256 is `62bc6dee9f86785dcd05c399a75ffba562632e89730d291c64f48ad269cc00df`.
The exact body between the source and captured dollar delimiters matches,
including leading/trailing newlines, at SHA-256
`ea3f215555523082142f0506ad3e40be28279d3b79778f7d9b05ed691f4c4c91`.
This comparison does not normalize or silently repair the body.

The predecessor trace is:

1. `20261010000001_assistant_provider_connections.sql` creates the original
   finish and the connection/scope helpers.
2. `20261012000002_assistant_api_turns.sql:208` replaces finish with the exact
   captured body and adds saved API identity/locking behavior.
3. `20261014000032_application_temporary_schema_order.sql:60` changes its
   effective search path to `pg_catalog, public, pg_temp`.
4. No other reference to this function occurs in the sealed migration files
   through `20261017000016`. SQL17 does not change it. SQL18 is the later,
   separately unadmitted replacement.

The body distinguishes native connection callers from API/user callers and
rejects ambiguous identities. It locks through the retained helpers, compares
attempt and connection/user/workspace/project identity, retains API cancellation,
compares exact terminal replay values and refuses changed replay. It preserves
running-state and lease checks, failure-code/result/receipt exclusivity,
answer/citation/proposal boundaries, and provider/model/auth-mode comparisons.
Saved API receipts additionally bind turn, attempt, API connection/revision,
configuration/packet hashes, endpoint and protocol. Helpers are explicitly
qualified in public; relation composites are public-qualified.

This is the expected predecessor, which still rejects a nonnull failure receipt.
It is not evidence that SQL18's native-limit behavior already exists. Neither
this review nor apply17 invokes finish, its authorization helpers or an agent
write. Exact approval/payload hashes, route-local verification, authorship and
action-registry requirements remain unchanged and unproved by this stage.

The descriptor records owner `postgres`, SECURITY DEFINER true, volatility `v`
and the complete one-entry proconfig array
`["search_path=pg_catalog, public, pg_temp"]`. Removing only `definition` from
the actual capture exactly reproduces `prior-function-pins.json`, SHA-256
`2832c3fc24d5b247161a3a2c4b1616fa22d47c4f87cdfa0a6527dd50f02db3e7`.
The proposal contains that exact descriptor. `policy.installed()` compares the
complete function set, hash, owner, definer status, volatility, full config and
expanded ACL with type-sensitive equality before 17. This is substantially more
than accepting a hash-shaped value.

## Raw ACL continuity does not establish named-role or default-privilege acceptance

The two actual expanded ACL entries each contain EXECUTE, grantable false and
grantor string `16384`. Their grantee strings are `16384` and `16445`.
These stay raw. This review does not rename them postgres or service_role.
Captured function ownership is a separate named field, not an OID-to-role map.
Global-role/membership digests likewise contain no recoverable named mapping.

The capture expands `coalesce(proacl, acldefault('f', proowner))`. Its absence
of grantee 0 supports the narrow observation that the expanded function ACL
contains no direct PUBLIC EXECUTE entry. It does not establish named grantee
identity, inherited access through membership, schema access or actual
anon/authenticated denial. The capture also omits raw proacl and pg_default_acl.
`acldefault()` is the built-in object default, not a census of ALTER DEFAULT
PRIVILEGES rules. Those distinct meanings must not be combined.

Source shows finish's direct PUBLIC/anon/authenticated revocations and
service_role grant. The inspected earlier default-grant migration explicitly
leaves functions untouched and changes table/sequence defaults. This records
source intent. It does not supply the missing actual named-role/default-ACL
evidence, and this review makes no new catalog query or grant repair.

For apply17, the descriptor can preserve the captured finish identity because
this stage neither edits nor executes it. I establish no additional body or
descriptor source objection in that limited use. Full semantic service-only
ACL acceptance remains unresolved. If the parent requires that stronger
acceptance before this stage, the retained packet does not satisfy it. It must
remain an explicit unmet prerequisite, not an invented named mapping. No 18,
fixture, provider or general privilege approval follows from these raw pins.

## Exact proposal and outer bindings match the actual R6 predecessor

The author checkout remains clean at the subject in
`/home/nathaniel/.t3/worktrees/openplan/t3-ac91cc52`, under
`docs/reviews/2026-10-16-a0-sequence-snapshot-correction`.

The exact proposed inputs are:

- Proposal: `/home/nathaniel/.local/state/openplan/a0-r6-apply17-admission-proposal-20261016/apply17-proposal.json`,
  SHA-256 `3c88370b4874ec6a623dda06ab5433ec288c0a24e9825a723eb8574acd5c0385`.
- Outer runner: `/home/nathaniel/.local/state/openplan/a0-r6-apply17-parent-runner-20261016.py`,
  SHA-256 `e4687aa8d813df25b1b4e299c755aa5c6c7b038a8832be2e527103bac3a4f150`.
- R6 package: `a8c583e5a73dec9602b7329e3c646e77e99677033c4229e20d38c173dabf3141`;
  plan: `f8b8a36f4439703964cd5d66d9e6408d37bc984215c6c07a5909a728af7db4e5`.
- Actual restore completion:
  `fc590a9ed0285dbfcb3de75137ffc627efbe4398446995eddfa58407475cca0f`.
  The separate manager-terminal receipt is present and binds restore419.
- Target: `openplan_a0_limit_c730358675ac8bb47ac15fdd`, integer OID 6227945,
  system 7683856985084612646; retained allocation backend PID 1475388.
  Target receipt SHA-256 is
  `b7d05c90a4c1e221704d00615fa1ff8d968416e3cf9650a424bc11760b00b58c`.

Application source remains `f8a571bb0a18b8b6501870acb5ef1e760d487e1c`, app tree
`d577a9cd955018b3253f42b3d9af2a96a9a10b53`, connector tree
`228ce912b1cf63dba408445422dc6e2b690d91f4`. All 421 migration sources match
their seal. SQL17 SHA-256 is
`b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`.
SQL18 remains `655e625878b3e62f332a7f17d6e126879813cc2bf881ca745593978d8eed6559`.

Stage, package, plan, predecessor, source/tree and integer resource fields match.
`functionPins:null` is appropriate for this pre18 stage; the one preceding finish
pin has the narrower role described above. Policy checks the independent-review
hash's syntax, not actual report consumption. The proposal still names source
review688; root must bind this admission review in its separate decision.
Extra observation/system/rootDecision fields are not all independently checked
by `apply()`. Root must compare their actual retained receipts before publication.

Independent text comparison reproduces the supplied outer diff against the
reviewed restore runner `ec482e26ed6f5dd955ae8a990198fca89b5b33744440a6d52f36b7b801b0b4b6`.
Only the docstring and stage/root/unit/admission bindings change. The outer
reserves fresh proof directories, records exact argv/environment/admission hash,
then records returned local PID, sampled unit identity, combined stream hash and
terminal exit. Inner journals retain separate stdout/stderr and their hashes.
This is unchanged process logic, not an executed apply17 trace.

Outer unit `openplan-a0-native-parent-r6-apply17-20261016-01` requests 1 GiB,
zero swap, CPU50, RuntimeMaxSec540 and UMask0077. It invokes exactly the sealed
`/bin/sh <R6 packet>/templates/run_stage.sh apply17`. Inner unit is
`openplan-a0-limit-r6-apply17`. Ordinary requests retain PATH/HOME/LANG only;
the manager adds its derived real-UID runtime directory. No inherited password,
provider credential, Docker-host or bus address is introduced.

## Retained actual restoration supplies scoped evidence, not broader recovery

I read the complete current source review688, observe714, allocatefb77 and new
restore7c7f. The source review's correct directory is
`docs/reviews/2026-10-16-a0-sequence-r6-independent`; its four files are recovered
from exact Git objects into this new private directory. The full restore review
has 21648 bytes and SHA-256
`f3cdc9bece92ab5caf000d4aed3a72e3c1473ae4190de366204cea71c6bfe3c5`.
No conditional pre-operation review is treated as actual operation evidence.

Direct retained-journal comparisons match 12 observe, 19 allocation and 25 restore
controller requests, plus each separate manager request. All 59 inputs/streams,
positive returned local PIDs and exits match. All 89 observe, 131 allocation
and 169 restore proof entries match their retained byte/length/mode/owner pins.
Restore proof manifest SHA-256 is
`f20a33fde59c4af5042bb0f1cb4eaab548240fbdb5b9694afbedb06d318e8ae5`.

Actual restore request017 streams one fixed single-transaction archive restore.
History019 matches419 versions, latest20261017000016 and full-row digest
`0ee645e79fb8431bb116c30a673f8775`. Snapshot021 matches the complete 376 ordinary
table count/digest map and pg_sequences census
`d906d887079dd69d2b018752258ca3b5`. Six explicit sequence objects retain
last_value/log_cnt/is_called. There is no independent source log_cnt/is_called
map, so initial source equivalence for those fields remains unassessed. Later
complete-map comparison has direct sensitivity to those captured values.
Definitions023 captures the one finish reviewed above. OriginalScope011/025
matches the R6 observe baseline of 615 database catalog identities and global
role/membership/settings digests. Actual child complete and manager-terminal
are present. Catalog equality does not certify protected row contents.

Root's parent session 43534 reports terminal0 after 15.408639802946709 seconds,
invocation `fad2f959cc9f47c2a64dad08fd31ecfb`. Active MemoryPeak 1835008 is a
sample; final exact peak remains unassessed. Wrapper limits do not cap the
existing database container. No owner/locale, global-installation, provider,
cancellation or whole-recovery claim follows. I do not open the archive, create
a dump, query an endpoint or replay any operation.

## Apply17 has a bounded atomic body and a separate postcommit failure boundary

The successful source path has 27 controller requests, not an observed trace:

1. Five Git requests establish source ancestry, app/connector trees and unchanged
   tracked bytes. Requests006–007 inspect/read native catalog identity.
2. Requests008–011 check actual target identity and originalScope. Each SQL call
   first inspects the fixed container and checks database, session/current role,
   system and target OID in the same backend used for that call.
3. Requests012–015 read419 history and compare the captured preceding finish
   descriptor. The history digest must match actual restore419/history.json.
4. Requests016–017 capture the complete before-map. Requests018–019 inspect
   and send one migration transaction to the fixed target.
5. Requests020–023 read420/latest17 history and the complete after-map. All map
   entries except migration history must remain identical, including sequence
   state and census. Requests024–027 capture postdefinitions and final scope.
   Child completion, manager acknowledgement and outer terminal custody follow.

The footprint consists of five Git, 11 container inspections and 11 SQL requests.
One separate manager request and outer custody are additional. No actual apply17
request is dispatched here.

The migration SQL explicitly begins a transaction, applies statement 15s,
lock 3s, idle-transaction 20s and work_mem 16 MB bounds, then SET LOCAL ROLE postgres.
Its role DO block requires actual current_user postgres and nonsuperuser status.
It locks schema_migrations EXCLUSIVE and compares the complete prior-row digest
again before executing SQL17 and inserting version 20261017000017, the real name
portfolio_skip_invalid_classifications and original text. COMMIT is last.
P2-APPLY17-1 qualifies the exact-text part of this construction.

I read the entire exact SQL17. There is no outer BEGIN/COMMIT in those bytes.
Its top-level changes replace two classification CHECK constraints and the
existing portfolio v2 function, followed by function-specific revocation/grant.
It contains no invocation of that function or stored-row rewrite. Decision=create
still requires supported classifications; invalid skipped classifications retain
their supplied raw audit values. Actor/workspace/source/hash/format checks,
formula/name confirmations, duplicates, positive cost/currency/year custody and
creation validity remain. SQL17 alters no finish, provider tuple, role, global
grant, default privilege, platform helper or RLS policy.

The archived full SQL17 native proof remains separate. Its 32 expected-error
calls, 40 notices, warned temporary-schema grant, first catalog discrepancy and
unchanged-SQL repeat with 395 matching inventory records retain their outcomes.
This stage does not recreate that campaign, portfolio HTTP/HTML/browser imports
or complete function-privilege acceptance. Those results are not new R6 evidence.

The history lock protects the history comparison and write. It does not itself
exclude unrelated target writes between separate before/after connections.
Root must hold exclusive target/catalog/global-role/settings ownership. The
postdefinitions are captured, not compared automatically against prior pins by
`apply()`; root must review that actual capture before any new proposal. Snapshot
maps cover rows and sequence state, not every structural catalog, ACL or object.

SQL errors before commit with ON_ERROR_STOP must remain failures. A successful
commit followed by failed consumer, fsync, history/snapshot/definition/scope read
or manager acknowledgement can leave a changed target without accepted completion.
It is not permission to roll back by hand, retry, repair receipts, clean up or
reuse the target. Local PID/input closure, timeout or outer termination does not
prove a backend exited or rolled back. The source comment promising rollback
from closing input is not accepted as observed cancellation evidence.

## The next parent decision remains gated

1. Resolve P2-APPLY17-1 and assess any exact changed candidate afresh. Preserve
   this report and its objection. Keep named-role/default-ACL acceptance explicitly
   unresolved unless separately established within authorized evidence.
2. Consume complete current reports, actual R6 chain and this review. Recheck
   exact subject/proposal/runner, app/connector, source/runtime/binding/helper
   seals, plan, preceding actual descriptor and predecessor/manager custody.
   Source review and hash syntax alone do not approve function pins or operation.
3. Freshly check absence, including dangling links and partial reservations, of
   admissions/apply17.json, stages/apply17 and the outer proof root. They are
   absent through lstat in this review. Unit availability, compiler-window
   exclusivity, current target access and capacity remain unobserved here.
4. Obtain root's fresh exclusive native/catalog/global-role/settings and target
   window. Confirm 1 GiB/zero-swap/CPU50 and finite bounds through that authorized
   operating process. Earlier observe/allocation/restore windows are not proxies.
5. Only after resolution and a separate root decision may a separately reviewed
   exact admission be durably published once and its pinned outer invoked once.
   Require actual inputs, returned identity, separate streams/exits, body/history
   and complete-map outcomes, postdefinitions/scope, child completion, manager
   acknowledgement and outer terminal evidence before accepting that one stage.
6. An error, timeout, unknown outcome, partial intent, lost acknowledgement or
   missing receipt permanently fences it. No overwrite, retry, repair, cleanup,
   target replacement/reuse/drop or automatic successor follows. Even successful 17
   would grant no 18, fixture, case, race, provider, hosted or release operation.

## Earlier findings, ownership and verification limits remain intact

The original wrapper STATUS at d20, R5 HANDOFF/parent/OID records, current full
R6 STATUS/HANDOFF/PARENT_RECIPE, original receipt/correction context and indexed
reviews 332925/857453/7468c58/6c12e7/133e195/98cff receive source inspection.
The responses retain namespace, provider FK/model/mode/token, qualified caller,
manager-location, main/case OID and sequence corrections and their limits.
No disagreement or earlier failure is regraded by this new P2.

The R5 target OID 6212363 remains permanently fenced after its 21-request restore,
with archive/history success followed by snapshot exit 3 for the missing sequence
composite type, stderr SHA-256
`ffa2a8d781640cc9a4a17e1a1daa1ba2e90d4e0137be34ba7e870865fc2c7080`.
Missing completion/manager acknowledgement stays missing. The R3 failed observe
also stays fenced. R6's explicit three-field sequence builder changes one path;
the other eight runtime files and strict numeric OID/PID, ordinary 0/shadow 888,
caller/tuple and restoration guards remain. Retained 12 sequence trials and 12
reduced continuity probes are inert composition evidence, with their harmless
survivors/named faults/restoration. They are not native SQL/RLS/cancellation
acceptance. No old 17376-file, 113-case or 15-fault campaign is rerun.

This assigned checkout starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`, branch
`t3/a0-r6-apply17-admission-review`, in
`/home/nathaniel/.t3/worktrees/openplan/t3-012fdf58`. T3 confirms the actual
isolated binding, delegated parent and Sol6.1/high configuration; separate budget
and M11 work remains separate. No nested agent is used. Ownership covers only
this new public directory and
`/home/nathaniel/.local/state/openplan/a0-r6-apply17-admission-independent-20261016`.
The local commit contains review documents only. No source join occurs.

Metadata comparisons match 33 exact subject Git files, four files from each of
four exact current review commits, nine package runtime files, five bindings,
1126 source pins, seven helpers and the 89/131/169 actual proof entries. Counts
overlap. Detailed comparisons, exact supplied hashes, body equality and selected
before/after custody remain in the new private directory. They do not expand
old campaign manifests or parse archive contents. No changed test or guard, source
import or new test execution occurs. Reader/path errors remain tool history,
not source failures or mutation kills.

AGENTS, planner-writing, prove-it and Supabase PostgreSQL source guidance apply.
Explicit offline restrictions exclude generic network/native/testing steps.
The binding V1 contract, sole roadmap A0 and T1/T15 scope remain intact. Retained
same-application direction receipts keep their dated reminders; no npm direction
command or broad product audit runs here.

No manager/flock/Docker/SQL/catalog/socket/native/helper/HTTP/browser, dependency,
test/build, real CLI/provider/account, publisher/runner, admission, hosted action,
push/PR/main change or release occurs. Protected419/sourceDB6072103, demo3000,
frozen607/215, failed targets, helpers and retained proofs receive no writes.
Hashes detect selected retained changes, not all transient effects, physical
durability or hostile same-user tampering. The mechanism remains trusted same-user.

Native parsing and exact transaction outcomes, effective named privileges,
default ACLs, backend absence/cancellation, full fixture compatibility, complete
source per-sequence equivalence and independent installation/recovery remain
unproved by this review. Route retention/readback, reader/UI, identified desktop
and 390px journeys, consented installed-provider recordings, human/scientific
acceptance, T1/T15 and the complete V1 floor remain open. Generic Codex resets
remain unknown. Recording-account and allowance consent is neither supplied nor
inferred. Existing main/hosted/release holds remain unchanged.
