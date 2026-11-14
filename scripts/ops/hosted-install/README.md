# Hosted capture and install kit

This folder holds the procedure and tools for two hosted operations: proving
that an offsite capture can be decrypted and restored, and installing a set of
migrations on the hosted database in one transaction. It replaces the private
installer kit that was lost with the wiped workstation in October 2026. It
implements the amended procedure in review 15 of November 14, 2026, and closes
that review's findings B1, B2, B3, B5, B6 and B7. Finding B4 (the migration
packets themselves) belongs to the lane that owns those pull requests.

Nothing here holds a credential. Credentials reach a container only on its
standard input (`env_to_stdin.py` on the host, `stdin_env.py` in the image), so
no value appears on a command line, in a container record or in output. The
kit never uses `supabase db query --linked`, because each call writes a login
role on hosted. No flag skips the capture, the restore proof, the dry run or
the change-map check.

## Files

| File | What it does |
|---|---|
| `kit.sh` | Host wrapper: `hosted` (any `run_sql.py` mode on hosted), `verify` (download, decrypt and check a capture) and `keycheck` (prove a key folder decrypts in the image). Fails if a kit container is left behind. |
| `image/build.sh`, `image/Dockerfile` | Builds `openplan-hosted-install:<commit>` from committed bytes only: the backup worker's base (PostgreSQL 17 client tools, Python 3.11, gpg, boto3), `backup.py`, `verify_capture.py` and this folder. Never pushed or deployed. |
| `keys/new_capture_key.sh` | Makes the capture key pair, checks it, prints only the fingerprint. |
| `run_sql.py` | The only path to a database. Modes `rtt`, `read`, `catalog`, `dryrun`, `install`, `probe`. One transaction, sent once as one message, with an envelope of the result. |
| `build_install.py` | Builds `DRYRUN.sql` from the window plan, then `INSTALL.sql` pinned to a completed dry run. |
| `sqllex.py` | Splits SQL as psql does and refuses transaction control, psql meta-commands and session changes. |
| `catalog_keys.sql` | The catalog key reader: one key and value per object. |
| `compare_maps.py` | Compares the restored copy's change map with the hosted one, allowing only keys named in `allowed_differences.json`. |
| `restore_copy.py`, `restore_readback.sql`, `boundary_probes.sql`, `compare_restore.py` | Restore a capture with no network and pass or stop it on the four B7 criteria. |
| `rehearse_copy.py` | Step 16: the whole window on the restored copy. |
| `postverify.py`, `health_readback.py` | After the install: the whole catalog against the dry run; then `/api/health` against the read history. |
| `rehearsal/` | Phase A helpers for a local stack. Not used on window day. |

## What each check compares

- **Catalog map (B3).** `catalog_keys.sql` covers schemas, relations, columns,
  constraints, indexes, functions (definition, owner, ACL, settings), triggers
  (including `UPDATE OF` and transition tables), policies, views, types,
  sequences, rules, comments, default privileges, event triggers, publications,
  extensions and their members, casts, roles and memberships (no passwords) and
  every `schema_migrations` row. It excludes `cli_login_%` roles, role expiry
  and all data. The kit compares key-to-value-hash maps, so a right key with a
  wrong value fails.
- **Dry run (B2).** `DRYRUN.sql` sets the B5 timeouts, records the transaction
  id and the whole catalog, runs every migration statement followed by a check
  that the transaction id is unchanged, reads the catalog again, runs the
  post-checks, prints the result, raises, and only then rolls back.
- **One message (lane 28).** `run_sql.py` sends each transaction, from
  `BEGIN` to `COMMIT` or to the dry run's raise, as one simple-query message:
  psql's backslash-semicolon joins the statements, and the kit's lexer decides
  where they join. The server runs them in order and stops at the first
  error. So no network round trip happens while a lock is held. Before this,
  psql sent one statement per round trip: at the 25 ms measured from the
  operator's workstation to hosted, the seven-file dry run held the Safety
  tables for about 4.6 s. A count of statement checks must match the build,
  or the transaction stops before it can commit. Every statement in one
  message sees the same `statement_timestamp()` (PostgreSQL 17 protocol
  53.2.2.1), so each check also compares it with the value the guard row
  stored: a transaction that reached the server in more than one message
  stops at the first check after the split (review 31, N4).
