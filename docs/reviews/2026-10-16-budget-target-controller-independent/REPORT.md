# Budget controller has conditional source support and one packet correction

October 16, 2026. Independent review by GPT-6.1 Sol at high reasoning.
Parent thread: `1401bb6a-70e4-42eb-a1f1-98045485f8cc`. No nested agent.

Subject: **fcf21c6861cd4a9478defa29cb8cc6292ddd02a5**, in
`/home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74`, under
`docs/reviews/2026-10-16-project-budget-native-target-controller`.
All subject paths below refer to that directory unless stated otherwise.

**Disposition: conditional support for the prepared TARGET/HISTORY source.
Correct PREP-1 before presenting this exact packet as the complete trial01
request/grant record. No new P1 or P2 runtime defect is established. No native
stage, publication, admission, caller operation or release is approved.**

The review stays SOURCE/METADATA ONLY. It runs no subject, parser, helper,
dependency, test, manager, lock, Docker command, SQL, socket, browser, HTTP,
provider, cloud operation or admission. No pure window is requested. The
remaining questions need actual future stage evidence, not another inert
repetition of the author's selected campaigns.

## PREP-1: The public trial01 request is an older preparation draft

The exact committed `evidence/trial01/window-request.json` has SHA-256
`d4a1079b2b20770b3aeb509375efd3cafd9fa911faab7f52fcb76f2289126f26`.
Its input pins describe controls of 22,174 bytes, controller of 22,183 bytes,
SQL of 16,530 bytes and a 796-byte wrapper. These differ from the executed
candidate's 28,435-byte controls, 23,660-byte controller, 17,422-byte SQL and
830-byte wrapper. The older wrapper pin is `3b974ab8`; the granted wrapper
pin is `dbadab75`. These are different subjects, not a whitespace exception.

Both `evidence/trial01/grant.json:4` and
`evidence/trial01/dispatch-intent.json:96` instead name request
`20526f8b4e4343791d71a3f72133e964a170fd4489b1f47750492fdf3cddb4c9`.
The exact granted request remains available at the private author path
`/home/nathaniel/.local/state/openplan/project-budget-native-target-controller-20261016/window-request-freshline-final.json`.
Direct hashing reproduces `20526f8b`. Its complete text pins the final four
runtime files, current controls, final device binding, 24 controls and final
wrapper. The trial02 reuse seal also identifies this exact private request.

Consequence: a reader using the committed trial01 evidence directory cannot
join its generically named request file to the grant by exact hash. The claim
in `VALIDATION.md` that evidence contains the exact requests needs this
qualification. The wrong file does not establish an unauthorized dispatch,
missing private evidence, changed runtime or a false trial02 outcome.

Smallest correction: preserve the older request with an explicit superseded,
unexecuted label; add a byte-identical copy of private request `20526f8b` under
a clearly named trial01 granted-request path; explain the distinction and update
the packet inventory. Review the resulting documentation commit. Do not rewrite
the grant, intent, failure, inventory or old request. No runtime edit, parser
experiment or campaign rerun is needed for this metadata correction. This review
owns no author file and makes none of these changes itself.

## The budget predecessor consumer addresses the separate A0 source concern

Root's later steering describes a potential issue in a different A0 controller:
a fresh before snapshot might become an unchecked baseline for after comparison.
That is not the structure of this budget subject.

`runtime/controller.py:215` reads the actual preceding stage's `state.json`
from the fixed budget private root. It compares the **entire object** with the
current preflight capture at line 218, then compares the captured function map
against root's reviewed prior definition pins. It does not compare only a fresh
before map with a fresh after map.

The consumer at lines 321–330 temporarily selects the prior version count,
captures the current database, restores the stage name in `finally`, removes
only the current observation's backend PID, and calls `predecessor_state(before)`
before `mutate_sql(payload)`. The preceding successful stage stores its state
after likewise removing the variable PID at lines 334–357. The objects include
native identity, complete version/name/statements rows, history digest, statement
shape/SHA proof, complete table and explicit sequence snapshot, function map,
wanted census and database properties. Changes in any retained field therefore
reach the whole-object equality before this migration dispatch.

`ready()` separately requires the actual predecessor completion and its manager
terminal, matches invocation IDs, and binds the predecessor completion hash into
the new admission. The state file is the local trusted predecessor record. This
does not authenticate a hostile same-user writer or create an independent
initial sequence reference. I do not inspect or operate on the additional A0
subject, infer actual native drift, or regrade its separate review.

## Admission and custody mechanisms have a bounded source basis

