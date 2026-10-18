# One exact R6 observe proposal has conditional source support

October 16, 2026. Fresh independent SOURCE/METADATA ONLY review. This is a new
admission-proposal review round, separate from source review688c783 and earlier
R5 observe reviewebfcb6c.

**Disposition: scoped no finding. No new P1 or P2 objection is established in
this exact proposal, its mechanical outer-runner binding or the observe source
path. Root may consider publishing and invoking this one observe after satisfying
the fresh prerequisites below. This report publishes no admission, starts no
launcher and establishes no current availability or native operating acceptance.**

## The proposal binds the exact R6 subject and source review

The subject is `b35dd7126939d7e1ad24e9ddbf887653275317c1`, read in the clean
author checkout `/home/nathaniel/.t3/worktrees/openplan/t3-ac91cc52`, under
`docs/reviews/2026-10-16-a0-sequence-snapshot-correction`.

Exact proposed inputs are:

- Proposal: `/home/nathaniel/.local/state/openplan/a0-r6-observe-admission-proposal-20261016/observe-proposal.json`,
  SHA-256 `f45cccec462d519ed9aef97e0d01362001889a13d0d221196926fe975d086919`.
- Outer runner: `/home/nathaniel/.local/state/openplan/a0-r6-observe-parent-runner-20261016.py`,
  SHA-256 `33825147386977f7e95db315f65250b031b49ae1ff019f3c235fd2930262e068`.
- Private packet: `/home/nathaniel/.local/state/openplan/a0-usage-limit-native-wrapper-20261016-r6`.
  Package SHA-256 `a8c583e5a73dec9602b7329e3c646e77e99677033c4229e20d38c173dabf3141`;
  plan SHA-256 `f8b8a36f4439703964cd5d66d9e6408d37bc984215c6c07a5909a728af7db4e5`.
- Independent source review: `688c783586fbdccad8d685656786e9fb85536d7d`,
  `docs/reviews/2026-10-16-a0-sequence-r6-independent/REVIEW.md`,
  SHA-256 `07af1a42a1771c4e2d70c7f5a365d1c722f35938dcefc25ee68d170156366125`.
  I read the full report and match its actual Git and working bytes. It supplies
  scoped source approval with no new P1/P2, and explicitly supplies no native
  admission or restoration acceptance.

The proposal matches the actual type-sensitive `policy.admission()` requirements:
stage observe, exact package/plan/application source/tree, null predecessor,
1,073,741,824 memory bytes, zero swap and CPU50. System identifier, observed hash,
function pins and prior function pins remain null. These are appropriate missing
observation or later-stage inputs. They are not invented current facts.

Application source remains `f8a571bb0a18b8b6501870acb5ef1e760d487e1c`, application
tree `d577a9cd955018b3253f42b3d9af2a96a9a10b53`, connector tree
`228ce912b1cf63dba408445422dc6e2b690d91f4`, and SQL18 SHA-256
`655e625878b3e62f332a7f17d6e126879813cc2bf881ca745593978d8eed6559`.
The runtime subject, application source and review commit identify different
things. None replaces another. Author ancestry, Git trees and unchanged tracked
application/connector bytes match. All 421 migration sources remain sealed.

Policy checks the review hash's shape, not its authority or report contents.
Root's actual consumption of this review and the pinned source review remains a
trusted same-user decision. No hash-shaped acknowledgement substitutes for it.

## The outer runner changes bindings, with no new process logic

The retained R5 observe runner hashes to
`50f1a5fefae4edda53f1d9f2d61b5d8514b47286a8c7407bf2536ba0266801eb`.
Independent text comparison reproduces the supplied `outer-runner-diff.patch`.
Changes name R6 in the docstring, proof root, outer unit, runtime path and admission
path. No dispatch, metadata loop, environment, stream or exit logic changes.

The new exclusive proof root is
`/home/nathaniel/.local/state/openplan/a0-native-wrapper-r6-parent-operation-20261016`,
with output under `observe`. The outer unit is
`openplan-a0-native-parent-r6-observe-20261016-01`. It requests MemoryMax1G,
MemorySwapMax0, CPUQuota50%, RuntimeMaxSec540 and UMask0077, then runs exactly
`/bin/sh <R6 packet>/templates/run_stage.sh observe`. The runner is unexecuted.

