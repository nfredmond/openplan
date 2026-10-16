# Exact history correction has source support; predecessor continuity needs one correction

October 16, 2026. New independent SOURCE/METADATA ONLY review of exact commit
`34e67a05ad8fc54b67345726d1d43a553b8c54c7`, in
`/home/nathaniel/.t3/worktrees/openplan/t3-b88cf8ee`, directory
`docs/reviews/2026-10-16-a0-migration-history-literal-correction`.

**Disposition: retain PREPARATION ONLY. The original P2-APPLY17-1 has a supported
source correction. One separate P2-CONTINUE17-1 remains: the continuation never
compares its fresh pre-apply data/sequence snapshot with the actual retained R6
restore snapshot. No P1, actual target drift or native failure is established.**

This review admits no operation. Root acknowledges the separate baseline concern
and confirms that no admission or native operation is being prepared or published
pending this disposition. Root will consume this full report before assigning a
separate response. No source fix, test or additional pure window runs here.

## P2-CONTINUE17-1: Refuse a changed predecessor map before sending SQL17

The primary location is the candidate's
[controller.py:288](</home/nathaniel/.t3/worktrees/openplan/t3-b88cf8ee/docs/reviews/2026-10-16-a0-migration-history-literal-correction/runtime/controller.py:288>),
continuing through line 301. Related consumers are `ready()` at lines 91–123,
`Controller.__init__()` at 163–167, and `original_scope()` at 207–211.

The actual external predecessor map already exists at:

`/home/nathaniel/.local/state/openplan/a0-usage-limit-native-wrapper-20261016-r6/stages/restore419/snapshot.json`

It has 41,476 bytes and SHA-256
`936054d47550fa7003177ddbf877fb1fd1b3c529e10536637bfbb1d85118d3db`.
Its object has 383 labels. There are 376 ordinary-table objects, each with
`count` and `digest`, including `supabase_migrations.schema_migrations` with
count 419 and digest `0ee645e79fb8431bb116c30a673f8775`. Six sequence labels retain
`last_value`, `log_cnt` and `is_called`: auth.refresh_tokens_id_seq,
net.http_request_queue_id_seq, public.lodes_od_id_seq, public.stop_times_id_seq,
realtime.subscription_id_seq and supabase_functions.hooks_id_seq. The remaining
`__pg_sequences__` entry is `d906d887079dd69d2b018752258ca3b5`.

The map equals the parsed JSON from actual restore controller request 021's
`stdout.bin`. Its 376 ordinary objects equal the retained plan's complete ordinary
map. These are comparisons of retained files, without a new database read.
The map is among the 413 exact records in `external-predecessor-pins.json` and
the proposed admission's complete external binding.

The actual source flow is:

1. `ready()` hashes the selected external files, including this snapshot, and
   checks their lengths, modes, UID/GID and regular-file status. It checks actual
   completion, separate manager terminal status, target and plan equality.
2. The controller reads its old observation and allocated target directly from
   the external R6 tree. Fresh target/system/OID and original-scope guards follow.
3. `apply()` lines 283–286 checks 419 versions/count/latest, the preceding finish
   descriptor, and the retained restore history digest.
4. Line 288 assigns a fresh `before=self.snapshot()`. No comparison with external
   `restore419/snapshot.json` follows. Line 289 immediately calls `lh.execute()`.
5. Lines 291–294 validate exact committed history and 420 versions/count/latest.
   Line 295 captures another fresh map. Line 296 compares that fresh after-map only
   with line 288's fresh before-map, excluding migration history from both.
6. The complete preceding finish descriptor is compared again, and final
   originalScope must match. `run()` then writes completion if every check returns.

Hashing a retained snapshot verifies the file's custody. It does not compare the
current target contents with that snapshot. `original_scope()` explicitly excludes
the continued target from its database catalog list and carries no target row map.
Identity,419 history and finish pins cover different facts.

A source counterexample is a valid unrelated row change before this new stage,
with the same target OID, history and finish descriptor. Let R be the retained
restore map and D the changed current map. If SQL17 leaves those rows unchanged,
both fresh snapshots return D. The existing comparison accepts D equals D, even
though D differs from R. A prior change to any captured sequence state has the
same gap. This does not assert that either event happened on the actual target.
It shows why the proposed external predecessor binding is insufficient to reject
such drift before an otherwise successful new migration.

The bounded correction is to compare the complete fresh `before` map with the
exact admitted external restore map before `lh.execute()`. Existing full-object
comparison can perform that check. Keep the current after-versus-before comparison,
with its deliberate history exclusion after migration. Retain the compared fresh
observation through the new stage's own journal. A mismatch must refuse without
changing the predecessor, replacing the baseline, restoring the database or
adopting a different target. No source-data query or new restore is needed to
design this correction. Future execution remains a separate root decision.