`runtime/policy.py` fixes seven stages and only two connection names: catalog
`postgres` and the proposed budget database. Source OID 6072103, failed R5
OID 6212363 and successful R6 OID 6227945 are not command targets. Allocation
uses template0 with fixed owner and locale arguments. It obtains the new OID
through actual readback rather than predicting it. Positive identity and process
IDs reject booleans. Catalog and target checks retain actual system, database,
session/current roles, role OIDs, server version and superuser properties.

`runtime/controller.py:56` requires concrete private review, publication and
window files with matching hashes and common stage/source/app/target/input/time
fields. A native-operation flag, exclusivity, positive local UID and a window
of at most 600 seconds are required. The template example supplies no usable
admission. Later stages bind the admitted target to the allocation receipt.
Actual review consumption and exclusive ownership still belong to root; files
written by the same UID do not authenticate that owner against itself.

The controller checks the fixed source ancestry, exact application tree and
tracked application changes. Its source seal checks pinned file bytes and the
executing template bytes. It remains bound to source `3f3639f54243f40dfe7ff093dbb7f4e982a18cbc`
and application `44e638d6d79378042343bf5b18408f09ee991d57`. Root's later joined
application is not an implicit rebind. A changed candidate needs its own seals
and assessment.

`main()` checks actual cgroup limits and the systemd invocation environment.
It reserves the fixed stage directory before any external request. Each request
then reserves intent, argv/environment, input bytes and hash before Popen,
followed by returned local PID and bounded separate streams. Exclusive file
creation and file/directory fsync prevent ordinary clobber and provide the
intended durable custody path. A partial reservation remains a fence.

Transport timeout, late terminal, output overflow, stderr or a missing response
cannot become a successful controller completion. The code distinguishes process
terminal, commit response, independent state capture, child completion and root's
manager-terminal record. Descriptor closure does not establish rollback or backend
death. There is no replay, repair, cleanup, drop, adoption or successor entry.
Physical flush, process survival and actual manager behavior remain unproved
here. The controller unit also does not cap the existing database container.

## Restore and migration composition retain their distinct limits

`render419` first requires actual allocation identity and emptiness. Its fixed
pg_restore argv has no database argument. It reads only the pinned archive in a
future admitted operation, retains rendered and guarded bytes, and ends. This
review does not open, parse or render the archive. The fixed 16,232,305-byte
archive remains UNPARSED here.

`runtime/sql.py:114` is a finite lexer, not PostgreSQL. It tracks comments,
quoted and dollar bodies, COPY data and restricted meta commands. It rejects
escape-string syntax and unknown forms. The outer transaction extraction is
used for generated restore text and exact SQL19; SQL17/18 must contain no outer
transaction controls. Actual archive compatibility is unknown. A future refusal
is not permission for a direct restore fallback.

Root must review the exact generated guarded restore artifact before admitting
restore419. The same target backend then checks identity and emptiness inside
the wrapper transaction before executing the rendered body. Timeout defaults
receive finite local replacements. Output suppression separates restored setval
output from the final response envelope. These are inspected source paths,
not an observed native restore.

After restore, the code checks 419 ordered versions, the retained full-row
history digest, the complete 376-table count/digest map and pg_sequences census.
The baseline is a retained historical reference. Each sequence also records
last_value, log_cnt and is_called explicitly, without `to_jsonb(sequence)`.
The initial independent log_cnt/is_called reference is absent. Capturing those
fields cannot establish their original-source equivalence. Later predecessor
and before/after comparisons do include them.

`runtime/sql.py:210` composes one real transaction around each migration body
and its history insert. Exact SQL19 starts with BEGIN and ends with COMMIT;
the compositor extracts those outer controls while retaining the full original
source, including both controls, in its one history-array entry. Function-local
BEGINs remain inside dollar bodies. SQL17/18 are unwrapped source bodies.

The transaction checks identity and setting, uses nonsuperuser postgres, locks
history EXCLUSIVE and checks its prior full-row digest before body execution.
It appends history only after the body. A same-backend precommit identity and
post-COMMIT response precede independent capture on a different backend PID.
The actual installed definitions, complete prior rows, statement proof, data,
explicit sequence states, database properties and final protected catalog scope
must pass their separate consumers before child completion.

Function maps retain definition text/hash, owner and owner OID, language,
result, security, volatility, complete config, raw ACL and expanded object ACL.
Root supplies exact complete prior/post maps. The wanted census starts from
the requested roles/relations/columns and reports missing objects plus actual
table/column SELECT truth. Denied truth remains false. Captured expanded ACLs
are not a complete named-role EXECUTE, membership, default-privilege or RLS
acceptance campaign. Wanted rows are inventory, not caller authorization.
Catalog digests protect the selected other-database identity/global catalog
scope, not all protected database row contents or every structural object.

## The history correction differs from the original apply17 objection

