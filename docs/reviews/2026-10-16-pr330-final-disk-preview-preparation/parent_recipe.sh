#!/bin/sh
# One parent-admitted stage only. No admission exists during preparation.
set -eu
umask 077
DURABLE=/home/nathaniel/.local/state/openplan/pr330-final-disk-preview-20261016
ROOT=/home/nathaniel/.local/state/openplan/pr330-final-disk-working-20261016
REPO=/home/nathaniel/.local/state/openplan/pr330-final-disk-preview-worktree-20261016
[ "$#" -eq 2 ] || { printf '%s\n' 'BLOCKED: supply accepted final review commit and one stage.' >&2; exit 2; }
review=$1
stage=$2
case "$review" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#review}" -eq 40 ] || exit 2
case "$stage" in allocate|preflight|restore|upgrade|services|active-check|checkout|build|archive|start|attest|post-journey) ;; *) exit 2 ;; esac
/usr/bin/sha256sum --check --strict --status <<'SEALED'
38a998520f1fb22955ea778ac2452a166a3fe830acec392c3494dee2d23c4682  /home/nathaniel/.local/state/openplan/pr330-final-disk-preview-20261016/packet.json
63e67c428be61108dd489670664e71e9c4ba148334dae07529a2bafb6f31f5c0  /home/nathaniel/.local/state/openplan/pr330-final-disk-preview-20261016/runtime-inputs.sha256
SEALED
/usr/bin/sha256sum --check --strict --status "$DURABLE/runtime-inputs.sha256"
exec 9>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n 9 || { printf '%s\n' 'Shared lock occupied. No stage requested.' >&2; exit 2; }
# Existence of a commit is not approval. Parent reads the independent review and
# explicitly publishes one exclusive source/seal-bound admission after accepting it.
/usr/bin/env -i PATH=/usr/bin:/bin HOME="$DURABLE/home" PYTHONDONTWRITEBYTECODE=1 \
  /usr/bin/python3 -B - "$review" "$stage" <<'PY'
import json,sys
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/pr330-final-disk-preview-20261016')
sys.path.insert(0,str(root/'templates'))
import storage_stage
try:
    packet,accepted=storage_stage.admission()
    if accepted['reviewCommit']!=sys.argv[1]:raise ValueError('review differs')
    if sys.argv[2]=='allocate':storage_stage.m.observe_capacity()
    required={'allocate':[], 'preflight':['journal/allocate-working-root/result.json'],
      'restore':['receipts/preflight-ready.json'],'upgrade':['receipts/clone-ready.json'],
      'services':['receipts/upgrade-ready.json'],'active-check':['receipts/service-receipts-private.json'],
      'checkout':['receipts/service-receipts-private.json'],'build':['receipts/execution/checkout-ready.json'],
      'archive':['journal/unit-build/intent.json'],'start':['build-record/archive-ready.json','receipts/execution/build-result.json'],
      'attest':['receipts/execution/start-intent.json'],
      'post-journey':['receipts/runtime-start-attestation.json','receipts/protected-runtime-before.json']}[sys.argv[2]]
    for name in required:
        path=root/name
        if not path.is_file() or path.is_symlink():raise ValueError('predecessor absent')
except Exception:
    print('BLOCKED: final independent review/source/seal admission or predecessor is absent.',file=sys.stderr)
    raise SystemExit(2)
PY
/usr/bin/git -C "$REPO" cat-file -e "$review^{commit}"
if [ "$stage" = allocate ]; then
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$DURABLE/home" PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/python3 -B "$DURABLE/templates/journal.py" claim request-allocate
  exec /usr/bin/env -i PATH=/usr/bin:/bin HOME="$DURABLE/home" PYTHONDONTWRITEBYTECODE=1 \
    XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
    /usr/bin/python3 -B "$DURABLE/templates/journal.py" execute unit-allocate -- \
    /usr/bin/systemd-run --user --wait --pipe --unit=openplan-pr330-disk-607ee0895-allocate \
      -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME="$DURABLE/home" PYTHONDONTWRITEBYTECODE=1 \
      /usr/bin/python3 -B "$DURABLE/templates/storage_stage.py" allocate
fi
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME="$DURABLE/home" PYTHONDONTWRITEBYTECODE=1 \
  XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  /bin/sh "$ROOT/run_stage.sh" "$stage"