- **Lock time (lane 28).** The guard after each statement records, on the
  server's clock, when the transaction first holds an ACCESS EXCLUSIVE lock on
  a non-temporary table; the last statement reads the clock again. The
  envelope's `lockHeldMs` is the difference. It does not include the commit or
  rollback itself, which needs no round trip. The limit is **2,000 ms**
  (`kitcommon.LOCK_LIMIT_MS`): one second under Supabase's 3 s default
  statement timeout for the `anon` role. A dry run whose lock time is over it
  reads `dry-run-too-slow` and exits 1.
- **Lock timeout (review 31, N3).** The dry run and install set
  `lock_timeout = '1s'`: no single lock wait lasts more than one second. The
  bundle's server time is about 0.3 s; while the install waits for a lock it
  keeps every lock it already holds, the Safety tables first, and live `anon`
  requests queued behind them time out at 3 s, so a wait must end well before
  that. A lock timeout fails safely: the transaction rolls back with hosted at
  448, and the window needs a new bundle. `read`, `catalog`, `rtt` and
  `probe` keep `lock_timeout = '3s'`.
- **Measure before acting (lane 28).** `rtt` sends 20 `SELECT 1` statements
  one at a time in a read-only transaction and records psql's time for each;
  the median is the round trip. A hosted `dryrun` or `install` needs `--rtt`
  (a `rtt` envelope to the same target, under 30 minutes old) and
  `--rehearsed` (a completed dry run of the same `DRYRUN.sql`). It prints
  `estimate = round trips under lock x round trip + rehearsed lock time`,
  records it in the envelope, and refuses to send anything when the estimate
  is over 2,000 ms. With one message there are no round trips under lock, so
  the estimate is the rehearsed lock time; the round trip still decides how
  long the connection and the large result take, outside the lock.
- **Install (B3.4).** `INSTALL.sql` is the same file pinned to one dry run on
  the same target. Before any change it requires session and current user
  `postgres`, `postgres` not a superuser, a read-write transaction, history
  count and newest version as planned, no planned version present, and the
  history tuple hash and whole-catalog digest the dry run read. After the
  changes it requires the change map to equal the dry run's exactly.
- **Restore (B7).** Exact counts for every table in `public`, `auth` and
  `storage`; ordered primary-key hashes for workspaces, members, projects,
  users and buckets; every `storage.objects` row against the decrypted
  manifest; owner, other-workspace and anonymous reads of one project row
  returning 1, 0 and 0. A difference passes only when the source shows rows
  created or updated at or after the capture started.

## Before you start

Run in Git Bash from a checkout of merged `main`. Prefix any `docker` command
you type with `MSYS_NO_PATHCONV=1` (`kit.sh` does this itself). Set:

```bash
KIT=scripts/ops/hosted-install
export KIT_IMAGE=$(bash $KIT/image/build.sh)          # refuses a dirty tree
export KIT_ENV_CMD="railway run -s offsite-backup -e production --"
W=$HOME/.local/state/openplan/hosted-install/<window-id>   # private; plaintext lands here
```

"Stop" means end the window, leave hosted as it is, record the state in
`$HOME/.local/state/openplan/COORDINATION.md` and do not retry in that window.
The lead runs every hosted step. Every hosted read goes through
`kit.sh hosted ... rtt`, `read` or `catalog`. After every `kit.sh` step,
`docker ps -a --filter label=openplan-hosted-install` must be empty; `kit.sh`
checks it.

## Phase A: build and rehearse (done in the kit pull request)

