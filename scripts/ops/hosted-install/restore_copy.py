"""Restore a decrypted capture into a disposable, network-free container.

    python restore_copy.py --capture DIR/<stamp> --image IMAGE --name NAME \
        --source-catalog CATALOG_ENVELOPE.json --evidence DIR

Follows HOSTED_RECOVERY.md "Restore into a disposable target":

  1. Check the archive's SHA-256 against the capture manifest.
  2. Start the Supabase PostgreSQL image with --network none and the kit
     label. Refuse an image whose server major.minor differs from the
     capture's (review 15, N5).
  3. Create a fresh database from template0. Refuse an existing one.
  4. Create only the roles the source has and this cluster lacks, with the
     source's attributes from a catalog read (no passwords, never LOGIN,
     never SUPERUSER), and the source's memberships among them.
  5. pg_restore --exit-on-error as supabase_admin, with every EVENT TRIGGER
     entry held back.
  6. Replay each event trigger entry alone, as postgres when postgres owns
     it and as supabase_admin otherwise.

The container keeps running for the readback, probes and rehearsal. Remove it
with `docker rm -f NAME` once the window record is written (review 15, N4).
The throwaway database password never leaves the container's own record and
the container has no network.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import time

import kitcommon as kc

LABEL = "openplan-hosted-install-copy"
DATABASE = "restore_target"


def docker(*args: str, input_text: str | None = None, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["docker", *args], input=input_text, capture_output=True, text=True, env=env)
    if check and result.returncode != 0:
        raise kc.KitError(f"docker {args[0]} failed: {result.stderr.strip()[-600:]}")
    return result


def in_container(name: str, script: str, input_text: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    """Run a shell script in the restore container as the postgres OS user.

    PGPASSWORD is set inside the container from its own POSTGRES_PASSWORD, so
    no value crosses a command line on the host.
    """
    return docker("exec", "-i", "-u", "postgres", name, "sh", "-c",
                  'export PGPASSWORD="$POSTGRES_PASSWORD" PGHOST=localhost; ' + script,
                  input_text=input_text, check=check)


def major_minor(version: str | None) -> str:
    match = re.match(r"\s*(\d+)\.(\d+)", version or "")
    if not match:
        raise kc.KitError(f"cannot read a server version from {version!r}")
    return f"{match.group(1)}.{match.group(2)}"


def wait_ready(name: str, timeout_s: int = 180) -> None:
    deadline = time.monotonic() + timeout_s
    stable = 0
    while time.monotonic() < deadline:
        probe = in_container(name, "psql -X -At -U supabase_admin -d postgres -c 'select 1'", check=False)
        stable = stable + 1 if probe.returncode == 0 and probe.stdout.strip() == "1" else 0
        if stable >= 3:
            return
        time.sleep(2)
    raise kc.KitError(f"container {name} did not become ready in {timeout_s} s")


def toc_split(listing: str) -> tuple[str, list[tuple[str, str]]]:
    """The TOC list with event triggers commented out, and each held-back entry with its owner."""
    held: list[tuple[str, str]] = []
    out = []
    for line in listing.splitlines():
        if not line.startswith(";") and " EVENT TRIGGER " in line:
            held.append((line, line.rsplit(" ", 1)[-1]))
            out.append(";" + line)
        else:
            out.append(line)
    return "\n".join(out) + "\n", held


def role_statements(source_map: dict[str, str], source_values: dict[str, str] | None, existing: set[str]) -> list[str]:
    """CREATE ROLE for roles the source has and the target lacks.

    source_values maps role keys to their JSON value arrays when the catalog
    read kept values; without them the role is created NOLOGIN with defaults.
    """
    out = []
    for key in sorted(source_map):
        if not key.startswith("role:"):
            continue
        name = key[len("role:"):].strip('"')
        if name in existing or name.startswith("pg_"):
            continue
        attrs = ["NOLOGIN"]
        if source_values and key in source_values:
            values = json.loads(source_values[key])
            _super, inherit, createrole, createdb, _login, replication, bypassrls = values[:7]
            attrs += ["INHERIT" if inherit else "NOINHERIT"]
            attrs += ["CREATEROLE"] if createrole else []
            attrs += ["CREATEDB"] if createdb else []
            attrs += ["BYPASSRLS"] if bypassrls else []
            attrs += ["REPLICATION"] if replication else []
        out.append(f'CREATE ROLE "{name}" ' + " ".join(attrs) + ";")
    return out


def restore(args: argparse.Namespace) -> dict:
    capture = pathlib.Path(args.capture)
    manifest = kc.read_json(capture / "manifest.json")
    dump = capture / "database.dump"
    if kc.sha256_file(dump) != manifest["database"]["sha256"]:
        raise kc.KitError("database.dump does not match the manifest hash")
    source = kc.read_json(pathlib.Path(args.source_catalog))
    source_map = (source.get("result") or {}).get("map")
    if not source_map:
        raise kc.KitError("the source catalog envelope holds no catalog map")
    evidence: dict = {"capture": capture.name, "image": args.image, "container": args.name,
                      "manifestServerVersion": manifest["database"].get("serverVersion")}
    existing = docker("ps", "-a", "--filter", f"name=^{args.name}$", "--format", "{{.Names}}").stdout.strip()
    if existing:
        raise kc.KitError(f"a container named {args.name} already exists; remove it or pick another name")
    env = dict(os.environ)
    env["POSTGRES_PASSWORD"] = secrets.token_urlsafe(24)
    docker("run", "-d", "--network", "none", "--label", LABEL, "--name", args.name,
           "-e", "POSTGRES_PASSWORD", "-v", f"{capture.resolve().as_posix()}:/capture:ro", args.image, env=env)
    wait_ready(args.name)
    server = in_container(args.name, "psql -X -At -U supabase_admin -d postgres -c 'show server_version'").stdout.strip()
    evidence["serverVersion"] = server
    if major_minor(server) != major_minor(manifest["database"].get("serverVersion")):
        raise kc.KitError(f"image runs PostgreSQL {server}, the capture came from "
                          f"{manifest['database'].get('serverVersion')}; use the matching image")
    present = in_container(args.name, f"psql -X -At -U supabase_admin -d postgres -c \"select 1 from pg_database where datname = '{DATABASE}'\"").stdout.strip()
    if present:
        raise kc.KitError(f"database {DATABASE} already exists in {args.name}; refusing a populated target")
    in_container(args.name, f"createdb -U supabase_admin -T template0 -O postgres {DATABASE}")
    roles = set(in_container(args.name, "psql -X -At -U supabase_admin -d postgres -c 'select rolname from pg_roles'").stdout.split())
    created = role_statements(source_map, (source.get("result") or {}).get("roleValues"), roles)
    if created:
        in_container(args.name, "psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f -", input_text="\n".join(created) + "\n")
    evidence["rolesCreated"] = [s.split('"')[1] for s in created]
    listing = in_container(args.name, "pg_restore -l /capture/database.dump").stdout
    toc, held = toc_split(listing)
    evidence["tocEntries"] = sum(1 for line in listing.splitlines() if line and not line.startswith(";"))
    evidence["eventTriggersHeld"] = [line.split(" EVENT TRIGGER ", 1)[1] for line, _ in held]
    in_container(args.name, "cat > /tmp/restore.list", input_text=toc)
    started = time.monotonic()
    result = in_container(args.name, f"pg_restore --exit-on-error -U supabase_admin -d {DATABASE} -L /tmp/restore.list /capture/database.dump", check=False)
    evidence["restoreExit"] = result.returncode
    evidence["restoreStderr"] = result.stderr.strip()[-2000:]
    if result.returncode != 0:
        raise kc.KitError("pg_restore failed: " + result.stderr.strip()[-600:])
    replayed = []
    for line, owner in held:
        user = "postgres" if owner == "postgres" else "supabase_admin"
        in_container(args.name, "cat > /tmp/event-trigger.list", input_text=line + "\n")
        one = in_container(args.name, f"pg_restore --exit-on-error -U {user} -d {DATABASE} -L /tmp/event-trigger.list /capture/database.dump", check=False)
        replayed.append({"entry": line.split(" EVENT TRIGGER ", 1)[1], "as": user, "exit": one.returncode,
                         "stderr": one.stderr.strip()[-400:]})
        if one.returncode != 0:
            evidence["eventTriggers"] = replayed
            raise kc.KitError(f"event trigger replay failed as {user}: {one.stderr.strip()[-400:]}")
    evidence["eventTriggers"] = replayed
    evidence["restoreSeconds"] = round(time.monotonic() - started, 1)
    out = kc.private_dir(pathlib.Path(args.evidence))
    kc.write_new(out / f"restore-{args.name}.json", json.dumps(evidence, indent=2) + "\n")
    return evidence


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--capture", required=True, help="the decrypted capture folder named by its stamp")
    parser.add_argument("--image", required=True, help="Supabase PostgreSQL image matching the capture's server minor")
    parser.add_argument("--name", required=True, help="container name for the restored copy")
    parser.add_argument("--source-catalog", required=True, help="a catalog envelope read from the source (run_sql.py catalog)")
    parser.add_argument("--evidence", required=True)
    args = parser.parse_args(argv)
    try:
        evidence = restore(args)
    except kc.KitError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    print(json.dumps({k: evidence[k] for k in ("container", "serverVersion", "tocEntries", "rolesCreated", "restoreExit")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
