"""Retain one realized household-resident population for both demand engines.

File identities establish which supplied records a consumer reads. They do not
authenticate Census origin, the producer, custody, fit quality or accuracy.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

SCHEMA = "openplan.common-population.v1"
MANIFEST_NAME = "common_population.json"
UNIVERSE = "household_residents"
EXCLUSIONS = {"group_quarters": "excluded_unassessed", "full_population_coverage": "unassessed"}
EXTERNAL_KINDS = frozenset({"external", "cordon", "gateway"})
MAX_SAFE_INTEGER = 2**53 - 1
HOUSEHOLD_FIELDS = frozenset({"household_id", "home_zone_id", "persons", "workers", "autos", "income", "hht", "seed_household_id", "source_geoid", "synthesis_method"})
PERSON_FIELDS = frozenset({"person_id", "household_id", "person_num", "home_zone_id", "age", "sex", "is_worker", "is_student", "esr", "schg", "wkhp", "seed_household_id", "source_geoid", "synthesis_method"})
ROLES = {"households": "households.csv", "persons": "persons.csv", "selected_zones": "selected_zones.json", "diagnostics": "diagnostics.json", "source_manifest": "source_manifest.json", "source_zone_attributes": "source_zone_attributes.csv"}
BASIS_FIELDS = frozenset({"schema", "source_profile", "universe", "exclusions", "selected_zone_map", "files", "realized_zone_counts", "published_all_person_totals", "custody", "caveats"})
CAVEAT = "One retained household-resident realization; group quarters are excluded and unassessed. Shared inputs do not establish full population coverage, scientific accuracy or local behavioral calibration."
SYNTHESIS_METHOD = "acs_pums_seed_iterative_proportional_updating"


class CommonPopulationError(ValueError):
    """The retained realization or its expected identity cannot be established."""


def _canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8")


def _reject_credentials(value: Any) -> None:
    """Refuse credential fields instead of copying them into model artifacts."""
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).lower().replace("-", "_")
            if (normalized == "key" or normalized.endswith("_key")
                    or any(word in normalized for word in ("api_key", "password", "secret", "token", "credential", "authorization"))):
                raise CommonPopulationError("Credentials cannot be retained in population artifacts.")
            _reject_credentials(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_credentials(child)
    elif isinstance(value, str) and re.search(r"[?&](?:key|api_key|token|password)=", value, re.IGNORECASE):
        raise CommonPopulationError("Credential URL parameters cannot be retained in population artifacts.")


def _json(data: bytes) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise CommonPopulationError("Duplicate JSON object key.")
            result[key] = value
        return result

    def nonfinite(value):
        raise CommonPopulationError("Nonfinite JSON value.")

    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=nonfinite)
    except (ValueError, UnicodeDecodeError) as exc:
        raise CommonPopulationError(f"Invalid retained JSON: {exc}") from exc


def _integer(value: Any, label: str, *, positive: bool = False, zone: bool = False) -> int:
    if isinstance(value, bool):
        raise CommonPopulationError(f"{label} must be an integer, not bool.")
    if isinstance(value, int):
        number = value
    elif zone and isinstance(value, float) and math.isfinite(value) and value.is_integer():
        number = int(value)
    elif isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value):
        number = int(value)
    else:
        raise CommonPopulationError(f"{label} requires a canonical integer identity/count.")
    if number < (1 if positive else 0) or number > MAX_SAFE_INTEGER:
        raise CommonPopulationError(f"{label} is outside the supported integer range.")
    return number


def census_source_profile(acs_summary_endpoint: str, pums_endpoint: str) -> dict[str, Any]:
    """Retain the lower-level Census endpoint spelling and catalog profile facts."""
    from population_source_registry import PopulationSourceError, census_endpoint_profile

    try:
        return census_endpoint_profile(acs_summary_endpoint, pums_endpoint)
    except PopulationSourceError as exc:
        raise CommonPopulationError(str(exc)) from exc


def validate_source_profile(profile: Mapping[str, Any], *, canonical: bool = False) -> dict[str, Any]:
    from population_source_registry import PopulationSourceError, validate_source_profile as validate

    try:
        return validate(profile, canonical=canonical)
    except PopulationSourceError as exc:
        raise CommonPopulationError(str(exc)) from exc


def selected_zone_map(zone_rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Canonicalize a map identity, never reorder or rewrite retained rosters."""
    zones = []
    ids: set[int] = set()
    geoids: set[str] = set()
    for row in zone_rows:
        zone_id = _integer(row.get("zone_id"), "zone_id", positive=True, zone=True)
        kind = str(row.get("zone_kind") or "internal").strip().lower()
        geoid = row.get("GEOID")
        if not isinstance(geoid, str):
            raise CommonPopulationError("Selected-zone GEOID must be a string.")
        if zone_id in ids or (geoid and geoid in geoids):
            raise CommonPopulationError("Duplicate selected-zone identity.")
        external = kind in EXTERNAL_KINDS
        if not external and (kind != "internal" or re.fullmatch(r"[0-9]{11,12}", geoid) is None):
            raise CommonPopulationError("Unsupported internal zone kind or Census geography.")
        ids.add(zone_id)
        if geoid:
            geoids.add(geoid)
        zones.append({"zone_id": zone_id, "GEOID": geoid, "zone_kind": kind, "population_role": "external_no_residents" if external else "household_residents"})
    lengths = {len(z["GEOID"]) for z in zones if z["population_role"] == UNIVERSE}
    if not zones or len(lengths) != 1:
        raise CommonPopulationError("Selected zones require one supported internal geography.")
    return sorted(zones, key=lambda row: row["zone_id"])


