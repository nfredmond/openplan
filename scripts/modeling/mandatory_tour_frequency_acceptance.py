#!/usr/bin/env python3
"""Freeze, open once, and grade the mandatory-tour acceptance partition.

The opening lock binds the source, reconstruction code, candidate, evaluator,
and exact ActivitySim random-choice implementation before an acceptance member
is read.  Evaluation writes one aggregate result.  It never writes person-day
outcomes, and a failed opening still consumes the exclusive receipt.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import inspect
import json
import math
import os
import platform
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from statistics import NormalDist
from typing import Any, Callable, Iterable, Mapping, Sequence

import fit_mandatory_tour_frequency_candidate as fit
import mandatory_tour_frequency_acceptance_protocol as acceptance_protocol
import mandatory_tour_frequency_candidate_registry as candidate_protocol
import mandatory_tour_frequency_outcomes as outcomes
import prepare_mandatory_tour_development_source as preparation


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "modeling"
DEFAULT_PREREGISTRATION = (
    DATA_ROOT / "mandatory-tour-frequency-preregistration-2026-08-19.json"
)
DEFAULT_ACCEPTANCE_PROTOCOL = (
    DATA_ROOT / "mandatory-tour-frequency-acceptance-protocol-v2-2026-08-19.json"
)
DEFAULT_DEVELOPMENT_MANIFEST = (
    DATA_ROOT / "mandatory-tour-frequency-development-outcomes-v2-2026-08-19.json"
)
DEFAULT_CANDIDATE_REGISTRY = (
    DATA_ROOT / "mandatory-tour-frequency-candidate-registry-v2-2026-08-19.json"
)
DEFAULT_CANDIDATE_PACKAGE = (
    DATA_ROOT / "activitysim-mandatory-tour-frequency-national-v2"
)
DEFAULT_OPENING_LOCK = (
    DATA_ROOT / "mandatory-tour-frequency-acceptance-opening-lock-v2-2026-08-19.json"
)
DEFAULT_OPENING_RECEIPT = (
    DATA_ROOT / "mandatory-tour-frequency-acceptance-opening-receipt-v2-2026-08-19.json"
)
DEFAULT_ACCEPTANCE_RESULT = (
    DATA_ROOT / "mandatory-tour-frequency-acceptance-result-v2-2026-08-19.json"
)

OPENING_LOCK_SCHEMA_VERSION = (
    "openplan.activitysim-mandatory-tour-frequency-acceptance-opening-lock.v1"
)
OPENING_LOCK_STATUS = "locked_acceptance_unopened"
OPENING_RECEIPT_SCHEMA_VERSION = (
    "openplan.activitysim-mandatory-tour-frequency-acceptance-opening-receipt.v1"
)
RESULT_SCHEMA_VERSION = (
    "openplan.activitysim-mandatory-tour-frequency-acceptance-result.v1"
)
EVALUATED_ONCE_STATUS = "acceptance_evaluated_once"
ACCEPTED_COMPONENT_STATUS = "accepted_component"
REJECTED_COMPONENT_STATUS = "rejected_component"
COMPONENT_SCOPE = (
    "ActivitySim mandatory-tour-frequency component conditional on observed mandatory DAP"
)
ACTIVITYSIM_VERSION = "1.5.1"
NUMPY_VERSION = "1.25.2"
PANDAS_VERSION = "2.3.3"
NUMBA_VERSION = "0.66.0"
SCIPY_VERSION = "1.16.3"
PYTHON_VERSION = "3.11.15"
ACTIVITYSIM_RANDOM_SHA256 = (
    "b46078a39ffec43fb0f24f497f65c00148900623926942d94d88d3c0a28a2bf7"
)
ACTIVITYSIM_CHOOSING_SHA256 = (
    "10a393bec5a426dc5118079f367dec4c2d5dfe2fd523712e4f2fc0182b7e164e"
)
ACTIVITYSIM_SIMULATE_SHA256 = (
    "30ee80da9be8aac46e05f00a5e27514c58753a3eb973f61d0a20f49652ca7805"
)
ACTIVITYSIM_LOGIT_SHA256 = (
    "9a2f3fe5282576b77ef9b33dc528d83fc21cb182e29f43f911c72b961852e461"
)
SUPPORTED_STATUS = "supported_alternative"
OUT_OF_SUPPORT_STATUS = "out_of_support_mandatory_pattern"
PRIMARY_STEP_NAME = "mandatory_tour_frequency"
PERSON_CHANNEL_NAME = "persons"


class MandatoryTourAcceptanceError(RuntimeError):
    """The frozen acceptance contract cannot be applied exactly once."""


@dataclass(frozen=True)
class ActivitySimEnvironment:
    """Exact runtime objects used by the stochastic acceptance check."""

    activitysim_version: str
    numpy_version: str
    pandas_version: str
    numba_version: str
    scipy_version: str
    python_version: str
    random_path: Path
    choosing_path: Path
    simulate_path: Path
    logit_path: Path
    random_class: Any
    choice_maker: Callable[..., Any]
    dataframe_factory: Callable[..., Any]
    index_factory: Callable[..., Any]


@dataclass(frozen=True)
class TaylorRatio:
    estimate: float
    standard_error: float
    variance: float
    degrees_of_freedom: int
    denominator: float


def _sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _load_json(path: str | Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise MandatoryTourAcceptanceError(f"{label} is unreadable") from exc
    if not isinstance(value, dict):
        raise MandatoryTourAcceptanceError(f"{label} must be a JSON object")
    return value


def _portable_path(path: str | Path) -> str:
    resolved = Path(path).resolve()
    try:
        return str(resolved.relative_to(REPOSITORY_ROOT))
    except ValueError:
        return str(resolved)


def _resolve_recorded_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPOSITORY_ROOT / path


def _positive_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result > 0 else None


def _exclusive_json(path: str | Path, value: Mapping[str, Any]) -> None:
    target = Path(path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    rendered = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    try:
        descriptor = os.open(
            target,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o644,
        )
    except FileExistsError as exc:
        raise MandatoryTourAcceptanceError(
            f"{target} already exists; the one-shot artifact cannot be replaced"
        ) from exc
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        # The path remains as evidence that the exclusive operation began.
        raise


def load_activitysim_environment() -> ActivitySimEnvironment:
    """Load and verify the exact ActivitySim 1.5.1 random-choice runtime."""
    try:
        import numpy as np
        import pandas as pd
        import numba
        import scipy
        from activitysim.core import choosing, logit, random as activitysim_random, simulate
    except ImportError as exc:
        raise MandatoryTourAcceptanceError(
            "Acceptance requires the locked ActivitySim execution environment"
        ) from exc

    try:
        activitysim_version = importlib.metadata.version("activitysim")
    except importlib.metadata.PackageNotFoundError as exc:
        raise MandatoryTourAcceptanceError("ActivitySim has no installed version record") from exc
    environment = ActivitySimEnvironment(
        activitysim_version=activitysim_version,
        numpy_version=str(np.__version__),
        pandas_version=str(pd.__version__),
        numba_version=str(numba.__version__),
        scipy_version=str(scipy.__version__),
        python_version=platform.python_version(),
        random_path=Path(inspect.getfile(activitysim_random)).resolve(),
        choosing_path=Path(inspect.getfile(choosing)).resolve(),
        simulate_path=Path(inspect.getfile(simulate)).resolve(),
        logit_path=Path(inspect.getfile(logit)).resolve(),
        random_class=activitysim_random.Random,
        choice_maker=choosing.choice_maker,
        dataframe_factory=pd.DataFrame,
        index_factory=pd.Index,
    )
    expected_versions = {
        "activitysim": ACTIVITYSIM_VERSION,
        "numpy": NUMPY_VERSION,
        "pandas": PANDAS_VERSION,
        "numba": NUMBA_VERSION,
        "scipy": SCIPY_VERSION,
        "python": PYTHON_VERSION,
    }
    measured_versions = {
        "activitysim": environment.activitysim_version,
        "numpy": environment.numpy_version,
        "pandas": environment.pandas_version,
        "numba": environment.numba_version,
        "scipy": environment.scipy_version,
        "python": environment.python_version,
    }
    if measured_versions != expected_versions:
        raise MandatoryTourAcceptanceError(
            "The ActivitySim acceptance environment versions differ from the frozen runtime"
        )
    if _sha256(environment.random_path) != ACTIVITYSIM_RANDOM_SHA256:
        raise MandatoryTourAcceptanceError("ActivitySim random.py differs from the frozen runtime")
    if _sha256(environment.choosing_path) != ACTIVITYSIM_CHOOSING_SHA256:
        raise MandatoryTourAcceptanceError("ActivitySim choosing.py differs from the frozen runtime")
    if _sha256(environment.simulate_path) != ACTIVITYSIM_SIMULATE_SHA256:
        raise MandatoryTourAcceptanceError("ActivitySim simulate.py differs from the frozen runtime")
    if _sha256(environment.logit_path) != ACTIVITYSIM_LOGIT_SHA256:
        raise MandatoryTourAcceptanceError("ActivitySim logit.py differs from the frozen runtime")
    return environment


def _runtime_record(environment: ActivitySimEnvironment) -> dict[str, Any]:
    return {
        "activitysim_version": environment.activitysim_version,
        "numpy_version": environment.numpy_version,
        "pandas_version": environment.pandas_version,
        "numba_version": environment.numba_version,
        "scipy_version": environment.scipy_version,
        "python_version": environment.python_version,
        "random_module": {
            "filename": environment.random_path.name,
            "sha256": _sha256(environment.random_path),
        },
        "choosing_module": {
            "filename": environment.choosing_path.name,
            "sha256": _sha256(environment.choosing_path),
        },
        "simulate_module": {
            "filename": environment.simulate_path.name,
            "sha256": _sha256(environment.simulate_path),
        },
        "logit_module": {
            "filename": environment.logit_path.name,
            "sha256": _sha256(environment.logit_path),
        },
    }


def _implementation_record(paths: Sequence[Path]) -> dict[str, Any]:
    files = [
        {"path": _portable_path(path), "sha256": _sha256(path)}
        for path in sorted({path.resolve() for path in paths}, key=str)
    ]
    return {"closure_sha256": _canonical_sha256(files), "files": files}


def evaluator_implementation_record() -> dict[str, Any]:
    """Hash every local module whose semantics the evaluator calls directly."""
    return _implementation_record(
        [
            Path(__file__),
            Path(fit.__file__),
            Path(candidate_protocol.__file__),
            Path(acceptance_protocol.__file__),
        ]
    )


def _verify_implementation_record(record: Mapping[str, Any], label: str) -> None:
    files = record.get("files")
    if not isinstance(files, list) or not files:
        raise MandatoryTourAcceptanceError(f"{label} has no implementation files")
    measured: list[dict[str, str]] = []
    for item in files:
        if not isinstance(item, Mapping):
            raise MandatoryTourAcceptanceError(f"{label} has an invalid file record")
        recorded_path = str(item.get("path") or "")
        path = _resolve_recorded_path(recorded_path).resolve()
        if not path.is_file() or _sha256(path) != item.get("sha256"):
            raise MandatoryTourAcceptanceError(f"{label} implementation file changed: {recorded_path}")
        measured.append({"path": recorded_path, "sha256": _sha256(path)})
    if _canonical_sha256(measured) != record.get("closure_sha256"):
        raise MandatoryTourAcceptanceError(f"{label} implementation closure changed")


def _acceptance_codes(preregistration: Mapping[str, Any]) -> list[str]:
    values = [
        str(row.get("division_code") or "")
        for row in (preregistration.get("selection") or {}).get(
            "acceptance_divisions", []
        )
    ]
    if not values or len(values) != len(set(values)) or any(not value for value in values):
        raise MandatoryTourAcceptanceError("The preregistered acceptance divisions are invalid")
    return sorted(values)


def _read_csv_rows(path: Path, label: str) -> list[dict[str, str]]:
    try:
        with path.open(newline="") as handle:
            return list(csv.DictReader(handle))
    except (OSError, csv.Error) as exc:
        raise MandatoryTourAcceptanceError(f"{label} is unreadable") from exc


def _verify_executable_model_consistency(
    candidate_package_dir: Path,
    package: Mapping[str, Any],
    fit_manifest: Mapping[str, Any],
) -> None:
    """Prove the scored JSON and the ActivitySim executable package are one model."""
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourAcceptanceError(
            "Executable-model verification requires numpy"
        ) from exc
    model = load_frozen_model(candidate_package_dir / fit.MODEL_NAME)
    alternatives = list(model["alternatives"])
    expected_settings = (
        f"SPEC: {fit.SPEC_NAME}\n"
        f"COEFFICIENTS: {fit.COEFFICIENTS_NAME}\n"
        "LOGIT_TYPE: MNL\n"
    )
    if (candidate_package_dir / fit.SETTINGS_NAME).read_text() != expected_settings:
        raise MandatoryTourAcceptanceError(
            "The ActivitySim settings do not execute the frozen mandatory-tour package"
        )

    measured_spec = _read_csv_rows(
        candidate_package_dir / fit.SPEC_NAME, "Candidate ActivitySim specification"
    )
    expected_spec = fit._spec_rows()
    if measured_spec != expected_spec:
        raise MandatoryTourAcceptanceError(
            "The ActivitySim specification differs from the scored model definition"
        )

    expected_coefficients: list[tuple[str, float, str]] = []
    for _worker, _student, cell in fit.STATUS_CELLS:
        for alternative in alternatives:
            expected_coefficients.append(
                (
                    f"offset_{cell}_{alternative}",
                    math.log(float(model["reference_probabilities"][cell][alternative])),
                    "T",
                )
            )
    for alternative in alternatives[1:]:
        for predictor in candidate_protocol.PREDICTORS:
            name = predictor["name"]
            expected_coefficients.append(
                (
                    f"coef_{alternative}_{name}",
                    float(model["learned_coefficients"][alternative][name]),
                    "F",
                )
            )
    measured_coefficients = _read_csv_rows(
        candidate_package_dir / fit.COEFFICIENTS_NAME,
        "Candidate ActivitySim coefficients",
    )
    if len(measured_coefficients) != len(expected_coefficients):
        raise MandatoryTourAcceptanceError(
            "The ActivitySim coefficient count differs from the scored model"
        )
    for measured, expected in zip(measured_coefficients, expected_coefficients):
        name, value, constrained = expected
        try:
            measured_value = float(measured.get("value", ""))
        except (TypeError, ValueError) as exc:
            raise MandatoryTourAcceptanceError(
                "An ActivitySim coefficient is non-numeric"
            ) from exc
        measured_production_value = float(np.float32(measured_value))
        expected_production_value = float(np.float32(value))
        if (
            set(measured) != {"coefficient_name", "value", "constrain"}
            or measured.get("coefficient_name") != name
            or measured.get("constrain") != constrained
            or not math.isfinite(measured_value)
            or measured_value != value
            or not math.isfinite(measured_production_value)
            or measured_production_value != expected_production_value
        ):
            raise MandatoryTourAcceptanceError(
                "The ActivitySim coefficients differ from the scored model JSON"
            )
    selected = float(model.get("selected_regularization"))
    if (
        selected != float(package.get("selected_regularization"))
        or selected
        != float(
            (fit_manifest.get("development_selection") or {}).get(
                "selected_regularization"
            )
        )
    ):
        raise MandatoryTourAcceptanceError(
            "The scored model and package disagree on selected regularization"
        )
    if fit_manifest.get("all_development_fit") != package.get("all_data_convergence"):
        raise MandatoryTourAcceptanceError(
            "The fit and coefficient package disagree on final convergence"
        )


def _build_artifact_chain(
    *,
    source_archive_path: Path,
    preregistration_path: Path,
    protocol_path: Path,
    development_manifest_path: Path,
    candidate_registry_path: Path,
    candidate_package_dir: Path,
) -> dict[str, Any]:
    preregistration = _load_json(preregistration_path, "Mandatory-tour preregistration")
    if preregistration.get("schema_version") != (
        "openplan.activitysim-mandatory-tour-frequency-preregistration.v1"
    ) or preregistration.get("status") != (
        "pre_registered_before_mandatory_tour_outcome_derivation"
    ):
        raise MandatoryTourAcceptanceError("The original preregistration is not unopened")
    preregistration_hash = _sha256(preregistration_path)
    source = preregistration.get("source") or {}
    if not source_archive_path.is_file():
        raise MandatoryTourAcceptanceError("The frozen NHTS source archive is missing")
    if _sha256(source_archive_path) != source.get("archive_sha256"):
        raise MandatoryTourAcceptanceError("The NHTS source archive changed after preregistration")
    if source_archive_path.stat().st_size != source.get("archive_size_bytes"):
        raise MandatoryTourAcceptanceError("The NHTS source archive size changed")

    protocol = _load_json(protocol_path, "Superseding acceptance protocol")
    if protocol.get("schema_version") != acceptance_protocol.SCHEMA_VERSION:
        raise MandatoryTourAcceptanceError("The superseding acceptance protocol schema changed")
    if protocol.get("status") != acceptance_protocol.STATUS:
        raise MandatoryTourAcceptanceError("The superseding acceptance protocol is not unopened")
    if protocol != acceptance_protocol.build_protocol(preregistration_path):
        raise MandatoryTourAcceptanceError(
            "The superseding acceptance protocol is not the exact a-priori correction"
        )
    if (protocol.get("supersedes") or {}).get(
        "preregistration_sha256"
    ) != preregistration_hash:
        raise MandatoryTourAcceptanceError("The superseding protocol names another preregistration")
    if (protocol.get("supersedes") or {}).get("acceptance_outcomes_read") is not False:
        raise MandatoryTourAcceptanceError("The superseding protocol records an opened outcome")

    development = _load_json(development_manifest_path, "Development outcome manifest")
    if development.get("schema_version") != outcomes.SCHEMA_VERSION:
        raise MandatoryTourAcceptanceError("The development outcome schema changed")
    if development.get("status") != "development_outcomes_only_acceptance_unopened":
        raise MandatoryTourAcceptanceError("The development outcome manifest is not unopened")
    if development.get("partition_role") != "development":
        raise MandatoryTourAcceptanceError("The outcome manifest is not the development partition")
    if (development.get("study_contract") or {}).get("acceptance_outcomes_read") is not False:
        raise MandatoryTourAcceptanceError("The development outcome manifest records acceptance")
    if (development.get("source") or {}).get(
        "preregistration_sha256"
    ) != preregistration_hash:
        raise MandatoryTourAcceptanceError("Development outcomes name another preregistration")
    reconstruction = development.get("implementation") or {}
    _verify_implementation_record(reconstruction, "Outcome reconstruction")
    if reconstruction != outcomes._implementation_record():
        raise MandatoryTourAcceptanceError(
            "The development outcome manifest omits the current reconstruction closure"
        )
    development_outputs = development.get("outputs") or {}
    development_person_days_sha256 = development_outputs.get("person_days_sha256")
    if not isinstance(development_person_days_sha256, str) or len(
        development_person_days_sha256
    ) != 64:
        raise MandatoryTourAcceptanceError(
            "The development outcome manifest has no person-day hash"
        )
    if (development.get("source") or {}).get("opening_lock_sha256") is not None:
        raise MandatoryTourAcceptanceError(
            "The development outcome manifest records acceptance authorization"
        )

    registry = _load_json(candidate_registry_path, "Candidate registry")
    if registry.get("schema_version") != candidate_protocol.SCHEMA_VERSION:
        raise MandatoryTourAcceptanceError("The candidate registry schema changed")
    if registry.get("status") != candidate_protocol.STATUS:
        raise MandatoryTourAcceptanceError("The candidate registry is not frozen")
    if registry.get("acceptance_outcomes_read") is not False:
        raise MandatoryTourAcceptanceError("The candidate registry records acceptance outcomes")
    registry_source = registry.get("source") or {}
    if registry_source.get("preregistration_sha256") != preregistration_hash:
        raise MandatoryTourAcceptanceError("The candidate registry names another preregistration")
    if registry_source.get("development_outcome_manifest_sha256") != _sha256(
        development_manifest_path
    ):
        raise MandatoryTourAcceptanceError("The candidate registry names another development manifest")
    if registry_source.get("outcome_reconstruction_closure_sha256") != reconstruction.get(
        "closure_sha256"
    ):
        raise MandatoryTourAcceptanceError("The candidate registry names another reconstruction")
    if (
        registry_source.get("development_person_days_sha256")
        != development_person_days_sha256
    ):
        raise MandatoryTourAcceptanceError(
            "The candidate registry names another development person-day table"
        )
    acceptance_codes = _acceptance_codes(preregistration)
    if sorted(registry_source.get("acceptance_division_codes_committed_but_not_read") or []) != acceptance_codes:
        raise MandatoryTourAcceptanceError("The candidate registry names another acceptance partition")

    package_manifest_path = candidate_package_dir / fit.PACKAGE_MANIFEST_NAME
    fit_manifest_path = candidate_package_dir / fit.FIT_MANIFEST_NAME
    package = _load_json(package_manifest_path, "Candidate coefficient package")
    fit_manifest = _load_json(fit_manifest_path, "Candidate fit manifest")
    if package.get("schema_version") != fit.PACKAGE_SCHEMA_VERSION:
        raise MandatoryTourAcceptanceError("The coefficient package schema changed")
    if package.get("status") != "candidate_not_accepted_for_production":
        raise MandatoryTourAcceptanceError("The coefficient package is not an unaccepted candidate")
    if package.get("acceptance_outcomes_read") is not False or package.get(
        "installation_authorized"
    ) is not False:
        raise MandatoryTourAcceptanceError("The coefficient package has premature acceptance state")
    if package.get("candidate_registry_sha256") != _sha256(candidate_registry_path):
        raise MandatoryTourAcceptanceError("The coefficient package names another candidate registry")
    expected_files = {
        fit.SETTINGS_NAME,
        fit.SPEC_NAME,
        fit.COEFFICIENTS_NAME,
        fit.MODEL_NAME,
    }
    package_hashes = package.get("files_sha256") or {}
    if set(package_hashes) != expected_files:
        raise MandatoryTourAcceptanceError("The candidate package member set changed")
    file_records: dict[str, dict[str, Any]] = {}
    for name in sorted(expected_files):
        path = candidate_package_dir / name
        if not path.is_file() or _sha256(path) != package_hashes.get(name):
            raise MandatoryTourAcceptanceError(f"Candidate package member changed: {name}")
        file_records[name] = {
            "sha256": _sha256(path),
            "size_bytes": path.stat().st_size,
        }
    fit_hash = _sha256(Path(fit.__file__).resolve())
    if package.get("reference_model_implementation_sha256") != fit_hash:
        raise MandatoryTourAcceptanceError("The reference-model implementation changed")
    if fit_manifest.get("schema_version") != fit.SCHEMA_VERSION or fit_manifest.get(
        "status"
    ) != "candidate_not_accepted_for_production":
        raise MandatoryTourAcceptanceError("The candidate fit manifest changed status")
    if fit_manifest.get("acceptance_outcomes_read") is not False:
        raise MandatoryTourAcceptanceError("The fit manifest records acceptance outcomes")
    if fit_manifest.get("implementation_sha256") != fit_hash:
        raise MandatoryTourAcceptanceError("The frozen fit implementation changed")
    if (fit_manifest.get("source") or {}).get("registry_sha256") != _sha256(
        candidate_registry_path
    ):
        raise MandatoryTourAcceptanceError("The fit manifest names another registry")
    fit_package = fit_manifest.get("candidate_package") or {}
    if fit_package.get("manifest_sha256") != _sha256(package_manifest_path):
        raise MandatoryTourAcceptanceError("The fit manifest names another package manifest")
    if fit_package.get("files_sha256") != package_hashes:
        raise MandatoryTourAcceptanceError("The fit and package manifests disagree on members")
    fit_source = fit_manifest.get("source") or {}
    if fit_source.get("development_outcome_manifest_sha256") != _sha256(
        development_manifest_path
    ):
        raise MandatoryTourAcceptanceError(
            "The candidate fit names another development outcome manifest"
        )
    if fit_source.get("development_person_days_sha256") != development_person_days_sha256:
        raise MandatoryTourAcceptanceError(
            "The candidate fit names another development person-day table"
        )
    _verify_executable_model_consistency(candidate_package_dir, package, fit_manifest)

    return {
        "source": {
            "source_id": source.get("source_id"),
            "archive_sha256": _sha256(source_archive_path),
            "archive_size_bytes": source_archive_path.stat().st_size,
            "preregistration_path": _portable_path(preregistration_path),
            "preregistration_sha256": preregistration_hash,
        },
        "protocol": {
            "path": _portable_path(protocol_path),
            "sha256": _sha256(protocol_path),
            "schema_version": protocol["schema_version"],
            "status": protocol["status"],
            "implementation_contract_sha256": _canonical_sha256(
                protocol["implementation_contract"]
            ),
        },
        "acceptance_division_codes": acceptance_codes,
        "outcome_reconstruction": {
            "development_manifest_path": _portable_path(development_manifest_path),
            "development_manifest_sha256": _sha256(development_manifest_path),
            **reconstruction,
        },
        "candidate": {
            "registry_path": _portable_path(candidate_registry_path),
            "registry_sha256": _sha256(candidate_registry_path),
            "package_manifest_path": _portable_path(package_manifest_path),
            "package_manifest_sha256": _sha256(package_manifest_path),
            "package_files": file_records,
            "fit_manifest_path": _portable_path(fit_manifest_path),
            "fit_manifest_sha256": _sha256(fit_manifest_path),
            "fit_implementation_sha256": fit_hash,
            "reference_model_implementation_sha256": fit_hash,
        },
    }


def _build_opening_lock(
    source_archive_path: str | Path,
    *,
    preregistration_path: str | Path = DEFAULT_PREREGISTRATION,
    protocol_path: str | Path = DEFAULT_ACCEPTANCE_PROTOCOL,
    development_manifest_path: str | Path = DEFAULT_DEVELOPMENT_MANIFEST,
    candidate_registry_path: str | Path = DEFAULT_CANDIDATE_REGISTRY,
    candidate_package_dir: str | Path = DEFAULT_CANDIDATE_PACKAGE,
    receipt_path: str | Path = DEFAULT_OPENING_RECEIPT,
    result_path: str | Path = DEFAULT_ACCEPTANCE_RESULT,
    environment: ActivitySimEnvironment | None = None,
) -> dict[str, Any]:
    """Build the complete lock without reading an acceptance ZIP member."""
    runtime = environment or load_activitysim_environment()
    chain = _build_artifact_chain(
        source_archive_path=Path(source_archive_path).resolve(),
        preregistration_path=Path(preregistration_path).resolve(),
        protocol_path=Path(protocol_path).resolve(),
        development_manifest_path=Path(development_manifest_path).resolve(),
        candidate_registry_path=Path(candidate_registry_path).resolve(),
        candidate_package_dir=Path(candidate_package_dir).resolve(),
    )
    return {
        "schema_version": OPENING_LOCK_SCHEMA_VERSION,
        "status": OPENING_LOCK_STATUS,
        "component": "mandatory_tour_frequency",
        **chain,
        "evaluator": evaluator_implementation_record(),
        "runtime": _runtime_record(runtime),
        "decision_contract": {
            "result_schema_version": RESULT_SCHEMA_VERSION,
            "evaluated_once_status": EVALUATED_ONCE_STATUS,
            "accepted_status": ACCEPTED_COMPONENT_STATUS,
            "rejected_status": REJECTED_COMPONENT_STATUS,
            "scope": COMPONENT_SCOPE,
            "candidate_package_evidence_key": (
                "evidence_hashes.candidate_package_manifest_sha256"
            ),
        },
        "one_shot_outputs": {
            "opening_receipt_path": _portable_path(receipt_path),
            "aggregate_result_path": _portable_path(result_path),
            "individual_outcome_artifact_allowed": False,
        },
    }


def build_opening_lock(source_archive_path: str | Path) -> dict[str, Any]:
    """Build the one official lock, bound to the study's fixed artifacts and outputs."""
    return _build_opening_lock(source_archive_path)


