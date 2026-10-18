#!/bin/bash
# Proposed ONE pure/source preparation only. A NEW root grant is required.
set -euo pipefail
umask 077
exec 9<>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n -x 9
set +e
/usr/bin/systemd-run --user --wait --pipe --unit=openplan-budget-observe-outer-preparation-20261016-01 \
 -p RuntimeMaxSec=120 -p MemoryMax=512M -p MemorySwapMax=0 \
 -p CPUQuota=50% -p TasksMax=64 -p UMask=0077 \
 /bin/bash /home/nathaniel/.local/state/openplan/budget-observe-outer-preparation-20261016/in-unit.sh
pure_manager_code=$?
set -e
/usr/bin/systemctl --user show openplan-budget-observe-outer-preparation-20261016-01.service \
 --no-pager --property=Id,InvocationID,Result,ExecMainCode,ExecMainStatus,ActiveState,SubState,MemoryPeak,MemorySwapPeak,CPUUsageNSec,RuntimeMaxUSec,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax
exit "$pure_manager_code"
