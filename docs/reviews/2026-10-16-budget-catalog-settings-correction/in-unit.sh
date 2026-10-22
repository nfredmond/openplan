#!/bin/bash
set -euo pipefail
p=/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016
old=/home/nathaniel/.local/state/openplan/budget-native-observe-preparation-20261016
outer=/home/nathaniel/.local/state/openplan/budget-catalog-outer-transport-20261016
proof=/home/nathaniel/.local/state/openplan/budget-catalog-capture-controls-20261016
subject=/home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74/docs/reviews/2026-10-16-project-budget-native-target-controller
repo=/home/nathaniel/.t3/worktrees/openplan/t3-e4106cfb
exec /usr/bin/bwrap --ro-bind / / --bind "$p" "$p" --ro-bind "$old" "$old" \
 --ro-bind "$outer" "$outer" --ro-bind "$proof" "$proof" --ro-bind "$subject" "$subject" \
 --ro-bind "$repo" "$repo" --unshare-net --die-with-parent --chdir "$p" \
 --dev-bind /dev/null /dev/null \
 /usr/bin/env -i PATH=/usr/bin:/bin HOME="$p/home" TMPDIR="$p/tmp" XDG_CACHE_HOME="$p/cache" \
 INVOCATION_ID="${INVOCATION_ID:?actual-manager-invocation-required}" PYTHONDONTWRITEBYTECODE=1 \
 /usr/bin/python3 -B "$p/pure_runner.py"
