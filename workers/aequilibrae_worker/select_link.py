#!/usr/bin/env python3
"""Select-link corridor attribution for the AequilibraE worker.

The 2-class assignment (M7) already reports resident vs external CLASS flow on
every link. Select-link goes one level deeper on chosen corridor links: it
recovers the origin-destination pattern of the trips actually using a link, so
the non-local traffic can be split into two planning-distinct categories that
aggregate link flows cannot separate:

  local    internal → internal (residents travelling within the study area)
  commute  exactly one endpoint at a boundary cordon (crossing the line to/from
           an internal zone — inbound/outbound commuters)
  through  both endpoints at boundary cordons (pass-through traffic that never
           stops in the study area — e.g. a state route traversing the county)

This is a SCREENING decomposition of demand the assignment already routed — it
does not change any VMT estimator and is not a calibration. The pure logic here
(screenline resolution, OD classification) is stdlib/numpy and unit-testable;
only main.py touches AequilibraE's select-link machinery.
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence

import numpy as np

from count_validation import bbox_contains, normalize_text, parse_pipe_list

# Guardrails so a pathological counts file can't allocate a dense OD per link
# for hundreds of links (each select-link set costs a zones×zones matrix per
# traffic class). Screenlines are corridor stations, so these are generous.
MAX_LINKS_PER_SCREENLINE = 12
MAX_SCREENLINES = 24


def select_link_screenlines(
    stations: Sequence[dict[str, Any]],
    modeled_links: Iterable[dict[str, Any]],
) -> dict[str, list[int]]:
    """Resolve each count station to the set of network links on its road.

    Uses the SAME name/type/bbox rules as count_validation.match_station, but
    returns the whole matching screenline (not one volume-tie-broken link) so
    the result is independent of assignment volumes — select-link must be set
    BEFORE the assignment runs. A station keeps its NAME/facility matches when
    it has any (so a named route isn't diluted by every same-type link in the
    bbox); only a station with no named match falls back to allowed-type links.

    Returns {station_id: [link_id, ...]} for stations with ≥1 link, capped.
    """
    links = list(modeled_links)
    out: dict[str, list[int]] = {}
    for station in stations:
        candidate_names = {normalize_text(n) for n in parse_pipe_list(station.get("candidate_model_names"))}
        excluded = {normalize_text(n) for n in parse_pipe_list(station.get("exclude_model_names"))}
        allowed_types = {normalize_text(t) for t in parse_pipe_list(station.get("candidate_link_types"))}
        facility = normalize_text(station.get("facility_name"))

        named: list[int] = []
        typed: list[int] = []
        for link in links:
            if not bbox_contains(station, link.get("lon"), link.get("lat")):
                continue
            name_norm = normalize_text(link.get("name"))
            type_norm = normalize_text(link.get("link_type"))
            if excluded and name_norm in excluded:
                continue
            if allowed_types and type_norm not in allowed_types:
                continue
            try:
                link_id = int(link["link_id"])
            except (KeyError, TypeError, ValueError):
                continue
            is_named = (bool(candidate_names) and name_norm in candidate_names) or (
                bool(facility) and facility in name_norm
            )
            if is_named:
                named.append(link_id)
            elif allowed_types:
                typed.append(link_id)

        screenline = named or typed
        if not screenline:
            continue
        # Deterministic order + de-dup + cap.
        screenline = sorted(dict.fromkeys(screenline))[:MAX_LINKS_PER_SCREENLINE]
        raw_name = str(station.get("station_id") or station.get("label") or f"station_{len(out)}")
        # AequilibraE's set_select_links rewrites any whitespace in a link-set
        # NAME to underscores, so the SL-OD results are keyed by the collapsed
        # name. Collapse it here too, or the worker would store under one key
        # and look up under another (KeyError → the whole analysis is lost).
        name = "_".join(raw_name.split()) or f"station_{len(out)}"
        while name in out:  # keep distinct stations distinct after collapsing
            name = f"{name}_{len(out)}"
        out[name] = screenline
        if len(out) >= MAX_SCREENLINES:
            break
    return out


def classify_od_by_endpoint(od: np.ndarray, is_cordon: np.ndarray) -> dict[str, float]:
    """Sum a square OD matrix into endpoint categories.

    `od` is (n, n) over the assignment centroids; `is_cordon[k]` marks centroid
    k as a boundary cordon. Returns internal_internal / internal_cordon /
    cordon_internal / cordon_cordon / total (floats), diagonal included.
    """
    od = np.asarray(od, dtype=float)
    if od.ndim != 2 or od.shape[0] != od.shape[1]:
        raise ValueError(f"od must be square 2-D, got shape {od.shape}")
    cordon = np.asarray(is_cordon, dtype=bool)
    if cordon.shape[0] != od.shape[0]:
        raise ValueError("is_cordon length must match od dimension")
    internal = ~cordon
    oi, oc = internal[:, None], cordon[:, None]   # origin masks (rows)
    di, dc = internal[None, :], cordon[None, :]   # destination masks (cols)
    return {
        "internal_internal": float(od[oi & di].sum()),
        "internal_cordon": float(od[oi & dc].sum()),
        "cordon_internal": float(od[oc & di].sum()),
        "cordon_cordon": float(od[oc & dc].sum()),
        "total": float(od.sum()),
    }


def link_attribution(combined_od: np.ndarray, is_cordon: np.ndarray) -> dict[str, Any]:
    """Local / commute / through decomposition for one screenline.

    `combined_od` is the resident + external select-link OD (trips using the
    screenline). local = internal↔internal, commute = exactly one cordon
    endpoint, through = both cordon endpoints. Shares are None when no demand
    uses the screenline (an unreached corridor is not 0% local).
    """
    c = classify_od_by_endpoint(combined_od, is_cordon)
    local = c["internal_internal"]
    commute = c["internal_cordon"] + c["cordon_internal"]
    through = c["cordon_cordon"]
    total = local + commute + through
    if total <= 0:
        return {
            "local_trips": 0.0, "commute_trips": 0.0, "through_trips": 0.0,
            "total_trips": 0.0,
            "local_share": None, "commute_share": None, "through_share": None,
        }
    return {
        "local_trips": round(local, 1),
        "commute_trips": round(commute, 1),
        "through_trips": round(through, 1),
        "total_trips": round(total, 1),
        "local_share": round(local / total, 4),
        "commute_share": round(commute / total, 4),
        "through_share": round(through / total, 4),
    }
