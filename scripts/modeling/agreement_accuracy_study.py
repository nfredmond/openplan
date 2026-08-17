#!/usr/bin/env python3
"""Does agreement between two demand models predict accuracy against counts?

============================================================ THE WHOLE POINT

Four state DOTs publish the AADT feeds this repository can validate against. In
the rest of the country a corridor number has no check at all. Two independent
demand models agreeing is evidence that IS available everywhere — if it means
anything.

So: at every count station, this joins what the counts say to whether the two
models agreed on that link, and asks whether agreement carried information. A
clear "no" is as valuable as a "yes" and is reported the same way.

======================================================= NO MODEL WRITES A NUMBER

Every figure here is arithmetic over files on disk. Medians, rank correlation,
precision and recall are computed in this file and tested against hand-worked
examples. An LLM may narrate the result; it may not produce one.

===================================================== WHAT IS NEVER DONE HERE

- **A station that cannot be joined is excluded and COUNTED**, never zero-filled.
  A zero-filled station reads as perfect agreement and perfect accuracy at once,
  and would pull both distributions toward the answer the study hopes for.
- **The two models' volumes are never averaged.** The comparison's whole value
  is the disagreement.
- **A county with too few stations does not contribute a median.** It is named
  in the output with the number it had.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

STUDY_SCHEMA_VERSION = "openplan.agreement_accuracy_study.v1"

# "Accurate" for the purpose of the prediction question. The same 30% the
# screening gate uses, so the study answers the question a planner actually has:
# would agreement have told me this corridor number was good enough to use?
ACCURATE_APE_THRESHOLD = 30.0

# Below this a county's median is not reported as a county figure — the same
# floor the registry pre-registers.
MINIMUM_STATIONS_FOR_A_COUNTY_FIGURE = 8


class AgreementAccuracyError(RuntimeError):
    """The study cannot be computed, with the reason to show."""


# --------------------------------------------------------------------------
# Statistics. Small, explicit, and tested against worked examples rather than
# taken from a library, so the study has no dependency that could change what
# a published figure means between releases.
# --------------------------------------------------------------------------


def median(values: Sequence[float]) -> float | None:
    usable = [float(v) for v in values if v is not None]
    return statistics.median(usable) if usable else None


def _ranks(values: Sequence[float]) -> list[float]:
    """Average ranks, so ties do not silently order themselves."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        end = position
        while end + 1 < len(order) and values[order[end + 1]] == values[order[position]]:
            end += 1
        shared = (position + end) / 2.0
        for index in range(position, end + 1):
            ranks[order[index]] = shared
        position = end + 1
    return ranks


