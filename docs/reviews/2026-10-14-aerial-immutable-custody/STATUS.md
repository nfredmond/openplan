# Aerial immutable custody candidate

A retry can replace original Storage bytes after an upload succeeds but its
custody-row write fails. The isolated counterexample adds one intended failure
to 24 passing cases. It changes the later source response while preserving the
same job, artifact kind and object key. The original `upsert: true` replaces the
first object. That is not recovered original custody.

The uncommitted candidate disables overwrite and reads the actual object after
every upload attempt. Its size and streamed SHA-256 must match the downloaded
bytes before a held row is recorded. A lost upload acknowledgement can recover
through matching actual bytes. Different, missing or unreadable bytes refuse.
Existing held rows still avoid another download or metadata replacement.

All 28 custody cases and 69 related callback/retry/planner-package cases pass.
Changed-file lint passes. Four positive guard cohorts and five intended source
faults pass; normal edits restore in finally. The new network read and existing
SDK upload lack a proven forwarded deadline/cancellation path. A focused
independent review is assessing that boundary. This is not a releasable claim
of bounded transfer or complete recovery.

Actual isolated Storage v1.67.20 and the installed SDK retain the original three
synthetic bytes after a simulated custody-row acknowledgement failure. A retry
with different bytes cannot become held; another retry with the original bytes
records matching custody. The database row interruption uses a simulated client.
This is not live RLS, current-main restore, browser, artifact provenance,
processing quality or full worker integration acceptance.

The first native driver has a syntax error before the scenario executes. The
second observes the expected byte behavior but fails cleanup because Storage
creates root-owned directories in its owned temporary mount. Both failed trials
remain. An owned copy of the existing Storage helper returns only its own mount
to the host owner before removing the container. Later guard and reconciliation
runs exit successfully. The earlier temporary directory remains for fenced
owned cleanup; retained proof databases are not removed or reset.

No migration, production setting or worker default changes are selected. Durable
source retention, prepared identity, expired-source recovery, cancellation,
late-object reconciliation, capacity and the full M3/M5b.2 outcome remain open.
Private proof base:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/aerial-immutable-custody-20261014/`.

## October 14 transport correction

The current candidate uses a required Storage client factory at both custody
routes. The factory preserves the configured installation and target, and opts
into an HTTP transport carrying the remaining pass deadline and request
cancellation. Other service clients keep their existing transport. Source reads,
uploads and reconciliation share the transfer deadline. Database reads, custody
writes and summary writes retain their separate existing transport.

Reconciliation uses the installed SDK's network stream. It counts bytes and
hashes chunks without assembling another object in memory. An excessive stream
is canceled. Both returned and thrown upload acknowledgement errors enter
reconciliation while the deadline still permits a read. A held row requires
matching actual bytes. The object upload uses `upsert: false`.

The changed files and dependencies pass scoped TypeScript. Full-program
TypeScript hits its configured 768 MiB heap ceiling before completion; it is not
a passing full check. Ten changed files pass lint. Four full source-control
cohorts each pass 92 cases across six files. All 15 source faults reach the named
assertion, including overwrite, hash, recovery, streaming, cancellation and
configuration failures. The source edits restore in finally.

Four native transport cohorts each pass six cases with the actual compiled
engine and installed SDK. Six faults reach actual exception diagnostics for
upload cancellation, ignored current cancellation, stalled reads, buffering
before the ceiling, removed byte limits and discarded thrown acknowledgements.
The owned loopback responses close after cancellation or refusal. Database
writes and Storage permissions in this transport fixture are simulated.

Actual isolated Storage v1.67.20 has four positive recovery cohorts and two
intended failures. Restoring overwrite changes the retained bytes; ignoring the
hash incorrectly marks changed bytes held. The passing run preserves the
original object and restores its row from matching bytes after a simulated row
write failure. Proof databases remain retained. This checks actual Storage bytes,
not live row-level access or current hosted schema recovery.

The independent read-only review identifies no further transport or target
defect in the corrected implementation. It does not grant workflow acceptance.
The source extension still affects object identity. Two simultaneous passes can
still let a failed custody-row upsert replace a held row. Durable retained source
bytes, prepared identity, expired-source recovery, recurring late-object cleanup,
complete worker integration, capacity and browser acceptance remain open.
No migration, production setting, worker default or release tag changes.

Earlier failed trials remain preserved: a full TypeScript heap-limit failure,
a scoped Node/DOM stream type mismatch, two native-driver errors, a native
cleanup error, and an incorrect transport-proof assertion location. The corrected
cohorts above do not turn those failures into passing runs.

## Joined callback and roadmap tree

The combined candidate joins the accepted-response/package correction and
main259's roadmap status format. Four full custody source cohorts each pass96
cases across six files. All15 source faults reach their named assertions.
Four installed-SDK loopback cohorts each pass six cases, with six targeted faults
and42 exception-oracle controls. Four actual isolated Storage cohorts and two
intended faults preserve and recover the original object. The last proof database
is retained as `openplan_attempt_cli_11ad3644a91448049612bbd07f1a55e6`.

The combined TypeScript/lint/148-case record is linked from the
[callback report](../2026-10-14-aerial-callback-retry/STATUS.md). Source bindings
match the restored joined tree. CI now runs the custody source and loopback
transport controls after callback controls; the local actual Storage fixture
retains its separate target fence and is not a generic hosted test. Fresh CI,
main integration and exact hosted delivery remain pending.

## October 14 current-main account-limit join

The combined worker stack joins main d0d2290da7e7 and preserves the incoming
workspace storage check. Its native transport fixture now asserts both the
workspace_storage_bytes function and the original workspace argument. Four
six-case installed-SDK cohorts pass. Six transfer faults and two fixture-scope
faults fail at their named assertions. The changed native fixture is bound by
stack-transport-bindings.json. Storage permissions and database writes remain
fixtures; this is separate from live RLS and hosted delivery.