The current fake always returns its saved R6 map for both snapshot calls
(`controls.py:81,144`). It does not vary the initial live map independently from
the immutable external map. Its 18 retained trials therefore do not establish
this missing comparison. A later changed guard needs separately authorized
harmless-survivor, specifically named drift-refusal and restored-source evidence.
This review needs no execution to establish the source finding.

This requirement preserves captured R6 state. It does not retroactively establish
independent initial source equivalence for `log_cnt` or `is_called`. It cannot
exclude transient changes between observations, structural/ACL changes outside
the snapshot, MD5 collisions or concurrent actors. Root's exclusive operating
window remains necessary. Earlier reports supported fresh in-stage before/after
checks within their scopes; this report identifies the explicit external
continuation boundary separately and preserves those reports and disagreements.

## Original P2-APPLY17-1 has a supported source correction

I read the full a846 independent finding and the complete research at
`201ef3062be85b5747e641d6d8cd7b8f9f7c2089`. The original objection concerns
ordinary quoted history text, setting-dependent backslashes, and the absence of
an independent exact-text oracle. It is distinct from P2-CONTINUE17-1.

`literal_history.py:19–33` reads original bytes, verifies the pinned source
SHA-256, requires strict UTF8 and refuses NUL. `text_value()` emits ASCII hex
inside `pg_catalog.decode`, then `pg_catalog.convert_from(...,'UTF8')`. Original
apostrophes, backslashes, control characters and newlines remain encoded data.
The history expression no longer uses the unchanged fixture literal encoder.
The executable SQL body remains the original raw file bytes.

`execute()` first starts one owned pipe with the normal fixed psql argv, without
`-c` or `-f`. Its prefix checks system/OID and admin identity before BEGIN,
finite local bounds, UTF8 client encoding and SET LOCAL ROLE postgres. Fresh
physical lines separate setting commands. The role guard requires actual
nonsuperuser postgres. It does not change standard_conforming_strings.

The readiness SELECT projects actual phase/database/int8 OID/session and current
roles/postgres flag/backend PID/application/string setting/client and server
encoding. `ready_identity()` compares exact fields and field types and requires
a positive nonboolean integer PID. `wait_ready()` requires one complete JSON line,
empty stderr, and a still-live owned process. It refuses off, ambiguous output,
wrong identity, malformed output, process exit or a six-second timeout.

The initial intent and input precede Popen. Readiness stream prefixes and identity
are fsynced before the dependent body. `send-body.sql` and its exact source/input
hash intent are exclusively written and fsynced before dependent bytes reach that
same stdin. The body locks history, rechecks the complete prior digest, appends
unchanged SQL17, inserts exact hex-decoded source and commits. A different backend
cannot supply this readiness acknowledgement. A local PID alone cannot supply it.

Fresh `readback_sql()` and `exact_history()` compare the original source bytes
with exactly one expected version/name row, nonnull one-element statements,
one dimension, bounds 1–1, byte length, text, hex and SHA-256. A separate digest
checks all predecessor history rows excluding 17. The subsequent versions/count/
latest check rejects an extra or missing version. Required readback projections
receive explicit fake assertions. A failed postcommit comparison fences completion.

Retained REL_17_6 mainloop.c:378–453, common.c:2132–2144 and
psqlscan.l:1068–1085 support the reported physical-line scanner distinction.
The retained common.c also explicitly flushes tuple output. Normal psql command
dispatch differs from one whole simple-query parse; SET ROLE does not load role
configuration defaults. These are upstream-source inferences and documented
semantics from the sealed research, not target-native observations. Vendor binary
behavior, real flush/pipe timing and actual conversion remain unobserved here.

I establish no remaining source objection to the original P2 correction within
these pinned bytes. That conclusion does not make the whole continuation ready
for admission while P2-CONTINUE17-1 remains unresolved.

## Process bounds and uncertain outcomes retain explicit limits

The new launch selector accepts only apply17. Inherited allocate/restore/18/
fixture/case/race methods remain source and receive no new launch authority.
`ready()` rejects old R6 apply17 admission/stage presence through lexists. The new
stage, manager and controller namespaces reserve intent exclusively. Partial
directories fence replay, including direct --run attempts. Missing real admission
is checked before any subject Popen; the retained final check denies every Popen
and observes exactly `MISSING_ROOT_ADMISSION:apply17`.

The proposed manager invokes one new unit with 1 GiB, zero swap, CPU 50, Tasks 64
and RuntimeMaxSec 450. The child checks actual memory/swap/CPU and attempts one
nonblocking compiler flock. The manager wait is 480 seconds, ordinary SQL waits 90,
readiness waits 6 and phase-error finish waits 25. Statement 15s, lock 3s,
idle-transaction 20s and work_mem 16 MB remain. Database-container resources lie
outside these wrapper caps. A new root-owned finite outer runner is still absent
and requires its own review and operating grant.