def spearman(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Rank correlation. None when it cannot be computed rather than 0.0.

    Zero would read as "measured, and there is no relationship"; None reads as
    "not measurable here", and the two mean opposite things to a reader.
    """
    if len(xs) != len(ys):
        raise AgreementAccuracyError("Rank correlation needs paired values of equal length.")
    if len(xs) < 3:
        return None
    rx, ry = _ranks(list(xs)), _ranks(list(ys))
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    covariance = sum((rx[i] - mx) * (ry[i] - my) for i in range(len(rx)))
    sx = sum((v - mx) ** 2 for v in rx) ** 0.5
    sy = sum((v - my) ** 2 for v in ry) ** 0.5
    if sx == 0 or sy == 0:
        return None
    return covariance / (sx * sy)


def precision_recall(joined: Sequence[Mapping[str, Any]], *, ape_key: str,
                     threshold: float = ACCURATE_APE_THRESHOLD) -> dict[str, Any]:
    """How well "the models agree here" predicts "this corridor number is accurate".

    Precision: of the stations where the models agreed, how many were accurate.
    Recall: of the accurate stations, how many the agreement flag would have
    found. Base rate is reported alongside, because a precision of 0.7 means
    nothing until you know that 0.7 of everything was accurate anyway.
    """
    usable = [row for row in joined if row.get(ape_key) is not None]
    if not usable:
        return {"stations": 0, "precision": None, "recall": None, "base_rate": None, "lift": None}
    predicted = [row for row in usable if row["agreement"] == "agree"]
    accurate = [row for row in usable if row[ape_key] <= threshold]
    true_positive = [row for row in predicted if row[ape_key] <= threshold]
    base_rate = len(accurate) / len(usable)
    precision = len(true_positive) / len(predicted) if predicted else None
    return {
        "stations": len(usable),
        "stations_where_models_agree": len(predicted),
        "stations_accurate": len(accurate),
        "threshold_ape": threshold,
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(len(true_positive) / len(accurate), 4) if accurate else None,
        "base_rate": round(base_rate, 4),
        # The number that decides whether the signal is worth anything: how much
        # better than knowing nothing. 1.0 is worthless however good precision looks.
        "lift": round(precision / base_rate, 4) if precision is not None and base_rate > 0 else None,
    }


# --------------------------------------------------------------------------
# Reading what the runs produced.
# --------------------------------------------------------------------------


def read_validation_rows(path: Path) -> list[dict[str, Any]]:
    """Matched count stations, with the model link they were matched to."""
    path = Path(path)
    if not path.exists():
        raise AgreementAccuracyError(f"No validation results at {path}")
    rows: list[dict[str, Any]] = []
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            if (row.get("match_status") or "").strip() != "matched":
                continue
            try:
                link_id = int(float(row["model_link_id"]))
                ape = float(row["absolute_percent_error"])
            except (TypeError, ValueError, KeyError):
                continue
            rows.append(
                {
                    "station_id": row.get("station_id") or "",
                    "link_id": link_id,
                    "link_name": (row.get("model_link_name") or "").strip(),
                    "road_class": (row.get("model_link_type") or "").strip() or "unknown",
                    "observed_volume": float(row.get("observed_volume") or 0),
                    "ape": ape,
                }
            )
    return rows


def read_agreement(path: Path) -> dict[str, Any]:
    path = Path(path)
    if not path.exists():
        raise AgreementAccuracyError(f"No agreement map at {path}")
    payload = json.loads(path.read_text())
    if "links" not in payload:
        raise AgreementAccuracyError(f"{path} is not a corridor-agreement map.")
    return payload


def join_stations_to_agreement(
    validation_rows: Sequence[Mapping[str, Any]],
    agreement: Mapping[str, Any],
    *,
    ape_key: str = "ape",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Attach each station to the agreement verdict for its own link.

    Link id first. A station whose link carries too little traffic to be
    classified, or is absent from the map, is EXCLUDED AND COUNTED — never
    zero-filled, which would enter the study as agreement and accuracy at once.
    """
    links_by_id = {int(link["link_id"]): link for link in agreement.get("links", [])}
    joined: list[dict[str, Any]] = []
    excluded = {"link_not_in_agreement_map": 0, "link_below_meaningful_volume": 0}
    for row in validation_rows:
        link = links_by_id.get(int(row["link_id"]))
        if link is None:
            excluded["link_not_in_agreement_map"] += 1
            continue
        if not link.get("carries_meaningful_traffic"):
            excluded["link_below_meaningful_volume"] += 1
            continue
        joined.append(
            {
                **row,
                "agreement": link["agreement"],
                "geh": float(link["geh"]),
                "first_volume": float(link["first_volume"]),
                "second_volume": float(link["second_volume"]),
                "corridor": link.get("name") or "",
            }
        )
    accounting = {
        "stations_in": len(validation_rows),
        "stations_joined": len(joined),
        "excluded": excluded,
        "note": (
            f"{len(joined)} of {len(validation_rows)} matched stations sit on a link the agreement "
            "map classifies. The rest are excluded and counted above: a station left in with a "
            "made-up verdict would enter the study as agreement and accuracy at the same time."
        ),
    }
    return joined, accounting


# --------------------------------------------------------------------------
# The question itself.
# --------------------------------------------------------------------------


def by_agreement_class(joined: Sequence[Mapping[str, Any]], *, ape_key: str = "ape") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for label in ("agree", "marginal", "diverge"):
        rows = [r for r in joined if r["agreement"] == label]
        out[label] = {
            "stations": len(rows),
            "median_ape": round(median([r[ape_key] for r in rows]), 2) if rows else None,
            "share_within_threshold": (
                round(sum(1 for r in rows if r[ape_key] <= ACCURATE_APE_THRESHOLD) / len(rows), 4)
                if rows
                else None
            ),
        }
    return out


def by_road_class(joined: Sequence[Mapping[str, Any]], *, ape_key: str = "ape") -> list[dict[str, Any]]:
    classes = sorted({r["road_class"] for r in joined})
    out = []
    for road_class in classes:
        rows = [r for r in joined if r["road_class"] == road_class]
        agreeing = [r for r in rows if r["agreement"] == "agree"]
        out.append(
            {
                "road_class": road_class,
                "stations": len(rows),
                "median_ape": round(median([r[ape_key] for r in rows]), 2),
                "stations_where_models_agree": len(agreeing),
                "median_ape_where_models_agree": (
                    round(median([r[ape_key] for r in agreeing]), 2) if agreeing else None
                ),
            }
        )
    return out


def analyse(joined: Sequence[Mapping[str, Any]], *, ape_key: str = "ape") -> dict[str, Any]:
    """Every figure the study reports, over one set of joined stations."""
    apes = [r[ape_key] for r in joined]
    gehs = [r["geh"] for r in joined]
    return {
        "stations": len(joined),
        "median_ape": round(median(apes), 2) if apes else None,
        "by_agreement_class": by_agreement_class(joined, ape_key=ape_key),
        # Positive = the more the models disagree, the worse the accuracy, which
        # is the direction the study's hypothesis predicts.
        "spearman_geh_vs_ape": (
            round(spearman(gehs, apes), 4) if spearman(gehs, apes) is not None else None
        ),
        "prediction": precision_recall(joined, ape_key=ape_key),
        "by_road_class": by_road_class(joined, ape_key=ape_key),
    }


def county_result(county_dir: Path, *, minimum_stations: int = MINIMUM_STATIONS_FOR_A_COUNTY_FIGURE) -> dict[str, Any]:
    """One county's answer, from the artifacts its status.json points at."""
    status = json.loads((county_dir / "status.json").read_text())
    if status.get("status") != "completed":
        return {
            "county_fips": status.get("county_fips"),
            "usable": False,
            "reason": status.get("dropped_reason") or (status.get("error") or {}).get("message") or status.get("status"),
        }
    artifacts = status["artifacts"]
    agreement = read_agreement(Path(artifacts["agreement_json"]))
    result: dict[str, Any] = {
        "county_fips": status["county_fips"],
        "region": status.get("region"),
        "band": status.get("band"),
        "usable": True,
        "attribution_is_supportable": agreement.get("attribution_is_supportable"),
        "noise_floor_measured": (agreement.get("assignment_noise_floor") or {}).get("measured"),
        "agree_share_meaningful_links": agreement["summary"]["agree_share_meaningful_links"],
    }
    for label, key in (("trip_based", "base_validation"), ("activity_based", "asim_validation")):
        path = Path(artifacts.get(key, ""))
        if not path.exists():
            result[label] = {"stations": 0, "reason": f"no validation results at {path}"}
            continue
        joined, accounting = join_stations_to_agreement(read_validation_rows(path), agreement)
        block = {"join": accounting}
        if len(joined) < minimum_stations:
            block["usable"] = False
            block["reason"] = (
                f"{len(joined)} joined stations is below the pre-registered floor of "
                f"{minimum_stations}; no county figure is reported from it."
            )
        else:
            block["usable"] = True
            block.update(analyse(joined))
        result[label] = block
        result.setdefault("_joined", {})[label] = joined if len(joined) >= minimum_stations else []
    return result


def pooled(results: Sequence[Mapping[str, Any]], label: str) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for result in results:
        if result.get("usable"):
            rows.extend(result.get("_joined", {}).get(label, []))
    if not rows:
        return {"stations": 0, "reason": "no county contributed usable stations"}
    return analyse(rows)


def counties_where_agreement_fails(results: Sequence[Mapping[str, Any]], label: str) -> list[dict[str, Any]]:
    """Named, not counted. A study that says "it worked in most counties"
    without saying which ones cannot be checked or acted on."""
    failures = []
    for result in results:
        block = result.get(label) if result.get("usable") else None
        if not block or not block.get("usable"):
            continue
        classes = block["by_agreement_class"]
        agree_median = classes["agree"]["median_ape"]
        diverge_median = classes["diverge"]["median_ape"]
        lift = block["prediction"]["lift"]
        # Failure = agreeing stations were not more accurate than diverging ones,
        # or the flag carried no lift over the base rate.
        if agree_median is None or diverge_median is None:
            reason = "one agreement class had no stations, so the comparison could not be made"
        elif agree_median > diverge_median:
            reason = (
                f"stations where the models agreed were LESS accurate (median APE {agree_median}%) "
                f"than where they diverged ({diverge_median}%)"
            )
        elif lift is not None and lift <= 1.0:
            reason = f"agreement carried no lift over the base rate (lift {lift})"
        else:
            continue
        failures.append(
            {
                "county_fips": result["county_fips"],
                "region": result.get("region"),
                "band": result.get("band"),
                "reason": reason,
            }
        )
    return failures


def run_analysis(study_half_dir: Path, *, minimum_stations: int = MINIMUM_STATIONS_FOR_A_COUNTY_FIGURE) -> dict[str, Any]:
    study_half_dir = Path(study_half_dir)
    county_dirs = sorted(p for p in study_half_dir.iterdir() if p.is_dir() and (p / "status.json").exists())
    if not county_dirs:
        raise AgreementAccuracyError(f"No county runs under {study_half_dir}.")
    results = [county_result(p, minimum_stations=minimum_stations) for p in county_dirs]

    payload: dict[str, Any] = {
        "schema_version": STUDY_SCHEMA_VERSION,
        "half": study_half_dir.name,
        "question": (
            "Does agreement between two independent demand models predict accuracy against "
            "observed traffic counts?"
        ),
        "counties_attempted": len(results),
        "counties_usable": sum(1 for r in results if r.get("usable")),
        "counties_not_usable": [
            {"county_fips": r["county_fips"], "reason": r["reason"]} for r in results if not r.get("usable")
        ],
        "pooled": {label: pooled(results, label) for label in ("trip_based", "activity_based")},
        "counties_where_agreement_fails_to_predict": {
            label: counties_where_agreement_fails(results, label)
            for label in ("trip_based", "activity_based")
        },
        "per_county": [{k: v for k, v in r.items() if k != "_joined"} for r in results],
        "what_this_is_not": [
            "Neither model is ground truth. Agreement means the two methods concur, not that "
            "either is right; both can be wrong in the same direction, and the pooled figures "
            "below can only detect that where counts exist.",
            "The two models' volumes are never averaged anywhere in this study.",
            "Accuracy here is measured only in the four states whose DOTs publish an AADT feed "
            "this repository can read. Whether the relationship holds elsewhere is exactly what "
            "the study cannot observe, and is the reason it is worth running at all.",
            "The behavioural coefficients of the activity-based side are estimated for the San "
            "Francisco Bay Area and applied unmodified. Its accuracy figures carry that limit.",
        ],
    }
    return payload


def markdown_for(payload: Mapping[str, Any]) -> str:
    lines = [
        f"# Does model agreement predict accuracy? — {payload['half']} counties",
        "",
        payload["question"],
        "",
        f"{payload['counties_usable']} of {payload['counties_attempted']} counties contributed usable stations.",
        "",
    ]
    for label in ("trip_based", "activity_based"):
        block = payload["pooled"][label]
        lines.append(f"## Pooled — {label.replace('_', '-')} accuracy")
        lines.append("")
        if not block.get("stations"):
            lines.extend([block.get("reason", "no stations"), ""])
            continue
        prediction = block["prediction"]
        lines.extend(
            [
                f"- stations: **{block['stations']}**, median APE **{block['median_ape']}%**",
                f"- rank correlation between disagreement (GEH) and error (APE): "
                f"**{block['spearman_geh_vs_ape']}**",
                f"- where the models agree: median APE "
                f"**{block['by_agreement_class']['agree']['median_ape']}%** "
                f"({block['by_agreement_class']['agree']['stations']} stations)",
                f"- where they diverge: median APE "
                f"**{block['by_agreement_class']['diverge']['median_ape']}%** "
                f"({block['by_agreement_class']['diverge']['stations']} stations)",
                f"- predicting APE ≤ {prediction['threshold_ape']}% from agreement: precision "
                f"**{prediction['precision']}**, recall **{prediction['recall']}**, base rate "
                f"**{prediction['base_rate']}**, lift **{prediction['lift']}**",
                "",
            ]
        )
        failures = payload["counties_where_agreement_fails_to_predict"][label]
        if failures:
            lines.append("### Counties where agreement did NOT predict accuracy")
            lines.append("")
            for failure in failures:
                lines.append(f"- **{failure['county_fips']}** ({failure['region']}, {failure['band']}): {failure['reason']}")
            lines.append("")
    lines.append("## What this is not")
    lines.append("")
    lines.extend(f"- {item}" for item in payload["what_this_is_not"])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Answer the pre-registered question from a completed study batch."
    )
    parser.add_argument("--study-half-dir", required=True, help="data/agreement-study/runs/<half>")
    parser.add_argument("--output-dir", help="Where to write the answer (default: alongside the runs)")
    args = parser.parse_args()

    half_dir = Path(args.study_half_dir).expanduser().resolve()
    payload = run_analysis(half_dir)
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else half_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "agreement_accuracy.json").write_text(json.dumps(payload, indent=2) + "\n")
    (output_dir / "agreement_accuracy.md").write_text(markdown_for(payload))
    print(
        json.dumps(
            {
                "output_dir": str(output_dir),
                "counties_usable": payload["counties_usable"],
                "counties_not_usable": payload["counties_not_usable"],
                "pooled": {
                    label: {
                        k: payload["pooled"][label].get(k)
                        for k in ("stations", "median_ape", "spearman_geh_vs_ape", "prediction")
                    }
                    for label in ("trip_based", "activity_based")
                },
                "counties_where_agreement_fails_to_predict": payload["counties_where_agreement_fails_to_predict"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
