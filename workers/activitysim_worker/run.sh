#!/usr/bin/env bash
# Launch the ActivitySim behavioral-preflight worker (Supabase poll/claim loop).
#
# The L1/L2 preflight loop only needs `requests` + `python-dotenv` (stdlib
# otherwise), so it can run on the system python3 or a light venv. The L3
# execution path (real ActivitySim runs) needs the heavier deps + a dedicated
# host — see DEPLOY.md. This picks the first interpreter that can import
# `requests`, preferring a local venv.
set -euo pipefail
cd "$(dirname "$0")"

for py in .venv/bin/python .venv311/bin/python python3; do
  if command -v "${py%% *}" >/dev/null 2>&1 && "$py" -c "import requests" >/dev/null 2>&1; then
    echo "Starting ActivitySim behavioral-preflight worker with $py"
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
