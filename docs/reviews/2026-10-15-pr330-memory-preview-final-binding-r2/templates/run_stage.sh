#!/bin/sh
# Parent only. Trusted controllers run in host context; npm uses the inner wrapper.
set -eu
umask 077
ROOT=/dev/shm/openplan-pr330-preview-20261015
DURABLE=/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2
[ "$#" -eq 1 ] || exit 2
/usr/bin/sha256sum --check --strict "$ROOT/operation-files.sha256" >/dev/null
stage=$1
case "$stage" in
  preflight|restore|upgrade|services|verify-services|post-journey) controller=helper.py; memory=512M ;;
  active-check) controller=app_binding_v1.py; memory=512M ;;
  checkout) controller=app_binding_v1.py; memory=1G ;;
  archive) controller=storage_stage.py; memory=512M ;;
  build) controller=app_binding_v1.py; memory=10G ;;
  start) controller=app_binding_v1.py; memory=512M ;;
  attest) controller=attest_start_v1.py; memory=512M ;;
  *) exit 2 ;;
esac
# One request per stage. A failure or lost acknowledgement is retained for review.
/usr/bin/python3 -B "$ROOT/journal.py" claim "request-$stage"
/bin/mkdir -m 700 "$ROOT/execution/request-$stage"
if [ "$stage" = start ]; then
  exec /usr/bin/python3 -B "$ROOT/journal.py" execute "unit-$stage" -- /usr/bin/systemd-run --user --unit=openplan-pr330-memory-f0cbeddff-r2-web \
    -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
    -p StandardOutput=append:/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2/journal/unit-start/web-stdout.bin \
    -p StandardError=append:/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2/journal/unit-start/web-stderr.bin \
    -p "ExecStopPost=/usr/bin/python3 -B /home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2/templates/journal.py stopped-web" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/python3 -B "$ROOT/$controller" "$stage"
fi
if [ "$stage" = attest ]; then
  # No enclosing bwrap user namespace. The strict observer needs host /proc access.
  exec /usr/bin/python3 -B "$ROOT/journal.py" execute "unit-$stage" -- /usr/bin/systemd-run --user --wait --pipe --unit=openplan-pr330-memory-f0cbeddff-r2-attest \
    -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/python3 -B "$ROOT/$controller"
fi
if [ "$stage" = active-check ] || [ "$stage" = checkout ]; then
  exec /usr/bin/python3 -B "$ROOT/journal.py" execute "unit-$stage" -- /usr/bin/systemd-run --user --wait --pipe --unit="openplan-pr330-memory-f0cbeddff-r2-$stage" \
    -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
    /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --dir /dev/shm \
    --bind "$ROOT" "$ROOT" --bind "$DURABLE/journal" "$DURABLE/journal" \
    --bind "$DURABLE/receipts" "$DURABLE/receipts" --bind "$ROOT/tmp" /tmp \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/python3 -B "$ROOT/$controller" "$stage"
fi
exec /usr/bin/python3 -B "$ROOT/journal.py" execute "unit-$stage" -- /usr/bin/systemd-run --user --wait --pipe --unit="openplan-pr330-memory-f0cbeddff-r2-$stage" \
  -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
  /usr/bin/python3 -B "$ROOT/$controller" "$stage"
