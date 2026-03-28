from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

MANIFEST_NAME = "manifest.json"
RUNTIME_MANIFEST_NAME = "runtime_manifest.json"
RUNTIME_SUMMARY_NAME = "runtime_summary.json"
DEFAULT_RUNTIME_PARENT = "runtime"
DEFAULT_OUTPUT_SUBDIR = "output"
DEFAULT_CONTAINER_ENGINE = "docker"
DEFAULT_CONTAINER_BUNDLE_DIR = "/openplan/bundle"
DEFAULT_CONTAINER_CONFIG_DIR = "/openplan/configs"
DEFAULT_CONTAINER_RUNTIME_DIR = "/openplan/runtime"
EXECUTED_RUNTIME_MODES = {"activitysim_cli", "activitysim_container_cli"}

STAGE_SEQUENCE = [
    ("validate_inputs", 10),
    ("prepare_activitysim_inputs", 20),
    ("run_activitysim", 30),
    ("collect_outputs", 40),
]

REQUIRED_BUNDLE_FILES = {
    "manifest": "manifest.json",
    "land_use": "land_use.csv",
    "households": "households.csv",
    "persons": "persons.csv",
    "skim_omx": "skims/travel_time_skims.omx",
}
CONFIG_PACKAGE_DESCRIPTOR_NAME = "openplan_config_package.json"
CONFIG_PACKAGE_STATUS_PLACEHOLDER = "placeholder_only"
CONFIG_PACKAGE_STATUS_STARTER = "starter_executable_kit"
CONFIG_PACKAGE_STATUS_RUNNABLE = "runnable_config_package"


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _slugify(value: str) -> str:
    allowed = []
    for char in value.strip().lower():
        if char.isalnum():
            allowed.append(char)
        elif char in {"-", "_"}:
            allowed.append(char)
        else:
            allowed.append("-")
    slug = "".join(allowed).strip("-")
    return slug or "activitysim-runtime"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _file_metadata(path: Path, base_dir: Path) -> dict[str, Any]:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "relative_path": str(path.relative_to(base_dir)),
        "byte_size": path.stat().st_size,
        "sha256": digest.hexdigest(),
    }


def _tail_text(path: Path, max_chars: int = 4000) -> str | None:
    if not path.exists():
        return None
    text = path.read_text()
    if not text:
        return None
    return text[-max_chars:]


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _resolve_cli_command(cli_command: list[str] | None) -> list[str] | None:
    if not cli_command:
        return None
    executable = cli_command[0]
    if os.path.sep not in executable:
        resolved = shutil.which(executable)
        if not resolved:
            return None
        return [resolved, *cli_command[1:]]
    return cli_command


def _default_host_cli_command(*, cli_command: list[str] | None, cli_template: str | None) -> list[str] | None:
    if cli_template:
        if not cli_template.strip():
            return None
        parts = shlex.split(cli_template)
        if not parts:
            return None
        resolved = shutil.which(parts[0])
        if not resolved:
            return None
        return [resolved]
    if cli_command:
        return _resolve_cli_command(cli_command)
    resolved = shutil.which("activitysim")
    if not resolved:
        return None
    return [resolved]


def _container_path_mapping(*, bundle_dir: Path, config_dir: Path, runtime_dir: Path) -> dict[str, str]:
    bundle_mount = DEFAULT_CONTAINER_BUNDLE_DIR
    config_mount = DEFAULT_CONTAINER_CONFIG_DIR
    runtime_mount = DEFAULT_CONTAINER_RUNTIME_DIR
    mapping = {
        "bundle_dir": bundle_mount,
        "config_dir": config_mount,
        "data_dir": bundle_mount,
        "runtime_dir": runtime_mount,
        "working_dir": f"{runtime_mount}/workdir",
        "output_dir": f"{runtime_mount}/{DEFAULT_OUTPUT_SUBDIR}",
        "home_dir": f"{runtime_mount}/home",
    }
    if _is_relative_to(config_dir, bundle_dir):
        mapping["config_dir"] = f"{bundle_mount}/{config_dir.relative_to(bundle_dir).as_posix()}"
    return mapping


