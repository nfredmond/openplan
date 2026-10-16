#!/bin/sh
# Preparation checks only. This script cannot select actual runtime attestation.
set -eu
umask 077
root=/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-fix-20261015
repo=/home/nathaniel/.t3/worktrees/openplan/t3-8b345466
public=$repo/docs/reviews/2026-10-15-current-project-preview-host-attestation-fix
[ "$#" -eq 2 ] || exit 2
case "$1" in
  direction) set -- "$1" "$2" /usr/bin/npm run product:direction:check ;;
  final) set -- "$1" "$2" /usr/bin/python3 -B "$public/final_checks.py" ;;
  *) exit 2 ;;
esac
stage=$1
attempt=$2
shift 2
exec /usr/bin/flock /home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock \
  /usr/bin/systemd-run --user --wait --pipe --unit="openplan-host-attest-fix-$stage-$attempt" \
  -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
  /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --unshare-net \
  --bind "$root" "$root" --bind "$root/tmp" /tmp --chdir "$repo/openplan" \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" PYTHONDONTWRITEBYTECODE=1 \
  XDG_RUNTIME_DIR=/run/user/1000 XDG_CACHE_HOME="$root/cache" npm_config_cache="$root/npm-cache" \
  npm_config_logs_dir="$root/npm-cache/_logs" "$@"
