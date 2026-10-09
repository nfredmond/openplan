"""Supervise host commands only; container daemon workloads need separate custody."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import BinaryIO

SHARED_WORKER = str(Path(__file__).resolve().parent.parent / "aequilibrae_worker")
if SHARED_WORKER not in sys.path:
    sys.path.append(SHARED_WORKER)

from model_engine_owner_guard import OwnerGuard
from model_engine_supervision import OwnedEngineScope, ScopeLimits, ScopeStillPopulated


def run_host_command(command: list[str], *, cwd: Path, log: BinaryIO,
                     records: Path, memory_bytes: int, tasks: int) -> subprocess.CompletedProcess:
    """Retain launch identity before releasing a guarded host command."""
    limits = ScopeLimits(memory_bytes, tasks)
    records.mkdir(mode=0o700)
    directory = os.open(records, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    guard = scope = process = None

    def record(name: str, payload: dict) -> None:
        descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(payload, stream, sort_keys=True, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(directory)

    try:
        guard = OwnerGuard()
        scope = OwnedEngineScope(limits, owner_guard=guard)
        identity = {
            "schema": "openplan.activitysim-host-command.v1",
            "command_sha256": hashlib.sha256(json.dumps(command, separators=(",", ":")).encode()).hexdigest(),
            "owner_guard": guard.identity,
            "scope_unit": scope.unit,
            "scientific_acceptance": "unassessed",
        }
        record("launch-reserved.json", identity)
        process = subprocess.Popen(scope.command(command), cwd=cwd, stdout=log,
                                   stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                   start_new_session=True, pass_fds=(scope.child.fileno(),))
        identity["scope"] = scope.verify_start(process.pid)
        record("scope-started.json", identity)
        scope.authorize()
        code = process.wait()
        # A detached descendant can outlive the command's original process.
        # Completion requires the whole owned scope to be empty.
        while True:
            guard.require_alive()
            try:
                empty = scope.require_empty()
                break
            except ScopeStillPopulated:
                time.sleep(0.05)
        record("observed-exit.json", {**identity, "scope": empty, "returncode": code,
                                      "database_status_changed": False})
        return subprocess.CompletedProcess(command, code)
    finally:
        try:
            if scope is not None:
                scope.close_gate()
            if guard is not None:
                guard.stop()
            if process is not None:
                process.wait(timeout=10)
        finally:
            os.close(directory)
