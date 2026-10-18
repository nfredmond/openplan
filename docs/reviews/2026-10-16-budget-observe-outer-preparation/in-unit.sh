#!/bin/bash
set -euo pipefail
p=/home/nathaniel/.local/state/openplan/budget-observe-outer-preparation-20261016
old=/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016
cap=/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2
exec /usr/bin/bwrap --ro-bind / / --bind "$p" "$p" --ro-bind "$old" "$old" --bind "$cap" "$cap" \
 --ro-bind "$p/drafts" "$p/drafts" \
 --ro-bind "$p/source" "$p/source" \
 --ro-bind /home/nathaniel/.t3/worktrees/openplan/t3-c93f6f08/docs/reviews/2026-10-16-budget-catalog-settings-independent /home/nathaniel/.t3/worktrees/openplan/t3-c93f6f08/docs/reviews/2026-10-16-budget-catalog-settings-independent \
 --ro-bind /home/nathaniel/.t3/worktrees/openplan/t3-8ee24700/docs/reviews/2026-10-16-budget-settings-native-capture-operation-independent /home/nathaniel/.t3/worktrees/openplan/t3-8ee24700/docs/reviews/2026-10-16-budget-settings-native-capture-operation-independent \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-native-observe-preparation-20261016 /home/nathaniel/.local/state/openplan/budget-native-observe-preparation-20261016 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-catalog-root-decision-20261016 /home/nathaniel/.local/state/openplan/budget-catalog-root-decision-20261016 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-settings-pure-root-decision-20261016 /home/nathaniel/.local/state/openplan/budget-settings-pure-root-decision-20261016 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-settings-trial02-root-decision-20261016 /home/nathaniel/.local/state/openplan/budget-settings-trial02-root-decision-20261016 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-catalog-capture-controls-20261016 /home/nathaniel/.local/state/openplan/budget-catalog-capture-controls-20261016 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2 /home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/outer-v2 /home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/outer-v2 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-catalog-outer-transport-20261016 /home/nathaniel/.local/state/openplan/budget-catalog-outer-transport-20261016 \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-settings-native-capture-root-decision-20261016 /home/nathaniel/.local/state/openplan/budget-settings-native-capture-root-decision-20261016 \
 --ro-bind /home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74 /home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74 \
 --ro-bind /home/nathaniel/.t3/worktrees/openplan/t3-e4106cfb /home/nathaniel/.t3/worktrees/openplan/t3-e4106cfb \
 --ro-bind /home/nathaniel/.local/state/openplan/budget-settings-observe-proposal-20261016 /home/nathaniel/.local/state/openplan/budget-settings-observe-proposal-20261016 \
 --ro-bind "$cap/capture-attempt" "$cap/capture-attempt" \
 --ro-bind "$cap/capture_catalog.py" "$cap/capture_catalog.py" \
 --ro-bind "$cap/catalog-capture.sql" "$cap/catalog-capture.sql" \
 --ro-bind "$cap/catalog-capture-request.json" "$cap/catalog-capture-request.json" \
 --ro-bind "$cap/run-capture-window.sh" "$cap/run-capture-window.sh" \
 --ro-bind "$cap/build_observe_proposal.py" "$cap/build_observe_proposal.py" \
 --ro-bind "$cap/observe-bindings.required.json" "$cap/observe-bindings.required.json" \
 --ro-bind "$cap/observe-input.json" "$cap/observe-input.json" \
 --ro-bind "$cap/capture-grant.json" "$cap/capture-grant.json" \
 --ro-bind "$cap/capture-review.md" "$cap/capture-review.md" \
 --ro-bind "$cap/capture-window.json" "$cap/capture-window.json" \
 --ro-bind "$cap/capture-manager-terminal.json" "$cap/capture-manager-terminal.json" \
 --ro-bind "$cap/capture-outer-terminal.json" "$cap/capture-outer-terminal.json" \
 --ro-bind "$cap/observe-bindings.actual.json" "$cap/observe-bindings.actual.json" \
 --ro-bind "$cap/observe-review.md" "$cap/observe-review.md" \
 --ro-bind "$cap/observe-window.json" "$cap/observe-window.json" \
 --ro-bind "$cap/observe-publication.json" "$cap/observe-publication.json" \
 --ro-bind "$p/run-observe-window.sh" "$p/run-observe-window.sh" \
 --ro-bind "$p/parent-recorder.py" "$p/parent-recorder.py" \
 --ro-bind "$p/controls.py" "$p/controls.py" \
 --ro-bind "$p/prepare_once.py" "$p/prepare_once.py" \
 --ro-bind "$p/in-unit.sh" "$p/in-unit.sh" \
 --ro-bind "$p/run-preparation-window.sh" "$p/run-preparation-window.sh" \
 --ro-bind "$p/source-pins.json" "$p/source-pins.json" \
 --ro-bind "$p/preparation-request.json" "$p/preparation-request.json" \
 --ro-bind "$p/pure-grant.json" "$p/pure-grant.json" \
 --ro-bind "$p/root-outer-intent.json" "$p/root-outer-intent.json" \
 --ro-bind "$p/parent-intent-contract.json" "$p/parent-intent-contract.json" \
 --unshare-net --die-with-parent --chdir "$p" --dev-bind /dev/null /dev/null \
 /usr/bin/env -i PATH=/usr/bin:/bin HOME="$p/home" TMPDIR="$p/tmp" XDG_CACHE_HOME="$p/cache" \
 INVOCATION_ID="${INVOCATION_ID:?actual-pure-unit-invocation-required}" PYTHONDONTWRITEBYTECODE=1 \
 /usr/bin/python3 -B "$p/prepare_once.py" --prepare-once
