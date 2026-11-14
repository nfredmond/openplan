# Hosted offsite backup

The Railway service `offsite-backup` copies the hosted database and every
private Storage object once a day, encrypts the bundle, and stores it in the
Railway bucket `openplan-offsite-backups` in US East (`iad`). The database runs
at Supabase in US West and the workers in Railway US West. The private key is
on one workstation only; see "Limits".

## What one run does

1. `pg_dump` writes a complete custom-format archive over TLS `verify-full`,
   preserving owners and ACLs. `pg_restore --list` must read its index.
2. Every object in every Storage bucket is copied through the authenticated
   Storage API, with its byte count and SHA-256.
3. The archive, the objects and a manifest are encrypted to the OpenPGP public
   key named by `BACKUP_GPG_FINGERPRINT` (the current fingerprint is under
   "Limits"). The private key never reaches Railway.
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
- **Key custody.** The private key for offsite captures (fingerprint
  `<NEW FINGERPRINT, lead fills in at rotation>`) exists only on the
  operator's Windows workstation:
  `%USERPROFILE%\.local\state\openplan\offsite-capture-key-<date>\` and a copy
  on that machine's second internal disk, `D:\openplan-key-escrow\`. Neither
  disk is encrypted, and the passphrase is stored with the key. If this
  workstation is lost, stolen, wiped or replaced without copying that folder,
  no offsite capture can be decrypted. Supabase's seven daily physical backups
  remain a database-only last resort (no Storage objects, in-place restore).
  The folder belongs on any machine-move checklist. A copy outside this
  machine, made by the account owner (password manager or offline media),
  would close this gap and is recorded as an open item, not a dependency.
- **Captures before the November 2026 rotation cannot be decrypted.** Every
  capture made before `<ROTATION STAMP, lead fills in>` is encrypted to
  `A4221F59406B5F299D2DD3FE7213CBBB858160CA`, whose private key was lost when
  the old Linux workstation was wiped in October 2026. No copy is known. Those
  captures age out of the bucket within 30 days of the rotation, so a copy of
  the old key found later would help only before then.
- **Credentials and Docker.** The install kit passes credentials to its
  containers on stdin, not with `docker run -e`, because a value passed with
  `-e` stays on Docker's disk after `--rm`. The Railway, Supabase and Vercel
  CLI tokens stored on the same unencrypted disk remain a larger risk.

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

Use the hosted install kit on the machine that holds the private key. It runs
`verify_capture.py` in an image built from this worker's own base, with the
bucket credentials on stdin and the key in a keyring that disappears with the
container:

```bash
export KIT_IMAGE=$(bash scripts/ops/hosted-install/image/build.sh)
export KIT_ENV_CMD="railway run -s offsite-backup -e production --"
bash scripts/ops/hosted-install/kit.sh verify <private window folder> <capture stamp> <key folder>
```

It checks the ciphertext against its summary, decrypts, refuses any archive
member that is not a plain file or folder inside the capture's own folder, and
checks the archive hash, the index count and every object's size and SHA-256.
It restores nothing; `scripts/ops/hosted-install/README.md` gives the restore
and its pass criteria. The image's Python (Debian bookworm, 3.11.2) has no
`tarfile` extraction filter, so the member check is the verifier's own.
`python3 -m unittest test_backup` covers retention, path refusal, paging,
encryption to the right key, the read-back refusal and the member check. It
does not reach a real database, Storage or bucket.
