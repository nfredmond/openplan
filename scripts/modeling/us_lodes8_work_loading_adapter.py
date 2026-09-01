#!/usr/bin/env python3
"""United States adapter for exact LODES8 work-loading source records."""
from __future__ import annotations

import csv
import gzip
import hashlib
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any


class LodesAdapterRefused(ValueError):
    """The registered LODES release cannot be read without changing its meaning."""


def _hash(path: Path, *, logical: bool) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    opener = gzip.open if logical and path.suffix == ".gz" else Path.open
    with opener(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def verify_release(repo_root: Path, source_release: Mapping[str, Any]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for label, record in (source_release.get("files") or {}).items():
        path = repo_root / str(record.get("path") or "")
        if not path.is_file():
            raise LodesAdapterRefused(f"Registered LODES source is unavailable: {label}")
        stored_size, stored_hash = _hash(path, logical=False)
        logical_size, logical_hash = _hash(path, logical=True)
        if stored_size != int(record.get("stored_bytes", -1)) or stored_hash != record.get("stored_sha256"):
            raise LodesAdapterRefused(f"Registered LODES stored bytes changed: {label}")
        if logical_size != int(record.get("bytes", -1)) or logical_hash != record.get("sha256"):
            raise LodesAdapterRefused(f"Registered LODES logical bytes changed: {label}")
        result[label] = path
    return result


def read_county_od(
    od_paths: Sequence[Path], geography_ids: Sequence[str]
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, set[str]]]:
    """Read every OD record touching a selected geography without a boundary cap."""
    selected = set(str(value) for value in geography_ids)
    rows: dict[str, list[dict[str, Any]]] = {value: [] for value in selected}
    active_blocks: dict[str, set[str]] = {value: set() for value in selected}
    for path in od_paths:
        with gzip.open(path, "rt", newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            required = {"w_geocode", "h_geocode", "S000"}
            if not required.issubset(reader.fieldnames or ()):
                raise LodesAdapterRefused(f"LODES OD file omitted {sorted(required)}: {path}")
            for raw in reader:
                work = str(raw["w_geocode"])
                home = str(raw["h_geocode"])
                geographies = {work[:5], home[:5]} & selected
                if not geographies:
                    continue
                try:
                    weight = int(raw["S000"])
                except (TypeError, ValueError) as exc:
                    raise LodesAdapterRefused("LODES OD S000 contains an unreadable value") from exc
                if weight < 0:
                    raise LodesAdapterRefused("LODES OD S000 contains negative employment")
                for geography in geographies:
                    rows[geography].append({"work_block": work, "home_block": home, "source_weight": weight})
                    active_blocks[geography].update((work, home))
    return rows, active_blocks


def read_crosswalk(path: Path, active_blocks: Mapping[str, set[str]]) -> dict[str, dict[str, dict[str, Any]]]:
    memberships: dict[str, list[str]] = defaultdict(list)
    for geography, blocks in active_blocks.items():
        for block in blocks:
            memberships[block].append(geography)
    selected = set(memberships)
    result: dict[str, dict[str, dict[str, Any]]] = {key: {} for key in active_blocks}
    with gzip.open(path, "rt", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {"tabblk2020", "blklatdd", "blklondd"}
        if not required.issubset(reader.fieldnames or ()):
            raise LodesAdapterRefused("LODES crosswalk omitted block id or internal-point coordinates")
        for raw in reader:
            block = str(raw["tabblk2020"])
            if block not in selected:
                continue
            try:
                latitude = float(raw["blklatdd"])
                longitude = float(raw["blklondd"])
            except (TypeError, ValueError):
                continue
            for geography in memberships[block]:
                result[geography][block] = {
                    "block_id": block,
                    "tract_id": block[:11],
                    "latitude": latitude,
                    "longitude": longitude,
                }
    return result


def read_area_coverage(path: Path, geography_ids: Sequence[str]) -> dict[str, dict[str, int]]:
    selected = set(geography_ids)
    counts: dict[str, Counter[str]] = {value: Counter() for value in selected}
    with gzip.open(path, "rt", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        geocode = next((field for field in ("h_geocode", "w_geocode") if field in (reader.fieldnames or ())), None)
        if geocode is None or "C000" not in (reader.fieldnames or ()):
            raise LodesAdapterRefused("LODES RAC/WAC file omitted its geocode or C000 total")
        for raw in reader:
            geography = str(raw[geocode])[:5]
            if geography not in selected:
                continue
            try:
                value = int(raw["C000"])
            except (TypeError, ValueError) as exc:
                raise LodesAdapterRefused("LODES RAC/WAC C000 contains an unreadable value") from exc
            counts[geography]["records"] += 1
            counts[geography]["explicit_zero_records" if value == 0 else "positive_records"] += 1
    return {key: dict(value) for key, value in counts.items()}


def aggregate_source_pairs(
    *,
    rows: Sequence[Mapping[str, Any]],
    blocks: Mapping[str, Mapping[str, Any]],
    zone_by_tract: Mapping[str, int],
    access_by_block: Mapping[str, Mapping[str, Any]],
) -> tuple[dict[tuple[int, int], list[dict[str, Any]]], dict[str, int], dict[str, float]]:
    grouped: dict[tuple[int, int, str, str, str], float] = defaultdict(float)
    states: Counter[str] = Counter()
    state_weights: Counter[str] = Counter()
    for row in rows:
        home_id, work_id = str(row["home_block"]), str(row["work_block"])
        home = blocks.get(home_id)
        work = blocks.get(work_id)
        home_zone = zone_by_tract.get(str((home or {}).get("tract_id") or ""))
        work_zone = zone_by_tract.get(str((work or {}).get("tract_id") or ""))
        if home_zone is None or work_zone is None:
            state = "unavailable_source" if home is None or work is None else "unmapped"
            states[state] += 1
            state_weights[state] += float(row["source_weight"])
            continue
        home_access = access_by_block.get(home_id)
        work_access = access_by_block.get(work_id)
        home_access_id = str((home_access or {}).get("access_point_id") or f"block:{home_id}")
        work_access_id = str((work_access or {}).get("access_point_id") or f"block:{work_id}")
        access_states = {
            str((item or {}).get("resolution_state") or "unmapped")
            for item in (home_access, work_access)
        }
        if access_states == {"routable"}:
            source_state = "covered"
        elif "unavailable_source" in access_states:
            source_state = "unavailable_source"
        elif "unroutable" in access_states:
            source_state = "unroutable"
        else:
            source_state = "unmapped"
        grouped[(int(home_zone), int(work_zone), home_access_id, work_access_id, source_state)] += float(row["source_weight"])
        states[source_state] += 1
        state_weights[source_state] += float(row["source_weight"])
    result: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for (home_zone, work_zone, home_access, work_access, state), weight in sorted(grouped.items()):
        result[(home_zone, work_zone)].append({
            "home_access_point_id": home_access,
            "work_access_point_id": work_access,
            "origin_access_point_id": home_access,
            "destination_access_point_id": work_access,
            "source_weight": weight,
            "source_state": state,
        })
    return dict(result), dict(states), dict(state_weights)


def reverse_source_pairs(
    pairs: Mapping[tuple[int, int], Sequence[Mapping[str, Any]]]
) -> dict[tuple[int, int], list[dict[str, Any]]]:
    result: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for (home_zone, work_zone), records in pairs.items():
        for raw in records:
            item = dict(raw)
            item["origin_access_point_id"] = item.get("work_access_point_id")
            item["destination_access_point_id"] = item.get("home_access_point_id")
            result[(work_zone, home_zone)].append(item)
    return dict(result)