Before dispatch it reserves new directories and writes/fsyncs the exact argv,
environment and actual admission hash in its intent. It records returned local
PID, attempts bounded active-unit identity capture, waits for the process, syncs
the combined unit stream, and records its length/hash, exit, elapsed time and
final selected unit properties. The outer stream intentionally combines stdout
and stderr. Inner request journals retain separate stdout/stderr. Neither a
successful `systemctl show` nor the outer JSON alone establishes child completion.

The fixed outer environment supplies PATH, HOME, LANG, the current UID's
XDG_RUNTIME_DIR and disabled Python bytecode. Ordinary child requests use only
PATH/HOME/LANG. The manager request alone adds the derived runtime directory.
No inherited provider, password, Docker-host or bus-address values supply inputs.

## The observe success path has 12 child requests

This list follows actual source, not a new runtime trace. `Controller.run()`
performs the first native identity check before calling `observed()`.

1. Git checks that application source is an ancestor of author HEAD.
2. Git reads and validates `HEAD:openplan`.
3. Git reads `HEAD:workers/planner_agent_connector`.
4. Git reads that connector tree at the pinned application source and compares.
5. Git checks tracked application/connector changes against HEAD.
6. Docker inspects the fixed container before initial native identity.
7. Socket psql reads initial catalog/native identity in postgres.
8. Docker supplies the container observation saved in observed.json.
9. Docker inspects before the retained native identity read.
10. Socket psql supplies that retained catalog/native identity.
11. Docker inspects before originalScope.
12. Socket psql reads the original catalog and global role/settings digests.

Thus success requires five Git requests, four container inspections and three
SQL requests. A separate `manager/request-001` launches and waits for the child.
It cannot collide with `controller/request-001`. Outer custody is separate again.
The historical R5 actual 12-child success does not establish an actual R6 trace.

The fixed container is
`a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`, image
`sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f`.
Policy also pins project, network identity and running/unpaused/nonrestarting
state. Inspect projects those fields and ports, excluding Config.Env.

Each SQL request uses `/usr/bin/docker exec -i` for that container, psql
`-XqAt -h /var/run/postgresql -p 5432 -w -U supabase_admin -d postgres`
and `ON_ERROR_STOP=1`. Its prefix sets application name and finite statement15s,
lock3s and idle-transaction20s bounds. Its same-backend DO guard checks database,
session role and current role. No password or credential discovery runs.

The two native identity queries project database OID through
`::pg_catalog.int8`. Consumers require positive nonboolean integer OID and PID,
actual admin/postgres/service-role attributes, application name and a numeric-text
cluster identifier. First observe has no admitted system pin. Its results must
be reviewed as new facts before any later operation. No later-stage target OID
or old cluster observation silently supplies the missing first-stage pin.

originalScope retains every other database's name/OID/owner/ACL/configuration,
plus hashes of global roles, memberships and database-zero role settings. It
excludes the proposed target name. It does not certify protected database row
contents, target-name availability, every transient change or absence of other
backends. Observe captures one initial R6 scope baseline. It does not itself
perform an in-stage before/after scope comparison, because it has no prior R6
observation. Root must maintain exclusive catalog/global-role/settings ownership
around the operation and keep any broader before/after claim within its actual
separately authorized evidence.

The fixed observe selector reaches no allocation, restore, snapshot, migration,
fixture, case, race, diagnostic, provider/account/model, HTTP, browser or hosted
branch. Imports define those methods without invoking them. Observe does not
open the retained archive or consume a diagnostic body. Session SET and identity
DO statements are not a READ ONLY transaction or rollback proof.

## Source approval preserves the sequence and case evidence limits

