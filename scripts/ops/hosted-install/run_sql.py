"""The kit's only path to a database. Every mode sends one transaction, once.

    python run_sql.py rtt     --target T --out DIR
    python run_sql.py read    --target T --out DIR FILE [--var NAME=VALUE ...]
    python run_sql.py catalog --target T --out DIR
    python run_sql.py dryrun  --target T --out DIR --bundle BUNDLE [--rtt RTT.json --rehearsed DRYRUN.json]
    python run_sql.py install --target T --out DIR --bundle BUNDLE [--rtt RTT.json --rehearsed DRYRUN.json]
    python run_sql.py probe   --target T --out DIR FILE

One message, one round trip (lane 28). Every mode except rtt sends its whole
transaction, BEGIN through COMMIT or through the dry run's raise, as a single
simple-query message: psql's backslash-semicolon joins the statements without
sending them one by one (PostgreSQL 17 psql reference), and the server runs
them in order and stops at the first error (protocol section 53.2.2.1). No
network round trip happens while the transaction holds a lock. psql sent one
statement per round trip before this change, which on hosted held the Safety
tables locked for about 168 round trips.

rtt sends a read-only transaction of short statements one at a time and
reports psql's own time for each: the round trip to the target. A hosted dry
run or install needs a fresh rtt envelope (--rtt) and a completed dry run of the
same DRYRUN.sql with its server-measured lock time (--rehearsed: the restored
copy's for the dry run, the hosted dry run's for the install). It prints its
lock-time estimate and refuses to start when the estimate is over
kitcommon.LOCK_LIMIT_MS.

Targets:
  hosted              psql from PATH with the PG* variables already in this
                      process (supplied on stdin by stdin_env.py inside the
                      kit image). Requires PGSSLMODE=verify-full and the CA.
  copy:<container>    a restored copy in a local container that carries the
                      kit label and has no network. Used for rehearsals.

Each run writes one envelope JSON and the raw output to DIR. Nothing is
retried. Exit status: 0 when the mode's outcome is the expected one, 1 when the
database refused, a check failed or the outcome is unknown, 2 when the kit
refused before sending.

Install status (review 31, B1): installed only on psql exit 0 with the result
and lock lines; install-failed only when psql exit 3 reports a database ERROR
on a connection that stayed up, so the server stopped before COMMIT and rolled
back; install-unknown for everything else (connection lost, psql killed, a
FATAL, missing lines). With one message the server runs every statement
through COMMIT whether or not psql is still connected, so an unknown ending
may have committed. Read catalog before anything else. A dry run has the same
three endings (dry-run-complete, dry-run-failed, dry-run-unknown); its message
holds no COMMIT, so a lost connection rolls it back, and dry-run-unknown means
only that the kit did not see how it ended.

Refusals before anything is sent: a read file that is not read-only, a probe
without a final ROLLBACK, a bundle whose files do not match their recorded
hashes, an install without a GO file naming this capture, this INSTALL.sql
hash and this target, an install already attempted from this bundle, a
rehearsal bundle on hosted, any hosted write between 10:05 and 10:50 UTC, and
a hosted dry run or install without a fresh round-trip measurement or whose
lock-time estimate is over the limit.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import statistics
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
_TIME = re.compile(r"^Time: ([0-9]+(?:\.[0-9]+)?) ms")
RTT_PROBES = 20
# The whole transaction is one message, so the client sends nothing between the
# first lock and the end of the transaction; the proxy test counts the
# messages. The term stays in the envelope as a record; with it at zero the
# estimate is the rehearsed lock time, and rtt is a recorded condition, not a
# gate (review 31, N2).
ROUND_TRIPS_UNDER_LOCK = 0
# Psql flags for every mode. SHOW_ALL_RESULTS is on by default in psql 17; it
# is set here because the dry run's result must print before its raise.
PSQL_FLAGS = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "SHOW_ALL_RESULTS=on"]


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
        # Review 15 (L8) read the session pooler on 5432. Transaction mode
        # (6543) hands the connection back after each transaction, and rtt's
        # 22 messages in one transaction were never tried there, so any other
        # port is refused before anything is sent (review 31, N5). The message
        # names no value it was given.
        if env.get("PGPORT", "").strip() != "5432":
            raise kc.KitError("PGPORT must be 5432, the Supabase session pooler; the kit refuses any other port")
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


def one_message(sql: str) -> str:
    """The script as one simple-query message.

    Every top-level semicolon but the last becomes a backslash-semicolon, which
    psql adds to the query buffer without sending. The kit's lexer finds the
    top-level semicolons, so a semicolon inside a string, comment or function
    body is never touched. Text after the last statement is dropped.
    """
    stmts = sqllex.split_statements(sql)
    if not stmts or not stmts[-1].terminated:
        raise kc.KitError("a script must end with a statement and its semicolon")
    parts, at = [], 0
    for stmt in stmts[:-1]:
        parts.append(sql[at:stmt.end - 1])
        parts.append("\\;")
        at = stmt.end
    parts.append(sql[at:stmts[-1].end])
    return "".join(parts) + "\n"


def transaction_message(sql: str, *, commit: bool) -> str:
    """BEGIN, the script and, when commit is true, COMMIT, as one message.

    The explicit BEGIN makes the message a regular transaction block (protocol
    53.2.2.1), so SET LOCAL and the B5 timeouts hold for every statement and a
    stray BEGIN cannot leave an implicit block. A dry run or probe has no
    COMMIT: it ends with its raise, and a ROLLBACK after it.
    """
    body = sql if sql.endswith("\n") else sql + "\n"
    return one_message("BEGIN;\n" + body + ("COMMIT;\n" if commit else ""))


def run_psql(target: Target, sql: str, variables: dict[str, str] | None = None, *,
             commit: bool) -> tuple[int, str, str, int]:
    """Send one transaction once, as one message. Returns exit code, stdout, stderr and elapsed ms."""
    command = target.command() + PSQL_FLAGS
    for name, value in (variables or {}).items():
        command += ["-v", f"{name}={value}"]
    command += ["-f", "-"]
    message = transaction_message(sql, commit=commit)
    started = time.monotonic()
    result = subprocess.run(command, input=message.encode("utf-8"), capture_output=True, env=target.environment())
    elapsed = int((time.monotonic() - started) * 1000)
    return (result.returncode, result.stdout.decode("utf-8", errors="replace"),
            result.stderr.decode("utf-8", errors="replace"), elapsed)


def rtt_script(probes: int = RTT_PROBES) -> str:
    """A read-only transaction of short statements that psql sends one at a time,
    timing each: the time psql reports for SELECT 1 is one round trip."""
    return ("BEGIN;\nSET TRANSACTION READ ONLY;\n" + kc.TIMEOUTS + "\\timing on\n"
            + "SELECT 1;\n" * probes + "\\timing off\nCOMMIT;\n")


def run_rtt(target: Target, probes: int = RTT_PROBES) -> tuple[int, list[float], str, int]:
    command = target.command() + PSQL_FLAGS + ["-f", "-"]
    started = time.monotonic()
    result = subprocess.run(command, input=rtt_script(probes).encode("utf-8"), capture_output=True,
                            env=target.environment())
    elapsed = int((time.monotonic() - started) * 1000)
    stdout = result.stdout.decode("utf-8", errors="replace")
    samples = [float(m.group(1)) for m in map(_TIME.match, stdout.splitlines()) if m]
    return result.returncode, samples, result.stderr.decode("utf-8", errors="replace"), elapsed


def _stamp_time(stamp: str) -> dt.datetime:
    return dt.datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)


def lock_estimate(bundle: dict, rtt_path: pathlib.Path, rehearsed_path: pathlib.Path, target: Target,
                  now: dt.datetime) -> dict:
    """Lock-holding estimate: round trips under lock x measured round trip, plus
    the server-measured lock time of a completed dry run of the same file."""
    rtt = kc.read_json(rtt_path)
    if rtt.get("mode") != "rtt" or rtt.get("status") != "measured":
        raise kc.KitError(f"{rtt_path.name} is not a completed round-trip measurement")
    if rtt.get("target") != target.describe():
        raise kc.KitError(f"the round trip was measured to {rtt.get('target')}, not {target.describe()}")
    age = (now - _stamp_time(rtt.get("startedAt", "19700101T000000Z"))).total_seconds()
    if not -60 <= age <= kc.RTT_MAX_AGE_SECONDS:
        raise kc.KitError(f"the round-trip measurement is {int(age)} s old; measure again (limit {kc.RTT_MAX_AGE_SECONDS} s)")
    rehearsed = kc.read_json(rehearsed_path)
    if rehearsed.get("status") != "dry-run-complete" or rehearsed.get("sha256") != bundle.get("dryrunSha256"):
        raise kc.KitError(f"{rehearsed_path.name} is not a completed dry run of this bundle's DRYRUN.sql")
    held = (rehearsed.get("lock") or {}).get("lockHeldMs")
    if not isinstance(held, int):
        raise kc.KitError(f"{rehearsed_path.name} has no server-measured lock time")
    rtt_ms = float(rtt["rttMs"])
    estimate = ROUND_TRIPS_UNDER_LOCK * rtt_ms + held
    return {"roundTripsUnderLock": ROUND_TRIPS_UNDER_LOCK, "rttMs": rtt_ms, "rehearsedLockMs": held,
            "rehearsedTarget": rehearsed.get("target"), "estimateMs": round(estimate, 1),
            "limitMs": kc.LOCK_LIMIT_MS, "rttEnvelope": rtt_path.name, "rehearsedEnvelope": rehearsed_path.name}


def read_wrapper(body: str) -> str:
    return ("SET TRANSACTION READ ONLY;\n" + kc.TIMEOUTS +
            "SET LOCAL search_path = pg_catalog, pg_temp;\n" + body)


def probe_wrapper(statements: list[sqllex.Statement]) -> str:
    body = "\n".join(stmt.text for stmt in statements)
    return (kc.TIMEOUTS + body + "\n" +
            f"DO $openplan_end$ BEGIN RAISE EXCEPTION '{kc.PROBE_SENTINEL}'; END $openplan_end$;\nROLLBACK;\n")


def ended_at_database_error(code: int, stderr: str) -> bool:
    """True only when psql exit 3 reports a database ERROR on a connection that
    stayed up: the server stopped the message at that error, before COMMIT, and
    the transaction rolled back (protocol 53.2.2.1). Exit 2 (connection lost,
    including a transaction_timeout's FATAL), a negative exit (psql killed) and
    any FATAL can end after the server committed: once the server has the one
    message, it runs it to the end even if the client is gone (protocol 53.2.9,
    "the backend will probably finish the query before noticing the
    disconnection"; review 31, B1)."""
    return (code == 3 and "ERROR:" in stderr and "FATAL:" not in stderr
            and "connection to server was lost" not in stderr)


def check_clock(target: Target, mode: str, now: dt.datetime | None = None) -> None:
    if target.kind != "hosted" or mode in {"read", "catalog", "rtt"}:
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
    if mode == "rtt":
        return execute_rtt(out, stamp, envelope, target)
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
        # Measure before acting (lane 28): the estimate is made, printed and
        # judged before the install attempt is recorded or anything is sent.
        rtt_arg, rehearsed_arg = getattr(args, "rtt", None), getattr(args, "rehearsed", None)
        if target.kind == "hosted" and not (rtt_arg and rehearsed_arg):
            raise kc.KitError("a hosted dry run or install needs --rtt (a fresh rtt envelope) and "
                              "--rehearsed (a completed dry run of the same DRYRUN.sql)")
        if rtt_arg or rehearsed_arg:
            if not (rtt_arg and rehearsed_arg):
                raise kc.KitError("--rtt and --rehearsed go together")
            estimate = lock_estimate(bundle, pathlib.Path(rtt_arg), pathlib.Path(rehearsed_arg), target,
                                     now or dt.datetime.now(dt.timezone.utc))
            envelope["lockEstimate"] = estimate
            print(json.dumps({"lockEstimate": estimate}))
            if estimate["estimateMs"] > kc.LOCK_LIMIT_MS:
                envelope["status"] = "refused-lock-estimate"
                base = free_name(out, f"{mode}-{stamp}")
                kc.write_new(out / f"{base}.json", json.dumps(envelope, indent=2, sort_keys=True) + "\n")
                raise kc.KitError(f"estimated lock time {estimate['estimateMs']} ms is over the "
                                  f"{kc.LOCK_LIMIT_MS} ms limit; nothing was sent")
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
    code, stdout, stderr, elapsed = run_psql(target, sql, variables, commit=mode in {"read", "catalog", "install"})
    results = kc.parse_results(stdout)
    envelope.update(exitCode=code, elapsedMs=elapsed, stderrTail=_safe_tail(stderr))
    locks = kc.parse_results(stdout, kc.LOCK_PREFIX)
    lock = locks[0] if len(locks) == 1 else None
    if lock is not None:
        envelope.update(lock=lock, lockHeldMs=lock.get("lockHeldMs"))
    if mode == "dryrun":
        befores = kc.parse_results(stdout, kc.BEFORE_PREFIX)
        ok = (code == 3 and kc.DRYRUN_SENTINEL in stderr and len(results) == 1 and len(befores) == 1
              and lock is not None)
        if ok:
            results[0]["before"] = befores[0].get("before") or {}
        if ok:
            envelope["status"] = "dry-run-complete"
        else:
            envelope["status"] = "dry-run-failed" if ended_at_database_error(code, stderr) else "dry-run-unknown"
        # Judged on the server's lock clock, not on wall time (lane 28).
        if ok and lock["lockHeldMs"] > kc.LOCK_LIMIT_MS:
            envelope["status"], ok = "dry-run-too-slow", False
    elif mode == "probe":
        ok = code == 3 and kc.PROBE_SENTINEL in stderr
        envelope["status"] = "probe-complete" if ok else "probe-failed"
    elif mode == "install":
        ok = code == 0 and len(results) == 1 and lock is not None
        if ok:
            envelope["status"] = "installed"
        else:
            envelope["status"] = "install-failed" if ended_at_database_error(code, stderr) else "install-unknown"
        if ok and lock["lockHeldMs"] > kc.LOCK_LIMIT_MS:
            envelope["lockOverLimit"] = True
    else:
        ok = code == 0
        envelope["status"] = "read" if ok else "read-failed"
    if results:
        envelope["result"] = results[-1] if len(results) == 1 else results
    base = free_name(out, f"{mode}-{stamp}")
    kc.write_new(out / f"{base}.out", stdout)
    envelope["output"] = f"{base}.out"
    kc.write_new(out / f"{base}.json", json.dumps(envelope, indent=2, sort_keys=True) + "\n")
    summary = {k: envelope[k] for k in ("mode", "target", "status", "exitCode", "elapsedMs", "lockHeldMs")
               if k in envelope}
    summary["envelope"] = f"{base}.json"
    print(json.dumps(summary))
    return (0 if ok else 1), envelope


def execute_rtt(out: pathlib.Path, stamp: str, envelope: dict, target: Target) -> tuple[int, dict]:
    code, samples, stderr, elapsed = run_rtt(target)
    ok = code == 0 and len(samples) == RTT_PROBES
    envelope.update(exitCode=code, elapsedMs=elapsed, probes=RTT_PROBES, samplesMs=samples,
                    stderrTail=_safe_tail(stderr), status="measured" if ok else "rtt-failed")
    if ok:
        envelope.update(rttMs=round(statistics.median(samples), 3), minMs=min(samples), maxMs=max(samples))
    base = free_name(out, f"rtt-{stamp}")
    kc.write_new(out / f"{base}.json", json.dumps(envelope, indent=2, sort_keys=True) + "\n")
    summary = {k: envelope[k] for k in ("mode", "target", "status", "rttMs", "minMs", "maxMs") if k in envelope}
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
    parser.add_argument("mode", choices=["rtt", "read", "catalog", "dryrun", "install", "probe"])
    parser.add_argument("file", nargs="?")
    parser.add_argument("--target", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--bundle")
    parser.add_argument("--var", action="append")
    parser.add_argument("--rtt", help="rtt envelope for the lock-time estimate")
    parser.add_argument("--rehearsed", help="completed dry-run envelope of the same DRYRUN.sql")
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
