#!/usr/bin/env bash
# Launch the AequilibraE worker with its Python virtualenv.
#
# The heavy deps (aequilibrae, numpy, pandas, shapely) live ONLY in a dedicated
# venv — NOT in the system python3 — so `python3 main.py` fails on a fresh
# checkout. This picks the first venv whose interpreter can import aequilibrae,
# and prints a clear setup hint if none is found. See LOCAL.md for venv setup.
set -euo pipefail
cd "$(dirname "$0")"

for py in .venv311/bin/python .venv/bin/python; do
  if [ -x "$py" ] && "$py" -c "import aequilibrae" >/dev/null 2>&1; then
    echo "Starting AequilibraE worker with $py"
    exec "$py" -u main.py
  fi
done

cat >&2 <<'EOF'
ERROR: no AequilibraE worker venv with dependencies was found.
Create one (see workers/aequilibrae_worker/LOCAL.md):

  cd workers/aequilibrae_worker
  python3 -m venv .venv311
  ./.venv311/bin/pip install -r requirements.txt

Then re-run `npm run worker:aequilibrae`.
EOF
exit 1