Compared with frozen R5, only three controller lines differ: R6 root, inner unit
prefix and the explicit sequence-state expression. Other eight runtime files
match exactly; all nine private templates match the candidate. The sequence
branch builds last_value/log_cnt/is_called with pg_catalog.jsonb_build_object.
Ordinary-table hashing, complete map, pg_sequences census, identifier quoting,
OID casts and case guards remain. Observe does not exercise this correction.

The retained author sequence campaign has 12 trials: two baseline/restored
passes, one harmless survivor and nine named failures. Whole-row serialization
fails sequence-snapshot-readback-not-reached; omitted state fields fail
sequence-state-fields-differ. Reduced continuity has 12 probes: six passes,
three harmless survivors and three cast-removal failures. Ordinary zero,
shadow888 and expected validator failure keep their distinct cases. These are
inert Popen composition records. They do not establish native sequence semantics,
temporary-schema identity, SQL parsing, RLS, rollback or accepted restoration.

The author's six-step TEST window is retained terminal evidence, not rerun here.
Its actual invocation is `2f18c73173014eafbc2029a515545211`, all six exits are
zero, peak157769728 bytes and swap zero. Named read-only mount/probe evidence
does not exclude inherited nested writable mounts. No host-wide isolation claim
or new pure campaign follows. The 1,919-entry correction manifest is hash-bound;
this review checks selected correction records rather than replaying its campaign.

## The R5 successes and failed restore remain historical

I read full R5 HANDOFF/STATUS/PARENT_RECIPE and OID audit, original wrapper STATUS,
indexed source reports332925/857453/7468c58/6c12e7/133e195, original usage-limit
review/correction reports, full R5 observe reviewebfcb6c, current R6 HANDOFF/full
STATUS/PARENT_RECIPE/SEQUENCE_AUDIT and full independent R6 review. Earlier
namespace/provider/caller-type, manager-location, OID and sequence findings,
responses, failed trials and disagreements retain their original scopes.

Retained R5 journals independently match inputs, separate streams/hashes,
positive returned PIDs and exits: observe has 12 child exits0, allocate19 exits0,
each with manager0, completion and manager-terminal. Their actual outer-parent
success records remain historical. They are not R6 predecessors or current facts.
Prior source approval133e195 and observe approvalebfcb6c do not approve R6 by proxy.

I read root's complete restore-failure report/evidence and retained decision,
publication, metadata-reader error and summary. All 145 failed-proof pins match.
Restore requests001 through020 exit0. Archive request017 exits0; raw history019
matches419 versions, latest20261017000016 and digest0ee645e79fb8431bb116c30a673f8775.
Request021 snapshot exits3 with the recorded missing-sequence-composite-type
error, stderr SHA-256
`ffa2a8d781640cc9a4a17e1a1daa1ba2e90d4e0137be34ba7e870865fc2c7080`.
Manager and outer exit1. History, snapshot, definitions, completion and
manager-terminal receipts remain absent; final originalScope is not reached.

The failed target `openplan_a0_limit_c2e1f4598374c1bf439baa3b`, OID6212363,
stays permanently fenced. No retry, repair, adoption, reuse, drop or cleanup is
authorized. R6's plan explicitly protects it. Archive success and matching raw
history do not establish full data/sequence custody, owner/locale, backend
absence, rollback or accepted restore. The old R3 failure stays fenced too.
This reviewer performs no source-database, archive-content or query operation.

## Root must satisfy fresh conditions before publication

There is no unresolved P1/P2 source objection within this exact scope. The
following conditions are future operating gates, not claims satisfied by review.

1. Consume this complete report and source review688c783. Recheck subject,
   proposal, runner, source review, package, plan, runtime/bindings and source
   seals, ownership, modes and regular-file identity. Preserve exact argv,
   environment and paths. Rebinding or editing requires new assessment.
2. Recheck absence of real R6 admissions/stages and the outer proof namespace,
   including symlinks and partial reservations. Verify both intended outer and
   inner `openplan-a0-limit-r6-observe` units are unused. Obtain the exclusive
   operating window and free compiler window through root's authorized process.
   Respect M11's priority. This reviewer contacts no manager and acquires no lock.
