# Hosted recovery record, October 10, 2026

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
point. Preserve `OPENPLAN_INTEGRATION_KEY_SECRET` through protected custody.

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
Verify retained password hashes against the synthetic users without printing
passwords or hashes. SQL hash checks do not establish a working Auth service.

Copy the captured objects and worker files into the isolated target, retrieve
fresh copies and compare all byte counts and digests. Do not send the copies
through production workers or mail providers. Stop the disposable service after
verification; keep its evidence and protected archives.

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
