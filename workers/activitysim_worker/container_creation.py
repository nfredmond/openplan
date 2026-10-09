"""Retain a single container creation intent outside writable container mounts.

The caller owns transport and the original live owner. These records do not
authorize start, retry, signaling, or continuation after a lost create reply.
"""
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from container_identity import ContainerPlan, verify_created_container, verify_bootstrap_container

SHARED_WORKER = str(Path(__file__).resolve().parent.parent / "aequilibrae_worker")
if SHARED_WORKER not in sys.path:
    sys.path.append(SHARED_WORKER)
from model_engine_recovery import read_record


class ContainerCreation:
    def __init__(self, records: Path, plan: ContainerPlan, endpoint_sha256: str):
        if not isinstance(plan, ContainerPlan) or not isinstance(endpoint_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", endpoint_sha256):
            raise ValueError("Container plan and endpoint fingerprint required")
        self.path = Path(records).absolute()
        resolved = self.path.resolve()
        for source, _, read_only in plan.mounts:
            if not read_only and resolved.is_relative_to(Path(source).resolve()):
                raise ValueError("Container custody cannot be inside a writable mount")
        self.path.mkdir(mode=0o700)
        parent = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        self.directory = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(self.directory)
        self.identity = (info.st_dev, info.st_ino)
        self.plan = plan
        self.requested = False
        self.recorded = False
        self.created_hash = None
        try:
            self.intent_hash = self._write("intent.json", {
                "schema": "openplan.container-creation-intent.v1", "plan": asdict(plan),
                "endpoint_sha256": endpoint_sha256,
                "start_authorized": False, "continuation_authorized": False})
        except BaseException:
            self.close()
            raise

    def _verify(self):
        if self.directory is None:
            raise ValueError("Container custody is closed")
        descriptor = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(descriptor)
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError("Container custody directory is not private")
            if (info.st_dev, info.st_ino) != self.identity:
                raise ValueError("Container custody directory changed")
        finally:
            os.close(descriptor)

    def _write(self, name, payload):
        self._verify()
        content = (json.dumps(payload, sort_keys=True, allow_nan=False) + "\n").encode()
        descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.directory)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(self.directory)
        self._verify()
        return hashlib.sha256(content).hexdigest()

    def verify_intent(self):
        """Require the retained bytes and the live immutable plan to agree."""
        self._verify()
        intent, current_hash = read_record(self.directory, "intent.json")
        if current_hash != self.intent_hash:
            raise ValueError("Container creation intent changed")
        if (not isinstance(self.plan, ContainerPlan)
                or json.dumps(intent.get("plan"), sort_keys=True, allow_nan=False)
                != json.dumps(asdict(self.plan), sort_keys=True, allow_nan=False)):
            raise ValueError("Container live plan differs from retained intent")
        return intent

    def begin_create(self):
        if self.requested:
            raise ValueError("Container create request already reserved; reconcile its result")
        self.verify_intent()
        self._write("create-requested.json", {"schema": "openplan.container-create-request.v1",
            "intent_sha256": self.intent_hash, "request_id": self.plan.request_id})
        self.requested = True

    def record_created(self, daemon_id: str, observed: dict):
        if not self.requested or self.recorded:
            raise ValueError("One reserved container create request required")
        self.verify_intent()
        request, _ = read_record(self.directory, "create-requested.json")
        if request != {"schema": "openplan.container-create-request.v1", "intent_sha256": self.intent_hash,
                       "request_id": self.plan.request_id}:
            raise ValueError("Container create reservation changed")
        identity = verify_created_container(self.plan, daemon_id, observed)
        self.created_hash = self._write("created.json", {"schema": "openplan.container-created-record.v1",
            "intent_sha256": self.intent_hash, "identity": identity})
        self.recorded = True
        return identity

    def observe_bootstrap(self, daemon_id: str, observed: dict):
        """Bind a running observation to this live object's verified creation."""
        if not self.recorded or self.created_hash is None:
            raise ValueError("A live verified creation is required")
        self.verify_intent()
        record, digest = read_record(self.directory, "created.json")
        if digest != self.created_hash or record.get("intent_sha256") != self.intent_hash:
            raise ValueError("Verified creation record changed")
        identity = record["identity"]
        result = verify_bootstrap_container(self.plan, daemon_id, observed, identity["container_id"])
        if result["policy_sha256"] != identity["policy_sha256"]:
            raise ValueError("Bootstrap policy differs from verified creation")
        return result

    def close(self):
        if self.directory is not None:
            os.close(self.directory)
            self.directory = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
