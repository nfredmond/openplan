#!/bin/sh
# Serial offline fixture entry point. This never invokes the application CLI.
set -eu
umask 077
root=/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2
public=/home/nathaniel/.t3/worktrees/openplan/t3-f129cb09/docs/reviews/2026-10-15-current-project-preview-health-contract-fix
case "$1" in
  attestation) script=verify_attestation.py ;;
  small) script=verify_small_guards.py ;;
  boundary)
    exec systemd-run --user --wait --pipe --unit="openplan-health-v2-boundary-$2" \
      -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" PYTHONDONTWRITEBYTECODE=1 \
      /usr/bin/python3 -B "$public/verify_boundary.py"
    ;;
  controls) script=verify_controls.py ;;
  *) exit 2 ;;
esac
exec systemd-run --user --wait --pipe --unit="openplan-health-v2-$1-$2" \
  -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
  /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --unshare-net \
  --bind "$root" "$root" --bind "$root/tmp" /tmp \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" XDG_CACHE_HOME="$root/cache" \
  npm_config_cache="$root/npm-cache" npm_config_logs_dir="$root/npm-cache/_logs" \
  PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B "$public/$script"
