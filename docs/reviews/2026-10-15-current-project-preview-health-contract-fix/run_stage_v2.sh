#!/bin/sh
# Reviewed trusted controller arrangement. This file has a fixed private root.
set -eu
umask 077
ROOT=/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2
[ "$#" -eq 1 ] || exit 2
/usr/bin/sha256sum --check --strict "$ROOT/operation-files.sha256" >/dev/null
case "$1" in
  build)
    exec /usr/bin/systemd-run --user --wait --pipe --unit=openplan-current-project-preview-app-678-v1-build \
      -p MemoryMax=10G -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B "$ROOT/app_binding_v1.py" build
    ;;
  start)
    exec /usr/bin/systemd-run --user --unit=openplan-current-project-preview-app-678-v1-web \
      -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B "$ROOT/app_binding_v1.py" start
    ;;
  active-check|checkout|attest)
    stage=$1
    if [ "$stage" = attest ]; then
      set -- /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B "$ROOT/attest_start_v1.py"
    else
      set -- /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B "$ROOT/app_binding_v1.py" "$stage"
    fi
    exec /usr/bin/systemd-run --user --wait --pipe --unit="openplan-current-project-preview-app-678-v1-$stage" \
      -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc \
      --bind "$ROOT" "$ROOT" --bind "$ROOT/tmp" /tmp "$@"
    ;;
  *) exit 2 ;;
esac
