"""Apply the complete candidate to a fresh main dump and restore its originals."""
import argparse
import hashlib
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "openplan/supabase/migrations/20261017000003_aerial_private_dispatch_custody.sql"


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("receipt", type=Path)
    parser.add_argument("main_backup", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    receipt = json.loads(args.receipt.read_text())
    container = receipt["id"]
    backup = args.main_backup.read_bytes()
    original = MIGRATION.read_bytes()
    rows = []

    def info():
        data = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
        assert data["Id"] == container and data["Name"] == "/openplan_odm_dispatch_database_20261011_02"
        assert data["Config"]["Labels"]["openplan.purpose"] == "odm-private-dispatch-producer-20261011-02"
        host = data["HostConfig"]
        assert host["Memory"] == 1073741824 and host["MemorySwap"] == 1073741824 and host["NetworkMode"] == "none"
        return data

    def command(arguments, name, data=None):
        result = subprocess.run(arguments, input=data, capture_output=True, timeout=90)
        (out / (name + "-private.log")).write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0, name
        return result.stdout

    def sql(database, query, name):
        return command(["docker", "exec", "-i", container, "psql", "-XqAt", "-U", "postgres", "-d", database,
                        "-v", "ON_ERROR_STOP=1"], name, query.encode()).decode().strip()

    def fresh(name, content):
        database = "dispatch_restore_" + uuid.uuid4().hex
        sql("postgres", "CREATE DATABASE " + database + " TEMPLATE template0 OWNER postgres ENCODING 'UTF8';", name + "-create")
        command(["docker", "exec", "-i", container, "pg_restore", "-U", "supabase_admin", "-d", database,
                 "--exit-on-error", "--single-transaction"], name + "-restore-main", backup)
        assert sql(database, "SELECT count(*),max(version),to_regnamespace('openplan_odm_private') IS NULL FROM supabase_migrations.schema_migrations;", name + "-main-history") == "405|20261017000001|t"
        sql(database, "BEGIN;\n" + content + "\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20261017000003','aerial_private_dispatch_custody',ARRAY[]::text[]);\nCOMMIT;", name + "-apply-candidate")
        assert sql(database, "SELECT count(*),max(version) FROM supabase_migrations.schema_migrations;", name + "-candidate-history") == "406|20261017000003"
        return database

    def seed(database, name):
        actor, workspace, project, mission, job = [str(uuid.uuid4()) for _ in range(5)]
        request = "dispatch-restore-" + uuid.uuid4().hex
        payload = json.dumps({"schemaVersion": "natford-aerial-processing.v1", "requestId": request,
            "callbackUrl": "https://app.example.invalid/callback", "missionTitle": "Synthetic étude aérienne",
            "externalRef": {"system": "openplan", "workspaceId": workspace, "projectId": project, "missionId": mission},
            "imagery": {"type": "zip_url", "url": "https://source.example.invalid/photos.zip?private=original"}}, ensure_ascii=False, indent=2) + "\n"
        statement = f"""
INSERT INTO auth.users(id,email) VALUES ({quote(actor)},{quote(actor+'@example.invalid')});
INSERT INTO public.workspaces(id,name,slug) VALUES ({quote(workspace)},'Synthetic dispatch restore',{quote(workspace)});
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ({quote(workspace)},{quote(actor)},'owner');
INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES ({quote(project)},{quote(workspace)},'Synthetic restore project',{quote(actor)});
INSERT INTO public.aerial_missions(id,workspace_id,project_id,title) VALUES ({quote(mission)},{quote(workspace)},{quote(project)},'Synthetic restore mission');
INSERT INTO public.aerial_processing_jobs(id,workspace_id,project_id,mission_id,request_id,imagery_url,created_by) VALUES ({quote(job)},{quote(workspace)},{quote(project)},{quote(mission)},{quote(request)},'https://source.example.invalid/photos.zip',{quote(actor)});
"""
        record = "SELECT public.record_aerial_original_dispatch(" + ",".join(map(quote, [job, actor, "installation-native-1", "database-native-1", payload])) + ");"
        value = json.loads(sql(database, "BEGIN;" + statement + "SET LOCAL ROLE service_role;" + record + "COMMIT;", name + "-record"))
        assert value["payloadText"] == payload and value["payloadBytes"] == len(payload.encode())
        return payload, value, "SELECT public.read_aerial_original_dispatch(" + ",".join(map(quote, [request, "installation-native-1", "database-native-1"])) + ");"

    def schema(database, name):
        raw = command(["docker", "exec", container, "pg_dump", "-U", "supabase_admin", "-d", database, "--schema-only"], name).decode()
        return "\n".join(line for line in raw.splitlines() if line.strip() and not line.startswith(("--", "\\restrict ", "\\unrestrict ")))

    def check_hash(value, payload):
        assert value["payloadSha256"] == hashlib.sha256(payload.encode()).hexdigest(), "Exact original hash"

    try:
        assert not info()["State"]["Running"]
        subprocess.run(["docker", "start", container], check=True, stdout=subprocess.DEVNULL)
        for _ in range(120):
            if subprocess.run(["docker", "exec", container, "pg_isready", "-U", "supabase_admin"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise TimeoutError("Native restore database readiness")
        for name, altered, broken in [("baseline", original.decode(), False), ("harmless", "-- Harmless restore control.\n" + original.decode(), False),
            ("wrong-generated-hash", original.decode().replace("extensions.digest(payload_text, 'sha256')", "extensions.digest(payload_text, 'md5')"), True), ("restored", original.decode(), False)]:
            database = fresh(name, altered)
            payload, value, read = seed(database, name)
            if broken:
                try:
                    check_hash(value, payload)
                except AssertionError as error:
                    assert str(error) == "Exact original hash", "Intended generated digest refusal"
                else:
                    raise AssertionError("Broken generated digest survived the original hash check")
                rows.append({"name": name, "result": "intended original hash mismatch", "database": database})
                continue
            check_hash(value, payload)
            dump = command(["docker", "exec", container, "pg_dump", "-U", "supabase_admin", "-d", database, "-Fc"], name + "-capture-candidate")
            (out / (name + "-candidate-private.dump")).write_bytes(dump)
            target = "dispatch_restored_" + uuid.uuid4().hex
            sql("postgres", "CREATE DATABASE " + target + " TEMPLATE template0 OWNER postgres ENCODING 'UTF8';", name + "-create-target")
            command(["docker", "exec", "-i", container, "pg_restore", "-U", "supabase_admin", "-d", target, "--exit-on-error", "--single-transaction"], name + "-restore-target", dump)
            actual = json.loads(sql(target, "BEGIN; SET LOCAL ROLE service_role;" + read + "ROLLBACK;", name + "-read-target"))
            observed = {key: value for key, value in actual.items() if key not in ["authorizedNow", "authorityObservedAt"]}
            assert observed == value and actual["authorizedNow"] is True and actual["engineTransportPermission"] is False, "Restored original receipt and current role"
            assert schema(database, name + "-source-schema") == schema(target, name + "-target-schema"), "Restored schema, ACLs and functions"
            query = "SELECT jsonb_agg(to_jsonb(t) ORDER BY job_id) FROM openplan_odm_private.original_dispatches t;"
            assert sql(database, query, name + "-source-records") == sql(target, query, name + "-target-records"), "Restored private rows including recorded time"
            rows.append({"name": name, "result": "survived", "database": database, "restoredDatabase": target, "dumpSha256": hashlib.sha256(dump).hexdigest()})
            print(name + ": " + rows[-1]["result"], flush=True)
        assert args.main_backup.read_bytes() == backup and MIGRATION.read_bytes() == original
        (out / "restore.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "selectedMainBackupSha256": hashlib.sha256(backup).hexdigest(),
            "controls": rows, "scope": "Complete candidate SQL application and pg_dump/pg_restore within one isolated capped cluster. UTF-8 originals, private rows, schema and ACL replay. Manual history records; no CLI, encrypted installation point, Storage/worker alignment, offsite/physical-host, hosted or browser acceptance."}, indent=2) + "\n")
    finally:
        data = info()
        (out / "container-before-stop.json").write_text(json.dumps({"oomKilled": data["State"]["OOMKilled"], "memoryLimit": data["HostConfig"]["Memory"], "swapLimit": data["HostConfig"]["MemorySwap"]}) + "\n")
        subprocess.run(["docker", "stop", "--time", "10", container], check=True, stdout=subprocess.DEVNULL)
        assert not info()["State"]["Running"] and MIGRATION.read_bytes() == original
        (out / "partial-controls.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