def write_opening_lock(lock: Mapping[str, Any], path: str | Path = DEFAULT_OPENING_LOCK) -> None:
    _exclusive_json(path, lock)


def _compare_hash(path: Path, expected: Any, label: str) -> None:
    if not path.is_file() or _sha256(path) != expected:
        raise MandatoryTourAcceptanceError(f"{label} changed after the opening lock")


def _verify_opening_lock(
    lock_path: str | Path,
    source_archive_path: str | Path,
    *,
    preregistration_path: str | Path = DEFAULT_PREREGISTRATION,
    protocol_path: str | Path = DEFAULT_ACCEPTANCE_PROTOCOL,
    development_manifest_path: str | Path = DEFAULT_DEVELOPMENT_MANIFEST,
    candidate_registry_path: str | Path = DEFAULT_CANDIDATE_REGISTRY,
    candidate_package_dir: str | Path = DEFAULT_CANDIDATE_PACKAGE,
    receipt_path: str | Path = DEFAULT_OPENING_RECEIPT,
    result_path: str | Path = DEFAULT_ACCEPTANCE_RESULT,
    environment: ActivitySimEnvironment | None = None,
) -> dict[str, Any]:
    """Verify the full chain without opening any member of the source ZIP."""
    lock_file = Path(lock_path).resolve()
    lock = _load_json(lock_file, "Acceptance opening lock")
    if lock.get("schema_version") != OPENING_LOCK_SCHEMA_VERSION:
        raise MandatoryTourAcceptanceError("The acceptance opening-lock schema changed")
    if lock.get("status") != OPENING_LOCK_STATUS:
        raise MandatoryTourAcceptanceError("The acceptance opening lock is already open")
    rebuilt = _build_opening_lock(
        source_archive_path,
        preregistration_path=preregistration_path,
        protocol_path=protocol_path,
        development_manifest_path=development_manifest_path,
        candidate_registry_path=candidate_registry_path,
        candidate_package_dir=candidate_package_dir,
        receipt_path=receipt_path,
        result_path=result_path,
        environment=environment,
    )
    if lock != rebuilt:
        raise MandatoryTourAcceptanceError("The opening-lock artifact chain no longer matches")
    _verify_implementation_record(lock.get("evaluator") or {}, "Acceptance evaluator")
    _verify_implementation_record(
        lock.get("outcome_reconstruction") or {}, "Outcome reconstruction"
    )
    return lock


