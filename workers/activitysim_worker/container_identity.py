"""Verify created or running bootstrap containers against a retained plan.

This module observes supplied daemon facts. It neither contacts Docker nor
authorizes start, signaling, recovery, or reuse of a saved container identity.
"""
from dataclasses import dataclass
import hashlib
import json
import re


@dataclass(frozen=True)
class ContainerPlan:
    daemon_id: str
    image_id: str
    request_id: str
    command: tuple[str, ...]
    entrypoint: tuple[str, ...]
    environment: tuple[str, ...]
    user: str
    working_dir: str
    memory_bytes: int
    tasks: int
    network: str
    mounts: tuple[tuple[str, str, bool], ...]

    def __post_init__(self):
        if not isinstance(self.daemon_id, str) or not self.daemon_id.strip():
            raise ValueError("Explicit daemon identity required")
        if not isinstance(self.image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", self.image_id):
            raise ValueError("Immutable container image ID required")
        if not isinstance(self.request_id, str) or not re.fullmatch(r"[0-9a-f]{32}", self.request_id):
            raise ValueError("Unique container request identity required")
        if any(type(value) is not tuple for value in (self.command, self.entrypoint, self.environment, self.mounts)):
            raise ValueError("Immutable container plan sequences required")
        if not self.command or not self.command[0] or any(not isinstance(part, str) for part in (*self.command, *self.entrypoint)):
            raise ValueError("Explicit container command required")
        if any(not isinstance(value, str) or "=" not in value for value in self.environment):
            raise ValueError("Explicit container environment required")
        if not isinstance(self.user, str) or not self.user or not isinstance(self.network, str) or not self.network:
            raise ValueError("Explicit container user and network required")
        if not isinstance(self.working_dir, str) or not self.working_dir.startswith("/"):
            raise ValueError("Explicit container working directory required")
        if any(type(value) is not int or value <= 0 for value in (self.memory_bytes, self.tasks)):
            raise ValueError("Positive container limits required")
        destinations = []
        for mount in self.mounts:
            if type(mount) is not tuple or len(mount) != 3:
                raise ValueError("Immutable container mount tuple required")
            source, destination, read_only = mount
            if not isinstance(source, str) or not source.startswith("/") or not isinstance(destination, str) or not destination.startswith("/") or type(read_only) is not bool:
                raise ValueError("Absolute container bind mounts required")
            destinations.append(destination)
        if len(destinations) != len(set(destinations)):
            raise ValueError("Duplicate container mount destination")


def _verify_plan(plan: ContainerPlan, daemon_id: str, observed: dict) -> dict:
    """Check immutable execution configuration independently of process state."""
    if not isinstance(plan, ContainerPlan) or daemon_id != plan.daemon_id:
        raise ValueError("Container daemon differs from execution plan")
    if not isinstance(observed, dict):
        raise ValueError("Container inspection must be an object")
    container_id = observed.get("Id")
    if not isinstance(container_id, str) or not re.fullmatch(r"[0-9a-f]{64}", container_id):
        raise ValueError("Full container ID required")
    config, host, state = (observed.get(key) for key in ("Config", "HostConfig", "State"))
    if not all(isinstance(value, dict) for value in (config, host, state)):
        raise ValueError("Container inspection is incomplete")
    if observed.get("Image") != plan.image_id:
        raise ValueError("Container image differs from execution plan")
    labels = config.get("Labels")
    if not isinstance(labels, dict) or labels.get("openplan.execution-request") != plan.request_id:
        raise ValueError("Container request label differs from execution plan")
    entrypoint = config.get("Entrypoint")
    environment = config.get("Env")
    if (not isinstance(environment, list) or any(not isinstance(value, str) for value in environment)
            or sorted(environment) != sorted(plan.environment)):
        raise ValueError("Container environment differs from execution plan")
    if (config.get("Cmd") != list(plan.command) or (entrypoint if entrypoint is not None else []) != list(plan.entrypoint)
            or config.get("User") != plan.user or config.get("WorkingDir") != plan.working_dir):
        raise ValueError("Container command or user differs from execution plan")
    for key, expected in (("Memory", plan.memory_bytes), ("MemorySwap", plan.memory_bytes), ("PidsLimit", plan.tasks)):
        if type(host.get(key)) is not int or host[key] != expected:
            raise ValueError("Container resource policy differs from execution plan")
    restart = host.get("RestartPolicy")
    if not isinstance(restart, dict):
        raise ValueError("Container restart policy is missing")
    if (host.get("NetworkMode") != plan.network or host.get("AutoRemove") is not False
            or host.get("Privileged") is not False or restart.get("Name") != "no"
            or host.get("CapAdd") or host.get("Devices") or host.get("DeviceRequests")):
        raise ValueError("Container lifecycle or privilege policy differs from execution plan")
    mounts = observed.get("Mounts")
    if not isinstance(mounts, list):
        raise ValueError("Container mounts are missing")
    actual = []
    for mount in mounts:
        if not isinstance(mount, dict) or mount.get("Type") != "bind" or type(mount.get("RW")) is not bool:
            raise ValueError("Container has an unplanned mount type")
        source, destination = mount.get("Source"), mount.get("Destination")
        if not isinstance(source, str) or not isinstance(destination, str):
            raise ValueError("Container mount path is invalid")
        actual.append((source, destination, not mount["RW"]))
    if sorted(actual) != sorted(plan.mounts):
        raise ValueError("Container mounts differ from execution plan")
    digest = hashlib.sha256(json.dumps({"command": plan.command, "entrypoint": plan.entrypoint,
        "environment": sorted(plan.environment), "user": plan.user, "working_dir": plan.working_dir, "memory_bytes": plan.memory_bytes, "tasks": plan.tasks,
        "network": plan.network, "mounts": sorted(plan.mounts)}, sort_keys=True).encode()).hexdigest()
    return {"schema": "openplan.created-container.v1", "daemon_id": daemon_id,
            "container_id": container_id, "image_id": plan.image_id, "request_id": plan.request_id,
            "policy_sha256": digest, "start_authorized": False,
            "signal_authorized": False, "continuation_authorized": False}


def verify_created_container(plan: ContainerPlan, daemon_id: str, observed: dict) -> dict:
    """Return observed identity only after checking an unstarted container."""
    identity = _verify_plan(plan, daemon_id, observed)
    state = observed["State"]
    if (state.get("Status") != "created" or type(state.get("Pid")) is not int or state["Pid"] != 0
            or any(state.get(key) is not False for key in ("Running", "Paused", "Restarting", "Dead"))):
        raise ValueError("Container has started or its initial state is unconfirmed")
    return {**identity, "observed_state": "created"}


def verify_bootstrap_container(plan: ContainerPlan, daemon_id: str, observed: dict,
                               expected_id: str) -> dict:
    """Recheck the exact running bootstrap before any descriptor delivery.

    This is evidence for a live controller, not a saved admission capability.
    The caller still needs verified socket peer identity and original owners.
    """
    identity = _verify_plan(plan, daemon_id, observed)
    if identity["container_id"] != expected_id:
        raise ValueError("Bootstrap container differs from created identity")
    state, host = observed["State"], observed["HostConfig"]
    if (state.get("Status") != "running" or state.get("Running") is not True
            or type(state.get("Pid")) is not int or state["Pid"] <= 0
            or any(state.get(key) is not False for key in ("Paused", "Restarting", "Dead"))):
        raise ValueError("Bootstrap process state is unconfirmed")
    if (host.get("PidMode") != "" or (host.get("Init") is not None and host.get("Init") is not False)
            or host.get("CapDrop") != ["ALL"] or host.get("SecurityOpt") != ["no-new-privileges"]):
        raise ValueError("Bootstrap namespace or privilege policy differs")
    return {**identity, "observed_state": "bootstrap_running", "bootstrap_pid": state["Pid"]}
