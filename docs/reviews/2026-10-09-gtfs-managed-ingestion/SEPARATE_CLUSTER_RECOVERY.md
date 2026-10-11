# Separate local cluster transit recovery, October 11

The retained transit point recovers into a new PostgreSQL cluster and volume.
Native rows, sequences, roles, passwords, memberships, database properties,
mounted key bytes and schema semantics match. All ten retained Storage objects
download with their exact sizes and hashes. The installed CLI recovers the
original completion receipt without computation. This advances M3 evidence.
It does not establish recovery on another physical host or close M3.

## Source and build custody

The encrypted point remains the [expanded local point](EXPANDED_LOCAL_POINT.md):
snapshot `08090b60e8c1fa07b71c2181704df5295ade9c9af40f45d7f8f2c09dba400acc`,
1,541 files and 644,693,866 bytes. It includes ten physical Storage files,
three GTFS roots, the database dump and protected configuration, roles and key.
Captured data, credentials, password hashes, keys and raw database images stay
outside Git. The original point stays unchanged.

The installed CLI runs from frozen `f72d4b5910dd08ace916ee585cb9fa2749a408e2`.
Its GTFS implementation matches the earlier point source `bf1f6ffa`.
The parser context retains that earlier build identity. The recovered journal
keeps logical origin `http://127.74.9.10:29941`; a restricted transport forwards
only its four permitted RPCs to the verified recovered gateway. Changing a
runtime transport does not replace saved input or installation identity.

The [frozen f72 build](separate-cluster-recovery-20261011/current-main/build-success.json)
exits 0 in 170.044 seconds, generates 140 pages with one worker and records
build ID `pFMvxBQGkzLl9mssii6ue`. Its peak is 6,863,728,640 bytes under a
10 GiB cap, no swap and one CPU. Selected regression passes 223 files and
3,481 tests, with 45 skipped. Changed main UI lint and the direction check pass.
The direction check retains its expired-registry and older-review reminders.
The limited current browser read below remains separate from these checks.

## Independent cluster reconstruction

The accepted second cluster uses project `openplan-restore-target-2026101132`
and a new owned volume. PostgreSQL 17.6.1.156 uses the pinned local image,
separately initialized data and independently reconstructed global roles.
The database has a 1 GiB memory cap, no additional swap, one CPU, 128 process
limit and no published database port. The copied root key is a separate
read-only bind. Existing clusters, roles and keys are not rewritten.

[The database continuation](separate-cluster-recovery-20261011/database/database-continuation-02-result.json)
compares 374 table images, six sequence states, 31 roles and 25 memberships.
It also compares the complete native role backup, including password and
membership details. Database owner, ICU locale, encoding, ACL and settings
match the captured properties. All restored point bytes and file modes match
before CLI recovery. The initialized cluster successfully restarts during the
first catalog continuation. That first continuation later fails its observer;
the second accepted continuation starts an already-running cluster. Its
restart field alone is not evidence of another stop/start transition.

## Retained failures and schema comparison

Both initial database producers exit 1. Rows, sequences, roles and mounted key
bytes match, but their raw schema comparison fails. Independent global-role
creation changes role OIDs. Native `pg_dump` changes the order of one policy's
role list and the order of 80 default-privilege statements. Raw equality is
therefore not accepted, and those failed producers remain failed.

The [separate comparator](separate-cluster-recovery-20261011/database/schema_semantics.py)
compares all 769 native policies by schema, table, name, command, permissiveness,
role names and predicates. It compares all 27 compiled default-privilege groups
and the complete multiset of 80 emitted statements. It removes policy start
lines only after checking the native policy census. Multiline continuation
text and the remaining ordered DDL stay in the core comparison. It does not
drop all grants, owners, routines or policy expressions to obtain equality.

The first catalog observer also exits 1 because it assumes every policy fits
on one line. Its source and failure remain retained. The corrected observer
passes both multiline and single-line policies, with 36 pure controls.
Baseline, harmless role-order changes and restored cases pass. Targeted policy,
privilege, statement and omitted-check variants fail their intended oracles.

