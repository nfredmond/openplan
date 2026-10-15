# Hosted recovery record, October 10, 2026

The [October 11 public cutover record](../../../docs/ops/HOSTED_LIVE_2026-10-11.md)
records the newer managed database and complete Storage capture. The final
archive's readable index is not a new restore rehearsal. The captured-data
restore evidence below retains its original schema and service boundary.

This record applies to Supabase project `lolckycpdjsgeejsmuzl` and the OpenPlan
Railway workers. The local-stack procedure in
[BACKUP_AND_RESTORE](BACKUP_AND_RESTORE.md) remains separate. The rehearsal below
restores captured database contents and copies retained files through an
isolated target. It does not perform a production cutover.

## Capture and retain

Keep a private destination with directory mode 700 and file mode 600. Keep its
independent protected copy outside the source repository. Inventory database
version, owner and ACLs, platform roles, Auth configuration, Storage bucket and
object records, object bytes, required worker files, encryption secrets and
deployment configuration. Quiesce all writers for an installation recovery
point. The October 10 rehearsal does not establish coordinated quiescence.

The captured managed PostgreSQL version is 17.11. The rehearsal uses the
Supabase PostgreSQL image `public.ecr.aws/supabase/postgres:17.6.1.156` for
`pg_dump` and the disposable target. PostgreSQL 17 tooling reads the managed
source through the session pooler, with TLS `verify-full` and the provider CA.
Keep connection settings in a private environment file. Never put the password
on a command line or disable certificate verification.

Use a complete custom-format dump. Preserve ownership and ACLs; omitting those
does not preserve the access boundary. Capture source role attributes separately
from `pg_roles`, without password material. A database dump does not recreate
every cluster role or service setting. Check the archive index and hash before
restoring. The verified rehearsal archive is 5,400,971 bytes.

