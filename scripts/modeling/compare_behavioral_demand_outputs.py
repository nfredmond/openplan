#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

DEFAULT_OUTPUT_SUBDIR = "comparison"
JSON_NAME = "behavioral_demand_comparison.json"
MARKDOWN_NAME = "behavioral_demand_comparison.md"
AGREEMENT_JSON_NAME = "corridor_agreement.json"
AGREEMENT_MARKDOWN_NAME = "corridor_agreement.md"


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare two OpenPlan behavioral KPI summaries or evidence packets honestly."
    )
    parser.add_argument("--current", help="Path to the current behavioral KPI summary or evidence packet JSON")
    parser.add_argument("--baseline", help="Path to the baseline behavioral KPI summary or evidence packet JSON")
    parser.add_argument("--output-dir", help="Directory to write comparison JSON/markdown (default: <current parent>/comparison)")
    parser.add_argument("--force", action="store_true", help="Replace an existing output directory")
    # METHOD-VERSUS-METHOD. The arguments above compare two behavioural KPI
    # summaries — the same model run twice. These compare two ASSIGNMENTS of the
    # same network from different demand models, which is the comparison the
    # dual-model work exists to produce. One entry point deliberately: a second
    # comparator is how two ways of answering the same question drift apart.
    parser.add_argument("--link-volumes-first", help="link_volumes.csv from the first run")
    parser.add_argument("--link-volumes-second", help="link_volumes.csv from the second run")
    parser.add_argument("--first-label", default="first demand model", help="How to name the first method")
    parser.add_argument("--second-label", default="second demand model", help="How to name the second method")
    parser.add_argument(
        "--loaded-links-geojson",
        help="Optional loaded_links.geojson supplying road names, so links roll up into corridors",
    )
    parser.add_argument(
        "--volume-column", default="PCE_tot", help="Which link volume column to compare (default: PCE_tot)"
    )
    parser.add_argument(
        "--first-manifest",
        help=(
            "bundle_manifest.json from the first run. Supplies how tightly its assignment "
            "converged, which decides whether a corridor difference can be attributed to the "
            "demand model at all."
        ),
    )
    parser.add_argument("--second-manifest", help="bundle_manifest.json from the second run")
    parser.add_argument(
        "--minimum-volume",
        type=float,
        default=None,
        help=(
            "Links below this carry too little traffic for a difference to mean anything. Reported "
            "with the result, never silently applied."
        ),
    )
    parser.add_argument(
        "--noise-floor-json",
        help=(
            "corridor_agreement.json from a ROUND-TRIP comparison — one model's own demand "
            "assigned twice over this network. Its divergence is what the assignment produces with "
            "no demand difference at all, so divergence at or below it here is not the demand "
            "models disagreeing. Without this flag every report says the floor is unmeasured."
        ),
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_markdown(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


def dedupe_strings(values: list[str | None]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        result.append(normalized)
        seen.add(normalized)
    return result


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def as_number(value: Any) -> float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def title_case(value: str) -> str:
    return " ".join(part[:1].upper() + part[1:] for part in value.replace(":", "_").split("_") if part)


def normalize_values(values: Any) -> list[dict[str, Any]]:
    rows = []
    for value in as_list(values):
        item = as_dict(value)
        rows.append(
            {
                "label": as_string(item.get("label")) or "(missing)",
                "count": as_number(item.get("count")),
                "share": as_number(item.get("share")),
            }
        )
    return rows


def flatten_summary(summary: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    totals = as_dict(summary.get("totals"))
    for metric in ("households", "persons", "tours", "trips"):
        rows.append(
            {
                "kpi_category": "totals",
                "kpi_name": f"total_{metric}",
                "kpi_label": title_case(metric),
                "value": as_number(totals.get(metric)),
                "unit": "count",
                "geometry_ref": None,
            }
        )

    for item in normalize_values(as_dict(summary.get("trip_volumes_by_purpose")).get("values")):
        rows.extend(
            [
                {
                    "kpi_category": "trip_purpose",
                    "kpi_name": "trip_purpose_count",
                    "kpi_label": f"Trip purpose trips · {item['label']}",
                    "value": item["count"],
                    "unit": "trips",
                    "geometry_ref": item["label"],
                },
                {
                    "kpi_category": "trip_purpose",
                    "kpi_name": "trip_purpose_share_pct",
                    "kpi_label": f"Trip purpose share · {item['label']}",
                    "value": item["share"] * 100 if item["share"] is not None else None,
                    "unit": "%",
                    "geometry_ref": item["label"],
                },
            ]
        )

    for item in normalize_values(as_dict(summary.get("mode_shares")).get("values")):
        rows.extend(
            [
                {
                    "kpi_category": "mode_share",
                    "kpi_name": "mode_share_count",
                    "kpi_label": f"Mode trips · {item['label']}",
                    "value": item["count"],
                    "unit": "trips",
                    "geometry_ref": item["label"],
                },
                {
                    "kpi_category": "mode_share",
                    "kpi_name": "mode_share_pct",
                    "kpi_label": f"Mode share · {item['label']}",
                    "value": item["share"] * 100 if item["share"] is not None else None,
                    "unit": "%",
                    "geometry_ref": item["label"],
                },
            ]
        )

    for segment_summary in as_list(summary.get("segment_summaries")):
        item = as_dict(segment_summary)
        target_kind = as_string(item.get("target_kind")) or "segment"
        segment = as_string(item.get("segment")) or "group"
        for value in normalize_values(item.get("values")):
            rows.extend(
                [
                    {
                        "kpi_category": f"segment_{target_kind}",
                        "kpi_name": f"{segment}_count",
                        "kpi_label": f"{title_case(target_kind)} {title_case(segment)} count · {value['label']}",
                        "value": value["count"],
                        "unit": "count",
                        "geometry_ref": f"{target_kind}:{segment}:{value['label']}",
                    },
                    {
                        "kpi_category": f"segment_{target_kind}",
                        "kpi_name": f"{segment}_share_pct",
                        "kpi_label": f"{title_case(target_kind)} {title_case(segment)} share · {value['label']}",
                        "value": value["share"] * 100 if value["share"] is not None else None,
                        "unit": "%",
                        "geometry_ref": f"{target_kind}:{segment}:{value['label']}",
                    },
                ]
            )
    return rows


def normalize_source(path: Path, payload: dict[str, Any]) -> dict[str, Any] | None:
    if payload.get("summary_type") == "activitysim_behavioral_kpi_summary":
        return {
            "source_type": "behavioral_kpi_summary",
            "source_path": str(path),
            "runtime_mode": as_string(as_dict(payload.get("source")).get("runtime_mode")),
            "runtime_status": as_string(as_dict(payload.get("source")).get("runtime_status")),
            "availability_status": as_string(as_dict(payload.get("availability")).get("status")),
            "caveats": [value for value in as_list(payload.get("caveats")) if isinstance(value, str)],
            "rows": flatten_summary(payload),
        }

    if payload.get("packet_type") == "behavioral_demand_evidence_packet":
        source = as_dict(payload.get("source"))
        prototype_chain = as_dict(payload.get("prototype_chain"))
        runtime = as_dict(prototype_chain.get("runtime"))
        behavioral = as_dict(prototype_chain.get("behavioral_kpis"))
        synthetic_summary = {
            "source": {
                "runtime_mode": runtime.get("mode"),
                "runtime_status": runtime.get("status"),
            },
            "availability": {
                "status": behavioral.get("availability_status"),
            },
            "totals": as_dict(behavioral.get("totals")),
            "trip_volumes_by_purpose": as_dict(behavioral.get("trip_volumes_by_purpose")),
            "mode_shares": as_dict(behavioral.get("mode_shares")),
            "segment_summaries": as_list(behavioral.get("segment_summaries")),
            "caveats": [value for value in as_list(payload.get("caveats")) if isinstance(value, str)],
        }
        return {
            "source_type": "behavioral_evidence_packet",
            "source_path": as_string(source.get("behavioral_manifest_path")) or str(path),
            "runtime_mode": as_string(runtime.get("mode")),
            "runtime_status": as_string(runtime.get("status")),
            "availability_status": as_string(behavioral.get("availability_status")),
            "caveats": [value for value in as_list(payload.get("caveats")) if isinstance(value, str)],
            "rows": flatten_summary(synthetic_summary),
        }

    return None


def row_key(row: dict[str, Any]) -> str:
    return f"{row.get('kpi_name') or 'kpi'}::{row.get('geometry_ref') or ''}"


def source_is_blocked(source: dict[str, Any] | None) -> bool:
    if source is None:
        return True
    return (
        source.get("availability_status") == "not_enough_behavioral_outputs"
        or source.get("runtime_mode") == "preflight_only"
        or source.get("runtime_status") == "blocked"
    )


def source_is_partial(source: dict[str, Any] | None) -> bool:
    if source is None:
        return False
    return source.get("availability_status") == "partial_behavioral_outputs" or source.get("runtime_status") == "failed"


def build_behavioral_demand_comparison(current_source: dict[str, Any] | None, baseline_source: dict[str, Any] | None) -> dict[str, Any]:
    current_map = {row_key(row): row for row in (current_source or {}).get("rows", [])}
    baseline_map = {row_key(row): row for row in (baseline_source or {}).get("rows", [])}
    current_keys = sorted(current_map.keys())
    baseline_keys = sorted(baseline_map.keys())
    shared_keys = [key for key in current_keys if key in baseline_map]
    shared_comparable_keys = [
        key
        for key in shared_keys
        if as_number(current_map[key].get("value")) is not None and as_number(baseline_map[key].get("value")) is not None
    ]
    current_only = [key for key in current_keys if key not in baseline_map]
    baseline_only = [key for key in baseline_keys if key not in current_map]

    blocked_reasons: list[str] = []
    if current_source is None or baseline_source is None:
        blocked_reasons.append("missing_behavioral_artifacts")
    if source_is_blocked(current_source) or source_is_blocked(baseline_source):
        blocked_reasons.append("preflight_or_not_enough_outputs")
    if not blocked_reasons and not shared_comparable_keys:
        blocked_reasons.append("no_shared_behavioral_kpis")

    comparison_rows: list[dict[str, Any]] = []
    for key in shared_comparable_keys:
        current = current_map[key]
        baseline = baseline_map[key]
        current_value = as_number(current.get("value"))
        baseline_value = as_number(baseline.get("value"))
        absolute_delta = None
        percent_delta = None
        if current_value is not None and baseline_value is not None:
            absolute_delta = current_value - baseline_value
            if baseline_value != 0:
                percent_delta = round(((current_value - baseline_value) / abs(baseline_value)) * 100, 2)
        comparison_rows.append(
            {
                **current,
                "baseline_value": baseline_value,
                "absolute_delta": absolute_delta,
                "percent_delta": percent_delta,
            }
        )

    partial = not blocked_reasons and (source_is_partial(current_source) or source_is_partial(baseline_source))
    support_status = (
        "behavioral_comparison_blocked"
        if blocked_reasons
        else "behavioral_comparison_partial_only"
        if partial
        else "behavioral_comparison_available"
    )
    support_message = (
        "Behavioral comparison is not supportable from the current managed-run artifacts yet."
        if "missing_behavioral_artifacts" in blocked_reasons
        else "Behavioral comparison is not supportable yet because one or both runs only reached preflight-only, blocked, or not-enough-output posture."
        if "preflight_or_not_enough_outputs" in blocked_reasons
        else "Behavioral comparison is not supportable because the two runs do not share any comparable behavioral KPI coverage."
        if "no_shared_behavioral_kpis" in blocked_reasons
        else "Behavioral comparison is limited to shared partial outputs only. Treat the deltas as prototype artifact differences, not full behavioral parity."
        if partial
        else "Behavioral comparison reflects only the shared prototype KPI rows discovered on both runs."
    )

    exclusions: list[str] = []
    if current_only:
        exclusions.append(f"Current run has {len(current_only)} behavioral KPI rows without a baseline match.")
    if baseline_only:
        exclusions.append(f"Baseline run has {len(baseline_only)} behavioral KPI rows without a current-run match.")

    caveats = dedupe_strings(
        list((current_source or {}).get("caveats", []))
        + list((baseline_source or {}).get("caveats", []))
        + [
            "At least one run produced only partial behavioral outputs, so comparison is partial-output only."
            if partial
            else None,
            "At least one run remains preflight-only, blocked, or otherwise lacks comparison-ready behavioral outputs, so deltas are intentionally withheld."
            if "preflight_or_not_enough_outputs" in blocked_reasons
            else None,
            "Only the shared behavioral KPI rows are compared; uncovered rows are excluded instead of being imputed."
            if shared_comparable_keys and (current_only or baseline_only)
            else None,
            "Behavioral-demand comparison remains prototype-only and does not establish calibration quality, behavioral realism, or client-ready forecasting claims.",
        ]
    )

    changed_count = len([row for row in comparison_rows if row.get("absolute_delta") not in (None, 0)])
    flat_count = len([row for row in comparison_rows if row.get("absolute_delta") == 0])

    return {
        "schema_version": "openplan.behavioral_demand_comparison.v0",
        "comparison_type": "behavioral_demand_comparison",
        "generated_at_utc": _utc_now(),
        "current": {
            "source_type": (current_source or {}).get("source_type"),
            "source_path": (current_source or {}).get("source_path"),
            "runtime_mode": (current_source or {}).get("runtime_mode"),
            "runtime_status": (current_source or {}).get("runtime_status"),
            "availability_status": (current_source or {}).get("availability_status"),
        },
        "baseline": {
            "source_type": (baseline_source or {}).get("source_type"),
            "source_path": (baseline_source or {}).get("source_path"),
            "runtime_mode": (baseline_source or {}).get("runtime_mode"),
            "runtime_status": (baseline_source or {}).get("runtime_status"),
            "availability_status": (baseline_source or {}).get("availability_status"),
        },
        "support": {
            "status": support_status,
            "supportable": not blocked_reasons,
            "partial": partial,
            "message": support_message,
            "reason_codes": blocked_reasons,
        },
        "coverage": {
            "current_kpi_keys": current_keys,
            "baseline_kpi_keys": baseline_keys,
            "comparable_kpi_keys": shared_comparable_keys,
            "current_only_kpi_keys": current_only,
            "baseline_only_kpi_keys": baseline_only,
            "comparable_kpi_count": len(shared_comparable_keys),
            "current_only_count": len(current_only),
            "baseline_only_count": len(baseline_only),
        },
        "exclusions": exclusions,
        "caveats": caveats,
        "comparison": {
            "comparable_kpi_count": len(shared_comparable_keys),
            "changed_kpi_count": changed_count,
            "flat_kpi_count": flat_count,
            "rows": [] if blocked_reasons else comparison_rows,
        },
    }


def markdown_for_comparison(comparison: dict[str, Any]) -> str:
    support = as_dict(comparison.get("support"))
    coverage = as_dict(comparison.get("coverage"))
    lines = [
        "# OpenPlan Behavioral-Demand Comparison",
        "",
        f"- Generated at: `{comparison.get('generated_at_utc')}`",
        f"- Support status: `{support.get('status')}`",
        f"- Supportable: `{support.get('supportable')}`",
        f"- Message: {support.get('message')}",
        f"- Comparable KPI rows: `{coverage.get('comparable_kpi_count')}`",
        f"- Current-only KPI rows: `{coverage.get('current_only_count')}`",
        f"- Baseline-only KPI rows: `{coverage.get('baseline_only_count')}`",
        "",
        "## Caveats",
        "",
    ]
    for caveat in as_list(comparison.get("caveats")):
        lines.append(f"- {caveat}")
    lines.extend(["", "## Exclusions", ""])
    for exclusion in as_list(comparison.get("exclusions")):
        lines.append(f"- {exclusion}")

    rows = as_list(as_dict(comparison.get("comparison")).get("rows"))
    lines.extend(["", "## Compared Rows", ""])
    if not rows:
        lines.append("- No behavioral deltas were emitted.")
    else:
        lines.extend(["| KPI | Current | Baseline | Delta | Percent |", "|---|---:|---:|---:|---:|"])
        for row in rows:
            item = as_dict(row)
            lines.append(
                f"| {item.get('kpi_label')} | {item.get('value')} | {item.get('baseline_value')} | {item.get('absolute_delta')} | {item.get('percent_delta')} |"
            )
    return "\n".join(lines) + "\n"


def compare_behavioral_demand_outputs(
    *,
    current: str,
    baseline: str,
    output_dir: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    current_path = Path(current).expanduser().resolve()
    baseline_path = Path(baseline).expanduser().resolve()
    current_source = normalize_source(current_path, read_json(current_path))
    baseline_source = normalize_source(baseline_path, read_json(baseline_path))
    if current_source is None:
        raise RuntimeError(f"Unsupported current input payload: {current_path}")
    if baseline_source is None:
        raise RuntimeError(f"Unsupported baseline input payload: {baseline_path}")

    resolved_output_dir = Path(output_dir).expanduser().resolve() if output_dir else current_path.parent / DEFAULT_OUTPUT_SUBDIR
    if resolved_output_dir.exists():
        if not force:
            raise RuntimeError(f"Comparison output directory already exists: {resolved_output_dir}")
        shutil.rmtree(resolved_output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)

    comparison = build_behavioral_demand_comparison(current_source, baseline_source)
    json_path = resolved_output_dir / JSON_NAME
    markdown_path = resolved_output_dir / MARKDOWN_NAME
    write_json(json_path, comparison)
    write_markdown(markdown_path, markdown_for_comparison(comparison))
    return {
        "output_dir": str(resolved_output_dir),
        "json_path": str(json_path),
        "markdown_path": str(markdown_path),
        "support_status": comparison["support"]["status"],
        "supportable": comparison["support"]["supportable"],
        "comparable_kpi_count": comparison["coverage"]["comparable_kpi_count"],
    }


def read_link_volume_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise RuntimeError(f"No link volume table at {path}")
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise RuntimeError(f"{path} has no links in it")
    return rows


def read_link_names(path: Path | None) -> dict[int, dict[str, Any]]:
    """Road names per link id, so links can roll up into corridors.

    Optional on purpose. Without it the comparison still reports every link;
    it simply cannot name the corridors, and saying that is better than
    inventing a grouping.
    """
    if path is None:
        return {}
    if not path.exists():
        raise RuntimeError(f"No loaded-links file at {path}")
    payload = json.loads(path.read_text())
    names: dict[int, dict[str, Any]] = {}
    for feature in payload.get("features", []):
        properties = feature.get("properties") or {}
        try:
            link_id = int(float(properties.get("link_id")))
        except (TypeError, ValueError):
            continue
        names[link_id] = {
            "name": properties.get("name") or "",
            "link_type": properties.get("link_type") or "",
        }
    return names


def read_convergence(manifest_path: str | None) -> dict[str, Any] | None:
    """How tightly a run's assignment converged, out of its own manifest.

    Returns None when there is no manifest, which the verdict treats as
    'unknown' rather than as 'fine' — an unrecorded gap is not a tight one.
    """
    if not manifest_path:
        return None
    path = Path(manifest_path).expanduser().resolve()
    if not path.exists():
        raise RuntimeError(f"No run manifest at {path}")
    payload = json.loads(path.read_text())
    return ((payload.get("assignment") or {}).get("convergence")) or None


def read_noise_floor(noise_floor_path: str | None) -> dict[str, Any] | None:
    """The measured assignment noise floor, from a round-trip comparison's own output.

    Fed the `corridor_agreement.json` of a comparison where BOTH sides came from
    the same demand — the divergence it reports is the assignment deciding
    between parallel routes, and nothing else. Refused if that file describes a
    comparison of two different demand models, because a "floor" that already
    contains a real demand difference would license attributing that difference
    to nothing.
    """
    if not noise_floor_path:
        return None
    path = Path(noise_floor_path).expanduser().resolve()
    if not path.exists():
        raise RuntimeError(f"No noise-floor comparison at {path}")
    payload = json.loads(path.read_text())
    summary = payload.get("summary") or {}
    if "diverge_share_meaningful_links" not in summary:
        raise RuntimeError(
            f"{path} is not a corridor-agreement comparison, so it cannot supply a noise floor."
        )
    sources = payload.get("noise_floor_basis") or {}
    return {
        "diverge_share_meaningful_links": summary["diverge_share_meaningful_links"],
        "median_geh_meaningful_links": summary.get("median_geh_meaningful_links"),
        "relative_gap": (payload.get("assignment_convergence") or {}).get("gaps", {}).get("first"),
        "measured_from": str(path),
        **sources,
    }


def compare_link_volume_runs(
    *,
    first_csv: str,
    second_csv: str,
    first_label: str,
    second_label: str,
    output_dir: str | None = None,
    force: bool = False,
    loaded_links_geojson: str | None = None,
    volume_column: str = "PCE_tot",
    minimum_volume: float | None = None,
    first_manifest: str | None = None,
    second_manifest: str | None = None,
    noise_floor_json: str | None = None,
) -> dict[str, Any]:
    """Compare two assignments of the same network from different demand models."""
    from corridor_agreement import DEFAULT_MINIMUM_VOLUME, build_agreement_map

    first_path = Path(first_csv).expanduser().resolve()
    second_path = Path(second_csv).expanduser().resolve()
    resolved_output_dir = (
        Path(output_dir).expanduser().resolve() if output_dir else first_path.parent / DEFAULT_OUTPUT_SUBDIR
    )
    if resolved_output_dir.exists() and force:
        shutil.rmtree(resolved_output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)

    agreement = build_agreement_map(
        read_link_volume_rows(first_path),
        read_link_volume_rows(second_path),
        first_label=first_label,
        second_label=second_label,
        volume_column=volume_column,
        minimum_volume=DEFAULT_MINIMUM_VOLUME if minimum_volume is None else minimum_volume,
        link_names=read_link_names(
            Path(loaded_links_geojson).expanduser().resolve() if loaded_links_geojson else None
        ),
        first_convergence=read_convergence(first_manifest),
        second_convergence=read_convergence(second_manifest),
        noise_floor=read_noise_floor(noise_floor_json),
    )
    agreement["sources"] = {"first": str(first_path), "second": str(second_path)}
    agreement["generated_at_utc"] = _utc_now()

    json_path = resolved_output_dir / AGREEMENT_JSON_NAME
    markdown_path = resolved_output_dir / AGREEMENT_MARKDOWN_NAME
    write_json(json_path, agreement)
    write_markdown(markdown_path, markdown_for_agreement(agreement))
    return {
        "output_dir": str(resolved_output_dir),
        "json_path": str(json_path),
        "markdown_path": str(markdown_path),
        "summary": agreement["summary"],
        "network_alignment": agreement["network_alignment"],
        "attribution_is_supportable": agreement["attribution_is_supportable"],
        "assignment_convergence": agreement["assignment_convergence"],
        "assignment_noise_floor": agreement["assignment_noise_floor"],
        "corridors": len(agreement["corridors"]),
    }


def markdown_for_agreement(agreement: dict[str, Any]) -> str:
    methods = agreement["methods"]
    summary = agreement["summary"]
    lines = [
        "# Where the two demand models agree",
        "",
        f"**{methods['first']}** compared against **{methods['second']}**, assigned on the same "
        "network with the same assignment settings.",
        "",
        summary["note"],
        "",
        agreement["network_alignment"]["note"],
        "",
        agreement["assignment_convergence"]["note"],
        "",
        "## What this is not",
        "",
    ]
    lines += [f"- {item}" for item in agreement["what_this_is_not"]]
    lines += ["", "## Corridors, worst agreement first", ""]
    if not agreement["corridors"]:
        lines.append("No named corridor carries enough traffic for a comparison to mean anything.")
    else:
        lines += [
            "| Corridor | Links | " + methods["first"] + " | " + methods["second"] + " | GEH | Agreement |",
            "|---|---:|---:|---:|---:|---|",
        ]
        for corridor in agreement["corridors"][:40]:
            lines.append(
                f"| {corridor['corridor']} | {corridor['links']} | {corridor['first_volume']:,.0f} "
                f"| {corridor['second_volume']:,.0f} | {corridor['geh']:.1f} | {corridor['agreement']} |"
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    args = parse_args()
    if args.link_volumes_first or args.link_volumes_second:
        if not (args.link_volumes_first and args.link_volumes_second):
            raise RuntimeError(
                "Comparing link volumes needs both --link-volumes-first and --link-volumes-second."
            )
        result = compare_link_volume_runs(
            first_csv=args.link_volumes_first,
            second_csv=args.link_volumes_second,
            first_label=args.first_label,
            second_label=args.second_label,
            output_dir=args.output_dir,
            force=args.force,
            loaded_links_geojson=args.loaded_links_geojson,
            volume_column=args.volume_column,
            minimum_volume=args.minimum_volume,
            first_manifest=args.first_manifest,
            second_manifest=args.second_manifest,
            noise_floor_json=args.noise_floor_json,
        )
        print(json.dumps(result, indent=2))
        return 0
    # `--current` and `--baseline` became optional so the link-volume mode does
    # not demand KPI summaries it has no use for. They are still required for
    # THIS mode, and the check has to live here or argparse would accept a call
    # with neither pair and fail later with a path error naming nothing useful.
    if not (args.current and args.baseline):
        raise RuntimeError(
            "Comparing behavioural KPI summaries needs both --current and --baseline. To compare "
            "two demand models on the same network instead, pass --link-volumes-first and "
            "--link-volumes-second."
        )
    result = compare_behavioral_demand_outputs(
        current=args.current,
        baseline=args.baseline,
        output_dir=args.output_dir,
        force=args.force,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
