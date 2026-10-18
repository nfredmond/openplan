#!/bin/sh
# Review fixtures only. No application operation can be selected here.
set -eu
umask 077
root=/home/nathaniel/.local/state/openplan/current-project-preview-v3-independent-round3-20261015
repo=/home/nathaniel/.t3/worktrees/openplan/t3-f7deea0c
public=$repo/docs/reviews/2026-10-15-current-project-preview-v3-independent-round3
stage=$1
attempt=$2
case "$stage" in
  direction) set -- /usr/bin/npm run product:direction:check ;;
  audit|identity|composition|final) set -- /usr/bin/python3 -B "$public/$stage.py" ;;
  *) exit 2 ;;
esac
if [ "$stage" = composition ]; then
  exec /usr/bin/flock /home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock \
    /usr/bin/systemd-run --user --wait --pipe --unit="openplan-review-v3-r3-$stage-$attempt" \
    -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" PYTHONDONTWRITEBYTECODE=1 XDG_RUNTIME_DIR="/run/user/$(/usr/bin/id -u)" "$@"
fi
exec /usr/bin/flock /home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock \
  /usr/bin/systemd-run --user --wait --pipe --unit="openplan-review-v3-r3-$stage-$attempt" \
  -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p UMask=0077 \
  /usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --unshare-net \
  --bind "$root" "$root" --bind "$root/tmp" /tmp --chdir "$repo/openplan" \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$root/home" PYTHONDONTWRITEBYTECODE=1 \
  XDG_CACHE_HOME="$root/cache" npm_config_cache="$root/npm-cache" npm_config_logs_dir="$root/npm-cache/_logs" \
  NODE_OPTIONS=--max-old-space-size=640 "$@"
