#!/bin/sh
# PREPARED ONLY. ROOT must review and authorize the bounded owning invocation.
set -eu
export LANG=C LC_ALL=C PGDATA=/compiler/pgdata
/usr/lib/postgresql/bin/initdb -D /compiler/pgdata --username=m424_compiler --encoding=UTF8 --locale=C --auth-local=trust --auth-host=reject --no-sync
exec /usr/lib/postgresql/bin/postgres --single -j -D /compiler/pgdata \
  -c shared_buffers=16MB -c work_mem=1MB -c maintenance_work_mem=16MB \
  -c max_connections=4 -c max_worker_processes=0 -c max_parallel_workers=0 \
  -c listen_addresses= -c unix_socket_directories= \
  -c shared_preload_libraries= -c session_preload_libraries= -c local_preload_libraries= \
  -c jit=off -c statement_timeout=10000 -c log_min_messages=notice -c log_error_verbosity=verbose \
  postgres < /inputs/compiler.sql
