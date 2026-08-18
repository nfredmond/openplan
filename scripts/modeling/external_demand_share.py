#!/usr/bin/env python3
"""How much of a run's traffic comes from outside the study area.

============================================================ WHY THIS EXISTS

Trips that cross the study-area boundary never pass through the gravity model.
They are injected at gateways with a **flat daily figure chosen by road class**
-- motorway 15,000, trunk 9,000, primary 6,000 -- identical in every county in
the country and observed nowhere, then routed all the way across the study area.
No demand parameter can move them: a trip-length sweep over five counties cut
model VMT per capita from 2.29x published to 1.38x and then stopped, because
what remained was largely this.

So the size of that term decides what to fix next, and it must be MEASURED
rather than inferred. Subtracting `internal_trips x avg_trip_miles` from network
VMT does not work: `avg_trip_miles` is centroid-to-centroid
(`internal_od_centroid_distance`), not the assigned network path, so it
understates internal VMT and overstates the external share. I published a
figure derived that way before checking, and this module is the correction.

============================================================== HOW IT MEASURES

Two runs of the SAME county with the SAME network, differing only in
`--external-demand-scalar`: one at 1.0 and one at 0.0. The second assigns
internal demand alone, so its network VMT is internal VMT on that network, and
the difference is what external demand put there.

**The subtraction is slightly biased, in a stated direction.** Assignment is not
additive: with external traffic removed the network is less congested, so
internal trips take marginally shorter paths than they do in the full run. The
internal-only figure is therefore a little low and the external share a little
high. Congestion effects are small at screening-grade volumes, but the bias is
one-directional and is reported rather than assumed away.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from gamma_fit_analysis import GammaFitError, county_population, network_vmt


class ExternalShareError(RuntimeError):
    """A pair that cannot be compared, named rather than skipped."""


def read_manifest(run_dir: Path) -> dict[str, Any]:
    summary = run_dir / "run_summary.json"
    if not summary.exists():
        raise ExternalShareError(f"{run_dir.name} has no run_summary.json — it did not finish")
    return json.loads(summary.read_text()).get("manifest", {})


def study_area_of(run_dir: Path) -> tuple[str, str]:
    """What area the run covered, from where the run actually records it.

    THIS FUNCTION EXISTS BECAUSE ITS FIRST VERSION READ A PATH THAT DOES NOT
    EXIST. It looked for `manifest.study_area.county_fips`, got None for every
    real run, and the "are these the same county?" guard compared None to None
    and passed. The test that covered it built its own manifest in the invented
    shape, so it proved the fixture. The identity is refused when missing rather
    than defaulting, because a missing identity is exactly what the broken
    version produced.
    """
    boundary = read_manifest(run_dir).get("boundary") or {}
    source_path = str(boundary.get("source_path") or "").strip()
    label = str(boundary.get("label") or "").strip()
    if not source_path and not label:
        raise ExternalShareError(
            f"{run_dir.name} records no study area in its manifest boundary block, so it cannot "
            "be shown to cover the same area as the run it is compared against"
        )
    return source_path, label


def external_scalar_of(run_dir: Path) -> float:
    """What the run itself recorded, never what its directory name suggests."""
    manifest = read_manifest(run_dir)
    rates = (manifest.get("demand") or {}).get("trip_rates") or {}
    value = rates.get("external_demand_scalar")
    if value is None:
        raise ExternalShareError(f"{run_dir.name} did not record an external demand scalar")
    return float(value)


def decompose(full_run: Path, internal_only_run: Path) -> dict[str, Any]:
    """Split one county's network VMT into internal and external.

    Both runs must be the same county, and the comparison run must actually have
    had its external demand switched off -- a pair that differs in anything else
    measures that instead, and a pair that differs in nothing measures noise.
    """
    full_manifest = read_manifest(full_run)
    full_area, internal_area = study_area_of(full_run), study_area_of(internal_only_run)
    if full_area != internal_area:
        raise ExternalShareError(
            f"different study areas: {full_run.name} covers {full_area[1] or full_area[0]}, "
            f"{internal_only_run.name} covers {internal_area[1] or internal_area[0]}"
        )
    county_fips, county_label = full_area

    full_scalar, internal_scalar = external_scalar_of(full_run), external_scalar_of(internal_only_run)
    if internal_scalar != 0.0:
        raise ExternalShareError(
            f"{internal_only_run.name} ran with external demand scalar {internal_scalar}, not 0 — "
            "it is not an internal-only run"
        )
    if full_scalar == 0.0:
        raise ExternalShareError(f"{full_run.name} also ran with external demand off; nothing to compare")

    total = network_vmt(full_run)
    internal = network_vmt(internal_only_run)
    external = total - internal
    return {
        "county_fips": county_fips or None,
        "county_label": county_label or None,
        "full_run": full_run.name,
        "internal_only_run": internal_only_run.name,
        "network_daily_vmt": round(total, 1),
        "internal_daily_vmt": round(internal, 1),
        "external_daily_vmt": round(external, 1),
        "external_share_of_network_vmt": round(external / total, 4) if total > 0 else None,
        "external_trips": (full_manifest.get("demand") or {}).get("external_trips"),
        "internal_trips": (full_manifest.get("demand") or {}).get("total_trips", 0)
        - ((full_manifest.get("demand") or {}).get("external_trips") or 0),
        "bias": (
            "The internal-only run is less congested, so its trips take marginally shorter paths "
            "than the same trips do in the full run. Internal VMT is therefore slightly low and "
            "the external share slightly high."
        ),
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    shares = sorted(row["external_share_of_network_vmt"] for row in rows if row["external_share_of_network_vmt"] is not None)
    if not shares:
        return {"counties": 0}
    mid = len(shares) // 2
    return {
        "counties": len(rows),
        "median_external_share_of_network_vmt": round(
            shares[mid] if len(shares) % 2 else (shares[mid - 1] + shares[mid]) / 2, 4
        ),
        "lowest": shares[0],
        "highest": shares[-1],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--runs-root", default=str(SCRIPT_DIR.parents[1] / "data" / "screening-runs"))
    parser.add_argument("--full-prefix", required=True, help="e.g. 'study-*-base'")
    parser.add_argument("--internal-only-prefix", required=True, help="e.g. 'noext'")
    parser.add_argument("--county", action="append", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()

    root = Path(args.runs_root).expanduser().resolve()

    def find(prefix: str, county: str) -> Path | None:
        pattern = prefix if "*" in prefix else f"{prefix}-*"
        for path in sorted(root.glob(pattern)):
            if county in path.name:
                return path
        return None

    rows, problems = [], []
    for county in args.county:
        full = find(args.full_prefix, county)
        internal = find(args.internal_only_prefix, county)
        if full is None or internal is None:
            problems.append(f"{county}: missing {'full' if full is None else 'internal-only'} run")
            continue
        try:
            rows.append(decompose(full, internal))
        except (ExternalShareError, GammaFitError) as exc:
            problems.append(f"{county}: {exc}")

    payload = {
        "schema_version": "openplan.external_demand_share.v1",
        "summary": summarize(rows),
        "per_county": rows,
        "counties_that_could_not_be_compared": problems,
    }
    text = json.dumps(payload, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
