"""The kit's only path to a database. Every mode sends one transaction, once.

    python run_sql.py read    --target T --out DIR FILE [--var NAME=VALUE ...]
    python run_sql.py catalog --target T --out DIR
    python run_sql.py dryrun  --target T --out DIR --bundle BUNDLE
    python run_sql.py install --target T --out DIR --bundle BUNDLE
    python run_sql.py probe   --target T --out DIR FILE

Targets:
  hosted              psql from PATH with the PG* variables already in this
                      process (supplied on stdin by stdin_env.py inside the
                      kit image). Requires PGSSLMODE=verify-full and the CA.
  copy:<container>    a restored copy in a local container that carries the
                      kit label and has no network. Used for rehearsals.

Each run writes one envelope JSON and the raw output to DIR. Nothing is
retried. Exit status: 0 when the mode's outcome is the expected one, 1 when the
database refused or a check failed, 2 when the kit refused before sending.

Refusals before anything is sent: a read file that is not read-only, a probe
without a final ROLLBACK, a bundle whose files do not match their recorded
hashes, an install without a GO file naming this capture, this INSTALL.sql
hash and this target, an install already attempted from this bundle, a
rehearsal bundle on hosted, and any hosted write between 10:05 and 10:50 UTC.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time

import kitcommon as kc
import sqllex

LABEL = "openplan-hosted-install"
# The restored copy runs for the whole window, so it carries its own label and
# the "no containers left" check after each step does not count it.
COPY_LABEL = "openplan-hosted-install-copy"
_VAR = re.compile(r"^([a-z_][a-z0-9_]*)=([A-Za-z0-9:.+\-_ ]{0,64})$")


class Target:
    kind = "abstract"

    def command(self) -> list[str]:
        raise NotImplementedError

    def environment(self) -> dict[str, str] | None:
        return None

    def describe(self) -> str:
        return self.kind

    def cleanup(self) -> None:
        pass


class HostedTarget(Target):
    """psql with PG* from this process. Values are never printed or written."""
    kind = "hosted"

    def __init__(self, env: dict[str, str]):
        missing = [n for n in ("PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE") if not env.get(n, "").strip()]
        if missing:
            raise kc.KitError("missing connection settings: " + ", ".join(missing))
        if env.get("PGSSLMODE") != "verify-full":
            raise kc.KitError("PGSSLMODE must be verify-full")
        self._env = dict(env)
        self._tmp = None
        if env.get("BACKUP_PG_CA_PEM", "").strip():
            self._tmp = tempfile.TemporaryDirectory(prefix="openplan-kit-ca-")
            ca = pathlib.Path(self._tmp.name) / "database-ca.crt"
            ca.write_text(env["BACKUP_PG_CA_PEM"])
            os.chmod(ca, 0o600)
            self._env["PGSSLROOTCERT"] = str(ca)
        elif not env.get("PGSSLROOTCERT", "").strip():
            raise kc.KitError("provide the database CA as BACKUP_PG_CA_PEM or PGSSLROOTCERT")
        self._env.pop("BACKUP_PG_CA_PEM", None)

    def command(self) -> list[str]:
        return ["psql"]

    def environment(self) -> dict[str, str]:
        return self._env

    def describe(self) -> str:
        return "hosted"

    def cleanup(self) -> None:
        if self._tmp:
            self._tmp.cleanup()


class CopyTarget(Target):
    """A restored copy in a labeled, network-free container."""
    kind = "copy"

    def __init__(self, container: str, database: str = "restore_target", inspect=None):
        inspect = inspect or _docker_inspect
        info = inspect(container)
        labels = (info.get("Config") or {}).get("Labels") or {}
        if COPY_LABEL not in labels:
            raise kc.KitError(f"container {container} does not carry the {COPY_LABEL} label")
        if (info.get("HostConfig") or {}).get("NetworkMode") != "none":
            raise kc.KitError(f"container {container} has a network; a restored copy must run with --network none")
        self.container = container
        self.database = database

    def command(self) -> list[str]:
        return ["docker", "exec", "-i", "-u", "postgres", self.container, "psql", "-d", self.database]

    def describe(self) -> str:
        return f"copy:{self.container}"


def _docker_inspect(container: str) -> dict:
    result = subprocess.run(["docker", "inspect", container], capture_output=True, text=True)
    if result.returncode != 0:
        raise kc.KitError(f"docker inspect {container} failed")
    return json.loads(result.stdout)[0]


def make_target(spec: str, env: dict[str, str] | None = None) -> Target:
    if spec == "hosted":
        return HostedTarget(dict(os.environ if env is None else env))
    if spec.startswith("copy:"):
        return CopyTarget(spec[len("copy:"):])
    raise kc.KitError("target must be hosted or copy:<container>")


def run_psql(target: Target, sql: str, variables: dict[str, str] | None = None) -> tuple[int, str, str, int]:
    """Send one script once. Returns exit code, stdout, stderr and elapsed ms."""
    command = target.command() + ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--single-transaction"]
    for name, value in (variables or {}).items():
        command += ["-v", f"{name}={value}"]
    command += ["-f", "-"]
    started = time.monotonic()
    result = subprocess.run(command, input=sql.encode("utf-8"), capture_output=True, env=target.environment())
    elapsed = int((time.monotonic() - started) * 1000)
    return (result.returncode, result.stdout.decode("utf-8", errors="replace"),
            result.stderr.decode("utf-8", errors="replace"), elapsed)


def read_wrapper(body: str) -> str:
    return ("SET TRANSACTION READ ONLY;\n" + kc.TIMEOUTS +
            "SET LOCAL search_path = pg_catalog, pg_temp;\n" + body)


def probe_wrapper(statements: list[sqllex.Statement]) -> str:
    body = "\n".join(stmt.text for stmt in statements)
    return (kc.TIMEOUTS + body + "\n" +
            f"DO $openplan_end$ BEGIN RAISE EXCEPTION '{kc.PROBE_SENTINEL}'; END $openplan_end$;\nROLLBACK;\n")


def check_clock(target: Target, mode: str, now: dt.datetime | None = None) -> None:
    if target.kind != "hosted" or mode in {"read", "catalog"}:
        return
    now = now or dt.datetime.now(dt.timezone.utc)
    if kc.in_capture_quiet_window(now.hour, now.minute):
        raise kc.KitError("no hosted dry run, install or probe between 10:05 and 10:50 UTC (daily capture at 10:17)")


def check_bundle(bundle_dir: pathlib.Path, target: Target, mode: str) -> tuple[dict, str, pathlib.Path]:
    bundle = kc.read_json(bundle_dir / "bundle.json")
    if target.kind == "hosted" and bundle.get("purpose") != "window":
        raise kc.KitError("a rehearsal bundle may not run on hosted")
    name = "DRYRUN.sql" if mode == "dryrun" else "INSTALL.sql"
    path = bundle_dir / name
    if not path.exists():
        raise kc.KitError(f"missing {path}")
    sha = kc.sha256_file(path)
    expected = bundle.get("dryrunSha256" if mode == "dryrun" else "installSha256")
    if sha != expected:
        raise kc.KitError(f"{name} hash {sha} does not match the bundle record {expected}")
    return bundle, sha, path


def check_go(bundle_dir: pathlib.Path, bundle: dict, install_sha: str, target: Target) -> dict:
    """Review 15, step 19: the operator writes GO naming the capture, the file hash and the target."""
    go_path = bundle_dir / "GO.json"
    if not go_path.exists():
        raise kc.KitError("no GO.json beside INSTALL.sql; the install needs a written go decision")
    go = kc.read_json(go_path)
    if go.get("capture") != bundle.get("capture"):
        raise kc.KitError("GO.json names a different capture than the bundle")
    if go.get("installSha256") != install_sha:
        raise kc.KitError("GO.json names a different INSTALL.sql hash")
    if go.get("target") != target.kind:
        raise kc.KitError(f"GO.json is for target {go.get('target')!r}, not {target.kind!r}")
    return go


def execute(args: argparse.Namespace, target: Target, now: dt.datetime | None = None) -> tuple[int, dict]:
    out = kc.private_dir(pathlib.Path(args.out))
    stamp = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    mode = args.mode
    check_clock(target, mode, now)
    variables: dict[str, str] = {}
    for item in args.var or []:
        match = _VAR.fullmatch(item)
        if not match:
            raise kc.KitError(f"--var must be name=value with a plain value: {item!r}")
        variables[match.group(1)] = match.group(2)
    envelope: dict = {"mode": mode, "target": target.describe(), "startedAt": stamp}
    if mode == "read":
        body = pathlib.Path(args.file).read_text(encoding="utf-8")
        sqllex.check_read_only(body, label=args.file)
        sql, envelope["file"] = read_wrapper(body), pathlib.Path(args.file).name
    elif mode == "catalog":
        sql, envelope["file"] = read_wrapper(kc.catalog_map_select()), "catalog_keys.sql"
    elif mode == "probe":
        body = pathlib.Path(args.file).read_text(encoding="utf-8")
        sql, envelope["file"] = probe_wrapper(sqllex.prepare_probe(body, label=args.file)), pathlib.Path(args.file).name
    elif mode in {"dryrun", "install"}:
        bundle_dir = pathlib.Path(args.bundle)
        bundle, sha, path = check_bundle(bundle_dir, target, mode)
        envelope.update(window=bundle.get("window"), capture=bundle.get("capture"), file=path.name)
        if mode == "install":
            go = check_go(bundle_dir, bundle, sha, target)
            marker = bundle_dir / f"install-attempt-{target.kind}.json"
            # One attempt per bundle and target, written before sending: if psql
            # dies after sending, the result is read, never resent (review 15, N12).
            kc.write_new(marker, json.dumps({"at": stamp, "installSha256": sha, "go": go}, indent=2) + "\n")
        sql = path.read_text(encoding="utf-8")
    else:
        raise kc.KitError(f"unknown mode {mode}")
    envelope["sha256"] = kc.sha256_bytes(sql.encode("utf-8")) if mode not in {"dryrun", "install"} else sha
    code, stdout, stderr, elapsed = run_psql(target, sql, variables)
    results = kc.parse_results(stdout)
    envelope.update(exitCode=code, elapsedMs=elapsed, stderrTail=_safe_tail(stderr))
    if mode == "dryrun":
        ok = code == 3 and kc.DRYRUN_SENTINEL in stderr and len(results) == 1
        envelope["status"] = "dry-run-complete" if ok else "dry-run-failed"
        if ok and target.kind == "hosted" and elapsed > 5000:
            envelope["status"] = "dry-run-too-slow"
    elif mode == "probe":
        ok = code == 3 and kc.PROBE_SENTINEL in stderr
        envelope["status"] = "probe-complete" if ok else "probe-failed"
    elif mode == "install":
        ok = code == 0 and len(results) == 1
        envelope["status"] = "installed" if ok else "install-failed"
    else:
        ok = code == 0
        envelope["status"] = "read" if ok else "read-failed"
    if results:
        envelope["result"] = results[-1] if len(results) == 1 else results
    base = free_name(out, f"{mode}-{stamp}")
    kc.write_new(out / f"{base}.out", stdout)
    envelope["output"] = f"{base}.out"
    kc.write_new(out / f"{base}.json", json.dumps(envelope, indent=2, sort_keys=True) + "\n")
    summary = {k: envelope[k] for k in ("mode", "target", "status", "exitCode", "elapsedMs") if k in envelope}
    summary["envelope"] = f"{base}.json"
    print(json.dumps(summary))
    return (0 if ok else 1), envelope


def free_name(out: pathlib.Path, base: str) -> str:
    """The first of BASE, BASE-2, BASE-3 ... with no envelope yet. Evidence is never overwritten."""
    name, n = base, 1
    while (out / f"{name}.json").exists() or (out / f"{name}.out").exists():
        n += 1
        name = f"{base}-{n}"
    return name


def _safe_tail(stderr: str) -> str:
    # psql errors name objects and statements, not connection secrets.
    return stderr.strip()[-2000:]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("mode", choices=["read", "catalog", "dryrun", "install", "probe"])
    parser.add_argument("file", nargs="?")
    parser.add_argument("--target", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--bundle")
    parser.add_argument("--var", action="append")
    args = parser.parse_intermixed_args(argv)
    if args.mode in {"read", "probe"} and not args.file:
        parser.error(f"{args.mode} needs a SQL file")
    if args.mode in {"dryrun", "install"} and not args.bundle:
        parser.error(f"{args.mode} needs --bundle")
    target = None
    try:
        target = make_target(args.target)
        code, _ = execute(args, target)
        return code
    except (kc.KitError, sqllex.SqlRefused) as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    finally:
        if target:
            target.cleanup()


if __name__ == "__main__":
    sys.exit(main())