The successful source path has 29 controller requests: five Git reads/checks,
12 container inspections and 12 SQL requests. The new independent history
readback adds two requests to the preceding 27-request path. The one manager
request and future outer custody are additional. This is source-derived ordering,
not an observed apply17 trace.

Readiness polling reads complete stdout/stderr files and imposes a line count
and time deadline, without an explicit byte quota. Ordinary transport similarly
retains complete streams before reading them. Fixed reviewed commands produce
bounded expected responses, but hostile or unbounded output is not structurally
byte-capped here. Blocking stdin writes and fsync do not have their own Python
deadline. The finite unit bounds the wrapper, not a proof of backend death or
complete disk/stream isolation. These are scope limits, not observed failures.

Every phase-error or transport uncertainty stops this path. Input closure, local
process exit, timeout, wrapper termination or missing acknowledgement does not
establish rollback, backend absence or cancellation. The inherited journal comment
promising rollback from input closure remains an unsupported comment; I do not
adopt it as evidence. A successful COMMIT followed by readback/fsync/manager failure
can leave a changed, unaccepted target. Preserve partial receipts and fence the
stage. No retry, repair, overwrite, reset, reuse, cleanup or successor follows.

## Actual R6 custody and the preceding finish remain separate evidence

All 413 selected external records match byte hash, length, mode, UID and GID.
The 89/131/169 retained proof entries include 12/19/25 controller requests and a
separate manager request per stage. All 59 request exits are zero; their separate
stream hashes, retained input hashes and positive returned local PIDs match.
The archive request has no copied stdin body here. No archive is opened or parsed.

The actual continued target is openplan_a0_limit_c730358675ac8bb47ac15fdd,
OID 6227945, system 7683856985084612646. Actual restore completion is
`fc590a9ed0285dbfcb3de75137ffc627efbe4398446995eddfa58407475cca0f`, with separate
manager-terminal acknowledgement. Parent 43534 terminal 0 retains invocation
fad2f959cc9f47c2a64dad08fd31ecfb and 15.408639802946709 seconds. These are retained
R6 observations. No new observe/allocation/restore stage is copied or fabricated.

Actual history request 019 equals history.json: 419 ordered versions, latest 16,
digest 0ee645e79fb8431bb116c30a673f8775. Snapshot 021 has the shape described above.
Final scope 025 matches the observed 615 catalog identities and global digests.
Catalog equality does not establish protected row contents. Initial sequence
source equivalence, native owner/locale, cancellation and whole installation
acceptance remain unproved.

Actual definitions.json hashes to
`51ee25e367f5b665a090011c6b8a173b6c0bb5db6d3f2a731ae6a5fab4a1808a` and equals
request 023's parsed object. I read its complete body. Its definition SHA-256 is
`62bc6dee9f86785dcd05c399a75ffba562632e89730d291c64f48ad269cc00df`.
Its body equals source 12 exactly, SHA-256
`ea3f215555523082142f0506ad3e40be28279d3b79778f7d9b05ed691f4c4c91`;
migration 14 supplies the effective search path. It retains qualified caller/scope
helpers, native/API caller exclusivity, attempt/provider/model/mode and saved API
identity, terminal replay, cancellation/lease and result/proposal checks. SQL17
does not invoke or alter finish. SQL18 remains a separate future replacement.

Removing definition from the capture equals the new prior-function descriptor.
Owner postgres, SECURITY DEFINER true, volatility v and the full one-entry
proconfig remain pinned. Expanded nongrantable EXECUTE ACL entries retain grantor
strings 16384 and grantees 16384/16445. No named mapping is inferred. Raw proacl,
pg_default_acl, named inherited access and actual service-only execution are
unproved. `policy.installed()` checks the descriptor before and now also after 17.
Its source support is conditional preservation, not new privilege acceptance.
No ownership, proconfig, role, grant or default privilege is repaired here.

## Retained pure evidence supports finite composition

The one previously granted pure window records parent 70737 terminal 0,
invocation c39ab66a2d23491b9a780fcca83cab00 and 33.87365764309652 seconds.
All four steps exit 0. Captured memory536870912/swap0/CPU 50000per100000/Tasks 64,
180-second argv, distinct network namespace, named read-only mounts and three
EROFS probes match the retained records. Memory 219.4M is rounded; exact peak
bytes remain unassessed. Inherited writable submounts and host-wide private-only
writes remain unassessed. No live manager or lock query occurs in this review.

The 18 main trials retain baseline, harmless survivor, 15 exact named failures
and restored baseline. Faults cover hex, NUL, source hash, duplicate/exact row,
predecessor history, corrupt postcommit readback, required projections, off,
boolean PID, wrong database, ambiguity, admission predecessor rebinding, fresh
physical lines and early send. Four reader trials reject substring false kills;
four resource trials retain their survivor/named omission/restoration outcomes.
All 18 private subject restoration manifests match their ten restored files.