3. Recheck current capacity for 1GiB/zero-swap/CPU50 and finite runtime. Maintain
   exclusive originalScope/catalog/global-role/settings control for the entire
   operation. Current container/socket/role access remains unobserved here.
   The proposed target `openplan_a0_limit_c730358675ac8bb47ac15fdd` is unallocated
   by this work; its present availability remains unknown and unnecessary to
   claim for observe. No source-data certification follows from catalog guards.
4. If root decides to proceed, publish only the exact proposal bytes once at
   private admissions/observe.json, directory0700/file0600, with exclusive durable
   publication custody. Invoke only the pinned outer runner once. Preserve intent,
   input, returned PID/unit invocation, stream hashes and exit separately from
   actual child observed/completion and manager-terminal acknowledgement.
5. Treat partial intent, input failure, timeout, unexpected exit, unknown
   acknowledgement or missing terminal receipt as a permanent fence. Do not retry,
   overwrite admission, repair journals, infer completion or dispatch a successor.
   A local returned PID is pending identity, not backend acknowledgement.
6. Review actual R6 outputs and their originalScope boundary before considering
   a new allocation proposal. Allocation, new-target restore419, SQL17/18,
   fixture/cases and every successor require separate reviewed inputs/admissions
   and actual predecessor plus manager custody. No R5 receipt fills that chain.

The manager transport waits at most480s; ordinary transport waits at most90s.
The outer unit has RuntimeMaxSec540. The inner unit has no separate RuntimeMaxSec,
and its flock blocks. The database container runs outside wrapper caps. Outer
termination, closing stdin, a stream hash or a unit record does not establish
inner-unit/backend cancellation, disconnection, absence or rollback. Preserve
unknown outcomes and fences. This review adds no unreviewed cancellation path.

## Metadata checks match and do not establish operation

Independent comparisons match 33 exact subject Git files and four exact source
review Git files; 32 public subject pins; 73 packet entries; nine runtime and
nine template copies; five binding files; 1,126 source pins; seven preceding
helpers; 56 prepared SQL pins; nine selected correction records; 1,126 selected
historical records; 145 failed-proof pins; three public and nine private source
review pins. Counts overlap. The 17,376-file historical campaign is not rehashed.
The correction manifest hash and all packet manifest entries match their seals.
No builder, subject import, launcher, guard, test or campaign runs in this review.

The assigned checkout starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`,
branch `t3/a0-r6-observe-admission-review`, in
`/home/nathaniel/.t3/worktrees/openplan/t3-0de241e8`. T3 confirms that separate
binding, Sol6.1 and active root/M11 work. Ownership covers only this new report
directory and `/home/nathaniel/.local/state/openplan/a0-r6-observe-admission-independent-20261016`.
No nested agent is used. AGENTS, planner-writing, prove-it and Supabase/Postgres
source guidance apply. Explicit SOURCE/METADATA ONLY restrictions exclude their
operational/network steps. Existing same-application nested direction receipt
exits0 with dated reminders retained; no npm or second product audit runs here.

Before/after selected input records preserve bytes, lengths, modes and owners.
Real R6 admission/stage and outer-operation namespaces remain absent, including
dangling-link checks. No author/runtime/proposal/old-proof bytes or permissions
change. Only new review documents enter the local commit. No manager, flock,
dependency, test, Docker, catalog/SQL/socket, archive parsing, HTTP, provider,
account, browser, service, hosted action, push, PR, main change or release occurs.

Hash equality detects retained selected changes, not every transient effect,
physical durability or hostile same-user tampering. Source inspection does not
prove native casts, PID/OID, SQL/RLS, process lifetime, recovery or future success.
Owner/source/history/full proconfig/ACL, approval and exact payload, provider/
account/model/provenance/receipt tiers, noReplay/cancellation and later rollback
requirements remain. Native SQL18/RLS and later real provider recordings remain
separate; consent remains absent. Reader/route/UI/desktop390px, independent
installation/recovery, human/scientific acceptance, T1/T15 and full v1 stay open.
Generic Codex resets remain unknown. Source approval alone certifies no new
runtime operation, hosted successor or release.