def _regular_bytes(path: Path) -> bytes:
    absolute = path.absolute()
    if any(part.is_symlink() for part in (absolute, *absolute.parents)) or not path.is_file():
        raise CommonPopulationError(f"Expected a regular file without symlink components: {path.name}")
    return path.read_bytes()


def file_descriptor(path: Path, *, relative_path: str | None = None) -> dict[str, Any]:
    data = _regular_bytes(path)
    return {"path": relative_path or path.name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def _descriptor(value: Any, path: str) -> dict[str, Any]:
    if (not isinstance(value, dict) or set(value) != {"path", "sha256", "bytes"}
            or value.get("path") != path or not isinstance(value.get("sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is None):
        raise CommonPopulationError("Exact file descriptor required; paths cannot traverse or alias files.")
    _integer(value["bytes"], "file bytes")
    if not isinstance(value["bytes"], int):
        raise CommonPopulationError("File byte length must be a JSON integer.")
    return value


def _checked_bytes(directory: Path, descriptor: dict[str, Any], path: str) -> bytes:
    _descriptor(descriptor, path)
    data = _regular_bytes(directory / path)
    if len(data) != descriptor["bytes"] or hashlib.sha256(data).hexdigest() != descriptor["sha256"]:
        raise CommonPopulationError(f"Retained file identity mismatch: {path}")
    return data


def _rows(data: bytes, required: frozenset[str]) -> list[dict[str, Any]]:
    try:
        reader = csv.DictReader(io.StringIO(data.decode("utf-8"), newline=""))
        fields = reader.fieldnames or []
        if len(set(fields)) != len(fields) or set(fields) != required:
            raise CommonPopulationError("Unknown retained roster row schema.")
        rows = []
        # Reuse identical low-cardinality source strings without changing values.
        shared = {key: {} for key in ("source_geoid", "seed_household_id", "synthesis_method", "esr", "schg", "wkhp")}
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise CommonPopulationError("Retained CSV row length differs from its declared schema.")
            for key, pool in shared.items():
                if key in row:
                    row[key] = pool.setdefault(row[key], row[key])
            rows.append(row)
        return rows
    except UnicodeDecodeError as exc:
        raise CommonPopulationError("Retained roster must be UTF-8 CSV.") from exc


def realized_zone_counts(households: Sequence[Mapping[str, Any]], persons: Sequence[Mapping[str, Any]], zones: Sequence[Mapping[str, Any]]) -> list[dict[str, int]]:
    """Check every roster join before deriving engine-compatible actual totals."""
    import census_pums as cp

    zone_index = {z["zone_id"]: z for z in zones}
    counts = {zone_id: {"zone_id": zone_id, "households": 0, "persons": 0, "workers": 0} for zone_id in zone_index}
    by_household = {}
    for raw in households:
        if set(raw) != HOUSEHOLD_FIELDS:
            raise CommonPopulationError("Unknown household row schema.")
        row = dict(raw)
        for key in ("household_id", "home_zone_id", "persons", "workers", "autos", "hht"):
            row[key] = _integer(row[key], key, positive=key in {"household_id", "home_zone_id", "persons"})
        try:
            income = float(row["income"])
        except (ValueError, TypeError) as exc:
            raise CommonPopulationError("Household income must be finite.") from exc
        if isinstance(row["income"], bool) or not math.isfinite(income):
            raise CommonPopulationError("Household income must be finite.")
        zone = zone_index.get(row["home_zone_id"])
        if zone is None or zone["population_role"] != UNIVERSE or row["source_geoid"] != zone["GEOID"]:
            raise CommonPopulationError("Household zone/GEOID differs from selected-zone map.")
        if row["household_id"] in by_household or row["workers"] > row["persons"]:
            raise CommonPopulationError("Duplicate household or impossible declared worker count.")
        if (not isinstance(row["seed_household_id"], str) or not row["seed_household_id"]
                or any(ord(char) < 32 for char in row["seed_household_id"])
                or row["synthesis_method"] != SYNTHESIS_METHOD):
            raise CommonPopulationError("Household source identity/method is missing.")
        by_household[row["household_id"]] = row
        counts[row["home_zone_id"]]["households"] += 1
    person_ids: set[int] = set()
    members = {key: [] for key in by_household}
    for raw in persons:
        if set(raw) != PERSON_FIELDS:
            raise CommonPopulationError("Unknown person row schema.")
        row = dict(raw)
        for key in ("person_id", "household_id", "person_num", "home_zone_id", "age", "sex", "is_worker", "is_student"):
            row[key] = _integer(row[key], key, positive=key in {"person_id", "household_id", "person_num", "home_zone_id"})
        if row["person_id"] in person_ids or row["is_worker"] not in (0, 1) or row["is_student"] not in (0, 1):
            raise CommonPopulationError("Duplicate person or invalid person indicator.")
        if any(not isinstance(row[key], str) for key in ("esr", "schg", "wkhp")):
            raise CommonPopulationError("Raw person source codes must retain their string schema.")
        if row["is_worker"] != int(cp.is_worker(row["esr"])) or row["is_student"] != int(cp.is_student(row["schg"])):
            raise CommonPopulationError("Person indicators differ from retained raw source codes.")
        household = by_household.get(row["household_id"])
        if household is None or any(row[key] != household[key] for key in ("home_zone_id", "source_geoid", "seed_household_id", "synthesis_method")):
            raise CommonPopulationError("Person does not join its exact household/zone/source.")
        person_ids.add(row["person_id"])
        members[row["household_id"]].append((row["person_num"], row["is_worker"]))
        counts[row["home_zone_id"]]["persons"] += 1
        counts[row["home_zone_id"]]["workers"] += row["is_worker"]
    for key, household in by_household.items():
        people = members[key]
        if (len(people) != household["persons"] or sum(p[1] for p in people) != household["workers"]
                or sorted(p[0] for p in people) != list(range(1, len(people) + 1))):
            raise CommonPopulationError("Declared household roster/count differs from actual persons.")
    return [counts[key] for key in sorted(counts)]


def _profile_matches_provenance(profile: dict[str, Any], provenance: Mapping[str, Any]) -> None:
    fields = {"endpoint": "pums_endpoint", "acs_summary_endpoint": "acs_summary_endpoint", "acs_sample_years": "sample_years", "income_dollar_year": "income_dollar_year", "puma_fields": "puma_fields"}
    if any(provenance.get(key) != profile[target] for key, target in fields.items()):
        raise CommonPopulationError("Realization provenance differs from the explicit source profile.")


def retained_school_enrollment(population: Mapping[str, Any]) -> dict[str, dict[str, float]]:
    """Read retained enrolled-resident cells without inventing seats or rates.

    The MTC adapter still uses enrolled residents as destination inputs. Its
    existing caveats disclose that approximation; raw cells remain separate.
    """
    import census_pums as cp

    school = population["diagnostics"].get("school_inputs")
    if not isinstance(school, dict) or set(school) != {"enrollment", "raw_by_geoid", "missing_cells_by_geoid", "basis"}:
        raise CommonPopulationError("Retained MTC population requires retained school input records; refetch is not allowed.")
    wanted = {row["GEOID"] for row in _json(_checked_bytes(Path(population["directory"]), population["basis"]["files"]["selected_zones"], ROLES["selected_zones"])) if row["population_role"] == UNIVERSE}
    if any(set(school[key]) != wanted for key in ("enrollment", "raw_by_geoid", "missing_cells_by_geoid")):
        raise CommonPopulationError("Retained school inputs must cover exactly the selected internal zones.")
    expected_basis = "ACS B14001 enrolled residents; not school seats or measured full-time college enrollment"
    if school["basis"] != expected_basis:
        raise CommonPopulationError("Unknown retained school input basis.")
    enrollment = {}
    for geoid, cells in school["raw_by_geoid"].items():
        values = [cp._cell_value(cells, cell) for cell in (cp.ENROLLMENT_HIGH_SCHOOL_CELL, *cp.ENROLLMENT_COLLEGE_CELLS)]
        if school["missing_cells_by_geoid"][geoid] or any(value is None or not math.isfinite(value) or value < 0 for value in values):
            raise CommonPopulationError("Retained school cells are missing/suppressed/invalid; enrolled residents are unassessed.")
        derived = {"high_school": values[0], "college": sum(values[1:])}
        if school["enrollment"][geoid] != derived:
            raise CommonPopulationError("Retained school enrollment differs from raw source cells.")
        enrollment[geoid] = derived
    return enrollment


def retain_population(directory: Path, zone_rows: Sequence[Mapping[str, Any]], result: Mapping[str, Any], *, source_manifest_path: Path, zone_attributes_path: Path, source_profile: Mapping[str, Any]) -> dict[str, Any]:
    """Create new artifacts only, bound to the supplied immutable source inputs.

    The source manifest can be a retained run-input snapshot. It is deliberately
    independent of the final engine package, which does not exist before demand.
    """
    directory = Path(directory)
    profile = validate_source_profile(source_profile)
    zones = selected_zone_map(zone_rows)
    _profile_matches_provenance(profile, result["provenance"])
    counts = realized_zone_counts(result["households"], result["persons"], zones)
    source_controls = result.get("source_controls")
    if not isinstance(source_controls, dict) or set(source_controls.get("raw_by_geoid", {})) != {z["GEOID"] for z in zones if z["population_role"] == UNIVERSE}:
        raise CommonPopulationError("Actual raw source controls must cover every selected internal zone.")
    diagnostics = {key: result[key] for key in ("provenance", "source_controls", "fit_quality", "fit_grading_note", "dropped_controls", "zone_fits", "method")}
    diagnostics["school_inputs"] = result.get("school_inputs")
    if diagnostics["method"] != SYNTHESIS_METHOD:
        raise CommonPopulationError("Unknown retained population synthesis method.")
    _reject_credentials(diagnostics)
    # Validate and spool the same canonical bytes before materialization. Full
    # fit-weight diagnostics can exceed a gigabyte; do not duplicate that string.
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", newline="") as diagnostics_file:
        json.dump(diagnostics, diagnostics_file, sort_keys=True, separators=(",", ":"),
                  ensure_ascii=True, allow_nan=False)
        diagnostics_file.write("\n")
        source_manifest_data = _regular_bytes(Path(source_manifest_path))
        _reject_credentials(_json(source_manifest_data))
        source_zones_data = _regular_bytes(Path(zone_attributes_path))
        # Bind the retained CSV map too, not merely the caller's in-memory map.
        if selected_zone_map(list(csv.DictReader(io.StringIO(source_zones_data.decode("utf-8"))))) != zones:
            raise CommonPopulationError("Source zone CSV differs from selected-zone map.")
        if directory.exists() or directory.is_symlink():
            raise CommonPopulationError("Common population directory must be new; replacement is not supported.")
        if any(part.is_symlink() for part in (directory.absolute().parent, *directory.absolute().parents)):
            raise CommonPopulationError("Population directory cannot use symlink components.")
        directory.mkdir(parents=True)
        for role, rows, fields in (("households", result["households"], HOUSEHOLD_FIELDS), ("persons", result["persons"], PERSON_FIELDS)):
            # Preserve realized row order and values; only a new CSV's columns use
            # an explicit stable schema. Existing bytes are never normalized.
            with (directory / ROLES[role]).open("x", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=sorted(fields))
                writer.writeheader()
                writer.writerows(rows)
        (directory / ROLES["selected_zones"]).write_bytes(_canonical(zones))
        diagnostics_file.seek(0)
        with (directory / ROLES["diagnostics"]).open("w", encoding="utf-8", newline="") as handle:
            shutil.copyfileobj(diagnostics_file, handle)
        (directory / ROLES["source_manifest"]).write_bytes(source_manifest_data)
        (directory / ROLES["source_zone_attributes"]).write_bytes(source_zones_data)
        files = {role: file_descriptor(directory / path) for role, path in ROLES.items()}
        basis = {"schema": SCHEMA, "source_profile": profile, "universe": UNIVERSE, "exclusions": EXCLUSIONS,
                 "selected_zone_map": files["selected_zones"], "files": files, "realized_zone_counts": counts,
                 "published_all_person_totals": {geoid: cells.get("B01003_001E") for geoid, cells in source_controls["raw_by_geoid"].items()},
                 "custody": "supplied_artifacts_not_producer_authenticated", "caveats": [CAVEAT]}
        (directory / MANIFEST_NAME).write_bytes(_canonical(basis))
        return file_descriptor(directory / MANIFEST_NAME)


def read_common_population(directory: Path, *, expected_manifest: Mapping[str, Any], zone_rows: Sequence[Mapping[str, Any]], expected_source_manifest: Mapping[str, Any] | None = None, expected_zone_attributes: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Verify expected manifest bytes and every file before consuming rows.

    Source descriptors, when supplied, refer to original retained input bytes,
    not transformed engine zone tables. The expected manifest pins both either way.
    """
    directory = Path(directory)
    basis = _json(_checked_bytes(directory, dict(expected_manifest), MANIFEST_NAME))
    if (not isinstance(basis, dict) or set(basis) != BASIS_FIELDS or basis.get("schema") != SCHEMA or basis.get("universe") != UNIVERSE
            or basis.get("exclusions") != EXCLUSIONS or basis.get("custody") != "supplied_artifacts_not_producer_authenticated"
            or basis.get("caveats") != [CAVEAT]):
        raise CommonPopulationError("Unsupported common-population schema/universe/custody.")
    profile = validate_source_profile(basis["source_profile"])
    files = basis.get("files")
    if not isinstance(files, dict) or set(files) != set(ROLES):
        raise CommonPopulationError("Retained population requires exactly its declared file roles.")
    payloads = {role: _checked_bytes(directory, files[role], path) for role, path in ROLES.items()}
    for expected, role in ((expected_source_manifest, "source_manifest"), (expected_zone_attributes, "source_zone_attributes")):
        if expected is not None:
            _descriptor(dict(expected), ROLES[role])
            if dict(expected) != files[role]:
                raise CommonPopulationError(f"Expected original source identity differs: {role}")
    zones = selected_zone_map(zone_rows)
    stored_zones = _json(payloads["selected_zones"])
    if (basis.get("selected_zone_map") != files["selected_zones"] or stored_zones != zones
            or selected_zone_map(stored_zones) != zones):
        raise CommonPopulationError("Selected-zone map identity differs from retained realization.")
    if selected_zone_map(list(csv.DictReader(io.StringIO(payloads["source_zone_attributes"].decode("utf-8"))))) != zones:
        raise CommonPopulationError("Retained source CSV map differs from selected zones.")
    diagnostics = _json(payloads.pop("diagnostics"))
    _reject_credentials(diagnostics)
    source_manifest = _json(payloads["source_manifest"])
    _reject_credentials(source_manifest)
    if diagnostics["method"] != SYNTHESIS_METHOD:
        raise CommonPopulationError("Unknown retained population synthesis method.")
    _profile_matches_provenance(profile, diagnostics["provenance"])
    raw_controls = diagnostics["source_controls"]["raw_by_geoid"]
    if set(raw_controls) != {z["GEOID"] for z in zones if z["population_role"] == UNIVERSE}:
        raise CommonPopulationError("Raw controls do not cover the selected zones.")
    if basis.get("published_all_person_totals") != {g: cells.get("B01003_001E") for g, cells in raw_controls.items()}:
        raise CommonPopulationError("Published all-person metadata differs from raw controls.")
    households = _rows(payloads.pop("households"), HOUSEHOLD_FIELDS)
    persons = _rows(payloads.pop("persons"), PERSON_FIELDS)
    counts = realized_zone_counts(households, persons, zones)
    declared_counts = basis.get("realized_zone_counts")
    if not isinstance(declared_counts, list):
        raise CommonPopulationError("Realized zone counts must be a list.")
    for row in declared_counts:
        if not isinstance(row, dict) or set(row) != {"zone_id", "households", "persons", "workers"}:
            raise CommonPopulationError("Unknown realized-zone count schema.")
        for key, value in row.items():
            _integer(value, key, positive=key == "zone_id")
            if not isinstance(value, int):
                raise CommonPopulationError("Declared realized counts must be JSON integers.")
    if counts != basis.get("realized_zone_counts"):
        raise CommonPopulationError("Retained zone counts differ from actual realized rosters.")
    # Return integer fields as typed integers; raw bytes remain retained and
    # hashed separately from any ActivitySim adapter representation.
    for row in households:
        for field in ("household_id", "home_zone_id", "persons", "workers", "autos", "hht"):
            row[field] = _integer(row[field], field)
        row["income"] = float(row["income"])
    for row in persons:
        for field in ("person_id", "household_id", "person_num", "home_zone_id", "age", "sex", "is_worker", "is_student"):
            row[field] = _integer(row[field], field)
    return {"basis": basis, "manifest": dict(expected_manifest), "households": households, "persons": persons,
            "diagnostics": diagnostics, "realized_zone_counts": counts, "directory": str(directory),
            "source_manifest": source_manifest, "source_zone_attributes": files["source_zone_attributes"]}


def aequilibrae_zone_totals(population: Mapping[str, Any]) -> dict[int, dict[str, int]]:
    """Map actual residents to the existing AequilibraE demand field names."""
    return {row["zone_id"]: {"households": row["households"], "est_population": row["persons"], "worker_residents": row["workers"]}
            for row in population["realized_zone_counts"]}


def copy_retained_population(population: Mapping[str, Any], destination: Path) -> None:
    """Keep raw realization bytes alongside a bundle's transformed inputs."""
    source = Path(population["directory"])
    destination.mkdir(parents=True, exist_ok=False)
    # Recheck rather than trusting a previously read mutable path.
    for path, descriptor in [(MANIFEST_NAME, population["manifest"]), *[(path, population["basis"]["files"][role]) for role, path in ROLES.items()]]:
        data = _checked_bytes(source, descriptor, path)
        (destination / path).write_bytes(data)