def build_container_command(
    *,
    bundle_dir: Path,
    config_dir: Path,
    runtime_dir: Path,
    image: str,
    engine_command: list[str] | None = None,
    container_template: str | None = None,
    network_mode: str | None = "none",
) -> tuple[list[str], dict[str, Any]]:
    engine = _resolve_cli_command(engine_command or [DEFAULT_CONTAINER_ENGINE])
    if not engine:
        raise RuntimeError("Container engine executable is not available")

    host_bundle_dir = bundle_dir.resolve()
    host_config_dir = config_dir.resolve()
    host_runtime_dir = runtime_dir.resolve()
    container_mapping = _container_path_mapping(
        bundle_dir=host_bundle_dir,
        config_dir=host_config_dir,
        runtime_dir=host_runtime_dir,
    )

    mounts = [
        {"source": str(host_bundle_dir), "target": DEFAULT_CONTAINER_BUNDLE_DIR, "read_only": True},
        {"source": str(host_runtime_dir), "target": DEFAULT_CONTAINER_RUNTIME_DIR, "read_only": False},
    ]
    if _is_relative_to(host_config_dir, host_bundle_dir):
        mounts.append(
            {
                "source": str(host_config_dir),
                "target": container_mapping["config_dir"],
                "read_only": True,
            }
        )
    else:
        mounts.append(
            {"source": str(host_config_dir), "target": DEFAULT_CONTAINER_CONFIG_DIR, "read_only": True}
        )

    command: list[str] = [*engine, "run", "--rm"]
    if network_mode:
        command.extend(["--network", network_mode])
    if hasattr(os, "getuid") and hasattr(os, "getgid"):
        command.extend(["--user", f"{os.getuid()}:{os.getgid()}"])
    for mount in mounts:
        volume = f"{mount['source']}:{mount['target']}"
        if mount["read_only"]:
            volume = f"{volume}:ro"
        command.extend(["-v", volume])
    command.extend(["-e", f"HOME={container_mapping['home_dir']}"])
    command.extend(["-w", container_mapping["working_dir"], image])
    if container_template:
        inner_command = _format_command(container_template, container_mapping)
    else:
        inner_command = [
            "activitysim",
            "run",
            "-c",
            container_mapping["config_dir"],
            "-d",
            container_mapping["data_dir"],
            "-o",
            container_mapping["output_dir"],
            "-w",
            container_mapping["working_dir"],
        ]
    command.extend(inner_command)
    return command, {
        "engine_command": engine,
        "image": image,
        "mounts": mounts,
        "container_paths": container_mapping,
        "inner_command": inner_command,
        "network_mode": network_mode,
    }


class BundleContractError(RuntimeError):
    pass


@dataclass
class StageRecord:
    stage_key: str
    order: int
    status: str = "queued"
    started_at_utc: str | None = None
    completed_at_utc: str | None = None
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class RuntimeRecorder:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, message: str) -> None:
        timestamp = _utc_now()
        with self.log_path.open("a") as handle:
            handle.write(f"{timestamp} {message}\n")


def resolve_bundle_paths(bundle_path: str | None, manifest_path: str | None) -> tuple[Path, Path]:
    provided = [value for value in (bundle_path, manifest_path) if value]
    if len(provided) != 1:
        raise BundleContractError("Provide exactly one of bundle_path or manifest_path")

    if bundle_path:
        bundle_dir = Path(bundle_path).expanduser().resolve()
        manifest = bundle_dir / MANIFEST_NAME
    else:
        manifest = Path(manifest_path).expanduser().resolve()
        bundle_dir = manifest.parent

    if manifest.name != MANIFEST_NAME:
        raise BundleContractError(f"Expected bundle manifest named {MANIFEST_NAME}, got {manifest.name}")
    if not bundle_dir.exists():
        raise BundleContractError(f"Bundle directory does not exist: {bundle_dir}")
    if not manifest.exists():
        raise BundleContractError(f"Bundle manifest does not exist: {manifest}")
    return bundle_dir, manifest


