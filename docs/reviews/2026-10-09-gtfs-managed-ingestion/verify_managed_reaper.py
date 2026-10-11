"""Challenge the service-only reaper in a retained clone of an owned predecessor."""
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json

root = Path(__file__).resolve().parents[3]
config = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2]).resolve()
container = config["container"]
assert container == "supabase_db_openplan-restore-target-2026091050"
assert os.environ.get("OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER") == container
assert re.fullmatch(r"openplan_attempt_cli_[a-f0-9]{32}", config["database"])
out.mkdir(mode=0o700, parents=True, exist_ok=False)
state = json.loads(subprocess.check_output(["docker", "inspect", container], text=True))[0]
settings = dict(v.split("=", 1) for v in state["Config"]["Env"] if "=" in v)
port = state["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"]
connections = []


def connect(database, role=None):
    connection = psycopg2.connect(
        host="127.0.0.1", port=port, dbname=database, user="postgres",
        password=settings["POSTGRES_PASSWORD"], connect_timeout=5,
        options="-c statement_timeout=15000 -c lock_timeout=5000",
    )
    connection.autocommit = True
    connections.append(connection)
    if role:
        query(connection, sql.SQL("SET ROLE {}").format(sql.Identifier(role)))
    return connection


def query(connection, statement, args=None):
    with connection.cursor() as cursor:
        cursor.execute(statement, args)
        return cursor.fetchone()[0] if cursor.description else None


