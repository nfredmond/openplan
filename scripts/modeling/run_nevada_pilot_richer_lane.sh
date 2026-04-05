#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VENV_PY="$ROOT/data/pilot-nevada-county/.venv/bin/python"
DATA_DIR="$ROOT/data/pilot-nevada-county"
PROJECT_DB="$DATA_DIR/aeq_project/project_database.sqlite"
PROJECT_DB_SEED="$DATA_DIR/aeq_project/project_database_step5_seed.sqlite"
COUNTS_CSV="$DATA_DIR/validation/caltrans_2023_priority_counts.csv"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 2
  fi
}

require_file "$VENV_PY"
require_file "$PROJECT_DB"
require_file "$PROJECT_DB_SEED"
require_file "$COUNTS_CSV"
require_file "$DATA_DIR/ca_od_main_JT00_2021.csv.gz"
require_file "$DATA_DIR/ca_wac_S000_JT00_2021.csv.gz"
require_file "$DATA_DIR/caltrans_2023_aadt.xlsx"

"$VENV_PY" - <<'PY'
import importlib.util
mods = ["geopandas", "numpy", "pandas", "aequilibrae", "openmatrix", "tables"]
missing = [m for m in mods if importlib.util.find_spec(m) is None]
if missing:
    raise SystemExit(f"Missing Python modules in pilot venv: {missing}")
print("pilot venv dependency check passed")
PY

echo "[1/8] Rebuilding Nevada package artifacts from raw local sources"
"$VENV_PY" "$DATA_DIR/build_network_package.py"
"$VENV_PY" "$DATA_DIR/build_trip_tables.py"

echo "[2/8] Restoring clean pre-step5 project DB seed"
cp "$PROJECT_DB_SEED" "$PROJECT_DB"

echo "[3/8] Running clean step4 richer-demand rerun"
"$VENV_PY" "$DATA_DIR/step4_demand_improvement.py"

echo "[4/8] Hydrating full loaded-link geometry for clean v2 rerun"
"$VENV_PY" "$ROOT/scripts/modeling/hydrate_assignment_geometry.py" \
  --run-output-dir "$DATA_DIR/run_output_v2" \
  --project-db "$PROJECT_DB_SEED"

echo "[5/8] Standardized validation bundle for clean v2 rerun"
"$VENV_PY" "$ROOT/scripts/modeling/validate_screening_observed_counts.py" \
  --run-output-dir "$DATA_DIR/run_output_v2" \
  --counts-csv "$COUNTS_CSV" \
  --project-db "$PROJECT_DB_SEED" \
  --output-dir "$DATA_DIR/validation/rerun_clean_v2_from_seed"

echo "[6/8] Running clean step5 centroid-fix rerun"
"$VENV_PY" "$DATA_DIR/step5_centroid_connector_fix.py"

echo "[7/8] Hydrating full loaded-link geometry for clean v3 rerun"
"$VENV_PY" "$ROOT/scripts/modeling/hydrate_assignment_geometry.py" \
  --run-output-dir "$DATA_DIR/run_output_v3" \
  --project-db "$PROJECT_DB"

echo "[8/8] Standardized validation bundle for clean v3 rerun"
"$VENV_PY" "$ROOT/scripts/modeling/validate_screening_observed_counts.py" \
  --run-output-dir "$DATA_DIR/run_output_v3" \
  --counts-csv "$COUNTS_CSV" \
  --project-db "$PROJECT_DB" \
  --output-dir "$DATA_DIR/validation/rerun_clean_v3_from_seed"

echo "Nevada richer-demand rerun lane complete"