[Actual transaction controls](separate-cluster-recovery-20261011/database/native-schema-controls.json)
change a policy predicate, its role set and a default privilege. Each change
fails its intended catalog assertion. A harmless role reorder passes.
Every transaction rolls back, and the restored catalog matches. These are
catalog controls, not role-specific application access or planner acceptance.
This comparator remains a fixture harness. It is not a general SQL parser or
a shipped change to the production full-restore command.

## Native API, Storage and CLI recovery

Four new services use copied configuration, immutable image IDs, exact owned
receipts and caps of 128 MiB for REST, 256 MiB each for Auth and gateway, and
512 MiB for Storage. Each has no additional swap, half a CPU and 128 process
limit. Their private network contains only these services and the new database.
One subnet-specific SCRAM rule is added to the new cluster's preserved HBA file.

The first API producer exits 1 at readiness and stops all four exact services.
Docker's internal network does not expose the planned loopback port. A separate
controlled restart observes Auth, REST and Storage readiness through the private
gateway address. This is private bridge operation, not a published loopback or
browser endpoint. The failed producer remains unchanged.

[The native API continuation](separate-cluster-recovery-20261011/api/result.json)
exits 0 in 35.129 seconds with a 157,224,960-byte process peak under a 1 GiB cap,
no swap and one CPU. It downloads all ten restored objects, 119,425,015 bytes,
and compares each size and hash against the retained physical files and manifest.
The actual installed CLI exits 0 in 1.06 seconds. The empty queue does not prevent
recovery of the retained job. Its job settles, terminal receipt resolves and
native request/response hashes equal the earlier accepted completion. It uses
three native journal lock holders, with no parser, model or source download.

Only the same three permitted journal files change. All other recovered file
bytes and modes remain equal. The final native read again compares all table
images, sequence states, schema semantics, properties, roles and key bytes.
All four new API services and the exact new database stop; volumes, network and
proof remain retained. PostgREST exits 255 after the deliberate stop, while the
controller exits 0 and records the verified stopped state. No service reports
an OOM kill. These outcomes remain distinct in the service records.

[A separate read of the original fixture](separate-cluster-recovery-20261011/api/original-preservation-result.json)
exits 0 in 26.273 seconds. Its 374 table images, six sequences, raw schema,
database properties, roles and mounted key bytes match. The original captured
point files remain unchanged. This read does not audit every unrelated database
or process on the computer.

## Authenticated access after recovery

Three synthetic retained users log in through the recovered Auth service.
[The separate continuation](separate-cluster-recovery-20261011/auth/continuation/result.json)
passes 21 native access checks. Owner and viewer read one scoped row in each
of the version, route service and stop service tables. An outsider receives
empty results; anonymous requests receive permission errors. All four roles
are refused the private GTFS archive, while a service request confirms the
same archive exists. The worker queue RPC returns an empty queue for the
service role and rejects the four other roles. These reads exercise three
GTFS tables, one archive and one RPC, not every application permission.

The [first Auth producer](separate-cluster-recovery-20261011/auth/failed-producer/failure-summary.json)
remains failed. It verifies the three logins and the first 16 access checks,
then supplies the wrong named parameters to the queue RPC. The corrected
continuation uses `p_limit` and `p_after`. It preserves the first three login
graphs and verifies three more. Each password login adds exactly one session,
refresh token, authentication method and audit row. Only the actor's sign-in
fields change in its existing user row. Retained Auth rows stay unchanged.
The continuation compares all other table images, files, schema, properties,
roles and key custody. Its executed sources match their pre-execution hashes.

The continuation exits 0 in 67.584 seconds with a 67,854,336-byte peak under
the 1 GiB cap, no swap and one CPU. All four exact API services and the new
database stop again. Pure baseline, harmless and restored controls pass;
targeted access, login-graph and omitted-check variants fail their intended
oracles. Passwords, tokens, raw Auth rows and service configuration remain
private. This does not establish new-cluster browser or all-table RLS acceptance.

