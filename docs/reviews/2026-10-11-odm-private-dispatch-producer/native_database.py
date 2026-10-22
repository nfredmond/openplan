"""Probe private custody and current scope on the explicitly owned SQL fixture."""
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
IMAGE = "sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f"

MUTATIONS = {
    "harmless": ("-- Read original custody", "-- Harmless comment.\n-- Read original custody", "survivor"),
    "original-bytes": ("saved.payload_text IS DISTINCT FROM p_payload_text", "false", "changed-exact-bytes"),
    "original-installation": ("saved.installation_id IS DISTINCT FROM p_installation", "false", "changed-original-installation"),
    "original-target": ("saved.target_id IS DISTINCT FROM p_target", "false", "changed-original-target"),
    "original-actor": ("current_job.created_by IS DISTINCT FROM p_actor", "false", "other-member-original-actor"),
    "admitted-status": ("current_job.status <> 'requested'", "false", "refuse-admission-accepted"),
    "admitted-role": ("member_role NOT IN ('owner', 'admin', 'member')", "false", "viewer-admission"),
    "admitted-null-role": ("member_role IS NULL", "false", "null-role-admission"),
    "current-status": ("job.status IN ('requested', 'accepted', 'running')", "true", "terminal-succeeded"),
    "current-role": ("member.role IN ('owner', 'admin', 'member')", "true", "viewer-revoked"),
    "current-mission-project": ("mission.project_id IS NOT DISTINCT FROM job.project_id", "true", "mission-project-changed"),
    "current-project-workspace": ("(job.project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects project\n        WHERE project.id = job.project_id AND project.workspace_id = job.workspace_id))", "true", "project-moved"),
    "actor-existence": ("SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor);", "SELECT true;", "private-deleted-actor"),
    "actor-lock": ("RETURN FOUND;", "RETURN TRUE;", "private-missing-actor"),
}
for field, expression in {
    "requestId": "payload->>'requestId' IS DISTINCT FROM current_job.request_id",
    "system": "payload#>>'{externalRef,system}' IS DISTINCT FROM 'openplan'",
    "workspaceId": "payload#>>'{externalRef,workspaceId}' IS DISTINCT FROM current_job.workspace_id::text",
    "missionId": "payload#>>'{externalRef,missionId}' IS DISTINCT FROM current_job.mission_id::text",
    "projectId": "payload#>>'{externalRef,projectId}' IS DISTINCT FROM current_job.project_id::text",
    "presetId": "coalesce(payload->>'presetId', 'balanced') IS DISTINCT FROM current_job.preset_id",
    "imagery": "payload#>>'{imagery,type}' IS DISTINCT FROM current_job.imagery_type",
    "schemaVersion": "payload->>'schemaVersion' IS DISTINCT FROM\n      (CASE current_job.imagery_type WHEN 'zip_url' THEN 'natford-aerial-processing.v1'\n        WHEN 'photo_manifest' THEN 'natford-aerial-processing.v1.1' ELSE NULL END)",
}.items():
    MUTATIONS["payload-" + field] = (expression, "false", "payload-" + field)
for field in ["id", "request_id", "workspace_id", "mission_id", "project_id", "created_by", "preset_id", "imagery_type"]:
    cast = "::text" if field in ["id", "workspace_id", "mission_id", "project_id", "created_by"] else ""
    operator = "IS NOT DISTINCT FROM" if field == "project_id" else "="
    MUTATIONS["projection-" + field] = (f"job.{field}{cast} {operator} saved.application_job->>'{field}'", "true", "tampered-projection-" + field)