def verify_opening_lock(
    lock_path: str | Path,
    source_archive_path: str | Path,
) -> dict[str, Any]:
    """Verify the official lock against only the study's fixed artifacts and outputs."""
    return _verify_opening_lock(lock_path, source_archive_path)


def load_frozen_model(model_path: str | Path) -> dict[str, Any]:
    model = _load_json(model_path, "Frozen mandatory-tour model")
    alternatives = list(model.get("alternatives") or [])
    if alternatives != list(candidate_protocol.ALTERNATIVES):
        raise MandatoryTourAcceptanceError("The frozen model alternative order changed")
    if model.get("reference_alternative") != candidate_protocol.REFERENCE_ALTERNATIVE:
        raise MandatoryTourAcceptanceError("The frozen reference alternative changed")
    reference = model.get("reference_probabilities") or {}
    coefficients = model.get("learned_coefficients") or {}
    expected_cells = {name for _worker, _student, name in fit.STATUS_CELLS}
    if set(reference) != expected_cells:
        raise MandatoryTourAcceptanceError("The frozen reference status cells changed")
    nonreference = alternatives[1:]
    if set(coefficients) != set(nonreference):
        raise MandatoryTourAcceptanceError("The frozen learned alternatives changed")
    predictor_names = [row["name"] for row in candidate_protocol.PREDICTORS]
    for cell in expected_cells:
        values = reference[cell]
        if set(values) != set(alternatives):
            raise MandatoryTourAcceptanceError("A frozen reference distribution is incomplete")
        probabilities = [float(values[name]) for name in alternatives]
        if any(not math.isfinite(value) or value <= 0 for value in probabilities):
            raise MandatoryTourAcceptanceError("Reference probabilities must be positive")
        if not math.isclose(sum(probabilities), 1.0, rel_tol=0.0, abs_tol=1e-12):
            raise MandatoryTourAcceptanceError("Reference probabilities do not sum to one")
    for alternative in nonreference:
        values = coefficients[alternative]
        if set(values) != set(predictor_names):
            raise MandatoryTourAcceptanceError("The learned predictor set changed")
        if any(not math.isfinite(float(value)) for value in values.values()):
            raise MandatoryTourAcceptanceError("A learned coefficient is non-finite")
    return model


