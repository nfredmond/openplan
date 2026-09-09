"""Upgrade the desktop demo's identified local Supabase database with a backup.

The coordinator supplies the candidate and private transaction directory. Remote
URLs and ambiguous service/container identities refuse automatic migration.
Recovery of the app keeps additive schema changes; database restore is separate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse


class DatabaseError(RuntimeError):
    pass


def run(args: list[str], **kwargs) -> str:
    result = subprocess.run(args, capture_output=True, text=True, timeout=kwargs.pop("timeout", 120), **kwargs)
    if result.returncode:
        raise DatabaseError(f"{args[0]} failed with exit {result.returncode}; database preparation stopped")
    return result.stdout.strip()


def endpoint(value: str) -> tuple[str, int]:
    parsed = urlparse(value)
    if (parsed.scheme not in ("http", "postgresql", "postgres") or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
            or not parsed.port):
        raise DatabaseError("Automatic database updates require an identified local Supabase stack")
    return "loopback", parsed.port


def runtime_url(app: Path, instance: Path, service: str) -> str:
    working = run(["systemctl", "--user", "show", service, "--property=WorkingDirectory", "--value"])
    if Path(working).resolve() != (instance / "openplan").resolve():
        raise DatabaseError("The service does not belong to the selected demo")
    pid = run(["systemctl", "--user", "show", service, "--property=MainPID", "--value"])
    if not pid.isdecimal() or int(pid) <= 0:
        raise DatabaseError("The running demo's environment could not be identified")
    inherited = dict(item.split("=", 1) for item in Path(f"/proc/{pid}/environ").read_text().split("\0") if "=" in item)
    # Use Next's production env loader and the service's startup environment,
    # so shell overrides and .env.production.local cannot silently pick a DB.
    script = '''const {loadEnvConfig} = require(process.argv[1]);
loadEnvConfig(process.argv[2], false, {info(){},error(){}});
process.stdout.write(process.env.NEXT_PUBLIC_SUPABASE_URL || "");'''
    return run(["node", "-e", script, str(instance / "openplan/node_modules/@next/env"), str(app)], env=inherited)


def local_database(app: Path, instance: Path, service: str) -> str:
    configured = endpoint(runtime_url(app, instance, service))
    active = endpoint(runtime_url(instance / "openplan", instance, service))
    status = json.loads(run(["npm", "exec", "--", "supabase", "status", "--output", "json"], cwd=app))
    api, db = endpoint(status["API_URL"]), endpoint(status["DB_URL"])
    if configured != active or configured != api:
        raise DatabaseError("Candidate, running demo and local Supabase API do not identify the same database")
    containers = json.loads(run(["docker", "inspect", "supabase_db_openplan", "supabase_kong_openplan"]))
    if len(containers) != 2:
        raise DatabaseError("The demo's local containers could not be identified")
    database, gateway = containers
    for container, internal, port in ((database, "5432/tcp", db[1]), (gateway, "8000/tcp", api[1])):
        bindings = container["NetworkSettings"]["Ports"].get(internal) or []
        if not container["State"]["Running"] or not any(int(binding["HostPort"]) == port for binding in bindings):
            raise DatabaseError("Local Supabase ports do not match the identified containers")
    if not set(database["NetworkSettings"]["Networks"]) & set(gateway["NetworkSettings"]["Networks"]):
        raise DatabaseError("Database and API containers do not share a local stack")
    return database["Id"]


def inventory(app: Path, container: str) -> tuple[list[str], list[str]]:
    expected = []
    for path in sorted((app / "supabase/migrations").glob("*.sql")):
        match = re.fullmatch(r"(\d{14})_.+\.sql", path.name)
        if not match:
            raise DatabaseError("Unrecognized migration filename")
        expected.append(match[1])
    applied = run(["docker", "exec", container, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c",
                   "select version from supabase_migrations.schema_migrations order by version"]).splitlines()
    if not expected or len(set(expected)) != len(expected) or applied != expected[:len(applied)]:
        raise DatabaseError("Database migration history is not a prefix of this build; automatic upgrade refused")
    return applied, expected[len(applied):]


def save_receipt(path: Path, receipt: dict) -> None:
    with path.open("w") as stream:
        os.chmod(path, 0o600)
        json.dump(receipt, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def prepare(app: Path, instance: Path, service: str, backup: Path) -> None:
    container = local_database(app, instance, service)
    applied, pending = inventory(app, container)
    if not pending:
        print("The identified local demo database already has this build's migrations.", flush=True)
        return
    backup.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with backup.open("xb") as stream:
        os.chmod(backup, 0o600)
        result = subprocess.run(["docker", "exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "--format=custom"],
                                stdout=stream, stderr=subprocess.PIPE, timeout=600)
        stream.flush()
        os.fsync(stream.fileno())
    if result.returncode or backup.stat().st_size == 0:
        raise DatabaseError("Database backup failed; no migration attempted")
    with backup.open("rb") as stream:
        result = subprocess.run(["docker", "exec", "-i", container, "pg_restore", "--list"],
                                stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
    if result.returncode:
        raise DatabaseError("Database backup is unreadable; no migration attempted")
    with backup.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    receipt = {"container": container, "backup": str(backup), "sha256": checksum,
               "applied_before": applied, "pending": pending, "phase": "backed_up"}
    record = backup.with_suffix(".json")
    save_receipt(record, receipt)
    print(f"Database backup saved: {backup}", flush=True)
    print(f"Applying {len(pending)} pending migrations to the identified local demo database…", flush=True)
    if local_database(app, instance, service) != container:
        raise DatabaseError("Local database identity changed after backup; no migration attempted")
    try:
        run(["npm", "exec", "--", "supabase", "migration", "up", "--local", "--yes"], cwd=app, timeout=600)
        _, remaining = inventory(app, container)
        if remaining:
            raise DatabaseError("Database still has pending migrations after the upgrade")
    except BaseException:
        receipt["phase"] = "migration_failed"
        save_receipt(record, receipt)
        raise
    receipt["phase"] = "upgraded"
    save_receipt(record, receipt)
    print("Local demo database upgrade verified. The backup is retained.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("instance", type=Path)
    parser.add_argument("service")
    parser.add_argument("backup", type=Path)
    args = parser.parse_args()
    try:
        prepare(args.app, args.instance, args.service, args.backup)
    except (DatabaseError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        parser.exit(1, f"Database update stopped: {exc}\n")