for field, earlier in {"project_id": "project-deleted", "preset_id": "job-changed-preset_id", "imagery_type": "job-changed-imagery_type"}.items():
    old, new, _ = MUTATIONS["projection-" + field]
    MUTATIONS["projection-" + field] = (old, new, earlier)


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("receipt", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--mutation", choices=list(MUTATIONS))
    args = parser.parse_args()
    os.umask(0o077)
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    receipt = json.loads(args.receipt.read_text())
    container = receipt["id"]
    rows = []
    original = MIGRATION.read_bytes()
    functions = original.decode()[original.decode().index("-- The backend role"):].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    injected = ""
    if args.mutation:
        old, new, _ = MUTATIONS[args.mutation]
        assert functions.count(old) == 1, (args.mutation, "Unique mutation target", functions.count(old))
        injected = functions.replace(old, new) + "\n"
    actor, other_actor, workspace, other_workspace, project, other_project, mission, job, null_mission, null_job = [str(uuid.uuid4()) for _ in range(10)]
    keeper = str(uuid.uuid4())
    request = "dispatch-native-" + uuid.uuid4().hex
    scope = {"installationId": "installation-native-1", "targetId": "database-native-1"}
    projection = {"id": job, "request_id": request, "workspace_id": workspace, "project_id": project,
                  "mission_id": mission, "created_by": actor, "preset_id": "balanced", "imagery_type": "zip_url"}
    payload = {"schemaVersion": "natford-aerial-processing.v1", "requestId": request,
               "callbackUrl": "https://app.example.invalid/aerial/callback?private=callback",
               "externalRef": {"system": "openplan", "workspaceId": workspace, "missionId": mission, "projectId": project},
               "missionTitle": "Synthetic aerial study près du métro", "presetId": "balanced",
               "imagery": {"type": "zip_url", "url": "https://source.example.invalid/photos.zip?private=source"}}
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    record = "SELECT public.record_aerial_original_dispatch(" + ",".join(map(literal, [job, actor, scope["installationId"], scope["targetId"], text])) + ");"
    read = "SELECT public.read_aerial_original_dispatch(" + ",".join(map(literal, [request, scope["installationId"], scope["targetId"]])) + ");"
    seed = f"""
INSERT INTO auth.users(id,email) VALUES ({literal(actor)},{literal(actor+'@example.invalid')}),({literal(other_actor)},{literal(other_actor+'@example.invalid')}),({literal(keeper)},{literal(keeper+'@example.invalid')});
INSERT INTO public.workspaces(id,name,slug) VALUES ({literal(workspace)},'Synthetic dispatch native',{literal(workspace)}),({literal(other_workspace)},'Synthetic other workspace',{literal(other_workspace)});
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ({literal(workspace)},{literal(actor)},'member'),({literal(workspace)},{literal(keeper)},'owner');
INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES ({literal(project)},{literal(workspace)},'Synthetic original project',{literal(actor)}),({literal(other_project)},{literal(other_workspace)},'Synthetic other project',{literal(other_actor)});
INSERT INTO public.aerial_missions(id,workspace_id,project_id,title) VALUES ({literal(mission)},{literal(workspace)},{literal(project)},'Synthetic original mission'),({literal(null_mission)},{literal(workspace)},NULL,'Synthetic unlinked mission');
INSERT INTO public.aerial_processing_jobs(id,workspace_id,project_id,mission_id,request_id,preset_id,imagery_url,created_by) VALUES
({literal(job)},{literal(workspace)},{literal(project)},{literal(mission)},{literal(request)},'balanced','https://source.example.invalid/photos.zip',{literal(actor)}),
({literal(null_job)},{literal(workspace)},NULL,{literal(null_mission)},{literal(request+'-null')},'balanced','https://source.example.invalid/photos.zip',{literal(actor)});
"""

    def info():
        data = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
        assert data["Id"] == container and data["Name"] == "/openplan_odm_dispatch_database_20261011_02" and data["Image"] == IMAGE
        assert data["Config"]["Labels"]["openplan.purpose"] == "odm-private-dispatch-producer-20261011-02"
        host = data["HostConfig"]
        assert host["Memory"] == 1073741824 and host["MemorySwap"] == 1073741824 and host["NanoCpus"] == 1000000000
        assert host["NetworkMode"] == "none" and not host["PortBindings"]
        return data

    def sql(query, name, expected_state=None, expected_detail=None):
        command = ["docker", "exec", "-i", container, "psql", "-XqAt", "-U", "postgres", "-d", receipt["database"],
                   "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
        result = subprocess.run(command, input=query, text=True, capture_output=True, timeout=30)
        (out / (name + "-private.log")).write_text(result.stdout + result.stderr)
        if expected_state:
            if result.returncode == 0:
                raise AssertionError("Expected native refusal absent: " + name)
            assert result.returncode == 3 and "ERROR:  " + expected_state + ":" in result.stderr, "Wrong native SQL refusal: " + name
            assert expected_detail in result.stderr, "Wrong native SQL refusal reason: " + name
        else:
            assert result.returncode == 0, (name, result.stderr[:300])
        rows.append({"name": name, "exit": result.returncode, "expectedState": expected_state, "expectedDetail": expected_detail})
        return result.stdout.strip()

    def transaction(query, name, **options):
        return sql("BEGIN;\n" + injected + query + "\nROLLBACK;", name, **options)

    def service(query):
        return "SET LOCAL ROLE service_role;\n" + query

    def check_receipt(value, expected=projection, body=text):
        assert value["format"] == "openplan.odm-application-dispatch.v1" and value["installationId"] == scope["installationId"] and value["targetId"] == scope["targetId"]
        assert value["applicationJob"] == expected and value["payloadText"] == body
        assert value["payloadBytes"] == len(body.encode()) and value["payloadSha256"] == hashlib.sha256(body.encode()).hexdigest()
        assert value["engineTransportPermission"] is False

    def current_change(statement, name):
        value = json.loads(transaction(seed + service(record) + "RESET ROLE;\n" + statement + "\n" + service(read), name).splitlines()[-1])
        check_receipt(value)
        assert value["authorizedNow"] is False, "Refused scope became authorized: " + name

    try:
        assert not info()["State"]["Running"], "Owned native database must start stopped"
        subprocess.run(["docker", "start", container], check=True, stdout=subprocess.DEVNULL)
        for _ in range(120):
            if subprocess.run(["docker", "exec", container, "pg_isready", "-U", "supabase_admin"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise TimeoutError("Owned native SQL readiness")
        assert sql("SELECT current_setting('server_encoding');", "encoding") == "UTF8"
        # Record and replay use the real service role, its grants and its RLS bypass.
        for name, suffix in [("baseline", ""), ("harmless", "\n-- Harmless SQL comment.\n"), ("exact-replay", record)]:
            value = json.loads(transaction(seed + service(record + suffix + read), name).splitlines()[-1])
            check_receipt(value)
            assert value["authorizedNow"] is True and value["authorityObservedAt"], name
        for role in ["anon", "authenticated"]:
            transaction(seed + f"SET LOCAL ROLE {role};\n" + record, role + "-record-rpc", expected_state="42501", expected_detail="permission denied for function record_aerial_original_dispatch")
            transaction(seed + service(record) + f"RESET ROLE; SET LOCAL ROLE {role};\n" + read, role + "-read-rpc", expected_state="42501", expected_detail="permission denied for function read_aerial_original_dispatch")
            transaction(seed + service(record) + f"RESET ROLE; SET LOCAL ROLE {role}; SELECT payload_text FROM openplan_odm_private.original_dispatches;", role + "-private-table", expected_state="42501", expected_detail="permission denied for schema openplan_odm_private")
        for operation in ["UPDATE openplan_odm_private.original_dispatches SET payload_text='changed';", "DELETE FROM openplan_odm_private.original_dispatches;"]:
            name = operation.split()[0].lower()
            transaction(seed + service(record + operation), "service-no-" + name, expected_state="42501", expected_detail="permission denied for table original_dispatches")
        # The database refuses changed wire text even if its decoded object agrees.
        conflict = record.replace(literal(text), literal(text.strip()))
        transaction(seed + service(record + conflict), "changed-exact-bytes", expected_state="23505", expected_detail="cannot be replaced")
        for name, old, new in [("installation", scope["installationId"], "different-installation"), ("target", scope["targetId"], "different-target")]:
            transaction(seed + service(record + record.replace(literal(old), literal(new))), "changed-original-" + name, expected_state="23505", expected_detail="cannot be replaced")
            transaction(seed + service(record + read.replace(literal(old), literal(new))), "wrong-read-" + name, expected_state="P0002", expected_detail="is unavailable")
        for name, changed in [("actor", record.replace(literal(actor), literal(other_actor))),
                              ("project", seed.replace(literal(project) + "," + literal(mission), literal(other_project) + "," + literal(mission)) + service(record))]:
            if name == "actor":
                query = seed + service(changed)
            else:
                query = changed
            transaction(query, "wrong-original-" + name, expected_state="42501", expected_detail="cannot process this workspace" if name == "actor" else "project scope differs")
        transaction(seed + "INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES (" + literal(workspace) + ","
                    + literal(other_actor) + ",'member');" + service(record.replace(literal(actor), literal(other_actor))),
                    "other-member-original-actor", expected_state="42501", expected_detail="job or mission scope changed")
        for status in ["accepted", "running", "succeeded", "failed", "canceled", "dispatch_failed"]:
            transaction(seed + "UPDATE public.aerial_processing_jobs SET status=" + literal(status) + " WHERE id=" + literal(job) + ";"
                        + service(record), "refuse-admission-" + status, expected_state="42501", expected_detail="job or mission scope changed")
        for field in ["requestId", "schemaVersion", "presetId"]:
            changed = {**payload, field: "different-original"}
            transaction(seed + service(record.replace(literal(text), literal(json.dumps(changed)))), "payload-" + field, expected_state="22023", expected_detail="payload scope differs")
        for field in ["system", "workspaceId", "missionId", "projectId"]:
            changed = {**payload, "externalRef": {**payload["externalRef"], field: "different-original"}}
            transaction(seed + service(record.replace(literal(text), literal(json.dumps(changed)))), "payload-" + field, expected_state="22023", expected_detail="payload scope differs")
        changed = {**payload, "imagery": {**payload["imagery"], "type": "photo_manifest"}}
        transaction(seed + service(record.replace(literal(text), literal(json.dumps(changed)))), "payload-imagery", expected_state="22023", expected_detail="payload scope differs")
        for status in ["requested", "accepted", "running"]:
            value = json.loads(transaction(seed + service(record) + "RESET ROLE; UPDATE public.aerial_processing_jobs SET status=" + literal(status) + " WHERE id=" + literal(job) + ";\n" + service(read), "active-" + status).splitlines()[-1])
            check_receipt(value)
            assert value["authorizedNow"] is True
        for status in ["succeeded", "failed", "canceled", "dispatch_failed"]:
            current_change("UPDATE public.aerial_processing_jobs SET status=" + literal(status) + " WHERE id=" + literal(job) + ";", "terminal-" + status)
        for role in ["owner", "admin", "member"]:
            value = json.loads(transaction(seed + "UPDATE public.workspace_members SET role=" + literal(role) + " WHERE workspace_id=" + literal(workspace) + " AND user_id=" + literal(actor) + ";" + service(record + read), "admitted-role-" + role).splitlines()[-1])
            check_receipt(value)
            assert value["authorizedNow"] is True
        transaction(seed + "UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=" + literal(workspace) + " AND user_id=" + literal(actor) + ";" + service(record), "viewer-admission", expected_state="42501", expected_detail="cannot process this workspace")
        transaction(seed + "ALTER TABLE public.workspace_members ALTER COLUMN role DROP NOT NULL; UPDATE public.workspace_members SET role=NULL WHERE workspace_id="
                    + literal(workspace) + " AND user_id=" + literal(actor) + ";" + service(record), "null-role-admission", expected_state="42501", expected_detail="cannot process this workspace")
        current_change("UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=" + literal(workspace) + " AND user_id=" + literal(actor) + ";", "viewer-revoked")
        current_change("DELETE FROM public.workspace_members WHERE workspace_id=" + literal(workspace) + " AND user_id=" + literal(actor) + ";", "membership-removed")
        delete_actor = "DELETE FROM public.workspaces WHERE id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id=" + literal(actor) + " AND role='owner' AND workspace_id<>" + literal(workspace) + "); DELETE FROM auth.users WHERE id=" + literal(actor) + ";"
        current_change(delete_actor, "actor-deleted-after-private-workspace-retirement")
        assert transaction(seed + delete_actor + service("SELECT openplan_odm_private.actor_exists(" + literal(actor) + ");"), "private-deleted-actor") == "f", "Native actor check differs: private-deleted-actor"
        assert transaction(service("SELECT openplan_odm_private.lock_actor(" + literal(actor) + ");"), "private-missing-actor") == "f", "Native actor check differs: private-missing-actor"
        current_change("UPDATE public.projects SET workspace_id=" + literal(other_workspace) + " WHERE id=" + literal(project) + ";", "project-moved")
        current_change("DELETE FROM public.projects WHERE id=" + literal(project) + ";", "project-deleted")
        current_change("UPDATE public.aerial_missions SET project_id=NULL WHERE id=" + literal(mission) + ";", "mission-project-changed")
        for field, value in [("request_id", request + "-changed"), ("created_by", other_actor), ("preset_id", "high-quality"), ("imagery_type", "photo_manifest")]:
            current_change("UPDATE public.aerial_processing_jobs SET " + field + "=" + literal(value) + " WHERE id=" + literal(job) + ";", "job-changed-" + field)
        for field in projection:
            changed_value = request + "-changed" if field == "request_id" else "high-quality" if field == "preset_id" else "photo_manifest" if field == "imagery_type" else other_actor
            query = seed + service(record) + "RESET ROLE; UPDATE openplan_odm_private.original_dispatches SET application_job=jsonb_set(application_job," + literal("{" + field + "}") + "," + literal(json.dumps(changed_value)) + "::jsonb) WHERE job_id=" + literal(job) + ";" + service(read)
            value = json.loads(transaction(query, "tampered-projection-" + field).splitlines()[-1])
            check_receipt(value, {**projection, field: changed_value})
            assert value["authorizedNow"] is False, "Refused scope became authorized: tampered-projection-" + field
        for table, identifier in [("aerial_missions", mission), ("workspaces", workspace), ("aerial_processing_jobs", job)]:
            transaction(seed + service(record) + "RESET ROLE; DELETE FROM public." + table + " WHERE id=" + literal(identifier) + ";" + service(read), "deleted-" + table, expected_state="P0002", expected_detail="is unavailable")
        nullable = {**payload, "requestId": request + "-null", "externalRef": {"system": "openplan", "workspaceId": workspace, "missionId": null_mission}}
        nullable_text = json.dumps(nullable, ensure_ascii=False, indent=2) + "\n"
        null_record = "SELECT public.record_aerial_original_dispatch(" + ",".join(map(literal, [null_job, actor, scope["installationId"], scope["targetId"], nullable_text])) + ");"
        value = json.loads(transaction(seed + service(null_record), "nullable-project"))
        check_receipt(value, {**projection, "id": null_job, "request_id": request + "-null", "mission_id": null_mission, "project_id": None}, nullable_text)
        # Catalog checks protect narrow grants even where another guard would refuse.
        assert sql("SELECT relrowsecurity FROM pg_class WHERE oid='openplan_odm_private.original_dispatches'::regclass;", "rls-enabled") == "t"
        assert sql("SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE oid IN ('public.record_aerial_original_dispatch(uuid,uuid,text,text,text)'::regprocedure,'public.read_aerial_original_dispatch(text,text,text)'::regprocedure);", "invoker-functions") == "t"
        assert sql("SELECT count(*) FROM openplan_odm_private.original_dispatches;", "all-probes-rolled-back") == "0"
        assert MIGRATION.read_bytes() == original
        (out / "native.json").write_text(json.dumps({"state": "passed-native-sql", "sourceSha256": hashlib.sha256(original).hexdigest(), "observations": rows,
            "scope": "Actual PostgreSQL service/member/anonymous roles and candidate functions on isolated current-main SQL fixture. No PostgREST, hosted operation, atomic external revocation, worker attestation, full restore or browser acceptance."}, indent=2) + "\n")
        print(json.dumps({"state": "passed-native-sql", "observations": len(rows)}), flush=True)
    finally:
        data = info()
        (out / "container-before-stop.json").write_text(json.dumps({"oomKilled": data["State"]["OOMKilled"], "memoryLimit": data["HostConfig"]["Memory"], "swapLimit": data["HostConfig"]["MemorySwap"], "networkMode": data["HostConfig"]["NetworkMode"]}) + "\n")
        subprocess.run(["docker", "stop", "--time", "10", container], check=True, stdout=subprocess.DEVNULL)
        assert not info()["State"]["Running"] and MIGRATION.read_bytes() == original
        (out / "partial-observations.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