I read the complete prior independent apply17 report at `t3-012fdf58`. Its
P2-APPLY17-1 concerns apostrophe-only history encoding, no same-backend setting
guard and readback that checks versions/count without exact history text.
That report and its disagreement remain intact for its subject.

This budget source sets standard_conforming_strings on before BEGIN and places
the guard and body on fresh physical lines. The guard checks the effective
setting. History text uses the original UTF-8 bytes through ASCII hex decode
and convert_from, independent of ordinary literal backslash semantics.
Postcommit comparison includes complete raw old/new history rows and an actual
query for cardinality, dimensions and ordered statement SHA-256. Expected new
proof comes from the pinned original migration: cardinality 1, dimensions
`[1:1]`, and the original source SHA. Prior proof must remain unchanged.

The retained REL_17_6 source explanation and emitted-line oracle are source
inference. The fake does not execute psql's scanner or PostgreSQL's parser.
Native setting behavior, exact body/history atomicity and real stored values
remain future acceptance boundaries. I find no basis to transfer the old A0
literal finding unchanged onto these different source mechanisms.

## Retained trial outcomes support selected inert claims

Trial01's grant and dispatch name request `20526f8b`; unit
`openplan-budget-target-pure01`, invocation
`ae9127413be74a8ea696e4bd2ddb03e6`, terminates 1 after 5.462 seconds.
Its actual controls result retains the initial baseline, harmless comment
SURVIVED and named faults 0–4. Mutation 5 stops at
`AssertionError: mutation-unique-anchor:5` before editing because its fsync
anchor occurs twice. Restoration and sourceUnchanged are true. This remains
HARNESS_FAILURE, not a killed fault, source failure or native failure.

Trial02 has a separate grant for exact request `67a51ee5`. Its retained diff
changes the private root, resume driver and mutation 5's unique write/flush/fsync
anchor. That fault retains the original durable-file-and-directory assertion;
the other 23 tuples and existing readers remain unchanged in the retained
comparison. The resume reader matches sealed trial01 inputs/results before reuse.
It does not rerun baseline, harmless, faults 0–4 or the seven resource mutants.

Unit `openplan-budget-target-pure02`, invocation
`73219af8f30d45d19112e2b9a12b506b`, terminates 0 after 9.648 seconds.
Its result records exactly faults 5–23 failing their named assertions, then
the final restored baseline and one actual nested direction check returning 0.
Restoration and sourceUnchanged are true. The direction stream retains dated
expiry/version reminders. The result SHA is
`036033976c49aeaf84891cfda1e10415a8dfe1595b08a189e90fdc77144cfd77`.

Direct selected request receipts show that the successful 20-request journey
uses explicitly synthetic process/backend IDs and supplied transaction/ACK
rows. They are evidence of the actual inert controller and file journal path,
not a real Docker process or SQL execution. Seven resource faults operate on
supplied records. Real retained resource samples report 512 MiB, zero swap,
CPU50, tasks64, named root RO, named private RW and a distinct network namespace.
The 198,774,784-byte after sample is not an independently observed final peak.
Inherited submount writability remains unassessed; no host-wide private-write
claim follows.

The 900 original failed01 files and 923 sealed copies remain historical custody.
Their author's post-terminal comparison is retained; this review independently
hashes selected direct records and both inventories, not every private file.
No original failure or retained whitespace-bearing diff is rewritten.

## Future admission still needs concrete records and actual results

The proposed database remains `UNALLOCATED_NOT_AVAILABLE_UNADMITTED`.
Direct metadata inspection finds no author `admissions` or native `stages`
directory. That observation neither queries database availability nor proves
that no unrelated native action ever occurred.

After PREP-1's small packet correction, root can assess one concrete stage at
a time. Each needs its own current review, publication, finite exclusive
native/catalog/role/settings window, manager invocation and exact admission.
Render419 and restore419 remain separate decisions. Unknown syntax, partial
intent, timeout, missing acknowledgement or postcommit consumer failure fence
the attempt; no repair, retry or replacement is inferred.

Original budget PREP-1 and the corrected R2 draft/line/total/status lifecycle,
foreign-money sentinels and EOF-byte history remain separate. The caller builder's
nine actors, 11 workspaces, 18 memberships and Auth signup/cutoff side effects
remain later conditional preparation. R3/R5 failures remain fenced; successful
R6 remains protected and is not the budget database. Nothing in this review
authorizes touching that frozen target.

This increment supports existing M11/CORE-PM-01 preparation. It closes no
ordinary Auth, caller, RPC, JSON/money, MVCC, financial reconstruction, browser,
artifact, practitioner or scientific acceptance. All states/DC, California
depth, explicit territories, tribal/overlapping authorities, free software,
portability and separate AequilibraE/ActivitySim evidence remain binding. Root's
joined TypeScript/lint checks do not supply native budget or browser evidence.
