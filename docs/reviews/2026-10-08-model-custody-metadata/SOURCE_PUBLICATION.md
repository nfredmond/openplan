# Publish the complete declared validation dependency set

October 9, 2026. Source and retained-fixture inspection at `4a3feef87`.
This decision implements the next part of roadmap S1. It does not declare an
archive implemented, a source complete or a scientific result accepted.

## Findings that change the implementation

The current joined native proof publishes six files per method: model output,
input bundle, match audit, comparison basis, assessment and diagnosis.
`verify_native_instrument_writer.py` defines those roles. Observation packages,
structural audits and their underlying files remain in worker directories.

The [retained-fixture inspection](prototype/source-publication-gap.json) finds
nine local files for each method. Six named comparison dependencies have no
matching bytes in either fixture directory: run summary, conservation record,
assignment profile, assignment settings, coefficient package and network. Those
hashes come from the authored `basis()` fixture in
`scripts/modeling/tests/test_validation_instrument_v2.py`. This is expected for
a synthetic transport test, but those files cannot establish a complete source
archive. The inspection does not claim the corresponding real-world files are
missing from the whole repository.

The controlled development runner supplies actual files for several of these
roles. `scripts/modeling/run_comparable_observation_study.py` binds a run summary,
conservation record and assignment profile in its comparison basis; its network
hash comes from the match audit. Several references contain a hash without a
path. A publisher cannot recover their intended role or location by listing a
worker directory or taking the first file with that hash.

There are two timing boundaries. Observation matching and preparation must
remain independent of modeled residuals. Run summaries and conservation records
are execution evidence. Archiving both is necessary, but labeling everything in
the archive as frozen before model output would be false. Keep the original
bytes and timing records. Do not rewrite JSON paths and recompute hashes to make
a portable archive appear to be the original prepared instrument.

## Publication contract

Build an explicit dependency catalog tied to the actual workspace, parent run,
stage, attempt, method and retained instrument hashes. Each entry carries a
semantic role, its exact reference in the original document, a portable object
name, stored SHA-256 and stored byte count. Compressed files also retain their
logical hash and logical byte count. Keep method and attempt identity even when
identical stored bytes can share a content-addressed object.

The catalog has distinct preparation and execution-evidence sections. Start
with the observation package, match audit, input bundle, comparison basis and
structural audit. Resolve every declared readiness artifact, observation-source
artifact and structural stored/logical source pair. Resolve the comparison
basis's run summary, conservation, assignment settings/profile, coefficient
package and network dependencies through explicit producer records. A hash-only
reference needs a supplied role-to-artifact binding. Do not search unrelated
worktrees or infer a source's authority from a matching filename.

An unresolved, conflicting, unavailable or unsupported dependency remains a
named failure. Do not produce a completeness claim from an empty source list or
from the six previously published files. Completeness here means the declared
dependency set is recoverable; it does not prove that the preparer declared every
scientifically necessary source, that a provider permits redistribution or that
the source is appropriate for the geography and use.

Reuse `model_package_inputs` and `model_handoff_files` for verified local copies
where their ownership contracts apply. The first snapshots complete package
inventories; the second copies an exact registered file through a pinned attempt
root. Neither supplies the missing semantic dependency catalog. Do not archive
a whole attempt directory, since it also contains outputs and execution records.

Publish files before their manifest, with immutable object identities and exact
readback. Large network/population inputs require bounded streaming and resumable
publication. The current `upload_verified_immutable_bytes` helper reads and
compares whole byte buffers; it is established for the existing small artifacts,
not a resource-safe whole-model archive uploader. Keep a retained per-object
progress record so interrupted publication reconciles original identities.
Publish the final manifest only after all referenced objects are confirmed.

Use existing attempt artifact commands and exact receipts for registration.
Retain the manifest as an additional artifact with explicit instrument binding;
never mutate historical custody rows or replace their hashes. Consumers must
verify those bindings and disclose a missing publication. A local filename or
Storage URI without retrievable, verified bytes is not an independent archive.
An archive downloaded elsewhere must resolve original references through its
catalog without requiring the author's absolute filesystem paths.