The reader accepts the entire exact `AssertionError:<expected>` string. Wrong
suffixes and generic exception types do not count. Root's pre-dispatch reader
correction and fake-phase flag adjustment remain separate from unchanged runtime.
The unexecuted 7f draft and reader draft remain retained. I rerun none of these.

Real controller, journal, identity/argv, history, definition and snapshot consumers
compose with Popen and pipe behavior replaced. Responses remain fabricated and
SQL recognition finite. These controls cannot establish PostgreSQL parsing,
conversion, RLS/ACL, native OID serialization, flush/lifetime, concurrency, commit,
physical durability or cancellation. The missing fresh-versus-retained map
comparison is also outside their exercised input variation.

## Exact identities and operating gates remain unchanged

The preparation base 14bef38 and this review's base 05dd3e8 do not rebind the native
application. Actual A0 source remains f8a571bb0a18b8b6501870acb5ef1e760d487e1c,
app tree d577a9cd955018b3253f42b3d9af2a96a9a10b53 and connector tree
228ce912b1cf63dba408445422dc6e2b690d91f4 in t3-ac91cc52. All 1126 source pins,
including 421 migrations, and seven helpers match. SQL17 remains 15938 bytes/hash
b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b;
SQL18 remains 9284 bytes/hash
655e625878b3e62f332a7f17d6e126879813cc2bf881ca745593978d8eed6559.

New package 3fcc19fb, plan f8b8a36f, external binding ef4bd64e and proposal bf6d72e8
match their public/private bindings. Full pins appear in source-pins.json.
The proposal's independent review remains null. A hash-shaped value alone would
not establish root's report consumption. There is no real new admission/stage or
old R6 apply17 admission/stage, including dangling links. No publisher runs here.

Resolve P2-CONTINUE17-1 in a separately owned response and review that exact
candidate. Then root must separately assess the complete proposed admission,
actual predecessor and descriptor, outer runner, current capacity/unit access,
exclusive native/target/catalog/global-role/settings window and finite compiler
grant. This review supplies none of those permissions. Pure green cannot admit
native work. Successful 17 would admit no 18, case, fixture, provider or publication.

Original reports and responses 332925/3c79ca, 857453/53e17b, 7468c58,
root 9c9/e71352, 6c12e7/133e195 and the full current source 688, observe 714,
allocate fb77 and restore 7c7f remain distinct. R3 failed observe stays fenced. R5
OID 6212363 stays permanently fenced after archive/history success and snapshot
exit 3, without completion or manager acknowledgement. Old rejected proposal
3c88370b and outer e4687aa8 remain never admitted or dispatched. No old campaigns
are copied, replayed or silently regraded.

The original A0 actor/device/workspace/provider/model/mode/account and exact
approved payload/proposal/hash requirements remain. API versus local native
authentication choice carries no silent billed fallback. Tested CLI/install
disclosures, terminal versus pending, observed versus unknown reset, action
registry and noReplay boundaries remain. Generic Codex reset stays unknown.
Recording-account and allowance consent remain absent. T1/T15, route/reader/
browser/installed-provider evidence, independent installation/recovery and human
acceptance retain their separate tiers.

Full V1 across all 50 states/DC, deepest California, territory/Tribal/overlapping
authorities, FOSS, portability and independent installation remain unchanged.
AequilibraE and ActivitySim stay separate and need independent scientific and
human acceptance. This bounded source finding changes no roadmap or release claim.

## Ownership and review limits

T3 confirms Sol 6.1/high, this independent child and parent 1401bb6a. The assigned
checkout is t3-411de75e, branch t3/a0-history-literal-independent-review, initially
clean at 05dd3e8da4a4572437f06e771b0a2477873e681f. Ownership covers only this new
review directory and the new private a0-history-literal-independent-20261016 root.
No nested agent is used. The author checkout stays at the exact clean subject.

AGENTS, planner-writing, prove-it and Supabase source guidance apply within the
explicit source-only restriction. The retained assigned-app direction receipt
does not rebind frozen A0 source. No npm/direction/dependency/test/SQL/parser/
socket/Docker/native/manager/flock/helper/archive/browser/provider/HTTP diagnostic,
admission, push/PR/main/source join/hosted/release operation runs here. Protected
source DB 6072103, demo 3000, frozen 607/215 and all actual targets remain unqueried.

Selected metadata equality detects retained file changes. It does not prove every
transient effect, hostile same-user protection, physical durability, current
target state or future operation success. [VALIDATION.md](VALIDATION.md) records
the exact comparison scope. This report's local documentation commit supplies no
native acceptance or operational grant.
