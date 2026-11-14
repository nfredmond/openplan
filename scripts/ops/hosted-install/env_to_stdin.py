"""Write named variables from this process to stdout as one JSON line, for a pipe.

    railway run -s offsite-backup -e production -- python -I env_to_stdin.py pg | docker run -i ...

Review 15, N1: `docker run -e NAME` stores the value in the container record,
which stays on Docker's disk after `--rm`. A value written to the container's
stdin is not part of its record. This script is the sending half; stdin_env.py
inside the image is the receiving half.

It refuses to write to a terminal, so a mistyped command cannot print a
credential on screen. It prints nothing else. Sets:

  pg       PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE BACKUP_PG_CA_PEM
  bucket   BACKUP_BUCKET AWS_ENDPOINT_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
           AWS_DEFAULT_REGION BACKUP_S3_ADDRESSING_STYLE
  capture  pg + bucket + SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY BACKUP_GPG_FINGERPRINT
           BACKUP_GPG_PUBLIC_KEY BACKUP_RETAIN_DAYS BACKUP_MIN_KEEP (rehearsal only)
"""

from __future__ import annotations

import json
import os
import sys

SETS = {
    "pg": ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "BACKUP_PG_CA_PEM"],
    "bucket": ["BACKUP_BUCKET", "AWS_ENDPOINT_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
               "AWS_DEFAULT_REGION", "BACKUP_S3_ADDRESSING_STYLE"],
}
SETS["capture"] = SETS["pg"] + SETS["bucket"] + [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BACKUP_GPG_FINGERPRINT", "BACKUP_GPG_PUBLIC_KEY",
    "BACKUP_RETAIN_DAYS", "BACKUP_MIN_KEEP"]
REQUIRED = {"pg": {"PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE"},
            "bucket": {"BACKUP_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"}}
REQUIRED["capture"] = REQUIRED["pg"] | REQUIRED["bucket"] | {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
                                                           "BACKUP_GPG_FINGERPRINT", "BACKUP_GPG_PUBLIC_KEY"}


def payload(set_name: str, env: dict[str, str]) -> str:
    if set_name not in SETS:
        raise SystemExit(f"unknown set {set_name!r}; use one of {', '.join(SETS)}")
    missing = sorted(n for n in REQUIRED[set_name] if not env.get(n, "").strip())
    if missing:
        raise SystemExit("missing variables (names only): " + ", ".join(missing))
    return json.dumps({n: env[n] for n in SETS[set_name] if n in env}, separators=(",", ":"))


def main(argv: list[str], env: dict[str, str], stdout) -> int:
    if len(argv) != 1:
        raise SystemExit("usage: env_to_stdin.py pg|bucket|capture")
    if stdout.isatty():
        raise SystemExit("refusing to write credentials to a terminal; pipe this into docker run -i")
    stdout.write(payload(argv[0], env) + "\n")
    stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:], dict(os.environ), sys.stdout))
