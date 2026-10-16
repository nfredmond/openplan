#!/bin/bash
# PREPARED ONLY. Root must grant the exact sealed invocation first.
set -euo pipefail
p=/home/nathaniel/.local/state/openplan/project-budget-native-target-controller-20261016
exec 9>>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n -s 9
/usr/bin/readlink /proc/self/ns/net > "$p/host-netns.txt"
/usr/bin/systemd-run --user --wait --pipe --unit=openplan-budget-target-pure01 \
 -p RuntimeMaxSec=180 -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p TasksMax=64 -p UMask=0077 \
 /usr/bin/bwrap --ro-bind / / --bind "$p" "$p" --unshare-net --die-with-parent --chdir "$p" \
 --dev-bind /dev/null /dev/null \
 /usr/bin/env -i PATH=/usr/bin:/bin HOME="$p/home" TMPDIR="$p/tmp" XDG_CACHE_HOME="$p/cache" \
 PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B "$p/window_runner.py"
