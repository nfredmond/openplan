#!/bin/bash
# SOURCE PREPARATION ONLY. Root separately admits one OBSERVE operation.
set -euo pipefail
umask 077
exec 9<>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n -x 9
set +e
/usr/bin/systemd-run --user --wait --pipe --unit=openplan-budget-settings-v2-observe \
 -p RuntimeMaxSec=300 -p MemoryMax=512M -p MemorySwapMax=0 \
 -p CPUQuota=50% -p TasksMax=64 -p UMask=0077 \
 /usr/bin/python3 -B \
 /home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2/controller.py \
 --run observe
observe_manager_code=$?
set -e
# Keep the same exclusive FD across the one fixed raw post-show.
/usr/bin/systemctl --user show openplan-budget-settings-v2-observe.service \
 --no-pager --property=Id,InvocationID,Result,ExecMainCode,ExecMainStatus,ActiveState,SubState,MemoryPeak,MemorySwapPeak,CPUUsageNSec,RuntimeMaxUSec,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax
exit "$observe_manager_code"