## Limited current f72 browser read

T3 navigates from the Dashboard through the Data Hub and Models to the saved
Oakland model. The preview uses frozen f72 and build ID
`pFMvxBQGkzLl9mssii6ue`, with the original expanded target in cluster
`a4181e33`. It does not use the new cluster `6d7969d9`.
[The recorded DOM observations](separate-cluster-recovery-20261011/browser-f72-limited/observations-summary.json)
cover 1280px and 390px reads. The study area remains Oakland, the model has
zero runs, the current BART feed remains selectable and the unadopted CTA
candidate remains absent from the model's feed options. No model is launched
and no feed is adopted.

Scripted native-select changes repeat the form's read-only coverage request.
The initial observer watches the wrong route and is corrected before the
captured repeat. The actual study-area endpoint returns HTTP 200, 119 bytes,
hash `bf1372d1f246cde823eadcafde9c467d5008372fea5ed75584335fc6c821ad90`
and 238 scheduled service rows in the saved bounding box. The submitted
60,606-byte geometry hash matches a fresh native project read. Native records
also confirm zero model runs, unchanged project geometry, the same current
BART version and the completed, unadopted CTA version. These are schedule
rows in a bounding box, not distinct stops, polygon coverage or measured service.

Two screenshot calls fail, three keyboard calls report failure with possible
partial effects, and two later resize calls time out. The successful DOM width
reads do not establish visible layout. The observer records no subsequent
errors or warnings, but it does not capture the whole console history.
This checkpoint adds no screenshot, visual, keyboard, full-console or
practitioner acceptance. The exact owned preview stops; existing target APIs
remain available. The [failure limits](separate-cluster-recovery-20261011/browser-f72-limited/limitations.json)
remain explicit rather than borrowing images from an earlier build.

## CI and integration disposition

[Exact f72 CI evidence](separate-cluster-recovery-20261011/exact-f72-ci-summary.json)
records four successful workflows: CI 38139451243, RLS 38139451316,
restore 38139451242 and worker security/cancellation 38139451254. QA passes
21,774 tests with 1,604 skipped; its 1,579 passed and 97 skipped files remain
visible. Live RLS passes 1,499 tests with 125 skipped. The independent CI restore
artifact compares 374 tables, six sequences and one 38-byte Storage object,
with mounted-key custody and preserved bootstrap. Its OWP source and target
records match hash `27b2e234a2c62b8cdde8c79e304980d1b7eed9ce437262350b65c35dd7133a59`.
That default-local CI fixture is separate from this ten-object GTFS point.

Remote main `7d92f3971482f0399f5f1a7cb6a495fab980124a` includes PR190 through
an external merge observed at 13:17:02 UTC. This session did not perform the
merge. Its tree equals f72; later main CI still requires its own inspection.
The relaunch agent retains hosted coordination and the main merge hold.
Migrations 28 through 31 remain unreleased candidates. This proof applies no
hosted schema, changes no deployment configuration and publishes no release.

## Remaining evidence boundaries

The cluster and volume are separate, but the physical host and disk are shared.
This is not clean-machine commissioning or recovery after losing that hardware.
The captured point has zero Vault secrets; mounted-key equality does not prove
historical decryption here. Earlier full-archive encrypted-canary evidence
remains a separate fixture and identity. The pinned PostgreSQL image has not
been upgraded or accepted for current production security maintenance.

Directory metadata, populated SQLite, every external worker family, healthy
computation beyond 45 minutes, no-egress useful cartography, teammate operation
and founder-independent agency commissioning remain open. The restored-point
T3 capture and later resize failures leave visual, full-console and keyboard
acceptance open. The limited 390px DOM read is recorded separately above.
Agent controls do not establish
practitioner usefulness, scientific validity or agency adoption. The nationwide,
California, territory, tribal and overlapping-authority contract remains intact.
