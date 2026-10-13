"""Apply with the installed CLI, then exercise real private RPC transport."""
import argparse
import base64
import hashlib
import hmac
import io
import ipaddress
import json
import os
import re
import secrets
import shutil
import subprocess
import tarfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "openplan"
PG_IMAGE = "sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f"
REST_IMAGE = "sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326"
MIGRATION = APP / "supabase/migrations/20261017000003_aerial_private_dispatch_custody.sql"
CLIENT = Path(__file__).with_name("native_rpc_client.cjs")


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def deadline_failure(result, message="Actual RPC deadline refuses a stalled command"):
    prefix = "AssertionError [ERR_ASSERTION]: " + message
    errors = re.findall(r"^(?:AssertionError|TypeError|Error|RangeError|SyntaxError|ReferenceError)(?: \[[^\]]+\])?:.*$", result.stderr, flags=re.MULTILINE)
    return result.returncode == 1 and errors == [prefix] and result.stderr.splitlines()[0] == prefix


def network_available(subnet, networks, routes):
    candidate = ipaddress.ip_network(subnet)
    assert candidate.version == 4 and candidate.is_private and candidate.prefixlen == 28, "Owned RPC subnet must be a private IPv4 /28"
    occupied = [item["Subnet"] for network in networks for item in network.get("IPAM", {}).get("Config") or [] if item.get("Subnet")]
    occupied += [route["dst"] for route in routes if route["dst"] != "default"]
    assert all(ipaddress.ip_network(value).version != 4 or not ipaddress.ip_network(value).overlaps(candidate) for value in occupied), "Owned RPC subnet overlaps another network or host route"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("proof", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--subnet", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    proof = args.proof.resolve()
    name = "openplan_odm_rpc_" + uuid.uuid4().hex[:12]
    purpose = "odm-private-dispatch-rpc-cli-20261012"
    network = name + "_network"
    containers = []
    pg = None
    rest = None
    rows = []
    source = MIGRATION.read_bytes()
    client_source = CLIENT.read_bytes()
    saved_backup = (proof / "native-02/main-before-candidate.dump").read_bytes()
    selected_main = subprocess.check_output(["git", "rev-parse", "origin/main"], cwd=ROOT, text=True).strip()
    # The fixture's selected main schema must still match fetched main migrations.
    assert not subprocess.check_output(["git", "diff", "c03788caf5c8", selected_main, "--", "openplan/supabase/migrations"], cwd=ROOT)

    def command(arguments, label, data=None, timeout=90):
        result = subprocess.run(arguments, input=data, capture_output=True, timeout=timeout)
        (out / (label + "-private.log")).write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0, "Owned RPC command failed: " + label
        return result.stdout

    def inspect(identity):
        return json.loads(subprocess.check_output(["docker", "inspect", identity]))[0]

    def verify(identity, image, memory):
        info = inspect(identity)
        assert info["Id"] == identity and info["Image"] == image
        assert info["Config"]["Labels"]["openplan.purpose"] == purpose
        host = info["HostConfig"]
        assert host["Memory"] == memory and host["MemorySwap"] == memory
        assert list(info["NetworkSettings"]["Networks"]) == [network]
        assert not host["PortBindings"], "Owned RPC services must not publish ports"
        address = info["NetworkSettings"]["Networks"][network]["IPAddress"]
        if info["State"]["Running"]:
            assert ipaddress.ip_address(address) in ipaddress.ip_network(args.subnet)
        return info

    def sql(database, query, label):
        return command(["docker", "exec", "-i", pg, "psql", "-XqAt", "-U", "postgres", "-d", database,
            "-v", "ON_ERROR_STOP=1"], label, query.encode()).decode().strip()

    def token(role, actor=None):
        def encoded(value):
            return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")
        body = {"role": role, "exp": int(time.time()) + 3600}
        if actor:
            body["sub"] = actor
        content = encoded({"alg": "HS256", "typ": "JWT"}) + b"." + encoded(body)
        return (content + b"." + base64.urlsafe_b64encode(hmac.new(jwt.encode(), content, hashlib.sha256).digest()).rstrip(b"=")).decode()

    def node(config, variant, operation, label, broken=False):
        config = {**config, "result": str(out / (label + "-result.json"))}
        path = out / (label + "-configuration-private.json")
        path.write_text(json.dumps(config))
        result = subprocess.run(["node", "--max-old-space-size=512", str(CLIENT), str(path), variant, operation],
            cwd=APP, capture_output=True, text=True, timeout=35)
        (out / (label + "-private.log")).write_text(result.stdout + result.stderr)
        if broken:
            message = "Actual RPC refuses revoked original scope" if operation == "revoked" else "Actual RPC deadline refuses a stalled command"
            assert deadline_failure(result, message), "Wrong actual RPC failure: " + label
            rows.append({"name": label, "result": "intended assertion", "assertion": message})
        else:
            assert result.returncode == 0, "Actual RPC probe failed: " + label
            rows.append({"name": label, "result": "survived", **json.loads(Path(config["result"]).read_text())})
        print(label + ": " + rows[-1]["result"], flush=True)

    def wait_query(database, pattern):
        for attempt in range(110):
            active = sql(database, "SELECT count(*) FROM pg_stat_activity WHERE usename='authenticator' AND state='active' AND query LIKE " + quote("%" + pattern + "%") + ";", "query-wait-" + uuid.uuid4().hex[:8])
            if active == "0":
                return
            time.sleep(.25)
        raise TimeoutError("Owned RPC server query remains active")

    try:
        assert shutil.disk_usage(out).free > 5 * 1024**3
        ids = subprocess.check_output(["docker", "network", "ls", "-q"], text=True).split()
        networks = json.loads(subprocess.check_output(["docker", "network", "inspect", *ids]))
        routes = json.loads(subprocess.check_output(["ip", "-j", "-4", "route"]))
        network_available(args.subnet, networks, routes)
        command(["docker", "network", "create", "--internal", "--subnet", args.subnet, "--label", "openplan.purpose=" + purpose, network], "create-private-network")
        network_info = json.loads(subprocess.check_output(["docker", "network", "inspect", network]))[0]
        assert network_info["Internal"] is True
        key = out / "mounted-root-private.key"
        key.write_bytes((proof / "native-02/mounted-root-private.key").read_bytes())
        key.chmod(0o444)
        volume = name + "_data"
        command(["docker", "volume", "create", "--label", "openplan.purpose=" + purpose, volume], "create-private-volume")
        preload = "pg_stat_statements,pgaudit,plpgsql,plpgsql_check,pg_cron,pg_net,pgsodium,auto_explain,pg_tle,plan_filter,supabase_vault"
        script = "set -eu\ninstall -d -m 700 -o postgres -g postgres /var/lib/postgresql/data/proof\nif [ ! -f /var/lib/postgresql/data/proof/PG_VERSION ]; then\ngosu postgres initdb -D /var/lib/postgresql/data/proof --username=supabase_admin --encoding=UTF8 --locale-provider=icu --icu-locale=en-US --auth-local=trust --auth-host=scram-sha-256\nfi\nexec gosu postgres postgres -D /var/lib/postgresql/data/proof -c listen_addresses='*' -c shared_preload_libraries=" + preload + " -c pgsodium.getkey_script=/usr/lib/postgresql/bin/pgsodium_getkey.sh -c cron.database_name=postgres\n"
        private_hba = "host all postgres,authenticator " + str(ipaddress.ip_network(args.subnet)) + " scram-sha-256"
        script = script.replace("exec gosu postgres postgres", "printf '%s\\n' '" + private_hba + "' >> /var/lib/postgresql/data/proof/pg_hba.conf\nexec gosu postgres postgres")
        pg = command(["docker", "create", "--name", name, "--network", network, "--memory", "1g", "--memory-swap", "1g", "--cpus", "1", "--pids-limit", "128", "--label", "openplan.purpose=" + purpose,
            "--mount", "type=volume,source=" + volume + ",target=/var/lib/postgresql/data", "--mount", "type=bind,source=" + str(key) + ",target=/etc/postgresql-custom/pgsodium_root.key,readonly", "--entrypoint", "sh", PG_IMAGE, "-c", script], "create-private-database").decode().strip()
        containers.append((pg, PG_IMAGE, 1073741824))
        command(["docker", "start", pg], "start-private-database")
        for _ in range(120):
            if subprocess.run(["docker", "exec", pg, "pg_isready", "-U", "supabase_admin"], capture_output=True).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise TimeoutError("Owned RPC database readiness")
        roles = (proof / "native-02/roles-private.sql").read_text()
        assert roles.splitlines().count("CREATE ROLE supabase_admin;") == 1
        roles = "\n".join("-- Existing bootstrap administrator." if line == "CREATE ROLE supabase_admin;" else line for line in roles.splitlines())
        command(["docker", "exec", "-i", pg, "psql", "-Xq", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "--single-transaction"], "restore-private-roles", roles.encode())
        password = secrets.token_hex(32)
        sql("postgres", "ALTER ROLE postgres PASSWORD " + quote(password) + "; ALTER ROLE authenticator PASSWORD " + quote(password) + ";", "private-connection-password")
        # The captured role's eight-second server limit masks the client signal.
        # Extend only this fresh fixture's limits for the deliberate stall cases.
        sql("postgres", "ALTER ROLE authenticator SET statement_timeout='30s'; ALTER ROLE authenticator SET lock_timeout='30s';", "fixture-stall-timeouts")
        database_address = verify(pg, PG_IMAGE, 1073741824)["NetworkSettings"]["Networks"][network]["IPAddress"]
        project = out / "cli-project"
        migrations = project / "supabase/migrations"
        migrations.mkdir(parents=True)
        archive = subprocess.check_output(["git", "archive", selected_main, "openplan/supabase/migrations"], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
            for item in bundle:
                if item.isfile():
                    (migrations / Path(item.name).name).write_bytes(bundle.extractfile(item).read())
        (project / "supabase/config.toml").write_text((APP / "supabase/config.toml").read_text())
        jwt = secrets.token_hex(32)
        for variant in ["baseline", "harmless", "missing-abort", "restored"]:
            database = "rpc_dispatch_" + uuid.uuid4().hex
            sql("postgres", "CREATE DATABASE " + database + " TEMPLATE template0 OWNER postgres ENCODING 'UTF8';", variant + "-create")
            command(["docker", "exec", "-i", pg, "pg_restore", "-U", "supabase_admin", "-d", database, "--exit-on-error", "--single-transaction"], variant + "-restore-main", saved_backup)
            candidate = source if variant != "harmless" else b"-- Harmless CLI migration control.\n" + source
            (migrations / MIGRATION.name).write_bytes(candidate)
            # The isolated fixture has no TLS listener. This setting is confined
            # to its verified private address and does not configure hosted TLS.
            url = "postgresql://postgres:" + password + "@" + database_address + ":5432/" + database + "?sslmode=disable"
            command([str(APP / "node_modules/.bin/supabase"), "migration", "up", "--db-url", url, "--workdir", str(project), "--include-all", "--yes"], variant + "-cli-upgrade")
            history = json.loads(sql(database, "SELECT json_build_object('count', count(*), 'candidate', max(version), 'hasStatements', bool_or(version='20261017000003' AND cardinality(statements)>0)) FROM supabase_migrations.schema_migrations;", variant + "-history"))
            assert history == {"count": 406, "candidate": "20261017000003", "hasStatements": True}, "CLI candidate migration history"
            command([str(APP / "node_modules/.bin/supabase"), "migration", "up", "--db-url", url, "--workdir", str(project), "--include-all", "--yes"], variant + "-cli-no-op")
            actor, keeper, workspace, project_id, mission, job = [str(uuid.uuid4()) for _ in range(6)]
            request = "rpc-dispatch-" + uuid.uuid4().hex
            sql(database, f"""INSERT INTO auth.users(id,email) VALUES ({quote(actor)},{quote(actor+'@example.invalid')}),({quote(keeper)},{quote(keeper+'@example.invalid')});
INSERT INTO public.workspaces(id,name,slug) VALUES ({quote(workspace)},'Synthetic private RPC',{quote(workspace)});
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ({quote(workspace)},{quote(actor)},'owner'),({quote(workspace)},{quote(keeper)},'owner');
INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES ({quote(project_id)},{quote(workspace)},'Synthetic RPC project',{quote(actor)});
INSERT INTO public.aerial_missions(id,workspace_id,project_id,title) VALUES ({quote(mission)},{quote(workspace)},{quote(project_id)},'Synthetic RPC mission');
INSERT INTO public.aerial_processing_jobs(id,workspace_id,project_id,mission_id,request_id,imagery_url,created_by) VALUES ({quote(job)},{quote(workspace)},{quote(project_id)},{quote(mission)},{quote(request)},'https://source.example.invalid/photos.zip',{quote(actor)});""", variant + "-seed")
            env = out / (variant + "-postgrest-private.env")
            env.write_text("PGRST_DB_URI=postgresql://authenticator:" + password + "@" + name + ":5432/" + database + "\nPGRST_DB_SCHEMAS=public,graphql_public\nPGRST_DB_EXTRA_SEARCH_PATH=public,extensions\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=" + jwt + "\nPGRST_OPENAPI_MODE=disabled\n")
            rest = command(["docker", "create", "--name", name + "_rest_" + variant, "--network", network, "--memory", "128m", "--memory-swap", "128m", "--cpus", "0.5", "--pids-limit", "128", "--label", "openplan.purpose=" + purpose, "--env-file", str(env), REST_IMAGE], variant + "-create-rest").decode().strip()
            containers.append((rest, REST_IMAGE, 134217728))
            command(["docker", "start", rest], variant + "-start-rest")
            endpoint = "http://" + verify(rest, REST_IMAGE, 134217728)["NetworkSettings"]["Networks"][network]["IPAddress"] + ":3000"
            import urllib.request
            for _ in range(120):
                try:
                    probe = urllib.request.Request(endpoint + "/aerial_processing_jobs?select=id&limit=0",
                        headers={"Authorization": "Bearer " + token("service_role")}, method="HEAD")
                    with urllib.request.urlopen(probe, timeout=1):
                        break
                except Exception:
                    time.sleep(.25)
            else:
                raise TimeoutError("Owned PostgREST readiness")
            projection = {"id": job, "request_id": request, "workspace_id": workspace, "project_id": project_id,
                "mission_id": mission, "created_by": actor, "preset_id": "balanced", "imagery_type": "zip_url"}
            payload = json.dumps({"schemaVersion": "natford-aerial-processing.v1", "requestId": request,
                "callbackUrl": "https://app.example.invalid/callback?private=original", "missionTitle": "Synthetic étude aérienne",
                "externalRef": {"system": "openplan", "workspaceId": workspace, "missionId": mission, "projectId": project_id},
                "presetId": "balanced", "imagery": {"type": "zip_url", "url": "https://source.example.invalid/photos.zip?private=original"}}, ensure_ascii=False, indent=2) + "\n"
            config = {"application": str(APP), "endpoint": endpoint, "scope": {"installationId": "installation-rpc-native", "targetId": "database-rpc-native"},
                "job": projection, "payloadText": payload, "serviceToken": token("service_role"), "anonToken": token("anon"), "authenticatedToken": token("authenticated", actor)}
            node(config, variant, "ordinary", variant + "-ordinary")
            sql(database, "UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=" + quote(workspace) + " AND user_id=" + quote(actor) + ";", variant + "-revoke-original-actor")
            node(config, variant, "revoked", variant + "-revoked")
            if variant == "baseline":
                node(config, "authorize-revoked", "revoked", "authorize-revoked-original", True)
            sql(database, "UPDATE public.workspace_members SET role='owner' WHERE workspace_id=" + quote(workspace) + " AND user_id=" + quote(actor) + ";", variant + "-restore-original-actor")
            lock_name = "dispatch-lock-" + uuid.uuid4().hex
            holder = subprocess.Popen(["docker", "exec", "-i", pg, "psql", "-XqAt", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            holder.stdin.write(("SET application_name=" + quote(lock_name) + "; BEGIN; SELECT id FROM public.projects WHERE id=" + quote(project_id) + " FOR UPDATE; SELECT 'lock-ready'; SELECT pg_sleep(40); ROLLBACK;\n").encode())
            holder.stdin.close()
            assert holder.stdout.readline().strip().decode() == project_id
            assert holder.stdout.readline().strip() == b"lock-ready"
            try:
                node(config, variant, "record-abort", variant + "-record-abort", variant == "missing-abort")
            finally:
                sql(database, "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name=" + quote(lock_name) + ";", variant + "-release-own-lock")
                holder.wait(timeout=10)
            wait_query(database, "record_aerial_original_dispatch")
            node(config, variant, "ordinary", variant + "-record-recovery")
            read_function = source.decode().split("CREATE FUNCTION public.read_aerial_original_dispatch", 1)[1]
            read_function = "CREATE OR REPLACE FUNCTION public.read_aerial_original_dispatch" + read_function
            assert read_function.count("  SELECT * INTO saved") == 1
            sql(database, read_function.replace("  SELECT * INTO saved", "  PERFORM pg_sleep(25);\n  SELECT * INTO saved"), variant + "-stall-own-read")
            node(config, variant, "read-abort", variant + "-read-abort", variant == "missing-abort")
            wait_query(database, "read_aerial_original_dispatch")
            sql(database, read_function, variant + "-restore-own-read")
            node(config, variant, "ordinary", variant + "-read-recovery")
            command(["docker", "stop", "--time", "10", rest], variant + "-stop-rest")
        assert source == MIGRATION.read_bytes() and client_source == CLIENT.read_bytes()
        (out / "result.json").write_text(json.dumps({"controls": rows, "selectedMain": selected_main,
            "selectedMainDumpSha256": hashlib.sha256(saved_backup).hexdigest(), "migrationSha256": hashlib.sha256(source).hexdigest(),
            "clientSha256": hashlib.sha256(client_source).hexdigest(), "cliVersion": command([str(APP / "node_modules/.bin/supabase"), "--version"], "cli-version").decode().strip(),
            "scope": "Actual CLI application and idempotence, installed PostgREST client with real private RPCs and ten-second client abort under isolated stalled SQL. Current-scope observation and private schema role boundaries only. No complete Supabase stack, atomic engine fence, hosted, offsite, browser, practitioner or scientific acceptance."}, indent=2) + "\n")
    finally:
        stopped = []
        for identity, image, memory in reversed(containers):
            info = verify(identity, image, memory)
            if info["State"]["Running"]:
                subprocess.run(["docker", "stop", "--time", "10", identity], check=True, stdout=subprocess.DEVNULL)
            assert not inspect(identity)["State"]["Running"]
            stopped.append({"image": image, "memoryMaxBytes": memory, "oomKilled": info["State"]["OOMKilled"], "stopped": True})
        (out / "partial-controls.json").write_text(json.dumps(rows, indent=2) + "\n")
        (out / "stopped.json").write_text(json.dumps(stopped, indent=2) + "\n")
        assert source == MIGRATION.read_bytes() and client_source == CLIENT.read_bytes()


if __name__ == "__main__":
    main()