def _activitysim_production_probabilities(
    evaluation_rows: Sequence[Mapping[str, Any]],
    references: Mapping[str, Sequence[float]],
    coefficients: Any,
) -> Any:
    """Evaluate the candidate with ActivitySim 1.5.1's legacy numeric semantics."""
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourAcceptanceError("Probability evaluation requires numpy") from exc
    feature_count = len(candidate_protocol.PREDICTORS)
    expected_shape = (len(candidate_protocol.ALTERNATIVES) - 1, feature_count)
    rounded_coefficients = np.asarray(coefficients, dtype=np.float32).astype(
        np.float64
    )
    if rounded_coefficients.shape != expected_shape:
        raise MandatoryTourAcceptanceError(
            f"Production coefficient shape must be {expected_shape}"
        )
    features = np.asarray(
        [
            row["features"]
            if row["features"] is not None
            else [0.0] * feature_count
            for row in evaluation_rows
        ],
        dtype=np.float64,
    )
    status_cells = [name for _worker, _student, name in fit.STATUS_CELLS]
    expression_values = np.asarray(
        [
            [1.0 if str(row["cell"]) == cell else 0.0 for cell in status_cells]
            + list(features[index])
            for index, row in enumerate(evaluation_rows)
        ],
        dtype=np.float64,
    )
    executable_spec = np.zeros(
        (len(status_cells) + feature_count, len(candidate_protocol.ALTERNATIVES)),
        dtype=np.float64,
    )
    for index, cell in enumerate(status_cells):
        executable_spec[index, :] = np.asarray(
            [math.log(float(value)) for value in references[cell]],
            dtype=np.float32,
        ).astype(np.float64)
    executable_spec[len(status_cells) :, 1:] = rounded_coefficients.T
    utilities = np.dot(expression_values, executable_spec)
    utilities -= utilities.max(axis=1, keepdims=True)
    exponentiated = np.exp(utilities)
    totals = exponentiated.sum(axis=1)
    np.divide(
        exponentiated,
        totals.reshape(len(exponentiated), 1),
        out=exponentiated,
    )
    np.clip(exponentiated, 0.0, 1.0, out=exponentiated)
    return exponentiated


def model_probabilities(
    rows: Sequence[Mapping[str, Any]], model: Mapping[str, Any]
) -> tuple[Any, Any]:
    """Return production-identical candidate and exact-reference float64 matrices."""
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourAcceptanceError("Probability evaluation requires numpy") from exc
    alternatives = list(model["alternatives"])
    references = {
        cell: [float(values[name]) for name in alternatives]
        for cell, values in model["reference_probabilities"].items()
    }
    predictor_names = [row["name"] for row in candidate_protocol.PREDICTORS]
    coefficients = np.asarray(
        [
            [float(model["learned_coefficients"][alternative][name]) for name in predictor_names]
            for alternative in alternatives[1:]
        ],
        dtype=np.float64,
    )
    evaluation_rows = [
        {
            "cell": fit.status_cell(row),
            "features": fit.feature_values(row),
            "weight": float(row["weekday_weight"]),
            "choice": 0,
        }
        for row in rows
    ]
    candidate = np.asarray(
        _activitysim_production_probabilities(
            evaluation_rows, references, coefficients
        ),
        dtype=np.float64,
    )
    reference = np.asarray(
        [references[str(row["cell"])] for row in evaluation_rows], dtype=np.float64
    )
    invalid = np.asarray(
        [row["features"] is None for row in evaluation_rows], dtype=bool
    )
    candidate[invalid] = reference[invalid]
    if candidate.dtype != np.float64 or reference.dtype != np.float64:
        raise MandatoryTourAcceptanceError("Model probabilities are not float64")
    if candidate.shape != reference.shape or candidate.shape != (len(rows), len(alternatives)):
        raise MandatoryTourAcceptanceError("Model probabilities have the wrong shape")
    if not np.array_equal(candidate[invalid], reference[invalid]):
        raise MandatoryTourAcceptanceError("Predictor-invalid rows did not use the exact reference")
    if not np.all(np.isfinite(candidate)) or not np.all(candidate > 0):
        raise MandatoryTourAcceptanceError("Candidate probabilities are not finite and positive")
    if not np.allclose(
        np.sum(candidate, axis=1, dtype=np.float64),
        1.0,
        rtol=0.0,
        atol=1e-12,
    ):
        raise MandatoryTourAcceptanceError("Candidate probability rows do not sum to one")
    return candidate, reference


