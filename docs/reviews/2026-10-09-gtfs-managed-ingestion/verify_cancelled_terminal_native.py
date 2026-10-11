"""Recover exact terminal journals after real SQL cancellation in an owned database."""
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[2]
sys.path.insert(0, str(here.parent / "2026-10-08-model-custody-metadata/prototype"))
from isolated_postgrest import gateway

config = json.loads(Path(sys.argv[1]).read_text())
assert config["container"] == "supabase_db_openplan-restore-target-2026091050"
assert os.environ.get("OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER") == config["container"]
assert re.fullmatch(r"openplan_attempt_cli_[a-f0-9]{32}", config["database"])
out = Path(sys.argv[2]).resolve()
out.mkdir(mode=0o700, parents=True, exist_ok=False)


def query(statement):
    result = subprocess.run(["docker", "exec", "-i", config["container"], "psql", "-U", "postgres",
        "-d", config["database"], "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr[:1500]
    return result.stdout.strip()


assert query("SELECT to_regclass('openplan_gtfs.executions') IS NOT NULL;") == "t"
workspace, actor = str(uuid.uuid4()), str(uuid.uuid4())
query(f"INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid'); INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic cancelled terminal','terminal-{workspace}'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');")
attempt = root / "openplan/src/lib/gtfs/managed-worker-attempt.ts"
original = attempt.read_text()
guard = '    if (snapshot.state === "cancelled") return { state: "observed_terminal" as const, snapshot };\n'
assert original.count(guard) == 1
records = []
try:
    with gateway("public", database=config["database"]) as rest:
        env = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=512",
            "OPENPLAN_PROOF_HTTP_URL": rest["url"], "OPENPLAN_PROOF_HTTP_TOKEN": rest["service_token"],
            "OPENPLAN_PROOF_WORKSPACE": workspace, "OPENPLAN_PROOF_ACTOR": actor}
        for name, operation, source, passes in [
            ("baseline", "fail", original, True),
            ("harmless-comment", "complete", original.replace("// Cancellation supersedes", "// Recorded cancellation supersedes"), True),
            ("cancelled-command-replayed", "fail", original.replace(guard, ""), False),
            ("restored", "complete", original, True),
        ]:
            attempt.write_text(source)
            result = subprocess.run(["node", "--import", str(root / "openplan/node_modules/tsx/dist/loader.mjs"),
                str(here / "verify_cancelled_terminal_native.mts"), str(out / name), operation],
                cwd=root / "openplan", env=env, text=True, capture_output=True, timeout=45)
            (out / (name + ".log")).write_text(result.stdout + result.stderr)
            assert (result.returncode == 0) == passes, (name, result.stderr[-1500:])
            if passes:
                payload = json.loads(result.stdout.strip().splitlines()[-1])
                version = str(uuid.UUID(payload["versionId"]))
                native = json.loads(query(f"SELECT jsonb_build_object('state',e.state,'attempt',e.attempt,'token',e.token,'versionStatus',v.status,'failureCode',v.failure_code,'current',v.is_current,'claims',(SELECT count(*) FROM openplan_gtfs.claims WHERE version_id=e.version_id),'routes',(SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=e.version_id),'stops',(SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id=e.version_id)) FROM openplan_gtfs.executions e JOIN public.gtfs_feed_versions v ON v.id=e.version_id WHERE v.id='{version}';"))
                assert native == {"state": "cancelled", "attempt": 1, "token": None, "versionStatus": "failed",
                    "failureCode": "abandoned", "current": False, "claims": 1, "routes": 0, "stops": 0}, native
                records.append({"case": name, "exitCode": 0, "passed": True, "worker": payload, "native": native})
            else:
                assert "GTFS worker acknowledgement unavailable" in result.stderr, result.stderr[-1500:]
                records.append({"case": name, "exitCode": result.returncode, "passed": True,
                    "expectedFailure": "GTFS worker acknowledgement unavailable on replay against cancelled SQL execution"})
            attempt.write_text(original)
finally:
    attempt.write_text(original)
    assert attempt.read_text() == original

paths = ["openplan/src/lib/gtfs/managed-worker-attempt.ts", "openplan/src/lib/gtfs/managed-worker-queue.ts",
    "openplan/scripts/workers/gtfs-ingestion.ts", "openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql"]
(out / "cancelled-terminal-native.json").write_text(json.dumps({"records": records,
    "sourceSha256": {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in paths},
    "limits": "Actual isolated PostgREST/SQL claims and cancellation, private journals and fresh Node processes. The terminal transport is deliberately interrupted before SQL terminal delivery. Complete commands contain synthetic unpublished evidence. This is not parser publication, hosted commissioning, power-loss durability, browser or scientific acceptance."}, indent=2) + "\n")
print("Native cancelled fail/complete journal recovery passes three positive cases; removed cancellation precedence fails as intended.")
