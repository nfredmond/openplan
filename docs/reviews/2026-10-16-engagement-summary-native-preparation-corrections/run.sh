#!/bin/bash
# UNRUN. One exact root grant required. A free compiler window grants nothing.
set -euo pipefail
p=/home/nathaniel/.local/state/openplan/engagement-summary-native-preparation-corrections-20261016
old=/home/nathaniel/.t3/worktrees/openplan/t3-c02aa002/docs/reviews/2026-10-16-engagement-summary-native-proof-preparation
oldprivate=/home/nathaniel/.local/state/openplan/engagement-summary-native-proof-preparation-20261016
review=/home/nathaniel/.t3/worktrees/openplan/t3-2873bd16/docs/reviews/2026-10-16-engagement-summary-native-preparation-independent
umask 077
test -f "$p/grant.json"
/usr/bin/sha256sum -c "$p/inputs.sha256"
/usr/bin/mkdir "$p/dispatch-intent"
printf '%s\n' 'ONCE_RESERVED_NO_RETRY' > "$p/dispatch-intent/state.txt"
exec 9>>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n -x 9
/usr/bin/readlink /proc/self/ns/net > "$p/host-netns.txt"
/usr/bin/mkdir "$p/home" "$p/tmp" "$p/cache"
/usr/bin/systemd-run --user --wait --pipe --unit=openplan-engagement-prep-corrections-text01 \
 -p RuntimeMaxSec=120 -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p TasksMax=64 -p UMask=0077 \
 /usr/bin/bwrap --ro-bind / / --bind "$p" "$p" \
 --ro-bind "$old" "$old" --ro-bind "$oldprivate" "$oldprivate" --ro-bind "$review" "$review" \
 --ro-bind "$p/subject" "$p/subject" --unshare-net --die-with-parent --chdir "$p" \
 --dev-bind /dev/null /dev/null \
 /usr/bin/env -i PATH=/usr/bin:/bin HOME="$p/home" TMPDIR="$p/tmp" XDG_CACHE_HOME="$p/cache" \
 PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B "$p/controller.py"
