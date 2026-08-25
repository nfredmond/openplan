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


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
        self._lock = threading.Lock()

    def set_current_work(self, work: dict[str, Any] | None) -> None:
        with self._lock:
            self._current_work = dict(work) if work else None

    def emit_once(self) -> bool:
        with self._lock:
            current_work = dict(self._current_work) if self._current_work else None
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
