# Hosted offsite backup

The Railway service `offsite-backup` copies the hosted database and every
private Storage object once a day, encrypts the bundle, and stores it in the
Railway bucket `openplan-offsite-backups` in US East (`iad`). The database runs
at Supabase in US West, the workers in Railway US West, and the private key on
Nathaniel's workstation, so no single one of those failing loses every copy.

## What one run does

1. `pg_dump` writes a complete custom-format archive over TLS `verify-full`,
   preserving owners and ACLs. `pg_restore --list` must read its index.
2. Every object in every Storage bucket is copied through the authenticated
   Storage API, with its byte count and SHA-256.
3. The archive, the objects and a manifest are encrypted to the OpenPGP public
   key `A4221F59406B5F299D2DD3FE7213CBBB858160CA`. The private key never
   reaches Railway.
4. The ciphertext is uploaded, downloaded again and compared by SHA-256. Only
   then is `summary.json` written beside it. A capture without a summary is
   incomplete.
5. Captures older than 30 days are deleted, always keeping the newest seven.

The schedule is `17 10 * * *` (10:17 UTC daily) with restart policy `NEVER`,
set on the service instance. A failed run exits 1 and logs
`offsite_capture_failed` with a reason that names no credential.

## Limits

- **Not atomic.** Writers stay active while the database and objects are
  copied. A restore must reconcile `storage.objects` rows against copied bytes.
- **Not covered:** worker volumes (journals, OCR custody, model files), Auth
  service configuration, and provider settings. Railway's volume backup
  schedules cover the volumes and have not been restore-tested.
- **Same Railway account as the workers.** Encryption protects the contents if
  that account is compromised. It does not protect against deletion.
- **The private key exists in one place until Nathaniel escrows it.** It is in
  `$HOME/.local/state/openplan/offsite-backup-key/` with its passphrase. If
  this workstation is lost before a second copy exists, the offsite captures
  cannot be decrypted.

## Variables

Set through `railway variable set NAME --stdin` so no value appears on a
command line. Names only:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, referenced from
  `application-workers`
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`,
  `PGSSLMODE=verify-full`, and `BACKUP_PG_CA_PEM` (the Supabase CA)
- `BACKUP_BUCKET`, `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` and
  `BACKUP_S3_ADDRESSING_STYLE`, from `railway bucket credentials`
- `BACKUP_GPG_FINGERPRINT`, `BACKUP_GPG_PUBLIC_KEY`, `BACKUP_RETAIN_DAYS`,
  `BACKUP_MIN_KEEP`, `RAILWAY_DOCKERFILE_PATH`

## Deploy a change

This service is not connected to GitHub, so a merge to `main` does not change
it. After a reviewed change lands, deploy the merged files from a directory
that holds only them:

```bash
stage=$(mktemp -d)
mkdir -p "$stage/workers/hosted-backup"
cp workers/hosted-backup/{Dockerfile,backup.py} "$stage/workers/hosted-backup/"
cp workers/hosted-backup/railway.json "$stage/railway.json"
cd "$stage" && railway link -p 9d7fbdc3-c370-41b5-8471-34dc128e718e -e production -s offsite-backup
railway up --service offsite-backup --ci
```

`railway up` starts one run immediately. Confirm its log line, then confirm
the instance still reports `cronSchedule` and `nextCronRunAt` through
`railway api`.

## Verify a capture

On a machine that holds the private key, with the bucket variables exported:

```bash
GNUPGHOME=$HOME/.local/state/openplan/offsite-backup-key/gnupg \
BACKUP_GPG_PASSPHRASE_FILE=$HOME/.local/state/openplan/offsite-backup-key/passphrase.txt \
python3 workers/hosted-backup/verify_capture.py /path/to/new/private/dir
```

It checks the ciphertext against its summary, decrypts, and checks the archive
hash and every object's size and SHA-256. With PostgreSQL 17 `pg_restore` on
the path it also checks the index count. It restores nothing.
`python3 -m unittest test_backup` covers retention, path refusal, paging,
encryption to the right key and the read-back refusal. It does not reach a
real database, Storage or bucket.