def _design_arrays(rows: Sequence[Mapping[str, Any]]) -> tuple[Any, list[tuple[str, str]], list[str]]:
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourAcceptanceError("Taylor variance requires numpy") from exc
    weights: list[float] = []
    strata: list[tuple[str, str]] = []
    psus: list[str] = []
    for row in rows:
        weight = _positive_float(row.get("weekday_weight"))
        if weight is None:
            raise MandatoryTourAcceptanceError("The Taylor design frame contains a nonpositive weight")
        division = str(row.get("census_division_code") or "")
        stratum = str(row.get("stratum_id") or "")
        household = str(row.get("household_id") or "")
        if not division or not stratum or not household:
            raise MandatoryTourAcceptanceError("The Taylor design frame has a missing design identifier")
        weights.append(weight)
        strata.append((division, stratum))
        psus.append(household)
    if not weights:
        raise MandatoryTourAcceptanceError("The Taylor design frame is empty")
    return np.asarray(weights, dtype=np.float64), strata, psus


def taylor_ratio(
    design_rows: Sequence[Mapping[str, Any]],
    numerator: Sequence[float],
    denominator: Sequence[float],
) -> TaylorRatio:
    """Taylor ratio estimate with WR strata and household PSU correction."""
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourAcceptanceError("Taylor variance requires numpy") from exc
    weights, strata, psus = _design_arrays(design_rows)
    a = np.asarray(numerator, dtype=np.float64)
    b = np.asarray(denominator, dtype=np.float64)
    if a.shape != weights.shape or b.shape != weights.shape:
        raise MandatoryTourAcceptanceError("Taylor-domain arrays do not match the design frame")
    if not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)):
        raise MandatoryTourAcceptanceError("Taylor-domain arrays contain non-finite values")
    total_b = float(np.sum(weights * b, dtype=np.float64))
    if total_b <= 0:
        raise MandatoryTourAcceptanceError("A Taylor ratio domain has zero denominator")
    estimate = float(np.sum(weights * a, dtype=np.float64) / total_b)

    by_stratum: dict[tuple[str, str], dict[str, float]] = {}
    for index, (stratum, psu) in enumerate(zip(strata, psus)):
        psu_totals = by_stratum.setdefault(stratum, {})
        contribution = float(weights[index] * (a[index] - estimate * b[index]) / total_b)
        psu_totals[psu] = psu_totals.get(psu, 0.0) + contribution
    variance = 0.0
    degrees_of_freedom = 0
    for stratum, psu_totals in sorted(by_stratum.items()):
        values = np.asarray(list(psu_totals.values()), dtype=np.float64)
        count = len(values)
        if count < 2:
            raise MandatoryTourAcceptanceError(
                f"Taylor variance refuses singleton stratum {stratum[0]}:{stratum[1]}"
            )
        mean = float(np.mean(values, dtype=np.float64))
        variance += count / (count - 1) * float(
            np.sum((values - mean) ** 2, dtype=np.float64)
        )
        degrees_of_freedom += count - 1
    if degrees_of_freedom <= 0 or variance < 0 or not math.isfinite(variance):
        raise MandatoryTourAcceptanceError("Taylor variance is undefined")
    return TaylorRatio(
        estimate=estimate,
        standard_error=math.sqrt(variance),
        variance=variance,
        degrees_of_freedom=degrees_of_freedom,
        denominator=total_b,
    )


def _t_critical(probability: float, degrees_of_freedom: int) -> float:
    try:
        from scipy.stats import t
    except ImportError as exc:
        raise MandatoryTourAcceptanceError("Acceptance inference requires scipy") from exc
    value = float(t.ppf(probability, degrees_of_freedom))
    if not math.isfinite(value):
        raise MandatoryTourAcceptanceError("The Student t critical value is undefined")
    return value


def _t_survival(value: float, degrees_of_freedom: int) -> float:
    try:
        from scipy.stats import t
    except ImportError as exc:
        raise MandatoryTourAcceptanceError("Acceptance inference requires scipy") from exc
    return float(t.sf(value, degrees_of_freedom))


def _domain_arrays(
    design_rows: Sequence[Mapping[str, Any]],
    values: Mapping[int, float],
) -> tuple[list[float], list[float]]:
    numerator = [0.0] * len(design_rows)
    denominator = [0.0] * len(design_rows)
    for index, value in values.items():
        numerator[index] = float(value)
        denominator[index] = 1.0
    return numerator, denominator


def _weighted_mean(weights: Any, values: Any) -> float:
    import numpy as np

    total = float(np.sum(weights, dtype=np.float64))
    if total <= 0:
        raise MandatoryTourAcceptanceError("A weighted acceptance domain is empty")
    return float(np.sum(weights * values, dtype=np.float64) / total)


def _weighted_shares(weights: Any, values: Any) -> Any:
    import numpy as np

    total = float(np.sum(weights, dtype=np.float64))
    if total <= 0:
        raise MandatoryTourAcceptanceError("A weighted acceptance distribution is empty")
    return np.sum(weights[:, None] * values, axis=0, dtype=np.float64) / total


def _total_variation(expected: Any, observed: Any) -> float:
    import numpy as np

    return 0.5 * float(np.sum(np.abs(expected - observed), dtype=np.float64))


def _holm(entries: list[dict[str, Any]], alpha: float) -> None:
    ordered = sorted(range(len(entries)), key=lambda index: (entries[index]["p_value"], index))
    running_adjusted = 0.0
    continue_rejecting = True
    count = len(entries)
    for rank, index in enumerate(ordered):
        entry = entries[index]
        multiplier = count - rank
        running_adjusted = max(running_adjusted, multiplier * float(entry["p_value"]))
        entry["holm_adjusted_p_value"] = min(1.0, running_adjusted)
        threshold = alpha / multiplier
        entry["holm_threshold"] = threshold
        rejected = continue_rejecting and float(entry["p_value"]) <= threshold
        entry["significant_deterioration"] = rejected
        if not rejected:
            continue_rejecting = False


def _activitysim_choices(
    probabilities: Any,
    seeds: Sequence[int],
    environment: ActivitySimEnvironment | None = None,
) -> dict[int, Any]:
    """Run ActivitySim Random and choice_maker with the frozen persons channel."""
    import numpy as np

    runtime = environment or load_activitysim_environment()
    count = int(probabilities.shape[0])
    person_index = runtime.index_factory(
        np.arange(1, count + 1, dtype=np.int64), name="person_id"
    )
    persons = runtime.dataframe_factory(
        {"_acceptance_domain": np.ones(count, dtype=np.uint8)},
        index=person_index,
    )
    choices: dict[int, Any] = {}
    for seed in seeds:
        generator = runtime.random_class()
        generator.set_base_seed(int(seed))
        generator.add_channel(PERSON_CHANNEL_NAME, persons)
        generator.begin_step(PRIMARY_STEP_NAME)
        try:
            random_points = generator.random_for_df(persons)
            selected = runtime.choice_maker(probabilities, random_points)
        finally:
            generator.end_step(PRIMARY_STEP_NAME)
        choices[int(seed)] = np.asarray(selected, dtype=np.int64)
    return choices


