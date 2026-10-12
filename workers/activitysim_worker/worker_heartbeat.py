"""Best-effort deployment heartbeat for a long-running modeling worker."""
from __future__ import annotations

import os
import socket
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests

HEARTBEAT_INTERVAL_SECONDS = 30

# A scan stops here and says so rather than stalling the heartbeat thread.
OUTPUT_SCAN_FILE_LIMIT = 200_000


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat()


class OutputGrowth:
    """When the files under one directory last changed, separate from liveness.

    A heartbeat proves the process answers; it does not prove the model is
    advancing. This records the file count, total bytes and newest modification
    time under `root`, and when any of them last changed, so a status can say
    "no new output for N minutes". Some model steps compute for a long time
    without writing. Silence is a reason to look, never a reason to stop a run.
    """

    def __init__(self, root: str, *, source: str = "run_output_files", clock=time.time) -> None:
        self._root = root
        self._source = source
        self._clock = clock
        self._lock = threading.Lock()
        self._signature: tuple[int, int, float] | None = None
        self._changed_at: float | None = None

    def _scan(self) -> tuple[int, int, float, bool] | None:
        if not os.path.isdir(self._root):
            return None
        count = size = 0
        newest = 0.0
        for directory, _subdirectories, names in os.walk(self._root):
            for name in names:
                try:
                    stat = os.lstat(os.path.join(directory, name))
                except OSError:
                    continue  # removed during the scan
                count += 1
                size += stat.st_size
                newest = max(newest, stat.st_mtime)
                if count >= OUTPUT_SCAN_FILE_LIMIT:
                    return count, size, newest, True
        return count, size, newest, False

    def observe(self) -> dict[str, Any]:
        with self._lock:
            now = self._clock()
            try:
                scanned = self._scan()
            except OSError:
                scanned = None
            if scanned is None:
                return {"source": self._source, "observedAt": _iso(now), "available": False}
            count, size, newest, truncated = scanned
            signature = (count, size, newest)
            if signature != self._signature:
                self._signature = signature
                self._changed_at = now
            return {
                "source": self._source,
                "available": True,
                "observedAt": _iso(now),
                "lastChangeAt": _iso(self._changed_at),
                "secondsWithoutChange": max(0, int(now - self._changed_at)),
                "fileCount": count,
                "totalBytes": size,
                "newestModifiedAt": _iso(newest) if count else None,
                "truncated": truncated,
            }


class WorkerHeartbeat:
    """Emit independently of stage execution; failure never stops model work."""

    def __init__(
        self,
        *,
        supabase_url: str,
        service_key: str,
        worker_kind: str,
        supported_stages: tuple[str, ...],
        runtime_mode: str,
    ) -> None:
        self._url = f"{supabase_url}/rest/v1/modeling_worker_heartbeats?on_conflict=worker_kind,instance_id"
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        self._worker_kind = worker_kind
        self._supported_stages = list(supported_stages)
        self._runtime_mode = runtime_mode
        self._version = os.getenv("OPENPLAN_COMMIT_SHA", "unrecorded").strip() or "unrecorded"
        self._started_at = _utc_now()
        self._instance_id = os.getenv("OPENPLAN_WORKER_INSTANCE_ID", "").strip() or (
            f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        )
        self._current_work: dict[str, Any] | None = None
        self._progress: OutputGrowth | None = None
        self._lock = threading.Lock()

    def set_current_work(self, work: dict[str, Any] | None, progress: OutputGrowth | None = None) -> None:
        """Name the held stage. Each emit renews it; `progress` adds output growth."""
        with self._lock:
            self._current_work = dict(work) if work else None
            self._progress = progress if work else None

    def emit_once(self) -> bool:
        with self._lock:
            current_work = dict(self._current_work) if self._current_work else None
            progress = self._progress
        if current_work is not None and progress is not None:
            try:
                current_work["progress"] = progress.observe()
            except Exception as exc:  # noqa: BLE001 - observation never blocks renewal
                current_work["progress"] = {"available": False, "error": type(exc).__name__}
        observed_at = _utc_now()
        payload = {
            "worker_kind": self._worker_kind,
            "instance_id": self._instance_id,
            "supported_stages": self._supported_stages,
            "runtime_mode": self._runtime_mode,
            "worker_version": self._version,
            "current_work": current_work,
            "started_at": self._started_at,
            "last_successful_heartbeat_at": observed_at,
        }
        try:
            response = requests.post(self._url, headers=self._headers, json=payload, timeout=15)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            print(f"Worker heartbeat unavailable; model work continues: {exc}")
            return False

    def start(self) -> None:
        def loop() -> None:
            while True:
                self.emit_once()
                time.sleep(HEARTBEAT_INTERVAL_SECONDS)

        threading.Thread(target=loop, name=f"{self._worker_kind}-heartbeat", daemon=True).start()