1. Build the kit with tests and mutation pairs for each guard.
2. Rehearse end to end on a local stack seeded at 448 migrations, with a
   synthetic capture encrypted to a throwaway key, in the exact images the
   window uses. `rehearsal/README.md` records what ran and what it proved.
3. Merge the kit pull request in a normal slot. It adds no migration.

## Phase B: new key and one proven capture

4. Record the plan in the HOSTED section of COORDINATION.md. Pick a time
   outside 10:05 to 10:50 UTC.
5. Save the current public key and fingerprint (public values) to `$W`:
   `railway variable list -s offsite-backup -e production --json | jq -r .BACKUP_GPG_FINGERPRINT > $W/old-fingerprint.txt`
   and the same for `.BACKUP_GPG_PUBLIC_KEY > $W/old-public.asc`. Pipe straight
   into `jq`; never print the list.
6. Make the key with an MSYS path under about 84 characters:
   `bash $KIT/keys/new_capture_key.sh /c/Users/<you>/.local/state/openplan/offsite-capture-key-YYYYMMDD`.
   It prints only the fingerprint. Copy the whole folder to
   `D:\openplan-key-escrow\` and set the access list on both copies:
   `MSYS2_ARG_CONV_EXCL='*' icacls "<folder>" /inheritance:r /grant:r "$USERNAME:(OI)(CI)F"`.
   Check the D: copy in the image: `bash $KIT/kit.sh keycheck /d/openplan-key-escrow/offsite-capture-key-YYYYMMDD`.
   **Stop** if the key check fails.
7. Read `railway cron list` for the service: no run in progress. Set the
   public key, then the fingerprint, both with `--skip-deploys`:
   `railway variable set BACKUP_GPG_PUBLIC_KEY --stdin --skip-deploys -s offsite-backup -e production < KEY/public.asc`
   and `railway variable set BACKUP_GPG_FINGERPRINT=<fpr> --skip-deploys -s offsite-backup -e production`.
   Check names and the fingerprint only. If either set fails, finish the pair
   before leaving; `backup.py` refuses a mismatched pair and uploads nothing.
8. `railway redeploy -s offsite-backup -e production -y`. Check the deployment
   succeeded and the instance still reports `cronSchedule` `17 10 * * *` and a
   `nextCronRunAt` (DEPLOY.md). If the schedule is gone, redeploy from the
   DEPLOY.md staging folder with `railway up` and check again. **Stop** if it
   is still missing.
9. Read `railway cron list`. If the redeploy started a run, wait for it;
   otherwise `railway cron run -s offsite-backup -e production --yes`
   `[VERIFY: flags with railway cron run --help]`. The `offsite_capture_complete`
   log line must name the **new** fingerprint and a new stamp, with counts near
   the last run's. **Stop** on `offsite_capture_failed` or the old fingerprint.
   Note the line's `capturedAt`.
10. Within 10 minutes of that line, read the source:
    `bash $KIT/kit.sh hosted $W catalog` and
    `bash $KIT/kit.sh hosted $W read /kit/restore_readback.sql --var capture_started=<capturedAt>`.
11. Verify in the image: `bash $KIT/kit.sh verify $W <stamp> <KEY_DIR>`.
    Every boolean must be true, `storageMismatches` 0 and the index count
    equal to the summary. **Stop** on any false.
12. Restore with no network into the Supabase image whose PostgreSQL minor
    matches the capture (`restore_copy.py` refuses a mismatch), then read back,
    probe and compare:

    ```bash
    python $KIT/restore_copy.py --capture $W/decrypted/<stamp>/<stamp> \
      --image public.ecr.aws/supabase/postgres:<17.11 tag> --name openplan-install-copy-<stamp> \
      --source-catalog $W/evidence/<catalog envelope from step 10> --evidence $W/evidence
    python $KIT/run_sql.py read --target copy:openplan-install-copy-<stamp> --out $W/copy \
      $KIT/restore_readback.sql --var capture_started=<capturedAt>
    python $KIT/run_sql.py probe --target copy:openplan-install-copy-<stamp> --out $W/copy $KIT/boundary_probes.sql
    python $KIT/compare_restore.py --copy $W/copy/read-*.json --source $W/evidence/<read envelope from step 10> \
      --manifest $W/decrypted/<stamp>/<stamp>/manifest.json --probes $W/copy/probe-*.json --out $W/evidence/restore-comparison.json
    ```

    Pass only when `compare_restore.py` exits 0. **Stop** otherwise.
13. Record the rotation: fill in the placeholders in DEPLOY.md,
    HOSTED_RECOVERY.md and HOSTED_OPERATIONS.md (new fingerprint, rotation
    stamp), close the matching known-issue line, and write the date of the
    first weekly decrypt check (step 11 on the newest capture) in
    COORDINATION.md. Then delete the plaintext:
    `docker rm -f openplan-install-copy-<stamp>` and `rm -rf $W/decrypted`.

## Phase C: the migration window (seven files, one transaction)

14. Preconditions (B4): one integration pull request with all seven files and
    the dependent code, every required check green on a frozen head. Write
    `$W/plan.json` (format below) reading every file from that head, its
    `postchecks.sql` with the packets' checks rebased to 455, and
    `allowed_differences.json`. Read the history row format of the newest
    hosted rows with a `read` query and set `historyStatements` to match
    (review 15, N6). Post the window in COORDINATION.md with versions, hashes,
    head SHA and planned UTC time.
15. Fresh capture: steps 9 to 12 again. Its stamp is the window's `capture`.
    **Stop** if any check fails.
16. On the restored copy: `python $KIT/rehearse_copy.py --plan $W/plan.json --repo . --container openplan-install-copy-<stamp> --window $W`.
    It runs the dry run, requires an unchanged catalog digest and 448 rows
    after it, then installs and post-verifies. **Stop** on any failure.
    `copy-run/summary.json` records `dryRunLockMs`; the copy's dry-run
    envelope (`copy-run/dryrun-*.json`) is the `--rehearsed` input in step 18.
    **Stop** if `dryRunLockMs` is over 2,000 ms: the window would hold its
    locks too long even with no network.
17. Hosted pre-checks: each packet's read-only pre-checks through
    `kit.sh hosted $W read <file>`. **Stop** on any difference.
18. Read `railway cron list` (no run in progress). Measure the round trip,
    then build and run the hosted dry run:

    ```bash
    bash $KIT/kit.sh hosted $W rtt
    python $KIT/build_install.py dryrun --plan $W/plan.json --repo . --out $W/bundle-hosted
    bash $KIT/kit.sh hosted $W dryrun --bundle /work/bundle-hosted \
      --rtt /work/evidence/rtt-<stamp>.json --rehearsed /work/copy-run/dryrun-<stamp>.json
    python $KIT/compare_maps.py --copy $W/copy-run/dryrun-*.json --hosted $W/evidence/dryrun-<stamp>.json \
      --allowed $W/allowed_differences.json --out $W/evidence/compare-maps.json
    python $KIT/build_install.py install --plan $W/plan.json --repo . --out $W/bundle-hosted \
      --pins $W/evidence/dryrun-<stamp>.json
    ```

    The `rtt` envelope must read `measured`; write its `rttMs` in the window
    notes. The dry run prints its lock-time estimate before it sends anything.
    If it refuses (`estimated lock time ... is over the 2000 ms limit; nothing
    was sent`), **stop**: hosted was not touched, and the copy's own lock time
    is too long for this window. A refusal because the measurement is missing,
    older than 30 minutes or to another target means: run `rtt` again, then
    the dry run. The dry-run envelope must read `dry-run-complete`, judged on
    its server-measured `lockHeldMs` (over 2,000 ms reads `dry-run-too-slow`);
    record `lockHeldMs` and `elapsedMs`. `compare_maps.py` must exit 0.
    **Stop** otherwise. A dry run's message holds no `COMMIT`, so a lost
    connection rolls it back; `dry-run-unknown` means the kit did not see how
    it ended. Read `catalog`: 448 rows and the before digest are expected.
19. Write `$W/bundle-hosted/GO.json` with `capture`, `installSha256` from
    `bundle.json` and `"target": "hosted"`. Measure again and install once:
    `bash $KIT/kit.sh hosted $W rtt`, then
    `bash $KIT/kit.sh hosted $W install --bundle /work/bundle-hosted --rtt /work/evidence/rtt-<new stamp>.json --rehearsed /work/evidence/dryrun-<stamp>.json`
    (the rehearsed lock time is now the hosted dry run's own). A refused
    estimate sends nothing and does not use up the bundle's one attempt. It
    must read `installed`; record `lockHeldMs`. If it reads anything but
    `installed`, read `catalog` before anything else. 455 rows and the dry
    run's after state means installed: continue at step 20. 448 rows and the
    before digest means not installed: stop. Anything else: stop for review.
    The kit never resends from that bundle (review 15, N12; review 31, B1).
    `install-failed` means psql reported a database error on a live
    connection, so the server stopped before `COMMIT`; `install-unknown`
    means the connection was lost, psql was killed or the output was
    incomplete. The whole transaction is one message, and the server runs it
    through `COMMIT` even after the client is gone, so either label is read
    against `catalog`, never taken as "rolled back".
20. Post-verify: `bash $KIT/kit.sh hosted $W catalog`, then
    `python $KIT/postverify.py --pins $W/evidence/dryrun-<stamp>.json --catalog $W/evidence/catalog-<new>.json --out $W/evidence/postverify.json`.
    Then each packet's rolled-back probes with `kit.sh hosted $W probe <file>`.
    **Stop** on any difference. Hosted at 455 with the old code is a safe hold;
    a rollback is a separate decision.
21. Merge the integration pull request in its slot. When it deploys, read the
    catalog again and run
    `python $KIT/health_readback.py --url https://openplan-zeta.vercel.app/api/health --commit <merge sha> --catalog <catalog envelope>`
    until it passes, then check each route the packets name.

