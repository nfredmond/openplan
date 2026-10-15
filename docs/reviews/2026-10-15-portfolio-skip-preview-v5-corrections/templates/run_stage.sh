#!/bin/sh
# Parent only. Trusted controllers run in host context; npm uses the inner wrapper.
set -eu
umask 077
ROOT=/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5
[ "$#" -eq 1 ] || exit 2
/usr/bin/sha256sum --check --strict "$ROOT/operation-files.sha256" >/dev/null
stage=$1
case "$stage" in
  preflight|restore|upgrade|services|verify-services|post-journey) controller=helper.py; memory=512M ;;
  active-check|checkout) controller=app_binding_v1.py; memory=512M ;;
  build) controller=app_binding_v1.py; memory=10G ;;
  start) controller=app_binding_v1.py; memory=512M ;;
  attest) controller=attest_start_v1.py; memory=512M ;;
  *) exit 2 ;;
esac
# One request per stage. A failure or lost acknowledgement is retained for review.
/bin/mkdir -m 700 "$ROOT/execution/request-$stage"
if [ "$stage" = start ]; then
  exec /usr/bin/systemd-run --user --unit=openplan-portfolio-skip-preview-49e3fa200-v5-web \
    -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/python3 -B "$ROOT/$controller" "$stage"
fi
if [ "$stage" = attest ]; then
  # No enclosing bwrap user namespace. The strict observer needs host /proc access.
  exec /usr/bin/systemd-run --user --wait --pipe --unit=openplan-portfolio-skip-preview-49e3fa200-v5-attest \
    -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/python3 -B "$ROOT/$controller"
fi
if [ "$stage" = active-check ] || [ "$stage" = checkout ]; then
  exec /usr/bin/systemd-run --user --wait --pipe --unit="openplan-portfolio-skip-preview-49e3fa200-v5-$stage" \
    -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
    /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc \
    --bind "$ROOT" "$ROOT" --bind "$ROOT/tmp" /tmp \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/python3 -B "$ROOT/$controller" "$stage"
fi
exec /usr/bin/systemd-run --user --wait --pipe --unit="openplan-portfolio-skip-preview-49e3fa200-v5-$stage" \
  -p MemoryMax="$memory" -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \
  /usr/bin/python3 -B "$ROOT/$controller" "$stage"
