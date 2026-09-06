# Backup and restore OpenPlan

OpenPlan recovery uses the database and storage already running on the
self-hosted Supabase stack. It requires no paid plan or hosted backup product.
Database rows and Storage object metadata are one PostgreSQL backup; object
bytes are a separate archive. A usable recovery point needs both.

Run these commands from the `openplan/` app directory. They assume the default
local project id, `openplan`; replace the two explicit container names if your
`supabase status` reports a different project id.

## Capture one recovery point

Choose a private directory outside the repository and make it owner-only:

```bash
OPENPLAN_BACKUP_DIR="/path/you/control/openplan-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$OPENPLAN_BACKUP_DIR"
docker exec supabase_db_openplan pg_dump -U postgres -d postgres --format=custom \
  > "$OPENPLAN_BACKUP_DIR/postgres.dump"
docker exec supabase_storage_openplan sh -c 'cd /mnt && tar -czf - .' \
  > "$OPENPLAN_BACKUP_DIR/storage.tgz"
sha256sum "$OPENPLAN_BACKUP_DIR/postgres.dump" "$OPENPLAN_BACKUP_DIR/storage.tgz" \
  > "$OPENPLAN_BACKUP_DIR/SHA256SUMS"
chmod 600 "$OPENPLAN_BACKUP_DIR"/*
```

Success means all three files exist, both archives are non-empty, and these
read-only checks pass:

```bash
pg_restore --list "$OPENPLAN_BACKUP_DIR/postgres.dump" >/dev/null
tar -tzf "$OPENPLAN_BACKUP_DIR/storage.tgz" >/dev/null
cd "$OPENPLAN_BACKUP_DIR" && sha256sum --check SHA256SUMS
```

Keep a protected copy of deployment configuration and secrets with the same
recovery point, outside the repository and outside chat. Do not put passwords,
service-role keys, private evidence, or resident uploads in a commit.

## Prove the recovery path without touching working data

```bash
npm run ops:restore-drill
```

The drill creates two disposable local Supabase projects on isolated ports,
loads representative tenant rows, evidence custody, and a real private storage
object, backs them up, restores them into the second project, checks hashes and
relationships, and runs the live RLS suite against the restored target. It
never runs `supabase db reset` and never connects to the working local database.
Temporary projects and bytes are removed when it exits.

Run it before a release that changes schema or recovery behavior and at least
quarterly for an operating deployment. A failed drill blocks that deployment's
next upgrade until the failure is understood and the procedure is corrected.

## Restore during a real incident

A restore replaces durable state and is destructive. It requires the deployment
owner's explicit approval.

1. Stop the web app and workers so no new rows or objects arrive.
2. Capture the damaged current state with the steps above for forensic review.
3. Verify both archive hashes and record the selected recovery point.
4. Restore into a new isolated Supabase stack first. Do not experiment against
   the working database.
5. Restore PostgreSQL with `pg_restore` and restore the storage archive into the
   new stack's `/mnt`, preserving paths and permissions.
6. Start the target, verify tenant relationships and representative object
   hashes, then run `npm run test:rls-live` with that target's local environment.
7. Point the app at the restored stack only after those checks pass. Keep the
   old stack stopped and intact until the owner accepts the recovery.

The disposable drill is the executable example of steps 4–6. Exact production
cutover commands depend on the operator's container names and network layout;
do not improvise them against the only copy of the data.