The kit refuses any hosted dry run, install or probe between 10:05 and
10:50 UTC.

## Window plan format

```json
{
  "window": "20261115-01",
  "purpose": "window",
  "capture": "20261115T180000Z",
  "history": {"count": 448, "newest": "20261024200400"},
  "historyStatements": "whole-file",
  "postchecks": "postchecks.sql",
  "files": [
    {"version": "20261102100000", "name": "persist_state_injury_crashes",
     "path": "openplan/supabase/migrations/20261102100000_persist_state_injury_crashes.sql",
     "commit": "<40-character integration head>", "sha256": "<file hash>", "selfWrapped": true}
  ]
}
```

`selfWrapped` says whether the file has its own `BEGIN;` and `COMMIT;`; the kit
removes exactly that pair and refuses a mismatch. `historyStatements` is
`whole-file`, `statements` or `empty`. A `window` plan must read every file
from one commit; a `rehearsal` plan may not run on hosted.

## Key custody (review 15, B6)

The private key for offsite captures exists only on the operator's Windows
workstation, in the state folder on C: and a copy on D:, a second internal
disk. Neither disk is encrypted, and the passphrase is stored with the key. If
this workstation is lost, stolen, wiped or replaced without copying that
folder, no offsite capture can be decrypted. Supabase's seven daily physical
backups remain a database-only last resort (no Storage objects, in-place
restore). The key folder belongs on any machine-move checklist. A copy outside
this machine, made by the account owner (password manager or offline media),
would close this gap and is recorded as an open item, not a dependency.

## Outside the repository

The kit still depends on: the signed-in Railway CLI and the `offsite-backup`
service variables; Docker Desktop; the public images `postgres:17-bookworm` and
`public.ecr.aws/supabase/postgres` at the hosted minor; Git for Windows `gpg`;
the key folder on this workstation; COORDINATION.md; and, for Phase C, the
integration head, packet post-checks and `allowed_differences.json` that the
migration lane writes.
