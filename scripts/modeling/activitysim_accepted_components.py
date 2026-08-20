"""Verify and install ActivitySim components that passed a recorded acceptance study."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any


DEFAULT_REGISTRY = Path(__file__).resolve().parents[2] / "data" / "modeling" / "activitysim-accepted-components.json"
REGISTRY_SCHEMA = "openplan.activitysim-accepted-components.v1"


class AcceptedComponentError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verified_file(base: Path, relative_path: str, expected_digest: str, label: str) -> Path:
    path = (base / relative_path).resolve()
    try:
        path.relative_to(base.resolve())
    except ValueError as exc:
        raise AcceptedComponentError(f"{label} escapes the accepted-component registry directory") from exc
    if not path.is_file():
        raise AcceptedComponentError(f"Accepted {label} is missing: {path}")
    actual = _sha256(path)
    if actual != expected_digest:
        raise AcceptedComponentError(
            f"Accepted {label} changed after approval: expected {expected_digest}, found {actual}"
        )
    return path


def resolve_accepted_components(registry_path: str | Path = DEFAULT_REGISTRY) -> list[dict[str, Any]]:
    registry_file = Path(registry_path).expanduser().resolve()
    registry = json.loads(registry_file.read_text())
    if registry.get("schema_version") != REGISTRY_SCHEMA or registry.get("status") != "active":
        raise AcceptedComponentError(f"{registry_file} is not an active accepted-component registry")

    resolved = []
    seen = set()
    for entry in registry.get("components") or []:
        component = str(entry.get("component") or "").strip()
        if not component or component in seen:
            raise AcceptedComponentError(f"Accepted component name is blank or duplicated: {component!r}")
        seen.add(component)
        if entry.get("status") != "accepted_for_production":
            raise AcceptedComponentError(f"Component {component} is not accepted for production")

        package_path = _verified_file(
            registry_file.parent,
            str(entry.get("candidate_package_manifest") or ""),
            str(entry.get("candidate_package_manifest_sha256") or ""),
            f"{component} candidate manifest",
        )
        package = json.loads(package_path.read_text())
        acceptance_path = _verified_file(
            registry_file.parent,
            str(entry.get("acceptance_result") or ""),
            str(entry.get("acceptance_result_sha256") or ""),
            f"{component} acceptance result",
        )
        acceptance = json.loads(acceptance_path.read_text())
        if acceptance.get("status") != "accepted_component" or acceptance.get("scope") != entry.get("scope"):
            raise AcceptedComponentError(f"Component {component} has no matching accepted decision")
        if (acceptance.get("evidence_hashes") or {}).get("candidate_package_manifest_sha256") != _sha256(package_path):
            raise AcceptedComponentError(f"Component {component} acceptance names a different candidate package")

        overlay_dir = (registry_file.parent / str(entry.get("overlay_directory") or "")).resolve()
        files = {}
        for filename, digest in sorted((entry.get("overlay_files_sha256") or {}).items()):
            if (package.get("files_sha256") or {}).get(filename) != digest:
                raise AcceptedComponentError(f"Component {component} registry disagrees with its candidate manifest for {filename}")
            files[filename] = _verified_file(overlay_dir, filename, digest, f"{component} file {filename}")
        if not files:
            raise AcceptedComponentError(f"Component {component} has no accepted overlay files")
        resolved.append({
            "component": component,
            "scope": entry["scope"],
            "files": files,
            "candidate_package_manifest": str(package_path),
            "candidate_package_manifest_sha256": _sha256(package_path),
            "acceptance_result": str(acceptance_path),
            "acceptance_result_sha256": _sha256(acceptance_path),
            "remaining_behavior_source": entry.get("remaining_behavior_source"),
        })
    return resolved


def install_accepted_components(
    destination_configs: str | Path,
    registry_path: str | Path = DEFAULT_REGISTRY,
) -> list[dict[str, Any]]:
    destination = Path(destination_configs)
    installed = []
    for component in resolve_accepted_components(registry_path):
        installed_files = {}
        for filename, source in component["files"].items():
            target = destination / filename
            shutil.copy2(source, target)
            installed_files[filename] = _sha256(target)
        installed.append({
            key: value for key, value in component.items() if key != "files"
        } | {"installed_files_sha256": installed_files})
    return installed