def _stability_check(
    supported_rows: Sequence[Mapping[str, Any]],
    weights: Any,
    candidate: Any,
    alternatives: Sequence[str],
    rule: Mapping[str, Any],
    sampler: Callable[[Any, Sequence[int]], Mapping[int, Any]] | None,
    environment: ActivitySimEnvironment | None,
) -> dict[str, Any]:
    import numpy as np

    seeds = [int(value) for value in rule.get("activitysim_seeds") or []]
    if not seeds or len(seeds) != len(set(seeds)):
        raise MandatoryTourAcceptanceError("The stochastic seed family changed")
    protocol_alternatives = list(rule.get("alternatives") or [])
    if protocol_alternatives != list(alternatives):
        raise MandatoryTourAcceptanceError("The stability alternative order changed")
    if int(rule.get("comparison_count") or 0) != len(seeds) * len(alternatives):
        raise MandatoryTourAcceptanceError("The stability comparison count changed")
    critical = float(rule.get("normal_critical_value"))
    comparison_count = len(seeds) * len(alternatives)
    per_comparison_alpha = float(rule.get("per_comparison_two_sided_alpha"))
    expected_alpha = (1.0 - float(rule.get("familywise_confidence"))) / comparison_count
    expected_critical = NormalDist().inv_cdf(1.0 - expected_alpha / 2.0)
    if (
        not math.isfinite(critical)
        or not math.isclose(per_comparison_alpha, expected_alpha, rel_tol=0.0, abs_tol=1e-15)
        or not math.isclose(critical, expected_critical, rel_tol=0.0, abs_tol=1e-14)
    ):
        raise MandatoryTourAcceptanceError("The stability critical value is invalid")

    sampled = (
        sampler(candidate, seeds)
        if sampler is not None
        else _activitysim_choices(candidate, seeds, environment)
    )
    if set(sampled) != set(seeds):
        raise MandatoryTourAcceptanceError("The stochastic sampler omitted or added a seed")
    total_weight = float(np.sum(weights, dtype=np.float64))
    expected = _weighted_shares(weights, candidate)
    variances = np.sum(
        (weights[:, None] ** 2) * candidate * (1.0 - candidate),
        axis=0,
        dtype=np.float64,
    ) / (total_weight * total_weight)
    margins = critical * np.sqrt(variances)
    comparisons: list[dict[str, Any]] = []
    passed = True
    for seed in seeds:
        choices = np.asarray(sampled[seed], dtype=np.int64)
        if choices.shape != (len(supported_rows),):
            raise MandatoryTourAcceptanceError("A stochastic seed returned the wrong row count")
        if np.any(choices < 0) or np.any(choices >= len(alternatives)):
            raise MandatoryTourAcceptanceError("A stochastic seed returned an invalid choice")
        for alternative_index, alternative in enumerate(alternatives):
            realized = float(
                np.sum(weights * (choices == alternative_index), dtype=np.float64)
                / total_weight
            )
            lower = float(expected[alternative_index] - margins[alternative_index])
            upper = float(expected[alternative_index] + margins[alternative_index])
            inside = lower <= realized <= upper
            passed = passed and inside
            comparisons.append(
                {
                    "seed": seed,
                    "alternative": alternative,
                    "expected_weighted_share": float(expected[alternative_index]),
                    "realized_weighted_share": realized,
                    "lower": lower,
                    "upper": upper,
                    "passed": inside,
                }
            )
    return {
        "passed": passed,
        "seeds_evaluated": len(seeds),
        "comparisons_evaluated": len(comparisons),
        "normal_critical_value": critical,
        "comparisons": comparisons,
    }


def _all_acceptance_gates_pass(gates: Mapping[str, Mapping[str, Any]]) -> bool:
    expected = {
        "outcome_coverage",
        "primary_predictive_score",
        "choice_distribution",
        "tour_totals",
        "transfer_cells",
        "stochastic_stability",
    }
    if set(gates) != expected:
        raise MandatoryTourAcceptanceError("The six-gate acceptance family changed")
    return all(bool(gates[name].get("passed")) for name in sorted(expected))


def _transfer_family_alpha(protocol: Mapping[str, Any]) -> float:
    value = (
        (protocol.get("implementation_contract") or {})
        .get("transfer_cells", {})
        .get("holm_family_alpha")
    )
    try:
        alpha = float(value)
    except (TypeError, ValueError) as exc:
        raise MandatoryTourAcceptanceError(
            "The pre-open protocol does not record the transfer-cell Holm family alpha"
        ) from exc
    if not math.isfinite(alpha) or not 0 < alpha < 1:
        raise MandatoryTourAcceptanceError(
            "The transfer-cell Holm family alpha is invalid"
        )
    return alpha


