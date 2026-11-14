# Phase A rehearsal

These helpers run the whole kit against a scratch local Supabase stack, with no
hosted access. `local_env.py` stands in for `railway run`: it supplies the
same variable names, filled from `supabase status` of the scratch stack (local
development keys only). `enable_local_tls.sh` gives the scratch database a
throwaway CA so every read uses `sslmode=verify-full`, as hosted does.
`seed_local.sql` adds three synthetic users and two projects.
`postchecks.example.sql` shows the post-check format.

## Run of November 14, 2026

Scratch stack `installkit` (ports 58440 to 58449; database, Auth, Storage and
Kong only) at origin/main `bda07da6f`, 448 migrations, PostgreSQL 17.11
(`public.ecr.aws/supabase/postgres:17.11.0.006`). Kit image built by
`image/build.sh` from the branch commits: Python 3.11.2 with no tar filter,
psql and pg_dump 17.12, gpg 2.2.40, the same packages as the backup worker.

| Step | Command | Observed |
|---|---|---|
| 6 | `keys/new_capture_key.sh` | Printed only the fingerprint; one secret key with an encryption subkey; round trip passed. `kit.sh keycheck` passed in the image. |
| 9 | Unchanged `backup.py` in the image, credentials on stdin, TLS verify-full, local S3 bucket | `offsite_capture_complete`, stamp `20261114T042556Z`, 8,135 index entries, 12 buckets, 4 objects, 158,011 bytes, uploaded and read back. |
| 10 | `kit.sh hosted catalog`, `read restore_readback.sql` | Both read 37 s after the capture started. |
| 11 | `kit.sh verify` (`verify_capture.py` on the image's Python, B1) | Every check true, 0 Storage mismatches, 8,135 index entries match. Main's `extractall(filter="data")` raises `TypeError` on this image. |
| 12 | `restore_copy.py`, readback, probes, `compare_restore.py` | pg_restore exit 0; 2 missing roles created from source attributes; 6 event triggers held back and replayed. Pass: 371 tables with exact counts, history 448 with matching tuple hash, 4 of 4 objects reconciled, probes 1, 0, 0. One count difference (`storage.objects` 4 against 6) explained by 2 rows written after the capture started (the capture's own upload into the same local Storage). |
| 16 | `rehearse_copy.py` on the restored copy | Dry run 707 ms, 48 changed keys, catalog digest unchanged, history 448 after. Install 678 ms; history 455 through `20261102140000`; post-verify passed on the whole catalog. |
| 18 | `kit.sh hosted dryrun` on the local stack standing in for hosted | 937 ms. With one extra default privilege on the stand-in (a stand-in for the managed default ACL), `compare_maps.py` stopped on the 8 new functions; with those 8 keys allowed in writing, it passed. |
| 19, 20 | Fresh bundle, GO, `kit.sh hosted install`, `catalog`, `postverify.py` | Dry run 797 ms, install 826 ms, history 455 through `20261102140000`, post-verify passed on all 48 changed keys. No kit container left after any step. |

The window plan read all seven files from one commit made only for this run
(`ae9fa8ef`, main plus the seven files from the five PR branches; no branch or
tag points at it). File hashes match the PR heads.

## Refusals shown

| Refusal | How | Result |
|---|---|---|
| Inner COMMIT | A file with `COMMIT;` added after its first statement | `REFUSED: 20261102120000: line 18: COMMIT: transaction control`; no bundle written. |
| Wrong file hash | One plan hash replaced | `REFUSED: 20261102110000: file SHA-256 is 1785f484..., plan says 0000...`; no bundle written. |
| Unexpected catalog change | A table created on the stand-in after its dry run | The database raised `the catalog changed since the dry run`; history stayed 448; a second attempt from the same bundle was refused before sending. |
| Missing GO file | `install` without `GO.json` | `REFUSED: no GO.json beside INSTALL.sql`; nothing sent. |
| Write in read mode | A read file with an `INSERT` | `REFUSED: line 2: INSERT is not allowed in read mode`; nothing sent. The live test shows the database also refuses a data-modifying CTE in read mode. |
| Credential in the container record | Canary value passed on stdin, container kept for inspection | The container received it (hashes match); 0 copies in `docker inspect` and 0 in its logs. The `-e NAME` control left it in the record. |

## What only hosted can prove

The pooler user's right to write `supabase_migrations.schema_migrations`;
dry-run wall time and lock waits under real traffic on Micro compute; the real
managed default privileges and history row format; whether `railway redeploy`
applies variables set with `--skip-deploys`; and the restore of a real capture
with its 223 objects and 7 event triggers (the local stack has 6, without
`ensure_rls`).
