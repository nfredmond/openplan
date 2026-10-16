#!/bin/sh
# Parent-only operating recipe. Run only after reading a fresh independent review.
set -eu
umask 077
ROOT=/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4
REPO=/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad
[ "$#" -eq 1 ] || { /usr/bin/printf '%s\n' 'Supply the accepted full independent review commit.' >&2; exit 2; }
case "$1" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#1}" -eq 40 ] || exit 2
/usr/bin/git -C "$REPO" cat-file -e "$1^{commit}"
# External literal pins come from the independently reviewed final public packet.
/usr/bin/sha256sum --check --strict --status <<'SEALED'
87f96cec8f07cb737c82ff93907619cc3e8aa9306efb0a578eed29f2ebbb7856  /home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4/operation-files.sha256
2f66be1b8c376d12075af08e09488fc2e616098c2489b966763cd13a124d11dd  /home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4/run_stage.sh
SEALED
/usr/bin/sha256sum --check --strict "$ROOT/operation-files.sha256" >/dev/null
exec 9>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n 9 || { /usr/bin/printf '%s\n' 'Shared compiler lock occupied. No stage requested.' >&2; exit 2; }
# Record review admission once. Shell text is never interpreted from a receipt.
/bin/mkdir -m 700 "$ROOT/execution/parent-reviewed-admission"
/usr/bin/printf '%s\n' "$1" > "$ROOT/execution/parent-reviewed-admission/review-commit.txt"
"$ROOT/run_stage.sh" preflight
"$ROOT/run_stage.sh" restore
"$ROOT/run_stage.sh" upgrade
"$ROOT/run_stage.sh" services
"$ROOT/run_stage.sh" active-check
"$ROOT/run_stage.sh" checkout
"$ROOT/run_stage.sh" build
"$ROOT/run_stage.sh" start
# Idempotent GET wait only. No mutator retries or second start requests.
/usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B - <<'PY'
import json
import time
import urllib.request
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
for attempt in range(30):
    try:
        with opener.open('http://127.74.19.11:3586/api/health',timeout=2) as response:
            health=json.loads(response.read(65536))
            if (response.status==200 and health.get('service')=='openplan' and health.get('status')=='ok'
                and health.get('deployment',{}).get('commit')=='49e3fa2004c1'
                and health['deployment'].get('migrations')=={'expected':420,'latest':'20261017000017'}):break
    except (OSError,ValueError):pass
    time.sleep(1)
else:raise SystemExit('New health identity not ready. Preserve startup evidence; do not restart.')
PY
"$ROOT/run_stage.sh" attest
/usr/bin/printf '%s\n' 'Operating stages finished. Root must read actual receipts and collect desktop/390px journey evidence.'