## Required implementation evidence

1. A prepared fixture supplies actual bytes for every declared role. Another
   intentionally incomplete fixture is refused with the missing roles named.
   Preserve the existing transport-only fixtures as historical limited evidence.
2. Both methods under one parent and repeated attempts retain distinct catalogs.
   Reused identical objects do not collapse those identities or claim tiers.
3. Relocation preserves original instrument bytes and hashes. Verify stored and
   decompressed source identities, nested references and original source roles.
4. Faults cover omitted dependencies, wrong role/run/method/attempt, changed
   bytes, file aliases, unsupported entries, interrupted upload and lost reply.
   Harmless metadata and a restored implementation pass. Missing cases cannot be
   converted to success by dropping them from a manifest.
5. Native Storage and artifact receipts preserve confirmed objects across a
   fresh process. A failed object or unresolved dependency cannot expose a final
   complete manifest. Account for all temporary services and retained fixtures.
6. Project/report handoffs download a usable archive through the application,
   at desktop and 390px in T3, with identified build and console evidence. Native
   reader checks alone do not satisfy this workflow.

The immediate implementation is the explicit dependency catalog and refusal of
unresolved declared roles, followed by streamed publication and recovery using
that same catalog. This is a dependency order within S1, not a replacement for
the roadmap. Normal worker enrollment, independent preparation, scientific
acceptance and the full V1 contract remain open.

## October 9 declared-dependency catalog implementation

`workers/aequilibrae_worker/model_validation_source_catalog.py` now builds the
prepublication catalog from exact document bytes, their retained hash/size
records, a caller-supplied run/attempt context and explicit role bindings.
It handles the five instrument documents, nested readiness artifacts, registry
and observation source members, match-audit network/registry/matcher references,
stored/logical structural sources and comparison-basis execution dependencies.
A measurement's `exact_record_sha256` remains a logical record digest; it is not
mistaken for a source-file hash. Compressed sources retain separate stored and
logical identities. Run-summary coefficient bindings retain execution phase.

The builder checks primary document bytes before parsing, refuses unsupported
schemas, duplicate JSON keys and nonfinite constants, and preserves all missing
binding diagnostics. Unknown, unsupported and unavailable binding statuses cannot
become an available record. Explicit role bindings must agree with declared
paths, hashes and byte counts. Parent-run/method mismatches and direct declared
preparation/output path aliases are refused. Stable role ordering and object
names permit identical bytes to share an eventual object without collapsing
method/attempt context or distinct semantic roles. Inputs are not mutated.

Nine tests pass under the lightweight Python 3.11 worker environment and local
Python. The fixture supplies actual in-memory source bytes for its declared
roles and resolves 23 catalog entries. It is authored software-integrity data,
not a prepared scientific study. The suite is included in focused worker CI.
[Twelve controls](prototype/source-catalog-controls.json) retain harmless and
restored passes plus ten expected faulty-implementation failures. The first
phase fault changed every execution record and triggered the output-alias guard;
the retained control targets the run-summary phase specifically, which fails
the intended phase assertion. Production code was restored after every campaign.

The builder explicitly returns `stored_source_bytes_verified: false`,
`publication_state: not_published`, and unassessed preparation independence and
scientific acceptance. Source bindings are producer-supplied metadata. This
step does not read those source files, resolve filesystem aliases, authorize
native custody, prove every scientifically necessary source was declared, or
publish/recover an archive. It is not yet called by normal worker dispatch.
Next, the owned-file copier and streaming publisher must consume this catalog,
verify exact stored/logical bytes and retained authority, and preserve its roles
through publication and recovery. The earlier archive and acceptance requirements
remain binding.


## Local retention checkpoint, October 9

`model_validation_source_files.retain` rebuilds the declared catalog from exact
primary document bytes and explicit bindings. It checks the expected context and
requires one physical file location for every role. The existing descriptor-based
copier verifies each role within the configured run directory, including roles
whose hashes already have a retained object. Preparation sources cannot name the
same physical file as modeled output. Gzip logical verification reads bounded
chunks and refuses excess logical bytes or a mismatched hash.

