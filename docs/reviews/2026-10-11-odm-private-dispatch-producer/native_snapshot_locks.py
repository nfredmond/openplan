"""Observe job changes after the original read and before parent acquisition.

Fresh retained clones use the actual candidate functions. A missing snapshot
guard must fail this proof at its selected refusal, even when payload guards
later refuse the changed row. This is not a proof of all concurrent operations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

from native_parent_locks import MIGRATION, quote

DETAIL = "Original aerial job or mission scope changed"
BOUNDARIES = ("workspace_id", "project_id", "mission_id", "request_id", "created_by",
              "preset_id", "imagery_type", "id", "status", "deleted")


def expect_refusal(exit_code, diagnostic, boundary):
    errors = [line for line in diagnostic.splitlines() if line.startswith("ERROR:")]
    assert exit_code == 3 and errors == ["ERROR:  42501: " + DETAIL], "Changed snapshot must refuse at its scope guard: " + boundary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("receipt", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    receipt = json.loads(args.receipt.read_text())
    container = receipt["id"]
    original = MIGRATION.read_bytes()
    functions = original.decode()[original.decode().index("-- The backend role"):].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    rows, children = [], []

    def info():
        value = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
        assert value["Name"] == "/openplan_odm_dispatch_database_20261011_02" and value["Id"] == container
        assert value["Config"]["Labels"]["openplan.purpose"] == "odm-private-dispatch-producer-20261011-02"
        host = value["HostConfig"]
        assert host["Memory"] == 1073741824 and host["MemorySwap"] == 1073741824
        assert host["NetworkMode"] == "none" and not host["PortBindings"]
        return value

    def command(database, application=None):
        result = ["docker", "exec", "-i"]
        if application:
            result.extend(["-e", "PGAPPNAME=" + application])
        return result + [container, "psql", "-XqAt", "-U", "postgres", "-d", database,
                         "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]

    def sql(database, query, name):
        result = subprocess.run(command(database), input=query, text=True, capture_output=True, timeout=20)
        (out / (name + "-private.log")).write_text(result.stdout + result.stderr)
        assert result.returncode == 0, "Snapshot fixture SQL failed: " + name
        return result.stdout.strip()

    def send(child, text):
        child.stdin.write(text.encode())
        child.stdin.flush()

    def wait_for(probe, reason, timeout=5, interval=.05):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if probe():
                return
            time.sleep(interval)
        raise TimeoutError(reason)

    def run(database, variant, boundary, broken):
        name = variant + "-" + boundary
        actor, keeper, workspace, other_workspace, project, mission, other_mission, job, other_job = [str(uuid.uuid4()) for _ in range(9)]
        request = "snapshot-lock-" + uuid.uuid4().hex
        sql(database, f"""INSERT INTO auth.users(id,email) VALUES ({quote(actor)},{quote(actor+'@example.invalid')}),({quote(keeper)},{quote(keeper+'@example.invalid')});
