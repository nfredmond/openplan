#!/usr/bin/env bash
# Launch the ActivitySim behavioral-demand worker (Supabase poll/claim loop).
#
# Prefer the execution venv when it is present and complete. Otherwise retain
# the honest preflight-only fallback, which needs only requests + python-dotenv.
# See DEPLOY.md for the execution environment contract.
set -euo pipefail
cd "$(dirname "$0")"

exec_py=.venv-exec/bin/python
exec_cli="$PWD/.venv-exec/bin/activitysim"
if [ -x "$exec_py" ] && [ -x "$exec_cli" ] && "$exec_py" -c "import activitysim, requests, dotenv" >/dev/null 2>&1; then
  export ACTIVITYSIM_CLI="$exec_cli"
  echo "Starting ActivitySim execution worker with $exec_py"
  exec "$exec_py" -u supabase_poll.py
fi

for py in .venv/bin/python .venv311/bin/python python3; do
  if command -v "${py%% *}" >/dev/null 2>&1 && "$py" -c "import requests, dotenv" >/dev/null 2>&1; then
    echo "Starting ActivitySim preflight-only worker with $py"
    exec "$py" -u supabase_poll.py
  fi
done

cat >&2 <<'EOF'
ERROR: no interpreter with `requests` was found for the ActivitySim worker.
Create a venv:

  cd workers/activitysim_worker
  python3 -m venv .venv
  ./.venv/bin/pip install -r requirements.txt

Then re-run `npm run worker:activitysim`.
EOF
exit 1
