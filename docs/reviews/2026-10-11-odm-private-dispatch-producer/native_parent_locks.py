"""Prove a project deletion can finish while admission waits on that parent."""
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
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    receipt = json.loads(args.receipt.read_text())
    container = receipt["id"]
    original = MIGRATION.read_bytes()
    functions = original.decode()[original.decode().index("-- The backend role"):].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    rows = []
    children = []

    def info():
        value = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
        assert value["Name"] == "/openplan_odm_dispatch_database_20261011_02" and value["Id"] == container
        assert value["Config"]["Labels"]["openplan.purpose"] == "odm-private-dispatch-producer-20261011-02"
        assert value["HostConfig"]["Memory"] == 1073741824 and value["HostConfig"]["MemorySwap"] == 1073741824
        assert value["HostConfig"]["NetworkMode"] == "none"
        return value

    def command(database, application=None):
        result = ["docker", "exec", "-i"]
        if application:
            result.extend(["-e", "PGAPPNAME=" + application])
        return result + [container, "psql", "-XqAt", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]

    def sql(database, query, name):
        result = subprocess.run(command(database), input=query, text=True, capture_output=True, timeout=20)
        (out / (name + "-private.log")).write_text(result.stdout + result.stderr)
        assert result.returncode == 0, (name, result.stderr[:300])
        return result.stdout.strip()

    def send(child, value):
        child.stdin.write(value.encode())
        child.stdin.flush()

    def wait_for(probe, reason):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if probe():
                return
            time.sleep(.05)
        raise TimeoutError(reason)

    def run(name, broken=False, harmless=False):
        database = "dispatch_lock_" + uuid.uuid4().hex
        sql("postgres", "CREATE DATABASE " + database + " TEMPLATE " + receipt["database"] + ";", name + "-clone")
        altered = functions
        if broken:
            old = "SELECT * INTO original FROM public.aerial_processing_jobs WHERE id = p_job;"
            assert altered.count(old) == 1
            altered = altered.replace(old, old[:-1] + " FOR UPDATE;")
        elif harmless:
            altered = "-- Harmless parent-lock comment.\n" + altered
        sql(database, "BEGIN;\n" + altered + "\nCOMMIT;", name + "-functions")
        actor, workspace, project, mission, job = [str(uuid.uuid4()) for _ in range(5)]
        request = "parent-lock-" + uuid.uuid4().hex
        seed = f"""
INSERT INTO auth.users(id,email) VALUES ({quote(actor)},{quote(actor+'@example.invalid')});
INSERT INTO public.workspaces(id,name,slug) VALUES ({quote(workspace)},'Synthetic parent lock',{quote(workspace)});
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ({quote(workspace)},{quote(actor)},'owner');
INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES ({quote(project)},{quote(workspace)},'Synthetic parent project',{quote(actor)});
INSERT INTO public.aerial_missions(id,workspace_id,project_id,title) VALUES ({quote(mission)},{quote(workspace)},{quote(project)},'Synthetic parent mission');
INSERT INTO public.aerial_processing_jobs(id,workspace_id,project_id,mission_id,request_id,imagery_url,created_by) VALUES ({quote(job)},{quote(workspace)},{quote(project)},{quote(mission)},{quote(request)},'https://source.example.invalid/photos.zip',{quote(actor)});
"""
        sql(database, seed, name + "-seed")
        payload = json.dumps({"schemaVersion": "natford-aerial-processing.v1", "requestId": request,
            "callbackUrl": "https://app.example.invalid/callback", "missionTitle": "Synthetic parent mission",
            "externalRef": {"system": "openplan", "workspaceId": workspace, "projectId": project, "missionId": mission},
            "imagery": {"type": "zip_url", "url": "https://source.example.invalid/photos.zip"}})
        parent_app = "parent_" + uuid.uuid4().hex
        worker_app = "worker_" + uuid.uuid4().hex
        parent = subprocess.Popen(command(database, parent_app), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        children.append(parent)
        send(parent, "BEGIN; SET statement_timeout='8s'; SELECT id FROM public.projects WHERE id=" + quote(project) + " FOR UPDATE;\n")
        wait_for(lambda: sql(database, "SELECT count(*) FROM pg_stat_activity WHERE application_name=" + quote(parent_app) + " AND state='idle in transaction';", name + "-parent-wait") == "1", "Parent did not acquire its row")
        worker = subprocess.Popen(command(database, worker_app), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        children.append(worker)
        send(worker, "BEGIN; SET statement_timeout='8s'; SET LOCAL ROLE service_role; SELECT public.record_aerial_original_dispatch(" + ",".join(map(quote, [job, actor, "installation-native-1", "database-native-1", payload])) + "); ROLLBACK;\n")
        worker.stdin.close()
        worker.stdin = None
        wait_for(lambda: sql(database, "SELECT count(*) FROM pg_stat_activity WHERE application_name=" + quote(worker_app) + " AND wait_event_type='Lock';", name + "-worker-wait") == "1", "Admission did not wait on the held parent")
        send(parent, "DELETE FROM public.projects WHERE id=" + quote(project) + "; COMMIT;\n")
        parent.stdin.close()
        parent.stdin = None
        parent_out, parent_error = parent.communicate(timeout=12)
        worker_out, worker_error = worker.communicate(timeout=12)
        (out / (name + "-parent-private.log")).write_bytes(parent_out + parent_error)
        (out / (name + "-worker-private.log")).write_bytes(worker_out + worker_error)
        if broken:
            assert b"ERROR:  40P01:" in parent_error + worker_error, "Intended parent/job deadlock required"
        else:
            assert parent.returncode == 0, "Parent deletion must finish"
            assert worker.returncode == 3 and b"ERROR:  42501:" in worker_error and b"project scope differs" in worker_error, "Changed parent must refuse admission"
        rows.append({"name": name, "result": "intended native deadlock" if broken else "survived", "parentExit": parent.returncode, "workerExit": worker.returncode, "database": database})
        print(name + ": " + rows[-1]["result"], flush=True)

    try:
        assert not info()["State"]["Running"]
        subprocess.run(["docker", "start", container], check=True, stdout=subprocess.DEVNULL)
        wait_for(lambda: subprocess.run(["docker", "exec", container, "pg_isready", "-U", "supabase_admin"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0, "Native database readiness")
        for name, broken, harmless in [("baseline", False, False), ("harmless", False, True), ("job-before-parent", True, False), ("restored", False, False)]:
            run(name, broken, harmless)
        (out / "controls.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "controls": rows,
            "scope": "Actual project deletion/admission lock order on four fresh retained native database clones. Other parent paths, authority fences, external requests and full recovery remain unproved."}, indent=2) + "\n")
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
                child.communicate(timeout=5)
            assert child.poll() is not None
        data = info()
        (out / "container-before-stop.json").write_text(json.dumps({"oomKilled": data["State"]["OOMKilled"], "memoryLimit": data["HostConfig"]["Memory"], "swapLimit": data["HostConfig"]["MemorySwap"]}) + "\n")
        subprocess.run(["docker", "stop", "--time", "10", container], check=True, stdout=subprocess.DEVNULL)
        assert not info()["State"]["Running"] and MIGRATION.read_bytes() == original
        (out / "partial-controls.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
