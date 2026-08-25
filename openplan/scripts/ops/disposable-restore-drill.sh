#!/usr/bin/env bash
set -euo pipefail

# Builds two temporary local Supabase projects with different ports. It never
# stops, resets, migrates, or restores into the working `openplan` stack.
APP_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DRILL_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/openplan-restore-drill.XXXXXX")
SOURCE_ROOT="$DRILL_ROOT/openplan-restore-source-$$"
TARGET_ROOT="$DRILL_ROOT/openplan-restore-target-$$"
BACKUP_ROOT="$DRILL_ROOT/backup"
SOURCE_PROJECT=$(basename "$SOURCE_ROOT")
TARGET_PROJECT=$(basename "$TARGET_ROOT")

cleanup() {
  npm exec -- supabase stop --project-id "$SOURCE_PROJECT" --no-backup >/dev/null 2>&1 || true
  npm exec -- supabase stop --project-id "$TARGET_PROJECT" --no-backup >/dev/null 2>&1 || true
  case "$DRILL_ROOT" in
    "${TMPDIR:-/tmp}"/openplan-restore-drill.*)
      find "$DRILL_ROOT" -depth -mindepth 1 -delete 2>/dev/null || true
      rmdir -- "$DRILL_ROOT" 2>/dev/null || true
      ;;
    *)
      echo "[restore-drill] refused cleanup outside the drill prefix: $DRILL_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT

make_project() {
  local destination=$1
  local api_port=$2
  local db_port=$3
  local shadow_port=$4
  local studio_port=$5
  local mail_port=$6
  local analytics_port=$7
  mkdir -p "$destination/supabase/migrations"
  cp "$APP_ROOT/supabase/config.toml" "$destination/supabase/config.toml"
  cp "$APP_ROOT"/supabase/migrations/*.sql "$destination/supabase/migrations/"
  sed -i \
    -e "0,/port = 54321/s//port = $api_port/" \
    -e "0,/port = 54322/s//port = $db_port/" \
    -e "0,/shadow_port = 54320/s//shadow_port = $shadow_port/" \
    -e "0,/port = 54323/s//port = $studio_port/" \
    -e "0,/port = 54324/s//port = $mail_port/" \
    -e "0,/port = 54327/s//port = $analytics_port/" \
    "$destination/supabase/config.toml"
}

status_value() {
  local workdir=$1
  local key=$2
  npm exec -- supabase status --workdir "$workdir" -o env 2>/dev/null \
    | sed -n "s/^${key}=\"\(.*\)\"$/\1/p" \
    | head -1
}

db_container() {
  local project=$1
  docker ps --filter "label=com.supabase.cli.project=$project" --format '{{.Names}}' \
    | sed -n '/^supabase_db_/p' \
    | head -1
}

start_project() {
  local workdir=$1
  npm exec -- supabase start --workdir "$workdir" \
    --exclude realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
    --yes >/dev/null
  npm exec -- supabase migration up --workdir "$workdir" --local --yes >/dev/null
}

mkdir -p "$BACKUP_ROOT/storage/kb-documents"
make_project "$SOURCE_ROOT" 56321 56322 56320 56323 56324 56327
make_project "$TARGET_ROOT" 57321 57322 57320 57323 57324 57327

echo "[restore-drill] starting disposable source stack $SOURCE_PROJECT"
start_project "$SOURCE_ROOT"
SOURCE_DB=$(db_container "$SOURCE_PROJECT")
SOURCE_API=$(status_value "$SOURCE_ROOT" API_URL)
SOURCE_SERVICE_KEY=$(status_value "$SOURCE_ROOT" SERVICE_ROLE_KEY)
test -n "$SOURCE_DB" && test -n "$SOURCE_API" && test -n "$SOURCE_SERVICE_KEY"

OBJECT_PATH="00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-00000000000d/recovery-evidence.txt"
OBJECT_FILE="$BACKUP_ROOT/storage/kb-documents/recovery-evidence.txt"
printf '%s\n' 'OpenPlan disposable recovery evidence' > "$OBJECT_FILE"
OBJECT_HASH=$(sha256sum "$OBJECT_FILE" | cut -d' ' -f1)
OBJECT_SIZE=$(wc -c < "$OBJECT_FILE" | tr -d ' ')

docker exec -i "$SOURCE_DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v object_hash="$OBJECT_HASH" -v object_size="$OBJECT_SIZE" <<'SQL'
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-4000-8000-000000000001', 'restore-probe@openplan.test');
INSERT INTO workspaces (id, name, slug)
VALUES ('00000000-0000-4000-8000-00000000000a', 'Restore Probe Workspace', 'restore-probe');
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', 'owner');
INSERT INTO workspace_reminder_preferences (workspace_id, advance_days, email_digest_enabled)
VALUES ('00000000-0000-4000-8000-00000000000a', 14, false);
INSERT INTO modeling_worker_heartbeats (
  worker_kind, instance_id, supported_stages, runtime_mode, worker_version,
  started_at, last_successful_heartbeat_at
) VALUES (
  'aequilibrae', 'restore-probe-worker',
  ARRAY['AequilibraE Setup', 'Network Assignment', 'Artifact Extraction'],
  'poll', 'restore-probe', now(), now()
);
INSERT INTO safety_crash_ingests (
  id, workspace_id, min_lon, min_lat, max_lon, max_lat, source_id, source_label,
  attribution, coverage_state, severity_completeness, status,
  published_through, published_through_provenance
) VALUES (
  '00000000-0000-4000-8000-000000000015',
  '00000000-0000-4000-8000-00000000000a', -121.3, 39.1, -120.0, 39.6,
  'ccrs-ca', 'Restore drill crash source', 'Restore drill fixture',
  'ccrs_ca_statewide', 'fatal_injury_only', 'ready',
  '2023-12-31', jsonb_build_object('basis', 'restore_drill_fixture', 'label', 'Exact cutoff fixture')
);
INSERT INTO projects (id, workspace_id, name)
VALUES ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a', 'Restore Probe Project');
INSERT INTO kb_documents (
  id, workspace_id, project_id, uploaded_by, title, doc_kind, source_kind,
  original_filename, content_type, byte_size, storage_ref, checksum, status, citation_label
) VALUES (
  '00000000-0000-4000-8000-00000000000d',
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-000000000001',
  'Recovery evidence', 'prior_study', 'uploaded_txt', 'recovery-evidence.txt',
  'text/plain', :'object_size',
  'storage://kb-documents/00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-00000000000d/recovery-evidence.txt',
  :'object_hash', 'ready', 'Recovery evidence'
);
INSERT INTO kb_document_chunks (
  id, document_id, workspace_id, chunk_index, char_start, char_end, content, token_estimate
) VALUES (
  '00000000-0000-4000-8000-00000000000e',
  '00000000-0000-4000-8000-00000000000d',
  '00000000-0000-4000-8000-00000000000a', 0, 0, 36,
  'OpenPlan disposable recovery evidence', 5
);
INSERT INTO reports (id, workspace_id, project_id, title, report_type, status, created_by)
VALUES (
  '00000000-0000-4000-8000-00000000000f',
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
  'Recovery evidence report', 'analysis_summary', 'generated',
  '00000000-0000-4000-8000-000000000001'
);
INSERT INTO report_artifacts (
  id, report_id, artifact_kind, storage_path, generated_by, metadata_json
) VALUES (
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-00000000000f', 'html',
  'report-artifacts/restore-probe.html',
  '00000000-0000-4000-8000-000000000001',
  jsonb_build_object('evidenceCustody', jsonb_build_object('sha256', :'object_hash', 'documentId', '00000000-0000-4000-8000-00000000000d'))
);
SQL

curl --fail --silent --show-error \
  -X POST "$SOURCE_API/storage/v1/object/kb-documents/$OBJECT_PATH" \
  -H "Authorization: Bearer $SOURCE_SERVICE_KEY" \
  -H "apikey: $SOURCE_SERVICE_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "@$OBJECT_FILE" >/dev/null

docker exec "$SOURCE_DB" pg_dump -U postgres -d postgres \
  --data-only --inserts --column-inserts --on-conflict-do-nothing \
  --table=auth.users \
  --table=public.workspaces \
  --table=public.workspace_members \
  --table=public.workspace_reminder_preferences \
  --table=public.modeling_worker_heartbeats \
  --table=public.safety_crash_ingests \
  --table=public.projects \
  --table=public.kb_documents \
  --table=public.kb_document_chunks \
  --table=public.reports \
  --table=public.report_artifacts \
  > "$BACKUP_ROOT/representative-data.sql"
test -s "$BACKUP_ROOT/representative-data.sql"
printf '{"bucket":"kb-documents","path":"%s","sha256":"%s","bytes":%s}\n' \
  "$OBJECT_PATH" "$OBJECT_HASH" "$OBJECT_SIZE" > "$BACKUP_ROOT/storage-manifest.json"

curl --fail --silent --show-error \
  "$SOURCE_API/storage/v1/object/authenticated/kb-documents/$OBJECT_PATH" \
  -H "Authorization: Bearer $SOURCE_SERVICE_KEY" \
  -H "apikey: $SOURCE_SERVICE_KEY" \
  -o "$BACKUP_ROOT/source-download.txt"
test "$(sha256sum "$BACKUP_ROOT/source-download.txt" | cut -d' ' -f1)" = "$OBJECT_HASH"

echo "[restore-drill] starting isolated restore target $TARGET_PROJECT"
start_project "$TARGET_ROOT"
TARGET_DB=$(db_container "$TARGET_PROJECT")
TARGET_API=$(status_value "$TARGET_ROOT" API_URL)
TARGET_SERVICE_KEY=$(status_value "$TARGET_ROOT" SERVICE_ROLE_KEY)
test -n "$TARGET_DB" && test -n "$TARGET_API" && test -n "$TARGET_SERVICE_KEY"

{
  printf '%s\n' 'SET session_replication_role = replica;'
  cat "$BACKUP_ROOT/representative-data.sql"
  printf '%s\n' 'SET session_replication_role = origin;'
} | docker exec -i "$TARGET_DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null
curl --fail --silent --show-error \
  -X POST "$TARGET_API/storage/v1/object/kb-documents/$OBJECT_PATH" \
  -H "Authorization: Bearer $TARGET_SERVICE_KEY" \
  -H "apikey: $TARGET_SERVICE_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "@$OBJECT_FILE" >/dev/null
curl --fail --silent --show-error \
  "$TARGET_API/storage/v1/object/authenticated/kb-documents/$OBJECT_PATH" \
  -H "Authorization: Bearer $TARGET_SERVICE_KEY" \
  -H "apikey: $TARGET_SERVICE_KEY" \
  -o "$BACKUP_ROOT/target-download.txt"
test "$(sha256sum "$BACKUP_ROOT/target-download.txt" | cut -d' ' -f1)" = "$OBJECT_HASH"

RESTORED_STORAGE=$(docker exec -i "$TARGET_DB" psql -U postgres -d postgres -tA \
  -v ON_ERROR_STOP=1 -v object_path="$OBJECT_PATH" -v object_size="$OBJECT_SIZE" <<'SQL'
SELECT count(*) FROM storage.objects
WHERE bucket_id = 'kb-documents'
  AND name = :'object_path'
  AND (metadata->>'size')::bigint = :'object_size';
SQL
)
test "$RESTORED_STORAGE" = "1"

RESTORED=$(docker exec "$TARGET_DB" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) || ':' || bool_and(k.checksum = r.metadata_json #>> '{evidenceCustody,sha256}')
   FROM workspaces w
   JOIN workspace_members wm ON wm.workspace_id = w.id
   JOIN projects p ON p.workspace_id = w.id
   JOIN kb_documents k ON k.project_id = p.id
   JOIN kb_document_chunks c ON c.document_id = k.id
   JOIN reports x ON x.project_id = p.id
   JOIN report_artifacts r ON r.report_id = x.id
   WHERE w.id = '00000000-0000-4000-8000-00000000000a';")
test "$RESTORED" = "1:true"

RESTORED_V032=$(docker exec "$TARGET_DB" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c \
  "SELECT
     (SELECT count(*) FROM workspace_reminder_preferences WHERE workspace_id = '00000000-0000-4000-8000-00000000000a' AND advance_days = 14 AND NOT email_digest_enabled)
     || ':' ||
     (SELECT count(*) FROM modeling_worker_heartbeats WHERE instance_id = 'restore-probe-worker')
     || ':' ||
     (SELECT count(*) FROM safety_crash_ingests WHERE id = '00000000-0000-4000-8000-000000000015' AND published_through = DATE '2023-12-31');")
test "$RESTORED_V032" = "1:1:1"

echo "[restore-drill] hashes and relationships restored; running live RLS against the target"
OPENPLAN_SUPABASE_WORKDIR="$TARGET_ROOT" npm run test:rls-live >/dev/null
echo "[restore-drill] PASS database rows, evidence custody, storage bytes, relationships, and live RLS"