INSERT INTO public.workspaces(id,name,slug) VALUES ({quote(workspace)},'Synthetic snapshot lock',{quote(workspace)}),({quote(other_workspace)},'Synthetic other workspace',{quote(other_workspace)});
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ({quote(workspace)},{quote(actor)},'member'),({quote(workspace)},{quote(keeper)},'owner');
INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES ({quote(project)},{quote(workspace)},'Synthetic snapshot project',{quote(actor)});
INSERT INTO public.aerial_missions(id,workspace_id,project_id,title) VALUES ({quote(mission)},{quote(workspace)},{quote(project)},'Synthetic snapshot mission'),({quote(other_mission)},{quote(workspace)},{quote(project)},'Synthetic other mission');
INSERT INTO public.aerial_processing_jobs(id,workspace_id,project_id,mission_id,request_id,imagery_url,created_by) VALUES ({quote(job)},{quote(workspace)},{quote(project)},{quote(mission)},{quote(request)},'https://source.example.invalid/photos.zip',{quote(actor)});""", name + "-seed")
        payload = json.dumps({"schemaVersion": "natford-aerial-processing.v1", "requestId": request,
            "callbackUrl": "https://app.example.invalid/callback", "missionTitle": "Synthetic snapshot mission",
            "externalRef": {"system": "openplan", "workspaceId": workspace, "projectId": project, "missionId": mission},
            "imagery": {"type": "zip_url", "url": "https://source.example.invalid/photos.zip"}})
        parent_app, worker_app = "parent_" + uuid.uuid4().hex, "worker_" + uuid.uuid4().hex
        parent = subprocess.Popen(command(database, parent_app), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        children.append(parent)
        # Hold the workspace before admission reaches any project/child lock.
        # A concurrent job write can then complete its real revision trigger.
        send(parent, "BEGIN; SET statement_timeout='8s'; SELECT id FROM public.workspaces WHERE id=" + quote(workspace) + " FOR UPDATE;\n")
        wait_for(lambda: sql(database, "SELECT count(*) FROM pg_stat_activity WHERE application_name=" + quote(parent_app) + " AND state='idle in transaction';", name + "-parent-held") == "1", "Snapshot parent was not held")
        worker = subprocess.Popen(command(database, worker_app), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        children.append(worker)
        send(worker, "BEGIN; SET statement_timeout='8s'; SET LOCAL ROLE service_role; SELECT public.record_aerial_original_dispatch(" + ",".join(map(quote, [job, actor, "installation-native-1", "database-native-1", payload])) + "); ROLLBACK;\n")
        worker.stdin.close()
        worker.stdin = None
        wait_for(lambda: sql(database, "SELECT count(*) FROM pg_stat_activity worker JOIN pg_stat_activity parent ON parent.pid = ANY(pg_blocking_pids(worker.pid)) WHERE worker.application_name=" + quote(worker_app) + " AND parent.application_name=" + quote(parent_app) + " AND worker.wait_event_type='Lock';", name + "-admission-blocked") == "1", "Snapshot admission did not reach this held parent")
        assignment = {"workspace_id": "workspace_id=" + quote(other_workspace), "project_id": "project_id=NULL",
            "mission_id": "mission_id=" + quote(other_mission), "request_id": "request_id=" + quote(request + "-changed"),
            "created_by": "created_by=" + quote(keeper), "preset_id": "preset_id='fast-preview'",
            "imagery_type": "imagery_type='photo_manifest'", "id": "id=" + quote(other_job),
            "status": "status='accepted'"}.get(boundary)
        change = "DELETE FROM public.aerial_processing_jobs WHERE id=" + quote(job) if boundary == "deleted" else "UPDATE public.aerial_processing_jobs SET " + assignment + " WHERE id=" + quote(job)
        sql(database, "BEGIN; SET statement_timeout='4s'; " + change + " RETURNING id; COMMIT;", name + "-concurrent-change")
        send(parent, "COMMIT;\n")
        parent.stdin.close()
        parent.stdin = None
        parent_out, parent_error = parent.communicate(timeout=12)
        worker_out, worker_error = worker.communicate(timeout=12)
        (out / (name + "-parent-private.log")).write_bytes(parent_out + parent_error)
        (out / (name + "-worker-private.log")).write_bytes(worker_out + worker_error)
        assert parent.returncode == 0, "Snapshot parent release must finish"
        if broken:
            assert worker.returncode in (0, 3) and (not worker_error or b"ERROR:  22023: Original aerial payload scope differs" in worker_error), "Snapshot fault must reach admission or its later payload guard"
            try:
                expect_refusal(worker.returncode, worker_error.decode(), boundary)
            except AssertionError as error:
                assert str(error) == "Changed snapshot must refuse at its scope guard: " + boundary
            else:
                raise AssertionError("Missing snapshot guard survived: " + boundary)
        else:
            expect_refusal(worker.returncode, worker_error.decode(), boundary)
        assert sql(database, "SELECT count(*) FROM openplan_odm_private.original_dispatches WHERE request_id=" + quote(request) + ";", name + "-original-absent") == "0", "Snapshot probe must not retain an original"
        rows.append({"name": name, "boundary": boundary, "result": "intended snapshot assertion failure" if broken else "survived",
            "workerExit": worker.returncode, "laterPayloadRefusal": bool(broken and worker.returncode == 3), "database": database})
        (out / "partial-controls.json").write_text(json.dumps(rows, indent=2) + "\n")
        print(name + ": " + rows[-1]["result"], flush=True)

    try:
        assert not info()["State"]["Running"]
        subprocess.run(["docker", "start", container], check=True, stdout=subprocess.DEVNULL)
        wait_for(lambda: subprocess.run(["docker", "exec", container, "pg_isready", "-U", "supabase_admin"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0, "Snapshot database readiness", timeout=180, interval=.5)
        for variant in ("baseline", "harmless", "missing-snapshot-guard", "restored"):
            database = "dispatch_snapshot_" + uuid.uuid4().hex
            sql("postgres", "CREATE DATABASE " + database + " TEMPLATE " + receipt["database"] + ";", variant + "-clone")
            altered = functions
            broken = variant == "missing-snapshot-guard"
            if broken:
                start = altered.index("  IF NOT FOUND OR current_job.workspace_id")
                end = altered.index("  IF jsonb_typeof(payload)", start)
                assert DETAIL in altered[start:end] and altered[start:end].count("END IF;") == 1
                altered = altered[:start] + "  -- Deliberately omitted snapshot guard.\n" + altered[end:]
            elif variant == "harmless":
                altered = "-- Harmless snapshot comment.\n" + altered
            sql(database, "BEGIN;\n" + altered + "\nCOMMIT;", variant + "-functions")
            for boundary in BOUNDARIES:
                run(database, variant, boundary, broken)
        (out / "controls.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(),
            "driverSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "controls": rows,
            "scope": "Actual concurrent changes after the original read: eight job projection fields, active status and deletion. Four fresh retained clones, forty cases. Removing the snapshot guard often reaches the later payload refusal, which is recorded separately. All interleavings, engine permission, hosted operation and full recovery remain unproved."}, indent=2) + "\n")
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
                child.communicate(timeout=5)
            assert child.poll() is not None
        value = info()
        (out / "container-before-stop.json").write_text(json.dumps({"oomKilled": value["State"]["OOMKilled"], "memoryLimit": value["HostConfig"]["Memory"], "swapLimit": value["HostConfig"]["MemorySwap"]}) + "\n")
        subprocess.run(["docker", "stop", "--time", "120", container], check=True, stdout=subprocess.DEVNULL)
        assert not info()["State"]["Running"] and MIGRATION.read_bytes() == original


if __name__ == "__main__":
    main()