The destination is exclusive. A free-space check accounts for unique stored
objects, a transient copy and overhead. Original documents remain unchanged.
Objects use catalog-relative names. The local manifest appears after all copies
and logical checks, with `retained_locally` status and scientific acceptance still
unassessed. Failed partial directories remain for reconciliation; retries cannot
overwrite them. This is not an implemented resume or power-loss recovery protocol.

Six local file tests pass, including relocation, duplicate-hash corruption,
logical hash and size, output alias, context, disk budget and destination refusal.
Eight [fault-control cases](prototype/source-file-controls.json) include harmless
and restored runs. The nine catalog tests and their twelve controls still pass.
The tests use synthetic files and caller-supplied context. They do not prove native
producer authority, independent preparation, provider redistribution permission,
Storage publication, normal dispatch, crash recovery or scientific acceptance.
The caller must establish producer completion and attempt authority; the local
administrator owns the source root and destination parent. These are not security
boundaries against another process with the same user's unrestricted access.

Next, bind this helper to the admitted attempt writer and register the manifest
through its retained command. Then implement bounded, resumable object publication
and native recovery proof before adding consumer download claims.

## Admitted writer checkpoint, October 9

`AttemptWriter.retain_validation_sources` now binds the manifest to its admitted
workspace, run, stage and attempt. It accepts an explicit supported method,
requires source paths within the verified attempt workspace, and records the
manifest through `write_model_attempt_artifact` under a fixed method-specific
logical name. It verifies workspace ownership before retention and before
registration. A retention or registration failure stops the writer. A lost reply
leaves the exact pending command and local manifest available for reconciliation.
The method argument remains a producer assertion, not evidence that the engine ran.

Five bound-writer tests cover both methods, exact manifest registration, foreign
source refusal, changed bytes, context mismatch and lost replies. Together with
the existing writer, output, package, catalog and source-file suites, 50 tests pass
in the Python 3.11 worker environment. Seven
[writer control cases](prototype/source-writer-controls.json) detect changes to
failure handling, attempt containment, artifact type, method metadata and publication
status; harmless and restored runs pass. HTTP receipts remain injected in these
checks. Native registration and fresh-process recovery for this new artifact,
normal-dispatch wiring and bounded Storage publication still require evidence.

## Native registration and reply-loss recovery, October 9

The admitted source writer now has native database evidence over synthetic files.
The existing isolated handoff harness creates a fresh owned database clone for
each case, admits its consumer attempt, and calls `retain_validation_sources`.
The proof checks the saved artifact row against the exact manifest bytes, its
attempt and workspace context, and each of the 23 local source roles. The two
methods retain separate artifacts under one parent run.

The transport wrapper lets the native artifact transaction commit, then raises a
lost-reply error before the writer receives its receipt. A separate Python process
runs the existing recovery CLI with the retained request ID. It obtains the exact
committed receipt, clears the pending journal entry and reports no model resume.
Six native table snapshots remain identical across recovery. The original writer
stays stopped and refuses later completion.

Seven [native cases](prototype/native-source-registration-controls.json) pass:
normal recovery for each method, harmless input-directory variation, three
expected failures and a restored run. Omitting registration, using an unrelated
request ID and bypassing the stopped writer each fail the stated assertion.
Each local API container is removed by the existing gateway cleanup. Retained
candidate metadata and logs live under
`~/.local/state/openplan/native-source-registration-controls-20261009a/`.

The first two standalone setup attempts, retained under
`native-source-registration-20261009a` and `native-source-registration-20261009b`,
failed because the new test wrapper called the writer's unset HTTP override.
The corrected wrapper uses the same default HTTP client as normal delivery.
The standalone `native-source-registration-20261009c` run and the subsequent
seven control clones pass. No product behavior or assertion was relaxed.

This proves native metadata registration and exact receipt recovery for local
synthetic source files. It does not prove Storage upload, source-authority quality,
independent preparation, normal model dispatch, scientific accuracy or human
acceptance. The next implementation remains bounded, resumable object publication
with immutable readback and manifest-last completion.

