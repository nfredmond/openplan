#!/bin/sh
# Fixed test-only commands. Never dispatch the real application controller.
set -eu
umask 077
root=/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-round2-20261015
review=/home/nathaniel/.t3/worktrees/openplan/t3-b1d2b569/docs/reviews/2026-10-15-current-project-preview-app-binding-independent-round2
stage=$1
case "$stage" in
  entry)
    exec /usr/bin/systemd-run --user --wait --pipe --unit="openplan-review-r2-entry-controller-$2" \
      -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" PYTHONDONTWRITEBYTECODE=1 \
      XDG_RUNTIME_DIR="/run/user/$(/usr/bin/id -u)" \
      /usr/bin/python3 -B "$review/entry_probe.py"
    ;;
  composition|boundary)
    exec /usr/bin/systemd-run --user --wait --pipe --unit="openplan-review-r2-$stage-$2" \
      -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" PYTHONDONTWRITEBYTECODE=1 \
      XDG_RUNTIME_DIR="/run/user/$(/usr/bin/id -u)" \
      /usr/bin/python3 -B "$review/replay.py" "$stage"
    ;;
  prepare|consumer|attestation|small) set -- /usr/bin/python3 -B "$review/replay.py" "$stage" ;;
  before|after) set -- /usr/bin/python3 -B "$review/preservation.py" "$stage" ;;
  audit) set -- /usr/bin/python3 -B "$review/audit.py" ;;
  guards) set -- /usr/bin/python3 -B "$review/guard_probe.py" ;;
  final) set -- /usr/bin/python3 -B "$review/finalize.py" ;;
  direction)
    set -- /usr/bin/npm run product:direction:check
    ;;
  *) exit 2 ;;
esac
exec /usr/bin/systemd-run --user --wait --pipe --unit="openplan-review-r2-$stage-01" \
  -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
  /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --unshare-net \
  --bind "$root" "$root" --bind "$root/tmp" /tmp \
  --chdir /home/nathaniel/.t3/worktrees/openplan/t3-b1d2b569/openplan \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" XDG_CACHE_HOME="$root/cache" \
  npm_config_cache="$root/npm-cache" npm_config_logs_dir="$root/npm-cache/_logs" \
  NODE_OPTIONS=--max-old-space-size=640 PYTHONDONTWRITEBYTECODE=1 "$@"
