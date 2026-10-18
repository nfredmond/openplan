#!/usr/bin/env bash
# Launch the AequilibraE worker with its Python virtualenv.
#
# The heavy deps (aequilibrae, numpy, pandas, shapely) live ONLY in a dedicated
# venv — NOT in the system python3 — so `python3 main.py` fails on a fresh
# checkout. Validate requirements and imports before entering the worker.
# OPENPLAN_AEQUILIBRAE_PYTHON binds an external absolute interpreter path, with
# no fallback on failure. Otherwise, try .venv311 then .venv. See LOCAL.md.
set -euo pipefail
cd "$(dirname "$0")"

AEQ_PY=""
if [ "${OPENPLAN_AEQUILIBRAE_PYTHON+x}" = x ]; then
  AEQ_PY="$OPENPLAN_AEQUILIBRAE_PYTHON"
  if [[ "$AEQ_PY" != /* ]] || [ ! -x "$AEQ_PY" ]; then
    echo "ERROR: OPENPLAN_AEQUILIBRAE_PYTHON must name an executable absolute interpreter path: $AEQ_PY" >&2
    exit 1
  fi
  if ! "$AEQ_PY" -B check_local_dependencies.py; then
    echo "ERROR: explicitly selected AequilibraE interpreter failed preflight; no fallback: $AEQ_PY" >&2
    exit 1
  fi
else
  for py in .venv311/bin/python .venv/bin/python; do
    if [ -x "$py" ]; then
      if "$py" -B check_local_dependencies.py; then AEQ_PY="$py"; break; fi
      echo "NOTE: rejecting incompatible AequilibraE interpreter: $py" >&2
    fi
  done
fi
if [ -n "$AEQ_PY" ]; then
  echo "Starting AequilibraE worker with $AEQ_PY"
  exec "$AEQ_PY" -u main.py
fi

cat >&2 <<'EOF'
ERROR: no AequilibraE interpreter satisfies workers/aequilibrae_worker/requirements.txt.
Create one (see workers/aequilibrae_worker/LOCAL.md):

  cd workers/aequilibrae_worker
  python3 -m venv .venv311
  ./.venv311/bin/pip install -r requirements.txt

Then re-run `npm run worker:aequilibrae`, or set OPENPLAN_AEQUILIBRAE_PYTHON
to a compatible external interpreter's absolute path.
EOF
exit 1
