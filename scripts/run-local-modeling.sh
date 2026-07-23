#!/usr/bin/env bash
# Start the OpenPlan LOCAL modeling stack on your own machine:
#   • the AequilibraE screening worker  (network + skims + screening KPIs)
#   • the ActivitySim behavioral worker (input bundle + ActivitySim run)
#
# Both poll your LOCAL Supabase. Launch a "Behavioral Demand" run (or "Fast
# Screening") from the app and it flows through both workers. Ctrl-C stops both.
#
# This is the interim self-hosted path — no cloud host required. Real ActivitySim
# runs are uncalibrated/starter-grade until county calibration is added; the app
# labels everything accordingly (never a forecast).
#
# Prereqs:
#   • Local Supabase running (npm exec supabase start).
#   • AequilibraE venv: workers/aequilibrae_worker/.venv311
#       python3 -m venv workers/aequilibrae_worker/.venv311
#       workers/aequilibrae_worker/.venv311/bin/pip install -r workers/aequilibrae_worker/requirements.txt
#   • (For REAL ActivitySim execution) exec venv: workers/activitysim_worker/.venv-exec
#       python3.11 -m venv workers/activitysim_worker/.venv-exec
#       workers/activitysim_worker/.venv-exec/bin/pip install -r workers/activitysim_worker/requirements-exec.txt python-dotenv
#     Without it, the ActivitySim stage runs in honest PREFLIGHT-ONLY mode.
set -euo pipefail
cd "$(dirname "$0")/.."  # repo root

# --- AequilibraE worker interpreter (must import aequilibrae) ---
AEQ_PY=""
for py in workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/.venv/bin/python; do
  if [ -x "$py" ] && "$py" -c "import aequilibrae" >/dev/null 2>&1; then AEQ_PY="$py"; break; fi
done
if [ -z "$AEQ_PY" ]; then
  echo "ERROR: no AequilibraE venv with deps found. Build one:" >&2
  echo "  python3 -m venv workers/aequilibrae_worker/.venv311" >&2
  echo "  workers/aequilibrae_worker/.venv311/bin/pip install -r workers/aequilibrae_worker/requirements.txt" >&2
  exit 1
fi

# --- ActivitySim worker interpreter (exec venv → real runs; else preflight-only) ---
AS_PY=""
AS_MODE="PREFLIGHT-ONLY (no ActivitySim installed)"
EXEC_PY="workers/activitysim_worker/.venv-exec/bin/python"
if [ -x "$EXEC_PY" ] && "$EXEC_PY" -c "import activitysim, requests, dotenv" >/dev/null 2>&1; then
  AS_PY="$EXEC_PY"
  export ACTIVITYSIM_CLI="$PWD/workers/activitysim_worker/.venv-exec/bin/activitysim"
  AS_MODE="EXECUTION (real ActivitySim — uncalibrated/starter)"
else
  for py in workers/aequilibrae_worker/.venv311/bin/python python3; do
    if command -v "${py%% *}" >/dev/null 2>&1 && "$py" -c "import requests, dotenv" >/dev/null 2>&1; then AS_PY="$py"; break; fi
  done
  echo "NOTE: ActivitySim exec venv not found → the ActivitySim stage runs PREFLIGHT-ONLY."
  echo "      For real runs, build it (see the header of this script)."
fi
if [ -z "$AS_PY" ]; then
  echo "ERROR: no interpreter with 'requests' for the ActivitySim worker." >&2
  exit 1
fi

echo "──────────────────────────────────────────────────────────────"
echo " OpenPlan local modeling stack"
echo "   AequilibraE worker : $AEQ_PY"
echo "   ActivitySim worker : $AS_PY"
echo "                        [$AS_MODE]"
echo "   Launch a run from the app; Ctrl-C stops both workers."
echo "──────────────────────────────────────────────────────────────"

pids=()
"$AEQ_PY" -u workers/aequilibrae_worker/main.py & pids+=("$!")
"$AS_PY" -u workers/activitysim_worker/supabase_poll.py & pids+=("$!")
trap 'echo; echo "stopping workers..."; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true' INT TERM EXIT
wait