def evaluate_acceptance_rows(
    rows: Sequence[Mapping[str, Any]],
    model: Mapping[str, Any],
    protocol: Mapping[str, Any],
    *,
    sampler: Callable[[Any, Sequence[int]], Mapping[int, Any]] | None = None,
    environment: ActivitySimEnvironment | None = None,
    expected_divisions: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Apply all six frozen gates and return aggregate diagnostics only."""
    import numpy as np

    rules = protocol.get("acceptance_rules") or {}
    transfer_family_alpha = _transfer_family_alpha(protocol)
    if rules.get("all_rules_must_pass") is not True:
        raise MandatoryTourAcceptanceError("The protocol no longer requires every acceptance gate")
    design_rows = [row for row in rows if _positive_float(row.get("weekday_weight")) is not None]
    if not design_rows:
        raise MandatoryTourAcceptanceError("The positive-weight acceptance design is empty")
    _design_arrays(design_rows)  # Validates every stratum before any domain calculation.
    supported_indexes = [
        index for index, row in enumerate(design_rows) if row.get("outcome_status") == SUPPORTED_STATUS
    ]
    if not supported_indexes:
        raise MandatoryTourAcceptanceError("The acceptance partition has no supported outcomes")
    supported_rows = [design_rows[index] for index in supported_indexes]
    order = sorted(range(len(supported_rows)), key=lambda index: str(supported_rows[index]["person_id"]))
    supported_rows = [supported_rows[index] for index in order]
    supported_design_indexes = [supported_indexes[index] for index in order]
    if len({str(row["person_id"]) for row in supported_rows}) != len(supported_rows):
        raise MandatoryTourAcceptanceError("Supported acceptance person identifiers are not unique")
    observed_design_divisions = {
        str(row["census_division_code"]) for row in design_rows
    }
    if expected_divisions is not None and observed_design_divisions != set(expected_divisions):
        raise MandatoryTourAcceptanceError(
            "The acceptance outcomes do not represent every locked acceptance division"
        )

    alternatives = list(model["alternatives"])
    alternative_index = {name: index for index, name in enumerate(alternatives)}
    if set(alternatives) != set((protocol.get("study_population") or {}).get("alternatives") or alternatives):
        # The superseding protocol intentionally omits study_population; its alternative
        # set is frozen in the stochastic rule and the model order remains authoritative.
        raise MandatoryTourAcceptanceError("The model and protocol alternative sets disagree")
    observed_choices = np.asarray(
        [alternative_index.get(str(row.get("alternative") or ""), -1) for row in supported_rows],
        dtype=np.int64,
    )
    if np.any(observed_choices < 0):
        raise MandatoryTourAcceptanceError("A supported outcome has an unknown alternative")
    candidate, reference = model_probabilities(supported_rows, model)
    weights = np.asarray([float(row["weekday_weight"]) for row in supported_rows], dtype=np.float64)
    one_hot = np.eye(len(alternatives), dtype=np.float64)[observed_choices]
    tiny = np.finfo(np.float64).tiny
    selected_candidate = candidate[np.arange(len(supported_rows)), observed_choices]
    selected_reference = reference[np.arange(len(supported_rows)), observed_choices]
    candidate_loss = -np.log(np.maximum(selected_candidate, tiny))
    reference_loss = -np.log(np.maximum(selected_reference, tiny))
    loss_difference = candidate_loss - reference_loss
    divisions = sorted({str(row["census_division_code"]) for row in supported_rows})
    if expected_divisions is not None and set(divisions) != set(expected_divisions):
        raise MandatoryTourAcceptanceError(
            "Every locked acceptance division must contain supported outcomes"
        )

    # 1. Coverage uses only complete observed mandatory patterns in its denominator.
    coverage_rule = rules.get("outcome_coverage") or {}
    coverage_by_division: dict[str, Any] = {}
    supported_weight = 0.0
    coverage_denominator_weight = 0.0
    exclusions_by_division: dict[str, dict[str, Any]] = {}
    exclusion_reasons_by_division: dict[str, dict[str, Any]] = {}
    for row in design_rows:
        division = str(row["census_division_code"])
        status = str(row.get("outcome_status") or "")
        weight = float(row["weekday_weight"])
        exclusion = exclusions_by_division.setdefault(division, {})
        entry = exclusion.setdefault(status, {"records": 0, "weekday_weight": 0.0})
        entry["records"] += 1
        entry["weekday_weight"] += weight
        if status != SUPPORTED_STATUS:
            reason = str(row.get("exclusion_reason") or "<none>")
            reason_entry = exclusion_reasons_by_division.setdefault(
                division, {}
            ).setdefault(reason, {"records": 0, "weekday_weight": 0.0})
            reason_entry["records"] += 1
            reason_entry["weekday_weight"] += weight
        if status in {SUPPORTED_STATUS, OUT_OF_SUPPORT_STATUS}:
            coverage_denominator_weight += weight
            if status == SUPPORTED_STATUS:
                supported_weight += weight
    if coverage_denominator_weight <= 0:
        raise MandatoryTourAcceptanceError("The coverage denominator is empty")
    for division in sorted(exclusions_by_division):
        statuses = exclusions_by_division[division]
        positive_weight = sum(
            float(value["weekday_weight"]) for value in statuses.values()
        )
        for value in statuses.values():
            value["positive_weekday_weight_share"] = (
                float(value["weekday_weight"]) / positive_weight
                if positive_weight > 0
                else None
            )
        numerator = float((statuses.get(SUPPORTED_STATUS) or {}).get("weekday_weight", 0.0))
        denominator = numerator + float(
            (statuses.get(OUT_OF_SUPPORT_STATUS) or {}).get("weekday_weight", 0.0)
        )
        coverage_by_division[division] = {
            "supported_share": numerator / denominator if denominator > 0 else None,
            "supported_weight": numerator,
            "complete_mandatory_weight": denominator,
        }
    coverage_share = supported_weight / coverage_denominator_weight
    coverage_passed = coverage_share >= float(
        coverage_rule.get("minimum_design_weighted_supported_share")
    )
    coverage = {
        "passed": coverage_passed,
        "design_weighted_supported_share": coverage_share,
        "minimum": float(coverage_rule["minimum_design_weighted_supported_share"]),
        "denominator": "supported plus out-of-support complete mandatory person-days",
        "by_division": coverage_by_division,
        "statuses_by_division": exclusions_by_division,
        "exclusion_reasons_by_division": exclusion_reasons_by_division,
    }

    # 2. Paired predictive score, using all design PSUs for domain variance.
    primary_rule = rules.get("primary_predictive_score") or {}
    primary_numerator, primary_denominator = _domain_arrays(
        design_rows,
        {
            design_index: float(value)
            for design_index, value in zip(supported_design_indexes, loss_difference)
        },
    )
    primary_ratio = taylor_ratio(design_rows, primary_numerator, primary_denominator)
    confidence = float(primary_rule.get("candidate_minus_reference_one_sided_confidence"))
    primary_critical = _t_critical(confidence, primary_ratio.degrees_of_freedom)
    upper = primary_ratio.estimate + primary_critical * primary_ratio.standard_error
    division_primary: dict[str, Any] = {}
    all_division_wins = True
    for division in divisions:
        mask = np.asarray(
            [str(row["census_division_code"]) == division for row in supported_rows], dtype=bool
        )
        candidate_mean = _weighted_mean(weights[mask], candidate_loss[mask])
        reference_mean = _weighted_mean(weights[mask], reference_loss[mask])
        win = candidate_mean < reference_mean
        all_division_wins = all_division_wins and win
        division_primary[division] = {
            "candidate_log_loss": candidate_mean,
            "reference_log_loss": reference_mean,
            "candidate_wins": win,
        }
    primary_passed = upper < float(primary_rule.get("upper_confidence_bound_must_be_below")) and all_division_wins
    primary = {
        "passed": primary_passed,
        "candidate_minus_reference": primary_ratio.estimate,
        "standard_error": primary_ratio.standard_error,
        "degrees_of_freedom": primary_ratio.degrees_of_freedom,
        "one_sided_critical_value": primary_critical,
        "upper_confidence_bound": upper,
        "pooled_candidate_log_loss": _weighted_mean(weights, candidate_loss),
        "pooled_reference_log_loss": _weighted_mean(weights, reference_loss),
        "by_division": division_primary,
    }

    # 3. Expected-versus-observed choice distribution.
    distribution_rule = rules.get("choice_distribution") or {}
    distribution_by_division: dict[str, Any] = {}

    def distribution_record(mask: Any) -> dict[str, Any]:
        observed = _weighted_shares(weights[mask], one_hot[mask])
        candidate_expected = _weighted_shares(weights[mask], candidate[mask])
        reference_expected = _weighted_shares(weights[mask], reference[mask])
        candidate_tv = _total_variation(candidate_expected, observed)
        reference_tv = _total_variation(reference_expected, observed)
        return {
            "candidate_total_variation": candidate_tv,
            "reference_total_variation": reference_tv,
            "candidate_minus_reference": candidate_tv - reference_tv,
            "candidate_wins": candidate_tv < reference_tv,
            "observed_shares": {
                name: float(observed[index]) for index, name in enumerate(alternatives)
            },
            "candidate_expected_shares": {
                name: float(candidate_expected[index]) for index, name in enumerate(alternatives)
            },
            "reference_expected_shares": {
                name: float(reference_expected[index]) for index, name in enumerate(alternatives)
            },
        }

    pooled_distribution = distribution_record(np.ones(len(supported_rows), dtype=bool))
    division_wins = 0
    no_large_disadvantage = True
    for division in divisions:
        mask = np.asarray(
            [str(row["census_division_code"]) == division for row in supported_rows], dtype=bool
        )
        record = distribution_record(mask)
        distribution_by_division[division] = record
        division_wins += int(record["candidate_wins"])
        no_large_disadvantage = no_large_disadvantage and record[
            "candidate_minus_reference"
        ] <= float(distribution_rule["maximum_disadvantage_in_remaining_division"])
    distribution_passed = (
        pooled_distribution["candidate_total_variation"]
        <= float(distribution_rule["maximum_pooled_total_variation_distance"])
        and pooled_distribution["candidate_wins"]
        and division_wins >= int(distribution_rule["minimum_division_wins"])
        and no_large_disadvantage
    )
    distribution = {
        "passed": distribution_passed,
        "pooled": pooled_distribution,
        "division_wins": division_wins,
        "by_division": distribution_by_division,
    }

    # 4. Candidate expected work and school means against observed design CIs.
    tour_rule = rules.get("tour_totals") or {}
    tour_vectors = {
        "work": np.asarray([1.0, 2.0, 0.0, 0.0, 1.0], dtype=np.float64),
        "school": np.asarray([0.0, 0.0, 1.0, 2.0, 1.0], dtype=np.float64),
    }
    if alternatives != ["work1", "work2", "school1", "school2", "work_and_school"]:
        raise MandatoryTourAcceptanceError("Tour-total vectors require the frozen model order")
    tours: dict[str, Any] = {}
    tours_passed = True
    for measure, vector in tour_vectors.items():
        observed_values = vector[observed_choices]
        expected_values = candidate @ vector

        def tour_interval(mask: Any) -> dict[str, Any]:
            selected = {
                design_index: float(value)
                for design_index, value, include in zip(
                    supported_design_indexes, observed_values, mask
                )
                if include
            }
            numerator, denominator = _domain_arrays(design_rows, selected)
            ratio = taylor_ratio(design_rows, numerator, denominator)
            critical = _t_critical(0.975, ratio.degrees_of_freedom)
            lower = ratio.estimate - critical * ratio.standard_error
            upper_bound = ratio.estimate + critical * ratio.standard_error
            expected = _weighted_mean(weights[mask], expected_values[mask])
            return {
                "observed": ratio.estimate,
                "observed_standard_error": ratio.standard_error,
                "degrees_of_freedom": ratio.degrees_of_freedom,
                "observed_95_percent_interval": [lower, upper_bound],
                "candidate_expected": expected,
                "inside": lower <= expected <= upper_bound,
            }

        pooled_tour = tour_interval(np.ones(len(supported_rows), dtype=bool))
        by_division: dict[str, Any] = {}
        division_inside = 0
        for division in divisions:
            mask = np.asarray(
                [str(row["census_division_code"]) == division for row in supported_rows],
                dtype=bool,
            )
            record = tour_interval(mask)
            by_division[division] = record
            division_inside += int(record["inside"])
        measure_passed = pooled_tour["inside"] and division_inside >= int(
            tour_rule["minimum_divisions_inside_interval"]
        )
        tours_passed = tours_passed and measure_passed
        tours[measure] = {
            "passed": measure_passed,
            "pooled": pooled_tour,
            "divisions_inside": division_inside,
            "by_division": by_division,
        }
    tour_totals = {"passed": tours_passed, "measures": tours, "rescaled": False}

    # 5. Transfer cells, with one Holm family over all eligible cells.
    transfer_rule = rules.get("transfer_cells") or {}
    minimum_cell_records = int(transfer_rule.get("minimum_unweighted_observations"))
    cell_members: dict[tuple[bool, bool, str], list[int]] = {}
    for index, row in enumerate(supported_rows):
        urban_rural = str(row.get("urban_rural_code") or "")
        if urban_rural not in {"01", "02"}:
            continue
        cell = (
            str(row.get("worker_code") or "") == "01",
            str(row.get("school_code") or "") == "01",
            urban_rural,
        )
        cell_members.setdefault(cell, []).append(index)
    transfer_cells: list[dict[str, Any]] = []
    for cell, indexes in sorted(cell_members.items()):
        if len(indexes) < minimum_cell_records:
            continue
        selected = {
            supported_design_indexes[index]: float(loss_difference[index])
            for index in indexes
        }
        numerator, denominator = _domain_arrays(design_rows, selected)
        ratio = taylor_ratio(design_rows, numerator, denominator)
        if ratio.standard_error == 0:
            p_value = 0.0 if ratio.estimate > 0 else 1.0
        else:
            p_value = _t_survival(
                ratio.estimate / ratio.standard_error, ratio.degrees_of_freedom
            )
        transfer_cells.append(
            {
                "worker": cell[0],
                "student": cell[1],
                "urban_rural_code": cell[2],
                "records": len(indexes),
                "candidate_minus_reference_log_loss": ratio.estimate,
                "candidate_log_loss": _weighted_mean(
                    weights[indexes], candidate_loss[indexes]
                ),
                "reference_log_loss": _weighted_mean(
                    weights[indexes], reference_loss[indexes]
                ),
                "candidate_expected_minus_observed_shares": {
                    name: float(value)
                    for name, value in zip(
                        alternatives,
                        _weighted_shares(weights[indexes], candidate[indexes])
                        - _weighted_shares(weights[indexes], one_hot[indexes]),
                    )
                },
                "reference_expected_minus_observed_shares": {
                    name: float(value)
                    for name, value in zip(
                        alternatives,
                        _weighted_shares(weights[indexes], reference[indexes])
                        - _weighted_shares(weights[indexes], one_hot[indexes]),
                    )
                },
                "candidate_work_expected_minus_observed": _weighted_mean(
                    weights[indexes], candidate[indexes] @ tour_vectors["work"]
                )
                - _weighted_mean(weights[indexes], tour_vectors["work"][observed_choices[indexes]]),
                "reference_work_expected_minus_observed": _weighted_mean(
                    weights[indexes], reference[indexes] @ tour_vectors["work"]
                )
                - _weighted_mean(weights[indexes], tour_vectors["work"][observed_choices[indexes]]),
                "candidate_school_expected_minus_observed": _weighted_mean(
                    weights[indexes], candidate[indexes] @ tour_vectors["school"]
                )
                - _weighted_mean(weights[indexes], tour_vectors["school"][observed_choices[indexes]]),
                "reference_school_expected_minus_observed": _weighted_mean(
                    weights[indexes], reference[indexes] @ tour_vectors["school"]
                )
                - _weighted_mean(weights[indexes], tour_vectors["school"][observed_choices[indexes]]),
                "standard_error": ratio.standard_error,
                "degrees_of_freedom": ratio.degrees_of_freedom,
                "p_value": p_value,
            }
        )
    _holm(transfer_cells, transfer_family_alpha)
    transfer_passed = not any(
        row["significant_deterioration"] for row in transfer_cells
    )
    transfer = {
        "passed": transfer_passed,
        "eligible_cells": len(transfer_cells),
        "holm_family_alpha": transfer_family_alpha,
        "cells": transfer_cells,
    }

    # 6. Actual ActivitySim Random plus choice_maker semantics.
    stability = _stability_check(
        supported_rows,
        weights,
        candidate,
        alternatives,
        rules.get("stochastic_stability") or {},
        sampler,
        environment,
    )

    gates = {
        "outcome_coverage": coverage,
        "primary_predictive_score": primary,
        "choice_distribution": distribution,
        "tour_totals": tour_totals,
        "transfer_cells": transfer,
        "stochastic_stability": stability,
    }
    passed = _all_acceptance_gates_pass(gates)
    return {
        "passed": passed,
        "gate_count": len(gates),
        "gates": gates,
        "inventory": {
            "design_records": len(design_rows),
            "supported_records": len(supported_rows),
            "acceptance_divisions": divisions,
            "alternatives_in_model_order": alternatives,
        },
    }


def _assert_aggregate_only(value: Any, path: tuple[str, ...] = ()) -> None:
    forbidden = {
        "person_id",
        "household_id",
        "outcome_rows",
        "individual_outcomes",
        "person_days",
    }
    if isinstance(value, Mapping):
        for key, child in value.items():
            if str(key) in forbidden:
                raise MandatoryTourAcceptanceError(
                    "The acceptance result attempted to include individual outcomes at "
                    + ".".join((*path, str(key)))
                )
            _assert_aggregate_only(child, (*path, str(key)))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_aggregate_only(child, (*path, str(index)))


def _result_artifact(
    lock: Mapping[str, Any],
    opening_lock_path: str | Path,
    receipt_path: str | Path,
    evaluation: Mapping[str, Any],
) -> dict[str, Any]:
    passed = evaluation.get("passed")
    if not isinstance(passed, bool):
        raise MandatoryTourAcceptanceError(
            "The six-gate evaluation did not return a boolean decision"
        )
    evidence_hashes = {
        "opening_lock_sha256": _sha256(opening_lock_path),
        "opening_receipt_sha256": _sha256(receipt_path),
        "protocol_sha256": lock["protocol"]["sha256"],
        "candidate_package_manifest_sha256": lock["candidate"][
            "package_manifest_sha256"
        ],
        "outcome_reconstruction_closure_sha256": lock[
            "outcome_reconstruction"
        ]["closure_sha256"],
        "evaluator_closure_sha256": lock["evaluator"]["closure_sha256"],
    }
    return {
        "schema_version": RESULT_SCHEMA_VERSION,
        "status": (
            ACCEPTED_COMPONENT_STATUS if passed else REJECTED_COMPONENT_STATUS
        ),
        "evaluation_status": EVALUATED_ONCE_STATUS,
        "component": "mandatory_tour_frequency",
        "scope": COMPONENT_SCOPE,
        "production_acceptance_passed": passed,
        "evidence_hashes": evidence_hashes,
        "source": dict(evidence_hashes),
        "evaluation": dict(evaluation),
        "limits": [
            "Acceptance covers mandatory_tour_frequency conditional on observed mandatory DAP only.",
            "It does not establish county-level accuracy or validate other ActivitySim components.",
            "The evaluator cannot prove that another process did not access the external raw archive outside this locked path.",
            "The result contains aggregates only; the evaluator never persisted reconstructed person-days.",
        ],
    }


def _open_and_evaluate_acceptance(
    source_archive_path: str | Path,
    opening_lock_path: str | Path = DEFAULT_OPENING_LOCK,
    *,
    preregistration_path: str | Path = DEFAULT_PREREGISTRATION,
    protocol_path: str | Path = DEFAULT_ACCEPTANCE_PROTOCOL,
    development_manifest_path: str | Path = DEFAULT_DEVELOPMENT_MANIFEST,
    candidate_registry_path: str | Path = DEFAULT_CANDIDATE_REGISTRY,
    candidate_package_dir: str | Path = DEFAULT_CANDIDATE_PACKAGE,
    receipt_path: str | Path = DEFAULT_OPENING_RECEIPT,
    result_path: str | Path = DEFAULT_ACCEPTANCE_RESULT,
) -> dict[str, Any]:
    """Consume the opening receipt, reconstruct in memory, and write aggregates."""
    runtime = load_activitysim_environment()
    lock = _verify_opening_lock(
        opening_lock_path,
        source_archive_path,
        preregistration_path=preregistration_path,
        protocol_path=protocol_path,
        development_manifest_path=development_manifest_path,
        candidate_registry_path=candidate_registry_path,
        candidate_package_dir=candidate_package_dir,
        receipt_path=receipt_path,
        result_path=result_path,
        environment=runtime,
    )
    if Path(result_path).exists() or Path(result_path).is_symlink():
        raise MandatoryTourAcceptanceError("The aggregate acceptance result already exists")
    receipt = {
        "schema_version": OPENING_RECEIPT_SCHEMA_VERSION,
        "status": "acceptance_opening_consumed_before_source_member_read",
        "component": "mandatory_tour_frequency",
        "opening_lock_sha256": _sha256(opening_lock_path),
        "source_archive_sha256": lock["source"]["archive_sha256"],
        "aggregate_result_path": lock["one_shot_outputs"]["aggregate_result_path"],
        "failure_consumes_receipt": True,
    }
    _exclusive_json(receipt_path, receipt)

    temporary_root = Path(tempfile.mkdtemp(prefix="openplan-mandatory-tour-acceptance-"))
    partition_dir = temporary_root / "partition"
    rows: list[dict[str, Any]] | None = None
    try:
        preparation._build_partition_source(
            source_archive_path,
            preregistration_path,
            partition_dir,
            role="acceptance",
            opening_lock_path=opening_lock_path,
            opening_receipt_path=receipt_path,
        )
        rows, context = outcomes._reconstruct_partition_outcomes(
            partition_dir,
            preregistration_path,
            role="acceptance",
            opening_lock_path=opening_lock_path,
            opening_receipt_path=receipt_path,
        )
        if context.get("role") != "acceptance":
            raise MandatoryTourAcceptanceError("Outcome reconstruction returned another role")
        if set(context.get("included_geography_codes") or []) != set(
            lock["acceptance_division_codes"]
        ):
            raise MandatoryTourAcceptanceError("Outcome reconstruction returned another partition")
        protocol = _load_json(protocol_path, "Superseding acceptance protocol")
        model_path = Path(candidate_package_dir) / fit.MODEL_NAME
        model = load_frozen_model(model_path)
        evaluation = evaluate_acceptance_rows(
            rows,
            model,
            protocol,
            environment=runtime,
            expected_divisions=lock["acceptance_division_codes"],
        )
        result = _result_artifact(
            lock, opening_lock_path, receipt_path, evaluation
        )
        _assert_aggregate_only(result)
        _exclusive_json(result_path, result)
        return result
    finally:
        if rows is not None:
            rows.clear()
        shutil.rmtree(temporary_root)


def open_and_evaluate_acceptance(
    source_archive_path: str | Path,
) -> dict[str, Any]:
    """Irreversibly evaluate the one study using only its fixed checked artifacts."""
    return _open_and_evaluate_acceptance(source_archive_path)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    lock_parser = subparsers.add_parser("lock", help="Freeze the unopened acceptance chain")
    lock_parser.add_argument("source_archive")
    evaluate_parser = subparsers.add_parser(
        "evaluate", help="Irreversibly consume the receipt and evaluate acceptance"
    )
    evaluate_parser.add_argument("source_archive")
    args = parser.parse_args(argv)
    if args.command == "lock":
        value = build_opening_lock(args.source_archive)
        write_opening_lock(value, DEFAULT_OPENING_LOCK)
        print(json.dumps(value, indent=2, sort_keys=True))
        return 0
    result = open_and_evaluate_acceptance(args.source_archive)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["production_acceptance_passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
