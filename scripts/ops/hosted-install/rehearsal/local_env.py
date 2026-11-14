"""Stand-in for `railway run` in the Phase A rehearsal: run a command with the
variables the offsite-backup service holds, pointed at a local Supabase stack.

    KIT_DOCKER_NETWORK=supabase_network_<project_id> \
    KIT_ENV_CMD="python scripts/ops/hosted-install/rehearsal/local_env.py STACK_DIR WORK_DIR --" \
        scripts/ops/hosted-install/kit.sh hosted WINDOW_DIR read ...

STACK_DIR holds the scratch stack's supabase/config.toml. WORK_DIR holds
tls/ca.crt (enable_local_tls.sh) and key/public.asc and key/FINGERPRINT
(keys/new_capture_key.sh). Values come from `supabase status` of that local
stack: local development keys, never a hosted credential. The database is
the stack's container, supabase_db_<project_id>, on its own port 5432 (the
only port HostedTarget accepts, review 31, N5), so kit.sh runs on the
stack's network (KIT_DOCKER_NETWORK). The API stays at host.docker.internal.
Both use TLS verify-full like hosted.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tomllib
import urllib.parse


def local_environment(stack_dir: pathlib.Path, work_dir: pathlib.Path) -> dict[str, str]:
    status = subprocess.run(["supabase", "status", "-o", "json", "--workdir", str(stack_dir)],
                            capture_output=True, text=True, check=True).stdout
    data = json.loads(status[status.index("{"):status.rindex("}") + 1])
    db = urllib.parse.urlparse(data["DB_URL"])
    api = urllib.parse.urlparse(data["API_URL"])
    host = "host.docker.internal"
    project = tomllib.loads((stack_dir / "supabase" / "config.toml").read_text(encoding="utf-8"))["project_id"]
    return {
        "PGHOST": f"supabase_db_{project}", "PGPORT": "5432", "PGUSER": db.username, "PGPASSWORD": db.password,
        "PGDATABASE": db.path.lstrip("/"), "PGSSLMODE": "verify-full",
        "BACKUP_PG_CA_PEM": (work_dir / "tls" / "ca.crt").read_text(),
        "SUPABASE_URL": f"http://{host}:{api.port}",
        "SUPABASE_SERVICE_ROLE_KEY": data["SECRET_KEY"],
        "BACKUP_BUCKET": "openplan-offsite-backups",
        "AWS_ENDPOINT_URL": f"http://{host}:{api.port}/storage/v1/s3",
        "AWS_ACCESS_KEY_ID": data["S3_PROTOCOL_ACCESS_KEY_ID"],
        "AWS_SECRET_ACCESS_KEY": data["S3_PROTOCOL_ACCESS_KEY_SECRET"],
        "AWS_DEFAULT_REGION": data.get("S3_PROTOCOL_REGION", "local"),
        "BACKUP_S3_ADDRESSING_STYLE": "path",
        "BACKUP_GPG_FINGERPRINT": (work_dir / "key" / "FINGERPRINT").read_text().strip(),
        "BACKUP_GPG_PUBLIC_KEY": (work_dir / "key" / "public.asc").read_text(),
        "BACKUP_RETAIN_DAYS": "30", "BACKUP_MIN_KEEP": "7",
    }


def main(argv: list[str]) -> int:
    if len(argv) < 4 or argv[2] != "--":
        raise SystemExit("usage: local_env.py STACK_DIR WORK_DIR -- CMD [ARGS...]")
    env = {**os.environ, **local_environment(pathlib.Path(argv[0]), pathlib.Path(argv[1]))}
    return subprocess.run(argv[3:], env=env).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
