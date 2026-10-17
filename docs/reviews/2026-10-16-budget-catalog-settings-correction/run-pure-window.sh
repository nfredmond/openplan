#!/bin/bash
# PREPARED ONLY. A later exact pure grant and parent outer intent are required.
set -euo pipefail
set -o noclobber
umask 077
p=/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016
exec 9<>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n -x 9
/usr/bin/readlink /proc/self/ns/net > "$p/host-netns.txt"
set +e
/usr/bin/systemd-run --user --wait --pipe --unit=openplan-budget-settings-v2-pure-20261016 \
 -p RuntimeMaxSec=120 -p MemoryMax=512M -p MemorySwapMax=0 \
 -p CPUQuota=50% -p TasksMax=64 -p UMask=0077 /bin/bash "$p/in-unit.sh"
pure_manager_code=$?
set -e
/usr/bin/systemctl --user show openplan-budget-settings-v2-pure-20261016.service \
 --no-pager --property=Id,InvocationID,Result,ExecMainCode,ExecMainStatus,ActiveState,SubState,MemoryPeak,MemorySwapPeak,CPUUsageNSec,RuntimeMaxUSec,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax
exit "$pure_manager_code"
