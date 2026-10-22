#!/bin/sh
# Parent only, one reviewed stage per invocation. Never automatically continue.
set -eu
umask 077
ROOT=/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5
REPO=/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad
[ "$#" -eq 2 ] || { /usr/bin/printf '%s\n' 'Supply accepted ROUND2 review commit and exactly one stage.' >&2; exit 2; }
review=$1
stage=$2
case "$review" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#review}" -eq 40 ] || exit 2
/usr/bin/git -C "$REPO" cat-file -e "$review^{commit}"
case "$stage" in preflight|restore|upgrade|services|active-check|checkout|build|start|attest|post-journey) ;; *) exit 2 ;; esac
/usr/bin/sha256sum --check --strict --status <<'SEALED'
88763144a835d0ef84df3c746ca92708fe39206df0acb7db34f194a8864dd7db  /home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5/operation-files.sha256
9448a7be67d1bbb297c51095d98ea57a70a6edf4a58f00e145838cbefe4809ca  /home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5/run_stage.sh
SEALED
/usr/bin/sha256sum --check --strict "$ROOT/operation-files.sha256" >/dev/null
exec 9>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n 9 || { /usr/bin/printf '%s\n' 'Shared lock occupied. No stage requested.' >&2; exit 2; }
# This gate checks admission and predecessor receipts; domain guards reacquire facts.
# Commit existence is not approval. Root must read the fresh review before admission.
/usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B - "$review" "$stage" <<'PY'
import json
import os
from pathlib import Path
import sys
root=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
review,stage=sys.argv[1:]
admission=root/'execution/parent-round2-admission.json'
if stage=='preflight':
    fd=os.open(admission,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'acceptedReviewCommit':review},f);f.write('\n');f.flush();os.fsync(f.fileno())
    fd=os.open(admission.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
else:
    if not admission.is_file() or admission.is_symlink() or json.loads(admission.read_text())!={'acceptedReviewCommit':review}:raise SystemExit('ROUND2 admission differs or is absent')
required={'preflight':[], 'restore':['preflight-ready.json'], 'upgrade':['clone-ready.json'],
    'services':['upgrade-ready.json'], 'active-check':['service-receipts-private.json'],
    'checkout':['service-receipts-private.json'], 'build':['execution/checkout-ready.json'],
    'start':['execution/build-result.json'], 'attest':['execution/start-intent.json'],
    'post-journey':['runtime-start-attestation.json','protected-runtime-before.json']}[stage]
for name in required:
    p=root/name
    if not p.is_file() or p.is_symlink():raise SystemExit('Required preceding artifact absent: '+name)
PY
# The runner reserves this one request. Inspect exit, invocation, receipts and
# partial state before issuing another stage. Start acceptance is not readiness.
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus /bin/sh "$ROOT/run_stage.sh" "$stage"
