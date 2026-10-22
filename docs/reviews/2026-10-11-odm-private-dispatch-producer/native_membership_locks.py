"""Observe admission against the real membership owner-floor trigger."""
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
    parser.add_argument("--historical-deadlock", action="store_true")
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
        assert result.returncode == 0, "Membership fixture SQL failed: " + name
        return result.stdout.strip()

    def send(child, text):
        child.stdin.write(text.encode())
        child.stdin.flush()

    def wait_for(probe, reason):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if probe():
                return
            time.sleep(.05)
        raise TimeoutError(reason)

    def run(name, broken=False, harmless=False):
        database = "dispatch_member_lock_" + uuid.uuid4().hex
        sql("postgres", "CREATE DATABASE " + database + " TEMPLATE " + receipt["database"] + ";", name + "-clone")
        altered = functions
        if broken:
            old = "WHERE workspace_id = original.workspace_id AND user_id = p_actor FOR SHARE NOWAIT;"
            assert altered.count(old) == 1, "Unique membership NOWAIT mutation"
            altered = altered.replace(old, old.replace(" NOWAIT", ""))
        elif harmless:
            altered = "-- Harmless membership-lock comment.\n" + altered
        sql(database, "BEGIN;\n" + altered + "\nCOMMIT;", name + "-functions")
        actor, keeper, workspace, project, mission, job = [str(uuid.uuid4()) for _ in range(6)]
        request = "member-lock-" + uuid.uuid4().hex
        sql(database, f"""INSERT INTO auth.users(id,email) VALUES ({quote(actor)},{quote(actor+'@example.invalid')}),({quote(keeper)},{quote(keeper+'@example.invalid')});
INSERT INTO public.workspaces(id,name,slug) VALUES ({quote(workspace)},'Synthetic member lock',{quote(workspace)});
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ({quote(workspace)},{quote(actor)},'owner'),({quote(workspace)},{quote(keeper)},'owner');
INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES ({quote(project)},{quote(workspace)},'Synthetic member project',{quote(actor)});
INSERT INTO public.aerial_missions(id,workspace_id,project_id,title) VALUES ({quote(mission)},{quote(workspace)},{quote(project)},'Synthetic member mission');
INSERT INTO public.aerial_processing_jobs(id,workspace_id,project_id,mission_id,request_id,imagery_url,created_by) VALUES ({quote(job)},{quote(workspace)},{quote(project)},{quote(mission)},{quote(request)},'https://source.example.invalid/photos.zip',{quote(actor)});""", name + "-seed")
        payload = json.dumps({"schemaVersion": "natford-aerial-processing.v1", "requestId": request,
            "callbackUrl": "https://app.example.invalid/callback", "missionTitle": "Synthetic member mission",
            "externalRef": {"system": "openplan", "workspaceId": workspace, "projectId": project, "missionId": mission},
            "imagery": {"type": "zip_url", "url": "https://source.example.invalid/photos.zip"}})
        parent_app = "membership_" + uuid.uuid4().hex
        worker_app = "admission_" + uuid.uuid4().hex
        parent = subprocess.Popen(command(database, parent_app), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        children.append(parent)
        send(parent, "BEGIN; SET statement_timeout='8s'; SELECT user_id FROM public.workspace_members WHERE workspace_id=" + quote(workspace) + " AND user_id=" + quote(actor) + " FOR UPDATE;\n")
        wait_for(lambda: sql(database, "SELECT count(*) FROM pg_stat_activity WHERE application_name=" + quote(parent_app) + " AND state='idle in transaction';", name + "-parent-wait") == "1", "Membership row was not held")
        worker = subprocess.Popen(command(database, worker_app), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        children.append(worker)
        send(worker, "BEGIN; SET statement_timeout='8s'; SET LOCAL ROLE service_role; SELECT public.record_aerial_original_dispatch(" + ",".join(map(quote, [job, actor, "installation-native-1", "database-native-1", payload])) + "); COMMIT;\n")
        worker.stdin.close()
        worker.stdin = None
        wait_for(lambda: worker.poll() is not None or sql(database, "SELECT count(*) FROM pg_stat_activity WHERE application_name=" + quote(worker_app) + " AND wait_event_type='Lock';", name + "-worker-wait") == "1", "Admission did not reach the held membership")
        send(parent, "UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=" + quote(workspace) + " AND user_id=" + quote(actor) + "; COMMIT;\n")
        parent.stdin.close()
        parent.stdin = None
        parent_stdout, parent_stderr = parent.communicate(timeout=12)
        worker_stdout, worker_stderr = worker.communicate(timeout=12)
        (out / (name + "-parent-private.log")).write_bytes(parent_stdout + parent_stderr)
        (out / (name + "-worker-private.log")).write_bytes(worker_stdout + worker_stderr)
        deadlock = b"ERROR:  40P01:" in parent_stderr or b"ERROR:  40P01:" in worker_stderr
        if broken or args.historical_deadlock:
            assert deadlock, "Intended membership owner-floor deadlock absent"
            result = "actual owner-floor deadlock detected"
        else:
            assert not deadlock, "Membership admission deadlocks against owner-floor revocation"
            assert parent.returncode == 0 and worker.returncode == 3 and b"ERROR:  55P03:" in worker_stderr, "Held membership must refuse admission without waiting"
            assert sql(database, "SELECT role FROM public.workspace_members WHERE workspace_id=" + quote(workspace) + " AND user_id=" + quote(actor) + ";", name + "-role") == "viewer", "Revocation must finish"
            assert sql(database, "SELECT count(*) FROM openplan_odm_private.original_dispatches WHERE job_id=" + quote(job) + ";", name + "-custody") == "0", "Refused admission must not capture an original"
            result = "admission refused and owner-floor revocation finished"
        rows.append({"name": name, "result": result, "parentExit": parent.returncode, "workerExit": worker.returncode})
        print(name + ": " + result, flush=True)

    try:
        assert not info()["State"]["Running"]
        subprocess.run(["docker", "start", container], check=True, stdout=subprocess.DEVNULL)
        wait_for(lambda: subprocess.run(["docker", "exec", container, "pg_isready", "-U", "supabase_admin"], capture_output=True).returncode == 0, "Membership database readiness")
        cases = [("historical", False, False)] if args.historical_deadlock else [("baseline", False, False), ("harmless", False, True), ("membership-wait", True, False), ("restored", False, False)]
        for name, broken, harmless in cases:
            run(name, broken, harmless)
        (out / "controls.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "controls": rows,
            "scope": "Actual owner-floor membership revocation and concurrent service admission. Fresh retained native clones; no hosted, other parent/snapshot paths or external engine fence acceptance."}, indent=2) + "\n")
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
                child.communicate(timeout=5)
            assert child.poll() is not None
        subprocess.run(["docker", "stop", "--time", "10", container], check=True, stdout=subprocess.DEVNULL)
        assert not info()["State"]["Running"] and MIGRATION.read_bytes() == original
        (out / "partial-controls.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