def validate_bundle_contract(bundle_dir: Path, manifest_path: Path) -> dict[str, Any]:
    manifest = _read_json(manifest_path)
    if manifest.get("bundle_type") != "activitysim_input_bundle":
        raise BundleContractError(
            f"Bundle manifest is not an ActivitySim input bundle: {manifest.get('bundle_type')!r}"
        )
    schema_version = manifest.get("schema_version")
    if not isinstance(schema_version, str) or not schema_version.startswith("openplan.activitysim_input_bundle."):
        raise BundleContractError(f"Unsupported bundle schema version: {schema_version!r}")

    files = manifest.get("files")
    if not isinstance(files, dict):
        raise BundleContractError("Bundle manifest is missing a valid 'files' section")

    checked_files: dict[str, str] = {}
    for key, default_relative in REQUIRED_BUNDLE_FILES.items():
        relative_path = files.get(key, default_relative)
        if not isinstance(relative_path, str) or not relative_path.strip():
            raise BundleContractError(f"Bundle manifest has invalid file reference for {key!r}")
        resolved = (bundle_dir / relative_path).resolve()
        if not resolved.exists():
            raise BundleContractError(f"Bundle is missing required file for {key!r}: {resolved}")
        checked_files[key] = str(resolved)

    config_dir = (bundle_dir / "configs").resolve()
    if not config_dir.exists():
        raise BundleContractError(f"Bundle is missing config scaffold directory: {config_dir}")

    return {
        "bundle_dir": str(bundle_dir),
        "manifest_path": str(manifest_path),
        "bundle_manifest": manifest,
        "required_files": checked_files,
        "config_dir": str(config_dir),
    }


def inspect_config_package(config_dir: Path) -> dict[str, Any]:
    descriptor_path = config_dir / CONFIG_PACKAGE_DESCRIPTOR_NAME
    settings_path = config_dir / "settings.yaml"
    constants_path = config_dir / "constants.yaml"
    readme_path = config_dir / "README.md"

    descriptor: dict[str, Any] | None = None
    if descriptor_path.exists():
        descriptor = _read_json(descriptor_path)

    package_status = (
        descriptor.get("package_status")
        if isinstance(descriptor, dict) and isinstance(descriptor.get("package_status"), str)
        else None
    )
    starter_version = (
        descriptor.get("starter_version")
        if isinstance(descriptor, dict) and isinstance(descriptor.get("starter_version"), str)
        else None
    )

    if package_status not in {
        CONFIG_PACKAGE_STATUS_PLACEHOLDER,
        CONFIG_PACKAGE_STATUS_STARTER,
        CONFIG_PACKAGE_STATUS_RUNNABLE,
    }:
        if not settings_path.exists():
            package_status = CONFIG_PACKAGE_STATUS_PLACEHOLDER
        elif descriptor_path.exists():
            package_status = CONFIG_PACKAGE_STATUS_STARTER
        else:
            package_status = CONFIG_PACKAGE_STATUS_RUNNABLE

    notes: list[str] = []
    if package_status == CONFIG_PACKAGE_STATUS_PLACEHOLDER:
        notes.append(
            "Bundle config directory is placeholder-only; no executable ActivitySim settings.yaml was found"
        )
    elif package_status == CONFIG_PACKAGE_STATUS_STARTER:
        version_note = f" `{starter_version}`" if starter_version else ""
        notes.append(
            "Bundle config directory contains the OpenPlan starter executable config kit"
            f"{version_note}; it is not a calibrated or pilot-ready ActivitySim package"
        )
    else:
        notes.append(
            "Config directory appears to be a runnable ActivitySim config package candidate; "
            "the runtime will only confirm execution after a real CLI run succeeds"
        )

    return {
        "config_dir": str(config_dir),
        "descriptor_path": str(descriptor_path) if descriptor_path.exists() else None,
        "settings_path": str(settings_path),
        "constants_path": str(constants_path) if constants_path.exists() else None,
        "readme_path": str(readme_path) if readme_path.exists() else None,
        "package_status": package_status,
        "starter_version": starter_version,
        "notes": notes,
    }