## Bounded object readback checkpoint, October 9

The next publisher needs a bounded verifier before it can acknowledge objects.
`model_storage_readback.verify_object` reads stored response bytes in chunks no
larger than 1 MiB, checks the exact expected size and SHA-256, and closes responses
on success and failure. It requests identity encoding and refuses an encoded
response, so an HTTP library cannot silently decompress a stored gzip artifact.
It refuses redirects, unexpected status, excess bytes, truncation and interrupted
raw streams. HTTP 404 returns explicit absence; permission and transport failures
remain unconfirmed. The caller must not turn an unconfirmed read into permission
to replace an object. Object path components are encoded and traversal segments
are refused before transport.

Eight tests cover bounded raw reads and a real loopback HTTP server. Nine
[control cases](prototype/storage-readback-controls.json) include harmless and
restored runs; weakened hash, size, status, absence, encoding, redirect and streaming
behavior fail. These checks do not yet cover native Storage or a large model file.
The helper is not wired into a resumable publisher yet, and existing byte-buffer
upload callers retain their previous implementation.

Current [Supabase standard upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
recommends the [TUS resumable protocol](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
for files over 6 MB. Use retained upload identity and server-confirmed offsets for
large source files, with immutable object names and this exact readback before
marking an object complete. A streamed single POST alone would not provide
byte-offset recovery after interruption. Native TUS configuration and restart
behavior still need verification against the isolated local Storage service.

## Retained resumable client checkpoint, October 9

`model_storage_resumable.upload_file` now retains one immutable upload intent and
its TUS session URL in an atomically replaced, private local state file. A file
lock prevents two processes from using that state concurrently. The saved intent
includes server, bucket, object name, hash, size and content type, without the
service credential. A caller cannot reuse it for a different object.

The client checks a private regular source file through an open descriptor before
network access. It sends at most 6 MiB per PATCH, checks the exact acknowledged
offset, and records progress after each confirmed chunk. After an uncertain PATCH,
a later call asks the server for its current offset. It accepts progress beyond
the last saved acknowledgement but refuses regression or a different total length.
Before reporting success, it verifies the entire stored object through bounded
raw readback. It also repeats readback when resuming previously verified state.

The implementation follows the [TUS 1.0 protocol](https://tus.io/protocols/resumable-upload)
for empty creation requests, HEAD offsets and PATCH acknowledgements. Creation
sends no file bytes. If the creation reply is lost before its URL is retained, a
later call can create another empty session for the same immutable object. The
original empty server session may remain until server expiration. A known expired
session is an explicit failure; automated expiration reconciliation is not yet
implemented. Foreign upload locations and redirects are refused. Upsert stays
false throughout.

Eleven protocol tests use a deterministic synthetic peer with actual local files
and saved state. They cover lost chunk and final replies, lost creation replies,
changed sources, changed intent, upload origin, protocol version, exact offsets,
corrupt readback, empty files and concurrent state ownership. Eleven
[fault-control cases](prototype/storage-resumable-controls.json) include harmless
and restored runs. Thirty related source and upload tests pass in Python 3.11.

This client is not yet connected to the source-set publisher. Native Storage TUS
configuration, separate-process interruption recovery, session expiration policy,
manifest-last publication and the admitted worker join remain open. These tests
are not a native service, large-network throughput or scientific acceptance claim.

## Native resumable transfer and process recovery, October 9

The client now has native Storage v1.67.20 evidence. Each case uses a fresh owned
database clone and file backend in a 512 MiB Storage container with no swap. The
source is a synthetic file of 6 MiB plus 25 bytes. The first uploader process exits
with code 73 after the server commits the first PATCH, before local progress is
updated. A fresh process reads the retained session URL, observes the server's
6 MiB offset, sends the remaining bytes and verifies the complete native object.
It does not create another upload session.

Six [native controls](prototype/native-resumable-storage-controls.json) pass:
normal, harmless file variation, changed object identity, skipped HEAD offset,
skipped readback and restored behavior. The three faulty cases fail their stated
assertions. Every case confirms removal of its owned Storage container. Private
candidate metadata, request summaries, local state and logs remain under
`~/.local/state/openplan/native-resumable-storage-controls-20261009a/`.

The first standalone run found a real client compatibility gap. This Storage
version reports an absent key with HTTP 400 and a JSON `NoSuchKey` code plus
`statusCode: "404"`. Readback now recognizes that precise legacy envelope using
a bounded 4,097-byte read and a 4,096-byte acceptance limit. It still refuses
other HTTP 400 errors, wrong error codes/statuses, malformed or oversized error
bodies and encoded responses. The nine readback tests and eleven readback controls
pass. Supabase documents both current and legacy structured errors in its
[Storage error guide](https://supabase.com/docs/guides/storage/debugging/error-codes).

Standalone run `native-resumable-storage-20261009a` retains that refusal. Run `b`
found a test adapter path error: the native service needs the gateway prefix
removed for TUS requests as well as object reads. The prefix-only request adapter
now applies to both; run `c` passes. It does not simulate TUS responses, alter
headers, translate statuses or replace service byte verification.

This proves uploader-process interruption recovery, not a Storage-service restart,
session expiration recovery, network-scale performance or complete source-set
publication. Publisher integration must still retain one state per object, bind
the original manifest, publish the manifest last and register the verified remote
reference through the admitted writer. Independent preparation and scientific
acceptance remain open.

## Source-set publisher and admitted registration, October 9

`model_validation_source_publication.publish` now checks the retained manifest's
hash and expected context, reads its five primary documents, and rebuilds the
catalog from those exact bytes and explicit bindings. It compares the rebuilt
catalog to the retained one, preserving every role and preparation/execution
phase. It rechecks compressed logical bytes and refuses changed object names,
duplicate roles, conflicting sizes and missing declared dependencies.

The publisher saves an immutable destination intent under a publication lock.
Each unique stored object has its own resumable upload state. Object names include
the run, attempt, method and original manifest hash. Each call rechecks remote
bytes through the existing uploader. The unchanged manifest uploads last, only
after every object returns verified. Its original `retained_locally` statement
remains part of the original bytes; the returned publication receipt separately
states `remote_verified`. Relative object names continue to resolve beneath the
remote manifest directory.

`AttemptWriter.publish_validation_sources` accepts only sources whose local
registration this invocation acknowledged. It records a separate
`model_validation_source_publication` artifact under a fixed method-specific
logical name, preserving the earlier local artifact. Both records bind the same
manifest hash. Upload or registration uncertainty stops the writer. A lost remote
registration reply leaves the exact artifact command pending. Upload reconciliation
must not reopen that stopped invocation or silently resume model execution.

Seven publisher and four admitted-publication tests pass with actual source files,
resumable client and command journal, a synthetic TUS peer and injected database
receipts. The full related set has 81 passing tests. Nine
[publication controls](prototype/source-publication-controls.json) catch altered
manifest hashes, catalog phases, omitted source objects, manifest-first ordering,
writer-stop bypass and wrong remote artifact type/hash. The seven existing source
writer controls also pass after narrowing their mutation scope to the retention
method, which now has a publication method immediately after it.

The complete source-set path still needs joined native Storage/database evidence
and interruption recovery. Neither the standalone native TUS proof nor the
standalone local manifest registration proof establishes that joined result.
Normal dispatch and user-facing download acceptance remain open. Primary JSON
documents are parsed in memory; large source objects transfer in bounded chunks.

## Joined native source-set acceptance, October 9

The source-set publisher and admitted writer now pass a joined native proof against
Storage v1.67.20 and PostgREST in the same isolated database. Both methods use one
admitted attempt. Each retains 23 semantic roles, publishes 15 unique source objects
and one unchanged manifest, then registers a separate remote artifact. The proof
checks all four local/remote artifact rows and downloads all 32 remote objects.
It verifies object sizes/hashes, the original manifest bytes, method/attempt/workspace
identity and manifest-last creation order.

Eight [native cases](prototype/native-source-set-controls.json) behave as expected:
normal, harmless binding reordering, omitted remote registration, wrong registered
URI, omitted source object, lost final registration reply, wrong recovery request
and restored behavior. The four faulty cases fail their named assertions. Each
case removes its owned 512 MiB Storage container; the PostgREST context also removes
its gateway. Private candidates and logs remain under
`~/.local/state/openplan/native-source-set-controls-20261009a/`. The initial standalone
run is retained under `native-source-set-publication-20261009a`.

For the lost-reply case, the ActivitySim remote-manifest artifact transaction commits
before the transport raises an error. The writer stops and refuses completion. A
separate process invokes the existing command-recovery CLI with the exact pending
request. It retrieves the same receipt without changing seven native table snapshots,
including Storage object metadata, and without reopening the writer. An unrelated
request ID fails recovery. Local source records remain separate and unchanged.

The proof uses complete authored source fixtures, not independent scientific data.
It does not run either model, admit normal dispatcher work, exercise browser downloads
or establish human acceptance. The standalone native TUS proof covers interruption
inside one object; this joined proof covers final artifact registration uncertainty.
An operator workflow for reconciling a stopped whole-source publication before its
final artifact command exists remains unfinished. It must preserve the original
publication intent and claim ownership without silently resuming model execution.

## Explicit whole-source reconciliation checkpoint, October 9

Before uploading, the admitted writer now retains a private `recovery.json` beside
the publication state. It binds the original attempt context, method and acknowledged
local manifest identity. A publication that fails before this record exists is not
automatically recoverable through this command.

`model_source_publication_recovery.py` reads the existing claim receipt, consumed
admission, pinned workspace ownership marker, saved recovery scope and acknowledged
local artifact. It verifies their relationships before network access. It refuses
unrelated pending commands. It checks current stage/parent ownership before resuming
uploads and again before registration. The artifact transaction still supplies the
final native ownership fence. These two reads are point-in-time checks, not a lease
covering a concurrent revocation during Storage transfer.

The command reconciles the saved source set and uses the same deterministic artifact
request ID and payload as the normal writer. It does not construct an AttemptWriter,
reenter a handler, create an execution admission or write stage status. The original
writer remains stopped after interruption. A final artifact reply loss stays in the
existing command journal. Generic exact-request recovery remains available for an
already prepared final artifact command; this new command covers the earlier gap.

Operator invocation, from `workers/aequilibrae_worker`, uses the original recorded
values, not a new deployment, root or claim. Replace the bracketed placeholders:

```bash
python model_source_publication_recovery.py \
  --root '[absolute owned runs directory]' \
  --journal '[original command journal directory]' \
  --base-url '[original Supabase URL]' \
  --deployment-id '[original deployment identity]' \
  --claim-request-id '[original claim request UUID]' \
  --method aequilibrae
```

Use `activitysim` for its separate saved source set. The service credential comes
from `SUPABASE_SERVICE_ROLE_KEY`; do not put it in command arguments. A successful
result reports `source_publication_reconciled` and `model_resumed: false`. Ownership
or delivery uncertainty exits 2; invalid/missing local custody exits 3. Never treat
either exit as authorization to relaunch the model or overwrite the object.

Eleven reconciliation tests pass with actual files, saved journals and consumed
admissions, but injected ownership/database responses and a synthetic TUS peer.
They cover interrupted upload recovery, idempotency, exact normal-writer slot reuse,
revocation before upload and before registration, changed owner/manifest records,
missing method plans, pending commands and lost registration replies. Ten
[reconciliation controls](prototype/source-reconciliation-controls.json) pass.
The broader related set has 92 passing tests; nine publication controls still pass
after artifact-payload construction moved into the shared recovery module.

The first unrelated-pending mutation exposed a test reporting weakness: it reached
a later transport error rather than the required early refusal. The assertion now
identifies that wrong boundary explicitly. Product refusal behavior was unchanged.
Native whole-source reconciliation and a fresh-process invocation of this new CLI
remain unverified. The prior native final-command receipt proof does not cover this
new earlier recovery boundary.
