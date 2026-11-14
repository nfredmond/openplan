#!/usr/bin/env bash
# Turn on TLS in a local Supabase database container so the rehearsal reads it
# with sslmode=verify-full, as the offsite capture reads hosted.
#   rehearsal/enable_local_tls.sh DB_CONTAINER WORK_DIR
# Writes WORK_DIR/tls/ca.crt (a throwaway CA) and a server certificate for
# host.docker.internal, localhost and DB_CONTAINER (the name local_env.py uses
# on the stack's network). Only for a scratch stack.
set -euo pipefail
container=${1:?usage: enable_local_tls.sh DB_CONTAINER WORK_DIR}
work=${2:?usage: enable_local_tls.sh DB_CONTAINER WORK_DIR}
tls="$work/tls"
if [ -e "$tls" ]; then echo "refusing: $tls exists" >&2; exit 2; fi
mkdir -p "$tls"
export MSYS2_ARG_CONV_EXCL='*'
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 \
  -subj "/CN=openplan-rehearsal-ca" -keyout "$tls/ca.key" -out "$tls/ca.crt" 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj "/CN=host.docker.internal" -keyout "$tls/server.key" -out "$tls/server.csr" 2>/dev/null
printf 'subjectAltName=DNS:host.docker.internal,DNS:localhost,DNS:%s,IP:127.0.0.1\n' "$container" > "$tls/san.ext"
openssl x509 -req -in "$tls/server.csr" -CA "$tls/ca.crt" -CAkey "$tls/ca.key" -CAcreateserial \
  -days 30 -extfile "$tls/san.ext" -out "$tls/server.crt" 2>/dev/null
docker exec -u root "$container" mkdir -p /var/lib/postgresql/rehearsal-tls
docker cp "$tls/server.crt" "$container:/var/lib/postgresql/rehearsal-tls/server.crt"
docker cp "$tls/server.key" "$container:/var/lib/postgresql/rehearsal-tls/server.key"
docker exec -u root "$container" sh -c 'chown -R postgres:postgres /var/lib/postgresql/rehearsal-tls && chmod 600 /var/lib/postgresql/rehearsal-tls/server.key'
docker exec -i -u postgres "$container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1' <<'SQL'
ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/rehearsal-tls/server.crt';
ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/rehearsal-tls/server.key';
ALTER SYSTEM SET ssl = on;
SELECT pg_reload_conf();
SQL
sleep 2
docker exec -u postgres "$container" psql -X -At -d postgres -c 'show ssl'