def detect_activitysim_capability(
    *,
    bundle_dir: Path,
    config_dir: Path,
    cli_command: list[str] | None,
    cli_template: str | None,
    container_image: str | None,
    container_engine_command: list[str] | None,
    container_template: str | None,
    container_network_mode: str | None,
) -> dict[str, Any]:
    config_package = inspect_config_package(config_dir)
    capability = {
        "mode": "preflight_only",
        "available": False,
        "reason": None,
        "command": None,
        "execution_backend": "none",
        "config_dir": str(config_dir),
        "settings_path": config_package["settings_path"],
        "config_package_status": config_package["package_status"],
        "config_package": config_package,
        "container_image": container_image,
        "container_engine_command": None,
        "container_template": container_template,
        "container_network_mode": container_network_mode,
    }

    if config_package["package_status"] == CONFIG_PACKAGE_STATUS_PLACEHOLDER:
        capability["reason"] = config_package["notes"][0]
        return capability

    if container_image:
        container_image = container_image.strip()
        if not container_image:
            capability["reason"] = "Empty ActivitySim container image"
            return capability
        resolved_engine = _resolve_cli_command(container_engine_command or [DEFAULT_CONTAINER_ENGINE])
        if not resolved_engine:
            engine_name = (container_engine_command or [DEFAULT_CONTAINER_ENGINE])[0]
            capability["reason"] = f"Configured container engine not found on PATH: {engine_name}"
            return capability
        capability["available"] = True
        capability["mode"] = "activitysim_container_cli"
        capability["execution_backend"] = "container_cli"
        capability["container_image"] = container_image
        capability["container_engine_command"] = resolved_engine
        capability["container_network_mode"] = container_network_mode
        capability["command"] = resolved_engine
        return capability

    if cli_template and not cli_template.strip():
        capability["reason"] = "Empty ActivitySim CLI template"
        return capability

    command = _default_host_cli_command(cli_command=cli_command, cli_template=cli_template)
    if not command:
        if cli_template:
            capability["reason"] = "ActivitySim CLI template provided, but its executable is not available"
        elif cli_command:
            capability["reason"] = f"Configured ActivitySim executable not found on PATH: {cli_command[0]}"
        else:
            capability["reason"] = "ActivitySim CLI is not installed or not on PATH"
        return capability

    capability["available"] = True
    capability["mode"] = "activitysim_cli"
    capability["execution_backend"] = "host_cli"
    capability["command"] = command
    return capability


def prepare_runtime_directory(
    *,
    bundle_dir: Path,
    runtime_dir: str | None,
    run_label: str | None,
    force: bool,
) -> Path:
    if runtime_dir:
        path = Path(runtime_dir).expanduser().resolve()
    else:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        label = _slugify(run_label or bundle_dir.name)
        path = bundle_dir / DEFAULT_RUNTIME_PARENT / f"{timestamp}-{label}"
    if path.exists():
        if not force:
            raise RuntimeError(f"Runtime output directory already exists: {path}")
        shutil.rmtree(path)
    (path / "logs").mkdir(parents=True, exist_ok=True)
    (path / "stages").mkdir(parents=True, exist_ok=True)
    (path / "workdir").mkdir(parents=True, exist_ok=True)
    return path


def _stage_output_dir(runtime_dir: Path, order: int, key: str) -> Path:
    path = runtime_dir / "stages" / f"{order:03d}-{key.replace('_', '-')}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_stage_record(stage_dir: Path, stage: StageRecord) -> None:
    _write_json(stage_dir / "stage.json", asdict(stage))


def _format_command(template: str, mapping: dict[str, str]) -> list[str]:
    return [part.format(**mapping) for part in shlex.split(template)]


