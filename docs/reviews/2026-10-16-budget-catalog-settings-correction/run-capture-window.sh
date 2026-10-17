#!/bin/bash
# PREPARED ONLY. Root records intent and exact grant before this one invocation.
set -euo pipefail
umask 077
exec 9<>/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock
/usr/bin/flock -n -x 9
set +e
/usr/bin/systemd-run --user --wait --pipe --unit=openplan-budget-catalog-settings-v2-20261016 \
 -p RuntimeMaxSec=90 -p MemoryMax=512M -p MemorySwapMax=0 \
 -p CPUQuota=50% -p TasksMax=64 -p UMask=0077 \
 /usr/bin/python3 -B \
 /home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2/capture_catalog.py \
 --capture-once
capture_manager_code=$?
set -e
# Retain these fixed manager fields within the same exclusive acquisition.
# Root's existing outer transport bounds and preserves both output streams.
/usr/bin/systemctl --user show openplan-budget-catalog-settings-v2-20261016.service \
 --no-pager --property=Id,InvocationID,Result,ExecMainCode,ExecMainStatus,ActiveState,SubState,MemoryPeak,MemorySwapPeak,CPUUsageNSec,RuntimeMaxUSec,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax
exit "$capture_manager_code"
