"""Shared helpers for the hosted install kit. Standard library only, so the
same files run on the operator's Python and on the image's Python 3.11."""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re

KIT_DIR = pathlib.Path(__file__).resolve().parent
RESULT_PREFIX = "OPENPLAN_RESULT "
# The dry run's whole "before" map, sent before the first lock is taken so its
# transfer never happens while a lock is held.
BEFORE_PREFIX = "OPENPLAN_BEFORE "
# The server's own lock clock: when the first ACCESS EXCLUSIVE lock on a
# non-temporary relation was taken, and the time just before the transaction ends.
LOCK_PREFIX = "OPENPLAN_LOCK "
DRYRUN_SENTINEL = "openplan dry run complete, rolling back"
PROBE_SENTINEL = "openplan probe complete, rolling back"

# Review 15, B5: the first statements of every write path.
TIMEOUTS = (
    "SET LOCAL lock_timeout = '3s';\n"
    "SET LOCAL statement_timeout = '60s';\n"
    "SET LOCAL idle_in_transaction_session_timeout = '30s';\n"
    "SET LOCAL transaction_timeout = '120s';\n"
)

# The daily capture runs at 10:17 UTC. pg_dump holds a lock on every table for
# its whole run, and the install takes ACCESS EXCLUSIVE locks, so no hosted
# write path runs between 10:05 and 10:50 UTC (review 15, B5).
CAPTURE_QUIET_START = (10, 5)
CAPTURE_QUIET_END = (10, 50)

# Lock-holding limit (lane 28). Live requests on a locked table wait in the lock
# queue. Supabase's default statement timeout for the anon role is 3 s and for
# authenticated 8 s (supabase.com/docs/guides/database/postgres/timeouts, read
# 2026-11-14), and the kit's own lock_timeout is 3 s. Two seconds leaves a
# second of margin under the shortest of those. A hosted dry run or install
# refuses to start when its estimate is over this, and a dry run whose measured
# lock time is over it reads dry-run-too-slow.
LOCK_LIMIT_MS = 2000
# A round-trip measurement older than this is not used for an estimate.
RTT_MAX_AGE_SECONDS = 30 * 60


class KitError(Exception):
    """A refusal or failure whose message is safe to print. It names no credential."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    return sha256_bytes(pathlib.Path(path).read_bytes())


def read_json(path: pathlib.Path) -> dict:
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise KitError(f"missing file: {path}") from None
    except json.JSONDecodeError as error:
        raise KitError(f"not valid JSON: {path}: {error}") from None


def write_new(path: pathlib.Path, text: str) -> None:
    """Write a file that must not exist yet. The kit never overwrites evidence."""
    path = pathlib.Path(path)
    if path.exists():
        raise KitError(f"refusing to overwrite {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "x", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def catalog_query() -> str:
    """The catalog key reader as one SELECT, comments removed, no trailing semicolon."""
    text = (KIT_DIR / "catalog_keys.sql").read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return "\n".join(lines).strip().rstrip(";")


def catalog_map_select() -> str:
    """A read-mode query returning the whole map and its digest as one result line."""
    return (
        "SELECT '" + RESULT_PREFIX + "' || pg_catalog.jsonb_build_object(\n"
        "  'map', pg_catalog.jsonb_object_agg(q.k, pg_catalog.md5(q.v)),\n"
        "  'digest', pg_catalog.md5(pg_catalog.string_agg(q.k || '=' || pg_catalog.md5(q.v), E'\\n' ORDER BY q.k COLLATE \"C\")),\n"
        "  'roleValues', pg_catalog.jsonb_object_agg(q.k, q.v) FILTER (WHERE q.k LIKE 'role:%')\n"
        ")::text FROM (\n" + catalog_query() + "\n) q;\n"
    )


def map_digest(mapping: dict[str, str]) -> str:
    """The same digest the SQL computes: md5 over sorted key=hash lines."""
    body = "\n".join(f"{k}={mapping[k]}" for k in sorted(mapping))
    return hashlib.md5(body.encode("utf-8")).hexdigest()


def parse_results(stdout: str, prefix: str = RESULT_PREFIX) -> list[dict]:
    out = []
    for line in stdout.splitlines():
        if line.startswith(prefix):
            out.append(json.loads(line[len(prefix):]))
    return out


def dollar_tag(base: str, *texts: str) -> str:
    """A dollar-quote tag that occurs in none of the texts."""
    for n in range(1000):
        tag = f"${base}{'' if n == 0 else n}$"
        if not any(tag in text for text in texts):
            return tag
    raise KitError("no free dollar-quote tag")


def sql_literal(text: str) -> str:
    """A standard SQL string literal. Callers also assert standard_conforming_strings."""
    if "\x00" in text:
        raise KitError("NUL byte in SQL text")
    return "'" + text.replace("'", "''") + "'"


_VERSION = re.compile(r"^[0-9]{14}$")


def check_version(value: str) -> str:
    if not _VERSION.fullmatch(value or ""):
        raise KitError(f"not a 14-digit migration version: {value!r}")
    return value


def in_capture_quiet_window(hour: int, minute: int) -> bool:
    now = (hour, minute)
    return CAPTURE_QUIET_START <= now < CAPTURE_QUIET_END


def private_dir(path: pathlib.Path) -> pathlib.Path:
    """Create a directory readable only by its owner where the OS honors modes."""
    path = pathlib.Path(path)
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass
    return path