def run_activitysim_runtime(
    *,
    bundle_path: str | None = None,
    manifest_path: str | None = None,
    runtime_dir: str | None = None,
    config_dir: str | None = None,
    cli_command: list[str] | None = None,
    cli_template: str | None = None,
    container_image: str | None = None,
    container_engine_command: list[str] | None = None,
    container_template: str | None = None,
    container_network_mode: str | None = "none",
    run_label: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    bundle_dir, bundle_manifest_path = resolve_bundle_paths(bundle_path, manifest_path)
    output_dir = prepare_runtime_directory(
        bundle_dir=bundle_dir,
        runtime_dir=runtime_dir,
        run_label=run_label,
        force=force,
    )
    logger = RuntimeRecorder(output_dir / "logs" / "runtime.log")
    logger.log(f"Starting ActivitySim runtime for bundle {bundle_dir}")

    config_path = Path(config_dir).expanduser().resolve() if config_dir else (bundle_dir / "configs").resolve()
    stages = [StageRecord(stage_key=key, order=order) for key, order in STAGE_SEQUENCE]
    stage_dirs = {stage.stage_key: _stage_output_dir(output_dir, stage.order, stage.stage_key) for stage in stages}
    runtime_manifest: dict[str, Any] = {
        "schema_version": "openplan.activitysim_runtime.v0",
        "runtime_type": "activitysim_worker_runtime",
        "created_at_utc": _utc_now(),
        "bundle": {
            "bundle_dir": str(bundle_dir),
            "manifest_path": str(bundle_manifest_path),
        },
        "runtime_dir": str(output_dir),
        "mode": "preflight_only",
        "status": "running",
        "caveats": [],
        "errors": [],
        "execution": {
            "backend": "none",
            "requested_container_image": container_image,
            "container_engine_command": container_engine_command,
            "container_template": container_template,
            "container_network_mode": container_network_mode,
            "host_cli_command": cli_command,
            "host_cli_template": cli_template,
        },
        "artifacts": {},
        "stages": [asdict(stage) for stage in stages],
    }
    _write_json(output_dir / RUNTIME_MANIFEST_NAME, runtime_manifest)

    try:
        validated_bundle: dict[str, Any] | None = None
        capability: dict[str, Any] | None = None
        collected_outputs: list[dict[str, Any]] = []

        for stage in stages:
            stage_dir = stage_dirs[stage.stage_key]
            stage.started_at_utc = _utc_now()
            stage.status = "running"
            _write_stage_record(stage_dir, stage)
            logger.log(f"Stage {stage.stage_key} started")
            try:
                if stage.stage_key == "validate_inputs":
                    validated_bundle = validate_bundle_contract(bundle_dir, bundle_manifest_path)
                    capability = detect_activitysim_capability(
                        bundle_dir=bundle_dir,
                        config_dir=config_path,
                        cli_command=cli_command,
                        cli_template=cli_template,
                        container_image=container_image,
                        container_engine_command=container_engine_command,
                        container_template=container_template,
                        container_network_mode=container_network_mode,
                    )
                    stage.metadata = {
                        "bundle_schema_version": validated_bundle["bundle_manifest"]["schema_version"],
                        "bundle_type": validated_bundle["bundle_manifest"]["bundle_type"],
                        "config_dir": str(config_path),
                        "detected_mode": capability["mode"],
                        "execution_backend": capability["execution_backend"],
                        "config_package_status": capability["config_package_status"],
                    }
                    stage.artifacts.append(
                        {
                            "artifact_type": "validated_input_bundle",
                            "path": str(bundle_manifest_path),
                        }
                    )
                    if capability["reason"]:
                        stage.notes.append(capability["reason"])
                        runtime_manifest["caveats"].append(capability["reason"])
                    runtime_manifest["config_package"] = capability["config_package"]
                    runtime_manifest["execution"] = {
                        "backend": capability["execution_backend"],
                        "mode": capability["mode"],
                        "host_cli_command": capability["command"] if capability["mode"] == "activitysim_cli" else None,
                        "host_cli_template": cli_template,
                        "container_image": capability["container_image"],
                        "container_engine_command": capability["container_engine_command"],
                        "container_template": capability["container_template"],
                        "container_network_mode": capability.get("container_network_mode"),
                    }
                    for note in capability["config_package"].get("notes", []):
                        if note not in runtime_manifest["caveats"]:
                            runtime_manifest["caveats"].append(note)
                    stage.status = "succeeded"

                elif stage.stage_key == "prepare_activitysim_inputs":
                    assert validated_bundle is not None
                    staged_bundle_manifest = stage_dir / "bundle_manifest_snapshot.json"
                    _write_json(staged_bundle_manifest, validated_bundle["bundle_manifest"])
                    scaffold = {
                        "bundle_dir": str(bundle_dir),
                        "config_dir": str(config_path),
                        "working_dir": str(output_dir / "workdir"),
                        "data_dir": str(bundle_dir),
                        "output_dir": str(output_dir / DEFAULT_OUTPUT_SUBDIR),
                    }
                    _write_json(stage_dir / "runtime_scaffold.json", scaffold)
                    stage.artifacts.extend(
                        [
                            {"artifact_type": "bundle_manifest_snapshot", "path": str(staged_bundle_manifest)},
                            {"artifact_type": "runtime_scaffold", "path": str(stage_dir / "runtime_scaffold.json")},
                        ]
                    )
                    if capability and capability["config_package"]["notes"]:
                        stage.notes.extend(capability["config_package"]["notes"])
                    stage.metadata = {
                        "config_package_status": capability["config_package_status"] if capability else None,
                        "settings_path": str(config_path / "settings.yaml"),
                    }
                    stage.status = "succeeded"

                elif stage.stage_key == "run_activitysim":
                    assert capability is not None
                    run_log_path = stage_dir / "activitysim_stdout.log"
                    if not capability["available"]:
                        stage.status = "blocked"
                        stage.metadata = {
                            "mode": capability["mode"],
                            "execution_backend": capability["execution_backend"],
                            "reason": capability["reason"],
                        }
                        stage.notes.append(capability["reason"] or "ActivitySim execution is unavailable")
                    else:
                        host_command_mapping = {
                            "bundle_dir": str(bundle_dir),
                            "config_dir": str(config_path),
                            "data_dir": str(bundle_dir),
                            "runtime_dir": str(output_dir),
                            "working_dir": str(output_dir / "workdir"),
                            "output_dir": str(output_dir / DEFAULT_OUTPUT_SUBDIR),
                        }
                        if capability["mode"] == "activitysim_container_cli":
                            command, container_execution = build_container_command(
                                bundle_dir=bundle_dir,
                                config_dir=config_path,
                                runtime_dir=output_dir,
                                image=capability["container_image"],
                                engine_command=capability["container_engine_command"],
                                container_template=container_template,
                                network_mode=capability.get("container_network_mode"),
                            )
                            runtime_manifest["execution"].update(
                                {
                                    "container_image": container_execution["image"],
                                    "container_engine_command": container_execution["engine_command"],
                                    "container_network_mode": container_execution["network_mode"],
                                    "container_mounts": container_execution["mounts"],
                                    "container_paths": container_execution["container_paths"],
                                    "container_inner_command": container_execution["inner_command"],
                                }
                            )
                            stage.metadata = {
                                "mode": capability["mode"],
                                "execution_backend": capability["execution_backend"],
                                "command": command,
                                "container_image": container_execution["image"],
                                "container_network_mode": container_execution["network_mode"],
                                "container_mounts": container_execution["mounts"],
                                "container_paths": container_execution["container_paths"],
                            }
                        elif cli_template:
                            command = _format_command(cli_template, host_command_mapping)
                            stage.metadata = {
                                "mode": capability["mode"],
                                "execution_backend": capability["execution_backend"],
                                "command": command,
                            }
                        else:
                            command = [
                                *capability["command"],
                                "run",
                                "-c",
                                str(config_path),
                                "-d",
                                str(bundle_dir),
                                "-o",
                                str(output_dir / DEFAULT_OUTPUT_SUBDIR),
                                "-w",
                                str(output_dir / "workdir"),
                            ]
                            stage.metadata = {
                                "mode": capability["mode"],
                                "execution_backend": capability["execution_backend"],
                                "command": command,
                            }
                        (output_dir / DEFAULT_OUTPUT_SUBDIR).mkdir(parents=True, exist_ok=True)
                        logger.log(f"Executing ActivitySim command: {' '.join(shlex.quote(part) for part in command)}")
                        completed = subprocess.run(
                            command,
                            cwd=str(output_dir / "workdir"),
                            capture_output=True,
                            text=True,
                            check=False,
                        )
                        run_log_path.write_text(
                            (completed.stdout or "")
                            + ("\n" if completed.stdout and completed.stderr else "")
                            + (completed.stderr or "")
                        )
                        stage.artifacts.append({"artifact_type": "activitysim_stdout_log", "path": str(run_log_path)})
                        stage.metadata["returncode"] = completed.returncode
                        if completed.returncode == 0:
                            stage.status = "succeeded"
                            runtime_manifest["mode"] = capability["mode"]
                        else:
                            stage.status = "failed"
                            stage.errors.append(
                                {
                                    "kind": "CalledProcessError",
                                    "message": f"ActivitySim CLI exited with return code {completed.returncode}",
                                    "details": _tail_text(run_log_path),
                                }
                            )

                elif stage.stage_key == "collect_outputs":
                    output_root = output_dir / DEFAULT_OUTPUT_SUBDIR
                    if output_root.exists():
                        for path in sorted(output_root.rglob("*")):
                            if path.is_file():
                                collected_outputs.append(_file_metadata(path, output_dir))
                    summary = {
                        "output_files": collected_outputs,
                        "runtime_log": str(output_dir / "logs" / "runtime.log"),
                        "run_log_tail": _tail_text(stage_dirs["run_activitysim"] / "activitysim_stdout.log"),
                    }
                    _write_json(stage_dir / "collected_outputs.json", summary)
                    stage.artifacts.append(
                        {"artifact_type": "collected_outputs", "path": str(stage_dir / "collected_outputs.json")}
                    )
                    stage.metadata = {"output_file_count": len(collected_outputs)}
                    stage.status = "succeeded"
            except Exception as exc:
                stage.status = "failed"
                stage.errors.append(
                    {
                        "kind": exc.__class__.__name__,
                        "message": str(exc),
                    }
                )
                stage.completed_at_utc = _utc_now()
                _write_stage_record(stage_dir, stage)
                logger.log(f"Stage {stage.stage_key} failed: {exc.__class__.__name__}: {exc}")
                raise

            stage.completed_at_utc = _utc_now()
            _write_stage_record(stage_dir, stage)
            logger.log(f"Stage {stage.stage_key} finished with status {stage.status}")

        runtime_manifest["stages"] = [asdict(stage) for stage in stages]
        runtime_manifest["artifacts"] = {
            "runtime_log": "logs/runtime.log",
            "collected_outputs": [entry["relative_path"] for entry in collected_outputs],
        }
        if any(stage.status == "failed" for stage in stages):
            runtime_manifest["status"] = "failed"
        elif any(stage.status == "blocked" for stage in stages):
            runtime_manifest["status"] = "blocked"
        else:
            runtime_manifest["status"] = "succeeded"
        if runtime_manifest["status"] != "succeeded":
            runtime_manifest["mode"] = (
                "preflight_only" if runtime_manifest["mode"] not in EXECUTED_RUNTIME_MODES else runtime_manifest["mode"]
            )
        _write_json(output_dir / RUNTIME_MANIFEST_NAME, runtime_manifest)

        summary = {
            "runtime_dir": str(output_dir),
            "runtime_manifest_path": str(output_dir / RUNTIME_MANIFEST_NAME),
            "runtime_summary_path": str(output_dir / RUNTIME_SUMMARY_NAME),
            "mode": runtime_manifest["mode"],
            "status": runtime_manifest["status"],
            "stage_statuses": {stage.stage_key: stage.status for stage in stages},
            "caveats": runtime_manifest["caveats"],
        }
        _write_json(output_dir / RUNTIME_SUMMARY_NAME, summary)
        logger.log(f"Runtime completed with status {summary['status']} in mode {summary['mode']}")
        return summary
    except Exception as exc:
        logger.log(f"Runtime failed before completion: {exc.__class__.__name__}: {exc}")
        runtime_manifest["status"] = "failed"
        runtime_manifest["errors"].append(
            {
                "kind": exc.__class__.__name__,
                "message": str(exc),
            }
        )
        runtime_manifest["stages"] = [asdict(stage) for stage in stages]
        _write_json(output_dir / RUNTIME_MANIFEST_NAME, runtime_manifest)
        summary = {
            "runtime_dir": str(output_dir),
            "runtime_manifest_path": str(output_dir / RUNTIME_MANIFEST_NAME),
            "runtime_summary_path": str(output_dir / RUNTIME_SUMMARY_NAME),
            "mode": runtime_manifest["mode"],
            "status": "failed",
            "stage_statuses": {stage.stage_key: stage.status for stage in stages},
            "caveats": runtime_manifest["caveats"],
            "errors": runtime_manifest["errors"],
        }
        _write_json(output_dir / RUNTIME_SUMMARY_NAME, summary)
        return summary
