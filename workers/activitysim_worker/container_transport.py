"""One Linux Unix-socket Docker connection, with no retry or reconnect.

This adapter creates and inspects an unstarted container. It is not a lifecycle
controller and deliberately exposes no start, signal, or removal operation.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import struct
import sys
import threading
from urllib.parse import urlencode

from container_identity import ContainerPlan, verify_created_container
from container_creation import ContainerCreation
from model_engine_recovery import read_record, unique_object, invalid_constant

API_VERSION = "1.51"
MAX_RESPONSE_BYTES = 1024 * 1024


class DockerTransportError(RuntimeError):
    pass


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: Path):
        super().__init__("localhost", timeout=10)
        self.path = path
        self.connected_once = False
        self.peer = None

    def connect(self):
        if self.connected_once:
            raise DockerTransportError("Docker connection cannot be reopened")
        self.connected_once = True
        stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            stream.settimeout(self.timeout)
            stream.connect(str(self.path))
            pid, uid, gid = struct.unpack("3i", stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid not in (0, os.getuid()):
                raise DockerTransportError("Docker socket peer belongs to another user")
            self.peer = {"pid": pid, "uid": uid, "gid": gid}
            self.sock = stream
        except BaseException:
            stream.close()
            raise


class LocalDocker:
    def __init__(self, socket_path: Path):
        if sys.platform != "linux" or not Path(socket_path).is_absolute():
            raise ValueError("An explicit Linux Docker socket path is required")
        self.path = Path(socket_path).resolve()
        self.owner = (os.getpid(), threading.get_ident())
        self.closed = False
        self.connection = _UnixConnection(self.path)
        try:
            version = self._json("GET", "/version")
            def parts(value):
                if not isinstance(value, str) or not re.fullmatch(r"1\.[0-9]+", value):
                    raise DockerTransportError("Docker API version is unconfirmed")
                return tuple(map(int, value.split(".")))
            if not parts(version.get("MinAPIVersion")) <= parts(API_VERSION) <= parts(version.get("ApiVersion")):
                raise DockerTransportError("Docker API 1.51 is unavailable")
            info = self._json("GET", f"/v{API_VERSION}/info")
            self.daemon_id = info.get("ID")
            if not isinstance(self.daemon_id, str) or not self.daemon_id.strip():
                raise DockerTransportError("Docker daemon identity is missing")
            self.identity = {"transport": "linux-unix", "socket_path": str(self.path),
                "peer": self.connection.peer, "daemon_id": self.daemon_id, "api_version": API_VERSION}
            self.endpoint_sha256 = hashlib.sha256(json.dumps(self.identity, sort_keys=True).encode()).hexdigest()
        except BaseException:
            self.close()
            raise

    def _json(self, method, path, payload=None, status=200, expected_type=dict):
        if self.closed or self.owner != (os.getpid(), threading.get_ident()):
            raise DockerTransportError("Docker connection is closed or belongs to another invocation")
        body = None if payload is None else json.dumps(payload, allow_nan=False).encode()
        try:
            self.connection.request(method, path, body=body, headers={"Content-Type": "application/json"})
            response = self.connection.getresponse()
            content = response.read(MAX_RESPONSE_BYTES + 1)
            if len(content) > MAX_RESPONSE_BYTES or response.status != status:
                raise DockerTransportError("Docker response size or status is unexpected")
            value = json.loads(content, object_pairs_hook=unique_object, parse_constant=invalid_constant)
            if not isinstance(value, expected_type):
                raise DockerTransportError("Docker response has an unexpected JSON type")
            return value
        except (OSError, http.client.HTTPException, ValueError, DockerTransportError) as error:
            self.close()
            raise DockerTransportError("Docker request is unconfirmed; reconnect and retry are refused") from error

    def inspect(self, container_id: str):
        if not isinstance(container_id, str) or not re.fullmatch(r"[0-9a-f]{64}", container_id):
            raise ValueError("Full container ID required for inspection")
        return self._json("GET", f"/v{API_VERSION}/containers/{container_id}/json")

    def create_reserved(self, creation: ContainerCreation):
        creation._verify()
        intent, digest = read_record(creation.directory, "intent.json")
        if (digest != creation.intent_hash or intent.get("endpoint_sha256") != self.endpoint_sha256
                or creation.plan.daemon_id != self.daemon_id):
            raise ValueError("Container creation differs from connected endpoint")
        creation.begin_create()
        plan = creation.plan
        payload = {"Image": plan.image_id, "Cmd": list(plan.command), "Entrypoint": list(plan.entrypoint),
            "Env": list(plan.environment), "User": plan.user, "WorkingDir": plan.working_dir,
            "Labels": {"openplan.execution-request": plan.request_id},
            "HostConfig": {"Memory": plan.memory_bytes, "MemorySwap": plan.memory_bytes,
                "PidsLimit": plan.tasks, "NetworkMode": plan.network, "AutoRemove": False,
                "Privileged": False, "RestartPolicy": {"Name": "no"},
                "Mounts": [{"Type": "bind", "Source": source, "Target": target, "ReadOnly": read_only}
                           for source, target, read_only in plan.mounts]}}
        response = self._json("POST", f"/v{API_VERSION}/containers/create", payload, status=201)
        container_id = response.get("Id")
        if not isinstance(container_id, str) or not re.fullmatch(r"[0-9a-f]{64}", container_id):
            raise DockerTransportError("Container creation reply lacks a full ID")
        creation._write("create-response.json", {"schema": "openplan.container-create-response.v1",
            "intent_sha256": creation.intent_hash, "container_id": container_id,
            "verified": False, "start_authorized": False})
        if response.get("Warnings") not in (None, []):
            raise DockerTransportError("Container creation reported warnings; inspection requires reconciliation")
        observed = self.inspect(container_id)
        if observed.get("Id") != container_id:
            raise DockerTransportError("Inspected container differs from creation response")
        return creation.record_created(self.daemon_id, observed)

    def observe_creation(self, plan: ContainerPlan):
        """Read a possible lost creation outcome without adopting execution ownership.

        A matching label locates candidates only. Full inspection must match the
        immutable plan, and even a verified observation grants no start authority.
        Absence is an observation at this instant, not proof creation never ran.
        """
        if not isinstance(plan, ContainerPlan) or plan.daemon_id != self.daemon_id:
            raise ValueError("Creation observation requires the original daemon and plan")
        query = urlencode({"all": "1", "filters": json.dumps({
            "label": ["openplan.execution-request=" + plan.request_id]})})
        candidates = self._json("GET", f"/v{API_VERSION}/containers/json?{query}", expected_type=list)
        result = {"schema": "openplan.container-creation-observation.v1",
            "daemon_id": self.daemon_id, "endpoint_sha256": self.endpoint_sha256,
            "request_id": plan.request_id, "start_authorized": False,
            "signal_authorized": False, "continuation_authorized": False,
            "retry_authorized": False}
        if not candidates:
            return {**result, "outcome": "not_observed"}
        if len(candidates) != 1:
            return {**result, "outcome": "ambiguous", "candidate_count": len(candidates)}
        candidate = candidates[0]
        container_id = candidate.get("Id") if isinstance(candidate, dict) else None
        observed = self.inspect(container_id)
        if observed.get("Id") != container_id:
            raise DockerTransportError("Creation observation returned another container")
        identity = verify_created_container(plan, self.daemon_id, observed)
        return {**result, "outcome": "verified_unstarted", "identity": identity}

    def close(self):
        self.closed = True
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
