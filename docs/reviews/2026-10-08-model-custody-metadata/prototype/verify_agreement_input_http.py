"""Read and retain agreement inputs through owned installed PostgREST and files."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
from types import FunctionType
import uuid
from unittest.mock import patch
import requests
from isolated_postgrest import gateway

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
sys.path.insert(0, str(REPO / "workers/aequilibrae_worker"))
import test_activitysim_assignment_handoff as fixtures


def verify(output):
    source = json.loads(Path(os.environ["OPENPLAN_MODEL_COMMAND_PROOF_METADATA"]).read_text())
    if source["container"] != "supabase_db_openplan-restore-target-2026091050" or not re.fullmatch(r"openplan_retention_upgrade_[0-9a-f]{32}", source["database"]):
        raise ValueError("Select owned installed proof source")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    database = "openplan_attempt_cli_" + uuid.uuid4().hex
    def sql(db, body):
        result = subprocess.run(["docker", "exec", "-i", source["container"], "psql", "-X", "-qAt",
            "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"], input=body,
            text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    if sql("postgres", f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != "0":
        raise RuntimeError("Source has active sessions")
    sql("postgres", f"CREATE DATABASE {database} TEMPLATE {source['database']};")
    (output / "candidate.json").write_text(json.dumps({"container": source["container"], "database": database,
        "source_database": source["database"]}, indent=2) + "\n")
    if sql(database, "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000021';") != "1":
        raise AssertionError("Installed migration21 required")
    worker = fixtures.main
    metadata = worker.assignment_artifact_metadata(fixtures.identity_record(0.0004), "link_volumes.csv")
    keys = ("assignment_profile", "assignment_profile_payload_json", "assignment_profile_digest", "network_settings",
            "network_settings_payload_json", "network_settings_digest", "network_state_record", "network_state_digest")
    kwargs = {"expected_" + key: metadata[key] for key in keys}
    fixture = str(uuid.UUID(source["fixture_run"]))
    work = output / "files"
    cases = []
    quote = lambda value: "'" + value.replace("'", "''") + "'"
    for mode in ("managed_completed", "managed_running", "managed_failed", "legacy_completed"):
        run, stage, artifact = [str(uuid.uuid4()) for _ in range(3)]
        sql(database, f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic agreement HTTP',created_by
 FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 VALUES('{stage}','{run}','Synthetic predecessor','queued',1);
""")
        path = work / "runs" / run / "producer.csv"
        path.parent.mkdir(parents=True)
        content = b"link_id,PCE_tot\n1,10\n"
        path.write_bytes(content)
        payload = {"id": artifact, "artifact_type": "link_volumes", "file_url": "local://" + str(path),
                   "file_size_bytes": len(content), "content_hash": hashlib.sha256(content).hexdigest(),
                   "metadata_json": metadata}
        if mode.startswith("managed"):
            claim = json.loads(sql(database, f"SET ROLE service_role; SELECT public.claim_model_stage_attempt('{uuid.uuid4()}','{stage}','native-agreement-proof');"))
            attempt = str(uuid.UUID(claim["attempt_id"]))
            sql(database, f"SET ROLE service_role; SELECT public.write_model_attempt_artifact('{uuid.uuid4()}','{attempt}',{quote(json.dumps(payload))}::jsonb);")
            if mode != "managed_running":
                status = "failed" if mode == "managed_failed" else "succeeded"
                error = "'Synthetic failure'" if status == "failed" else "NULL"
                sql(database, f"SET ROLE service_role; SELECT public.write_model_stage_attempt('{uuid.uuid4()}','{attempt}','{status}','Synthetic predecessor', {error});")
        else:
            sql(database, f"""
UPDATE public.model_run_stages SET status='succeeded' WHERE id='{stage}';
INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json)
 VALUES('{artifact}','{run}','{stage}','link_volumes',{quote(payload['file_url'])},{len(content)},
 {quote(payload['content_hash'])},{quote(json.dumps(metadata))}::jsonb);
""")
        cases.append({"mode": mode, "run": run, "stage": stage, "artifact": artifact, "path": path, "content": content})
    calls = []
    outcomes = []
    member = str(uuid.UUID(sql(database, f"SELECT wm.user_id FROM public.workspace_members wm JOIN public.model_runs r ON r.workspace_id=wm.workspace_id WHERE r.id='{fixture}' LIMIT 1;")))
    outsider = str(uuid.uuid4())
    if sql(database, f"SELECT count(*) FROM public.workspace_members WHERE user_id='{outsider}';") != "0":
        raise AssertionError("Synthetic outsider unexpectedly has membership")
    def database_snapshot():
        tables = ("model_runs", "model_run_stages", "model_stage_attempts", "model_run_artifacts",
                  "model_stage_claim_receipts", "model_stage_write_receipts", "model_artifact_write_receipts")
        return {table: sql(database, f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
    before = database_snapshot()
    client_reads = []
    with gateway("public", database=database, subjects=(member, outsider)) as connection:
        key = connection["service_token"]
        class Bridge(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                path = self.path.removeprefix("/rest/v1")
                if not path.startswith("/model_run_artifacts?") or self.headers.get("Authorization") != "Bearer " + key:
                    self.send_error(403)
                    return
                with requests.get(connection["url"] + path, headers={"Authorization": "Bearer " + key}, timeout=15) as response:
                    status, body = response.status_code, response.content
                calls.append(status)
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        server = HTTPServer(("127.0.0.1", 0), Bridge)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        original = worker.require_completed_artifact_producer
        guard_source = inspect.getsource(original)
        try:
            with patch.object(worker, "SUPABASE_URL", f"http://127.0.0.1:{server.server_port}"), patch.object(
                worker, "HEADERS", {"Authorization": "Bearer " + key}), patch.object(worker, "RUN_WORK_ROOT", str(work)):
                for control in ("baseline", "harmless", "ignore-completion", "restored"):
                    candidate = guard_source + ("\n# Harmless comment.\n" if control == "harmless" else "")
                    if control == "ignore-completion":
                        candidate = candidate.replace('or producer.get("status") != "succeeded"', 'or False')
                        if candidate == guard_source:
                            raise AssertionError("Completion mutation anchor missing")
                    namespace = dict(worker.__dict__)
                    exec(compile(candidate, "<native-producer-control>", "exec"), namespace)
                    worker.require_completed_artifact_producer = FunctionType(namespace[original.__name__].__code__, worker.__dict__)
                    for case in cases:
                        directory = case["path"].parent / control
                        directory.mkdir()
                        accepted = False
                        try:
                            result = Path(worker.verified_latest_local_artifact(case["run"], "link_volumes",
                                retained_directory=str(directory), **kwargs))
                        except RuntimeError as error:
                            if "confirmed completed producer" not in str(error):
                                raise
                        else:
                            if result.parent != directory or result.read_bytes() != case["content"] or result.stat().st_ino == case["path"].stat().st_ino:
                                raise AssertionError("Native input did not retain independent bytes")
                            accepted = True
                        expected = case["mode"].endswith("completed")
                        if control == "ignore-completion":
                            # An actual running producer must be admitted by this broken guard.
                            if case["mode"] == "managed_running" and not accepted:
                                raise AssertionError("Completion fault did not expose native running input")
                        elif accepted != expected:
                            raise AssertionError("Native producer acceptance differs: " + case["mode"])
                        outcomes.append({"control": control, "mode": case["mode"], "accepted": accepted})
                missing = worker.sb_get_run_artifacts(str(uuid.uuid4()))
                if missing != []:
                    raise AssertionError("Run-scoped query returned unrelated artifacts")
                # Service-role read is a worker capability. An anonymous client must not see these rows.
                with requests.get(connection["url"] + "/model_run_artifacts", params={"run_id": "eq." + cases[0]["run"]},
                    headers={"Authorization": "Bearer " + connection["anon_token"]}, timeout=15) as response:
                    if response.status_code == 200:
                        if response.json() != []:
                            raise AssertionError("Anonymous client read private model artifacts")
                    elif response.status_code not in (401, 403):
                        raise AssertionError("Anonymous read failed for an unexpected reason")
                    anon_status = response.status_code
                projection = "id,run_id,stage_id,attempt_id,file_size_bytes,model_run_stages(id,run_id,status,attempt_managed,active_attempt_id)"
                for role, subject, expected_count in (("member", member, 1), ("outsider", outsider, 0)):
                    with requests.get(connection["url"] + "/model_run_artifacts", params={"run_id": "eq." + cases[0]["run"], "select": projection},
                        headers={"Authorization": "Bearer " + connection["authenticated_tokens"][subject]}, timeout=15) as response:
                        if response.status_code != 200:
                            raise AssertionError("Authenticated projection failed: " + role)
                        rows = response.json()
                        if not isinstance(rows, list) or len(rows) != expected_count:
                            raise AssertionError("Authenticated artifact visibility differs: " + role)
                        if expected_count and (rows[0]["id"] != cases[0]["artifact"] or rows[0]["model_run_stages"]["id"] != cases[0]["stage"]):
                            raise AssertionError("Member received a different artifact or producer")
                        client_reads.append({"role": role, "status": response.status_code, "row_count": len(rows)})
        finally:
            worker.require_completed_artifact_producer = original
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    if database_snapshot() != before:
        raise AssertionError("Agreement reads changed native model records")
    result = {"source_sha256": hashlib.sha256((REPO / "workers/aequilibrae_worker/main.py").read_bytes()).hexdigest(),
              "cases": outcomes, "http_read_count": len(calls), "http_statuses": sorted(set(calls)),
              "anonymous_status": anon_status, "authenticated_reads": client_reads, "native_record_checksums_unchanged": True, "limits": "Installed owned clone, actual normal worker read, native files and member versus nonmember read cases. No exhaustive RLS matrix, concurrent revocation fencing, complete dispatch or scientific acceptance."}
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    (ROOT / "agreement-input-http.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve())