Copy each private Storage object through the authenticated Storage API, keeping
its bucket, path, byte count and SHA-256. Copy complete worker directories under
the same consistency interval, including SQLite journals and WAL sidecars.
Use SQLite's backup API or a verified checkpoint for active journals. A file
transfer made while workers write is insufficient for a consistent recovery
point. Preserve `OPENPLAN_INTEGRATION_KEY_SECRET` and
`OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET` through protected custody whenever
the recovery point contains workspace keys or sealed worker credentials that
need the second secret. Database dumps and worker journals do not contain these
environment secrets. Keep each required secret while a retained recovery point
needs it. Follow the [rotation procedure](../SELF_HOSTING.md#rotate-the-integration-encryption-secret)
before changing either slot.

## Encrypted offsite copy, October 12, 2026

The Railway service `offsite-backup` writes a daily encrypted database and
Storage capture to a Railway bucket in US East. See
[its deployment record](../../../workers/hosted-backup/DEPLOY.md) for schedule,
retention, variables and limits. The first capture (`20261012T002831Z`) was
downloaded, decrypted and checked: ciphertext hash, archive hash, 7,477 index
entries, and all 220 objects (117,871,050 bytes) by size and SHA-256. Its
archive was then restored as `supabase_admin` into a fresh database in a
disposable `supabase/postgres:17.11.0.004` container with no network. Two
errors remained, both the `ensure_rls` event trigger described below. The
restored copy matches production on 405 migrations, 310 public tables, 309
with RLS, 769 policies, five Auth users, 11 buckets and 220 object rows, and
those rows name exactly the 220 copied objects. Production has seven event
triggers; the restored copy has six.

That restore proves the archive and objects. It does not start replacement
Auth or Storage services, replay worker journals, or cut production over. The
private key that decrypts these captures must be kept in a second place
outside this workstation.

Railway's live model, application-worker and OCR volumes have daily and weekly
backup schedules. The observed retention is six days for daily backups and
27 days for weekly backups. Launch-baseline snapshot records also exist for
all three volumes. Their presence does not prove a completed snapshot restore.

## Restore into a disposable target

Use a separate private PostgreSQL service with no public domain, outgoing worker
callbacks or production Auth/Storage services. Retain the production source.
Create a fresh database from `template0`. Refuse a populated target.

Create only missing non-system platform roles using the captured source role
attributes. The rehearsal target lacks `supabase_realtime_admin` initially.
Replay the custom archive with `pg_restore --exit-on-error` as `supabase_admin`,
preserving its owners and grants. A restore as ordinary `postgres` cannot apply
the managed Realtime function's `log_min_messages` setting.

The platform event triggers need separate replay with their captured owners.
In this rehearsal, restore schema and data before the final event-trigger TOC
entries. Create `ensure_rls` as `postgres`, then replay the other six platform
event-trigger entries as `supabase_admin`. Verify each name, function and owner
against the source. Do not drop or change event triggers on the live source to
make a rehearsal pass. Retain the exact private SQL and TOC list used.

Verify migrations, table inventory, RLS flags, bucket/object records, Auth rows,
role grants, event triggers and representative access boundaries independently.
On any restored or replacement project, rerun
[`restrict-postgis-data-api.sql`](../../scripts/ops/restrict-postgis-data-api.sql)
and [`verify-postgis-data-api.sql`](../../scripts/ops/verify-postgis-data-api.sql).
That Data API guard lives in a role setting, which a database dump does not carry.
Verify retained password hashes against the synthetic users without printing
passwords or hashes. SQL hash checks do not establish a working Auth service.

Restore the recovery point's required primary and second integration secrets
to the replacement web app and every credential-reading worker before resuming
work. Check retained credentials without redispatching an uncertain provider
request. A successful row or file restore does not establish credential recovery.

Copy the captured objects and worker files into the isolated target, retrieve
fresh copies and compare all byte counts and digests. Do not send the copies
through production workers or mail providers. Stop the disposable service after
verification; keep its evidence and protected archives.

## Roll back the hosted app

An app rollback does not reverse migrations or encrypted records. Roll back
only to a deployment whose code works with the current schema and can read
every required credential with the protected secrets that will be configured.

1. Find the candidate: `vercel ls openplan --scope natford --prod`, then
   `vercel inspect <url> --scope natford` for its commit.
2. Check schema and credential-reader compatibility. List the hosted migrations through the
   Management API (`GET /v1/projects/lolckycpdjsgeejsmuzl/database/migrations`)
   and the repository's `openplan/supabase/migrations` at the candidate commit.
   Require every migration applied since that commit to be additive, with no
   dropped or renamed object the candidate reads. Also inspect the candidate's
   credential readers and protected configuration. If required workspace records,
   sealed requests, journals or restore points need both integration secrets,
   the web app and every credential-reading worker must support both secrets.
   A build that reads only one secret cannot read a required set encrypted under
   both, even when its schema is compatible. Follow the
   [rotation procedure](../SELF_HOSTING.md#rotate-the-integration-encryption-secret).
   Do not rewrite retained rows or queued envelopes to fit the rollback.
   If either compatibility check is uncertain, roll forward with a compatible
   fix instead.
3. Promote with `vercel rollback <url> --scope natford`, then confirm
   `/api/health` reports the candidate's commit. Vercel then stops promoting
   new `main` builds until someone promotes a later deployment, so record the
   rollback in the coordination file.
4. Railway workers deploy from `main` separately. Check that their commit
   matches the rolled-back app, or that the worker paths did not change.
   Confirm every credential-reading worker retains the required secrets and
   supports them before resuming work.

**Dated target, October 12, 2026.** Production `dpl_7CTf3ojNmvkxJqiPK7gkcw33qxNs`
serves `c03788c`. The previous production deployment,
`dpl_9VqupkuiPeYiPJicoA5qktkFb1sP`, serves `6730997`. No migration file changed
between those commits. At 03:56 UTC the hosted project added migration 406,
`20261017000002`, which only creates one function, so that build still reads
nothing that was dropped or renamed. Every later merge or migration replaces
this target; repeat step 2 before using it.

**One operator.** Recovery depends on Nathaniel: the Vercel, Supabase,
Railway and Resend accounts are under his login, and the only copy of the
offsite decryption key is on his workstation until he stores a second one.
If he is unavailable, no one else can restore or roll back this installation.

## Observed result and remaining boundaries

The target contains 399 migrations, 308 public tables, 307 tables with RLS,
three Auth users, ten buckets, four Storage object records and seven platform
event triggers. Both synthetic password hashes match. Owner, other-workspace
and anonymous SQL probes see one, zero and zero retained project rows.
Four object files totaling 216,267 bytes and ten application-worker journal
files match after a complete round trip through the isolated host.

Replacement Auth and Storage service startup, actual password sign-in against
that replacement, complete worker-journal replay, provider snapshot restoration,
an independent protected-copy restore and production cutover remain untested.
These checks must precede a claim of complete installation recovery. Obtain
specific approval before replacing live durable state. Restore rehearsals do
not revoke exposed credentials or undo prior information disclosure.
