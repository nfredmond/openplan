# A completed cleanup can precede a late GTFS upload

October 10, 2026. Candidate `5ff3d37f7`, PostgreSQL 17.6 and native Supabase
Storage `v1.67.20`. This counterexample changes the next implementation step.
Managed source intake must not treat one successful object-removal response as
proof that no upload can subsequently create that object.

## Observed race

The [runner](verify_late_storage_upload.py) clones the recorded 400-migration
candidate into a new owned database. Real service-role SQL admits a synthetic
upload with the retained BART fixture's exact hash and byte count. A real HTTP
request sends half of its 892,312 bytes, then pauses. The runner observes bytes
in the private file backend and confirms that no completed `storage.objects`
row exists. This establishes actual server progress before cancellation.

The managed cancellation command closes the version and records its object
cleanup request. A real Storage deletion returns HTTP 200 with an empty list.
The runner acknowledges that request with the exact version/path predicate used
in `persist.ts`. It then sends the rest of the upload. Storage returns HTTP 200;
the object downloads with the original hash. SQL observes a cancelled execution,
failed version, one object row and no remaining cleanup request.

This occurs with the service credential and with an anonymous insert policy
that reads the import's current state. The temporary policy is restricted to
this synthetic workspace. It refuses new requests after cancellation, but does
not stop requests that passed its earlier check. It is a diagnostic policy,
not proposed application access. No real user token or user impersonation is
involved.

The [results](late-storage-upload.json) contain three complete sequences:
baseline, harmless SQL comment and restored predicate. Each sequence includes
closed-before-start refusal, a successful open import, and both late-upload
counterexamples. Two broken predicates fail their intended assertions: denying
all writes prevents the open upload reaching the backend; allowing all writes
permits a closed import to start. These controls establish that the policy is
active and that the runner distinguishes live from closed imports.

The final service `openplan-gtfs-late-upload-20261010d.service` exits successfully
under a 512 MiB memory cap with swap disabled. Storage has a separate 512 MiB
cap. The runner removes its policy, private-schema grant, container and files
before publishing its success record. The owned database remains for inspection.
Python compilation and `git diff --check` pass.

Two earlier runs are not successful evidence. The first used the wrong receipt
field, `status` instead of `state`. The second reproduced the race but failed
temporary-file cleanup because the deliberately permissive policy left an
object behind. The runner now removes that fixture in a `finally` block and
publishes results only after teardown. Its owned temporary residue was removed.

## Provider mechanism and design decision

The pinned [Storage v1.67.20 uploader source](https://github.com/supabase/storage/blob/v1.67.20/src/storage/uploader.ts)
checks permission before transferring the body. Completion uses a superuser
database connection without a second caller-policy check. The native result
agrees with that implementation. This finding is specific to the tested server;
it is not a claim about every Storage release, S3 or resumable uploads.

[Custom Storage roles](https://supabase.com/docs/guides/storage/schema/custom-roles)
are supported, but a different role does not repair this check's timing. Do not
add a JWT-signing configuration requirement to claim this race is solved.
[Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design)
also favors reading metadata and using the API for object operations. Avoid
custom Storage-table triggers as an unverified workaround.

The next implementation is recurring, bounded reconciliation of GTFS objects
against retained import ownership and deletion state. A late object must become
eligible for cleanup again, including after an earlier request was acknowledged.
One empty deletion response means absent at that observation, not permanently
removed. The design must preserve open/prepared and ready archives, distinguish
unknown keys from authorized deletions, handle deleted feeds/workspaces, retain
progress through worker loss, and avoid starvation as the bucket grows. Physical
deletion still goes through the Storage API. Those behaviors need native controls
before source intake or routes use them.

## Limits and reproduction

This uses native Storage and lifecycle SQL, but repeats the cleanup acknowledgment
predicate directly. It does not call the application sweeper, prove a replacement
worker, test largest-feed capacity, establish physical backend orphan recovery,
or provide browser/practitioner acceptance. No application migration or import
route changes in this checkpoint. Full branch release checks remain open.

Run from the isolated checkout, in a bounded service, with an unused output path:

```bash
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_late_storage_upload.py \
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/lock-upgrade-01/candidate-database.json \
/home/nathaniel/.local/state/openplan/gtfs-profile-20261009/bart.zip \
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/late-upload-new
```