records = []
try:
    control = connect("postgres")
    assert query(control, "SELECT count(*) FROM pg_stat_activity WHERE datname=%s", (config["database"],)) == 0
    database = "openplan_attempt_cli_" + uuid.uuid4().hex
    query(control, sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(
        sql.Identifier(database), sql.Identifier(config["database"])))
    (out / "database.json").write_text(json.dumps({"container": container, "database": database}) + "\n")
    (out / "database.json").chmod(0o600)
    admin = connect(database)
    assert query(admin, "SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs'") == 0
    migrations = []
    for suffix in ["28_gtfs_managed_execution", "29_gtfs_submission_status", "30_gtfs_human_review", "31_gtfs_request_cancellation"]:
        path = root / "openplan/supabase/migrations" / ("202610160000" + suffix + ".sql")
        data = path.read_bytes()
        query(admin, data.decode())
        migrations.append({"path": str(path.relative_to(root)), "sha256": hashlib.sha256(data).hexdigest()})
    service = connect(database, "service_role")
    workspace, actor = str(uuid.uuid4()), str(uuid.uuid4())
    query(admin, "INSERT INTO auth.users(id,email) VALUES(%s,%s)", (actor, actor + "@example.invalid"))
    query(admin, "INSERT INTO public.workspaces(id,name,slug) VALUES(%s,%s,%s)", (workspace, "Synthetic reaper isolation", "reaper-" + workspace))
    query(admin, "INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(%s,%s,'owner')", (workspace, actor))
    admitted = query(service, "SELECT public.admit_gtfs_ingest(%s,%s,%s,NULL,%s)", (
        str(uuid.uuid4()), workspace, actor, Json({"kind": "url", "provisionalName": "Synthetic healthy worker",
        "sourceUrl": "https://example.invalid/feed.zip", "normalizedSourceUrl": "https://example.invalid/feed.zip"})))
    version, token = admitted["versionId"], str(uuid.uuid4())
    query(service, "SELECT public.claim_gtfs_ingest(%s,%s)", (version, token))
    query(service, "SELECT public.stage_gtfs_ingest(%s,%s,'fetching')", (version, token))
    source = (root / migrations[0]["path"]).read_text()
    function = source.split("CREATE OR REPLACE FUNCTION public.reap_gtfs_feed_version", 1)[1].split("CREATE OR REPLACE FUNCTION public.close_failed_gtfs_version", 1)[0]
    function = "CREATE OR REPLACE FUNCTION public.reap_gtfs_feed_version" + function
    snapshot_sql = "SELECT jsonb_build_object('version',to_jsonb(v),'execution',to_jsonb(e),'feed',to_jsonb(f)) FROM public.gtfs_feed_versions v JOIN openplan_gtfs.executions e ON e.version_id=v.id JOIN public.gtfs_feeds f ON f.id=v.feed_id WHERE v.id=%s"
    original = query(admin, snapshot_sql, (version,))
    legacy_feed, legacy_version = str(uuid.uuid4()), str(uuid.uuid4())
    query(admin, "INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(%s,%s,%s)", (legacy_feed, workspace, "Synthetic legacy import"))
    query(admin, "INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status) VALUES(%s,%s,%s,'url','fetching')", (legacy_version, workspace, legacy_feed))

    def healthy():
        assert query(service, "SELECT public.reap_gtfs_feed_version(%s,clock_timestamp()+interval '1 day')", (version,)) is False, "managed-version-reaped"
        assert query(admin, snapshot_sql, (version,)) == original, "managed-state-changed"
        assert query(admin, "SELECT lease_until>clock_timestamp() FROM openplan_gtfs.executions WHERE version_id=%s", (version,)), "live-lease-not-established"

    for name, definition in [("baseline", function), ("harmless-comment", function.replace("-- Managed execution owns", "-- Retained execution owns")), ("restored", function)]:
        query(admin, definition)
        healthy()
        records.append({"case": name, "passed": True})
    assert query(service, "SELECT public.reap_gtfs_feed_version(%s,clock_timestamp()+interval '1 day')", (legacy_version,)) is True, "legacy-reaper-disabled"
    assert query(admin, "SELECT failure_code FROM public.gtfs_feed_versions WHERE id=%s", (legacy_version,)) == "abandoned"
    records.append({"case": "legacy-unmanaged-version", "passed": True})
    guard = "  IF EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id=v.id) THEN\n    RETURN false;\n  END IF;\n"
    assert function.count(guard) == 1
    try:
        for name, definition, code in [
            ("removed-managed-exclusion", function.replace(guard, ""), "55000"),
            ("invoker-private-query", function.replace("SECURITY DEFINER", "SECURITY INVOKER"), "42501"),
        ]:
            query(admin, definition)
            try:
                healthy()
            except psycopg2.Error as error:
                assert error.pgcode == code, (name, error.pgcode)
                records.append({"case": name, "expectedSqlState": code, "passed": True})
            else:
                raise AssertionError("Broken reaper survived: " + name)
            finally:
                query(admin, function)
                healthy()
        for role in ["anon", "authenticated", "service_role"]:
            caller = connect(database, role)
            assert query(admin, "SELECT has_function_privilege(%s,'public.reap_gtfs_feed_version(uuid,timestamptz)','EXECUTE')", (role,)) == (role == "service_role"), "reaper-execute-scope"
            if role != "service_role":
                try:
                    query(caller, "SELECT public.reap_gtfs_feed_version(%s,clock_timestamp()+interval '1 day')", (version,))
                except psycopg2.Error as error:
                    assert error.pgcode == "42501", error.pgcode
                else:
                    raise AssertionError("unauthorized-reaper-executed")
            try:
                query(caller, "SELECT count(*) FROM openplan_gtfs.executions")
            except psycopg2.Error as error:
                assert error.pgcode == "42501", error.pgcode
            else:
                raise AssertionError("Private executions exposed to " + role)
            records.append({"case": role + "-privileges", "passed": True})
        query(admin, "GRANT EXECUTE ON FUNCTION public.reap_gtfs_feed_version(uuid,timestamptz) TO authenticated")
        caller = connect(database, "authenticated")
        assert query(caller, "SELECT public.reap_gtfs_feed_version(%s,clock_timestamp()+interval '1 day')", (version,)) is False
        try:
            assert query(admin, "SELECT has_function_privilege('authenticated','public.reap_gtfs_feed_version(uuid,timestamptz)','EXECUTE')") is False, "reaper-execute-scope"
        except AssertionError as error:
            assert str(error) == "reaper-execute-scope"
            records.append({"case": "opened-authenticated-execute", "expectedAssertion": str(error), "passed": True})
        else:
            raise AssertionError("Opened execute privilege escaped its guard")
    finally:
        query(admin, function)
        healthy()
    report = {"records": records, "migrations": migrations, "managedVersion": version,
        "limits": "Native SQL and privileges on a retained clone of the recorded predecessor. Future cutoff deliberately challenges age eligibility while the lease stays live. No 15-minute wall-clock run, Storage transport, hosted operation, browser or scientific acceptance. No proof database is deleted."}
    (out / "managed-reaper-controls.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Native managed exclusion, legacy cleanup and role boundaries pass; three broken SQL/privilege variants expose their intended violation.")
finally:
    for connection in connections:
        connection.close()
