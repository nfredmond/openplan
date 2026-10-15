#!/bin/sh
# Offline test entry only. Never dispatch the application controller.
set -eu
umask 077
root=/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3
public=/home/nathaniel/.t3/worktrees/openplan/t3-c2662e5b/docs/reviews/2026-10-15-current-project-preview-app-binding-v3
stage=$1
attempt=$2
serial=/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
case "$stage" in
  composition|entry)
    exec /usr/bin/flock "$serial" /usr/bin/systemd-run --user --wait --pipe --unit="openplan-binding-v3-$stage-$2" \
      -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" PYTHONDONTWRITEBYTECODE=1 XDG_RUNTIME_DIR="/run/user/$(/usr/bin/id -u)" \
      /usr/bin/python3 -B "$public/verify_$stage.py"
    ;;
  controls|attestation|identity|mechanical) set -- /usr/bin/python3 -B "$public/verify_$stage.py" ;;
  seal) set -- /usr/bin/python3 -B "$public/seal_v3.py" ;;
  direction) set -- /usr/bin/npm run product:direction:check ;;
  *) exit 2 ;;
esac
exec /usr/bin/flock "$serial" /usr/bin/systemd-run --user --wait --pipe --unit="openplan-binding-v3-$stage-$attempt" \
  -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
  /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --unshare-net \
  --bind "$root" "$root" --bind "$root/tmp" /tmp --chdir /home/nathaniel/.t3/worktrees/openplan/t3-c2662e5b/openplan \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" XDG_CACHE_HOME="$root/cache" \
  npm_config_cache="$root/npm-cache" npm_config_logs_dir="$root/npm-cache/_logs" \
  NODE_OPTIONS=--max-old-space-size=640 PYTHONDONTWRITEBYTECODE=1 "$@"
