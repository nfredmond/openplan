"""Stage leases, lapsed-lease reconciliation and shutdown records for poll workers.

KI-2026-10-12-018. A worker process that died mid-stage (a deploy, an
out-of-memory kill, a lost acknowledgement) left its stage "running" forever:
the claim is a one-time queued -> running PATCH, nothing renewed it, and the
reaper (migration 20261016000022) refuses started work by design.

WHERE THE LEASE LIVES. `model_run_stages` has no lease or worker column, and
this change adds no migration. The deployment heartbeat already writes one
`modeling_worker_heartbeats` row per worker process every 30 seconds. After a
CONFIRMED claim, the worker names the stage and its claim time in that row's
`current_work`; every heartbeat renews the lease. A stage's lease has lapsed
when no heartbeat naming it is fresher than LEASE_LAPSE_SECONDS.

WHAT "INTERRUPTED" MEANS HERE. Status stays `running`. The owner or
administrator recovery decision (migration 20261016000023) accepts only
nonterminal work, so writing `failed` or `cancelled` here would strand the run
outside the one recovery path that exists. The interruption is recorded as the
stage's `error_message` (and the run's, when the run has none), which the run
card already shows. Nothing here marks a stage failed, completes it, or starts
it again: `retain_model_stage_execution_start` refuses a second start of the
same stage, and replay from a stage boundary is not built.

Accuracy can justify runs that take days. Nothing here times out a run that
still holds its lease, however long it takes.
"""
from __future__ import annotations

import os
import signal
import sys
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import requests

# 30 missed 30-second heartbeats. Generous on purpose: marking a live stage as
# interrupted is the error this module must not make. A stage that has been
# stuck for days loses nothing to a quarter hour of caution.
LEASE_LAPSE_SECONDS = 15 * 60
RECONCILE_INTERVAL_SECONDS = 5 * 60

# The hosted supervisor allows 20 seconds between SIGTERM and SIGKILL
# (workers/hosted-models/supervise.py). Gate wait plus both writes stay under it.
SHUTDOWN_GATE_WAIT_SECONDS = 4
SHUTDOWN_WRITE_TIMEOUT_SECONDS = 5

# PostgREST caps responses (1000 rows by default). A read that fills this
# limit cannot prove it saw every lease, so it refuses to mark anything.
MAX_ROWS = 500

# Every legacy stage or run status write in a worker process passes through
# this gate. A shutdown record takes it and never releases it, so no write from
# this process can land after the interruption is recorded.
STATE_WRITE_GATE = threading.Lock()


class LeaseRecordUnconfirmed(RuntimeError):
    """A lease read or interruption record has no valid acknowledgement."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _readable(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _canonical_uuid(value: Any) -> str:
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("Model identity must be a canonical UUID")
    return value


def lease_work(stage: dict, claimed_at: str) -> dict:
    """The heartbeat `current_work` that holds a confirmed claim."""
    return {
        "runId": stage["run_id"],
        "stageId": stage["id"],
        "stageName": stage["stage_name"],
        "claimedAt": claimed_at,
        "lease": "held",
    }


def interruption_message(reason: str, *, at: datetime, last_seen: datetime | None = None,
                         started_at: datetime | None = None) -> str:
    """Planner-facing text. States what is known; never guesses a cause."""
    if reason == "shutdown":
        cause = (f"the model worker shut down at {_readable(at)} (for example, during a deployment) "
                 "before this stage finished.")
    elif reason == "lease_lapsed":
        since = last_seen or started_at
        cause = (f"no model worker has held this stage since {_readable(since)}." if since
                 else "no model worker holds this stage.")
        cause += " The worker may have stopped, restarted or lost contact with the database."
    else:
        raise ValueError(f"Unknown interruption reason: {reason}")
    return (f"Interrupted: {cause} This stage did not finish. Saved records are kept. "
            "To continue, an owner or administrator can close this run under Review execution "
            "recovery, then start a new run.")


def run_interruption_message(stage_name: str) -> str:
    return (f"Interrupted during {stage_name}. This run did not finish. See the stage for details; "
            "an owner or administrator can close it under Review execution recovery.")


def lapsed_stages(stages: list[dict], heartbeats: list[dict], *, now: datetime,
                  lapse_seconds: int = LEASE_LAPSE_SECONDS) -> list[tuple[dict, datetime | None]]:
    """Running stages that no live worker holds, with the last time one did.

    A stage qualifies only when its claim is older than the lapse window AND no
    heartbeat naming it is fresher than that window. A heartbeat naming the
    stage with an unreadable time counts as live: doubt protects the stage.
    """
    live: set[str] = set()
    last_seen: dict[str, datetime] = {}
    for row in heartbeats:
        work = row.get("current_work") if isinstance(row, dict) else None
        stage_id = work.get("stageId") if isinstance(work, dict) else None
        if not isinstance(stage_id, str):
            continue
        seen = parse_time(row.get("last_successful_heartbeat_at"))
        if seen is None or (now - seen).total_seconds() <= lapse_seconds:
            live.add(stage_id)
        elif stage_id not in last_seen or seen > last_seen[stage_id]:
            last_seen[stage_id] = seen
    result = []
    for stage in stages:
        if not isinstance(stage, dict) or stage.get("status") != "running" or stage.get("error_message"):
            continue
        started = parse_time(stage.get("started_at"))
        if started is None or (now - started).total_seconds() <= lapse_seconds:
            continue
        if stage.get("id") in live:
            continue
        result.append((stage, last_seen.get(stage.get("id"))))
    return result


def _read_list(response) -> list:
    if response.status_code != 200:
        raise LeaseRecordUnconfirmed(f"Lease read failed (HTTP {response.status_code})")
    rows = response.json()
    if not isinstance(rows, list):
        raise LeaseRecordUnconfirmed("Lease read did not return a list")
    if len(rows) >= MAX_ROWS:
        raise LeaseRecordUnconfirmed("Lease read reached its row limit; it cannot prove completeness")
    return rows


def _conditional_note(http, url: str, headers: dict, record_id: str, message: str, timeout: float) -> bool:
    """One conditional PATCH. False when the row no longer matches the condition."""
    try:
        response = http.patch(url, headers=headers, json={"error_message": message}, timeout=timeout)
        if response.status_code != 200:
            raise LeaseRecordUnconfirmed(f"Interruption record unconfirmed (HTTP {response.status_code})")
        rows = response.json()
    except LeaseRecordUnconfirmed:
        raise
    except (requests.RequestException, ValueError, TypeError) as error:
        raise LeaseRecordUnconfirmed("Interruption record unconfirmed: no valid receipt") from error
    if rows == []:
        return False
    if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict)
            or rows[0].get("id") != record_id or rows[0].get("error_message") != message):
        raise LeaseRecordUnconfirmed("Interruption record unconfirmed: returned row differs")
    return True


def mark_stage_interrupted(*, base_url: str, headers: dict, stage: dict, message: str,
                           http=requests, timeout: float = 30, log: Callable[[str], None] = print) -> bool:
    """Record an interruption on the SAME running claim, never on a later one.

    The PATCH matches the stage id, `running`, no recorded error and the exact
    claim time, so a stage that finished, was abandoned or was relaunched in
    the meantime is left alone (returns False).
    """
    stage_id = _canonical_uuid(stage.get("id"))
    run_id = _canonical_uuid(stage.get("run_id"))
    started_at = stage.get("started_at")
    if parse_time(started_at) is None:
        raise ValueError("An interruption record needs the claim time")
    stage_url = (f"{base_url}/rest/v1/model_run_stages?id=eq.{stage_id}&status=eq.running"
                 f"&error_message=is.null&started_at=eq.{_quote(started_at)}")
    if not _conditional_note(http, stage_url, headers, stage_id, message, timeout):
        return False
    run_url = f"{base_url}/rest/v1/model_runs?id=eq.{run_id}&status=eq.running&error_message=is.null"
    try:
        _conditional_note(http, run_url, headers, run_id,
                          run_interruption_message(str(stage.get("stage_name") or "a stage")), timeout)
    except LeaseRecordUnconfirmed as error:
        # The stage record is the authority; the run line is a convenience.
        log(f"Run-level interruption note unconfirmed for run={run_id}: {error}")
    return True


def reconcile_lapsed_stages(*, base_url: str, headers: dict, stage_filter: str, worker_label: str,
                            now: datetime | None = None, http=requests,
                            log: Callable[[str], None] = print) -> list[str]:
    """Mark this worker kind's running stages whose lease has lapsed. Never raises."""
    now = now or _utc_now()
    cutoff = (now - timedelta(seconds=LEASE_LAPSE_SECONDS)).isoformat()
    try:
        stages = _read_list(http.get(
            f"{base_url}/rest/v1/model_run_stages?status=eq.running&error_message=is.null&{stage_filter}"
            f"&started_at=lt.{_quote(cutoff)}&select=id,run_id,stage_name,status,started_at,error_message"
            f"&order=started_at.asc&limit={MAX_ROWS}",
            headers=headers, timeout=30,
        ))
        if not stages:
            return []
        heartbeats = _read_list(http.get(
            f"{base_url}/rest/v1/modeling_worker_heartbeats?current_work=not.is.null"
            f"&select=worker_kind,instance_id,current_work,last_successful_heartbeat_at&limit={MAX_ROWS}",
            headers=headers, timeout=30,
        ))
    except Exception as error:  # noqa: BLE001 - reconciliation must never stop polling
        log(f"{worker_label}: lease reconciliation skipped; nothing was marked ({type(error).__name__}).")
        return []
    marked = []
    for stage, last_seen in lapsed_stages(stages, heartbeats, now=now):
        identity = f"run={stage.get('run_id')} stage={stage.get('id')} ({stage.get('stage_name')})"
        message = interruption_message("lease_lapsed", at=now, last_seen=last_seen,
                                       started_at=parse_time(stage.get("started_at")))
        try:
            if mark_stage_interrupted(base_url=base_url, headers=headers, stage=stage, message=message,
                                      http=http, log=log):
                marked.append(stage["id"])
                log(f"{worker_label}: lease lapsed; marked interrupted for recovery review: {identity}.")
            else:
                log(f"{worker_label}: {identity} changed before it could be marked; left unchanged.")
        except Exception as error:  # noqa: BLE001
            log(f"{worker_label}: could not record the interruption of {identity} ({type(error).__name__}); "
                "it stays running and remains recoverable.")
    return marked


def attach_stage_identity(error: BaseException, stage: dict) -> None:
    """Carry run and stage identity to the poll loop's report."""
    if getattr(error, "openplan_stage", None) is None:
        try:
            error.openplan_stage = {  # type: ignore[attr-defined]
                "run_id": stage.get("run_id"), "stage_id": stage.get("id"), "stage_name": stage.get("stage_name"),
            }
        except AttributeError:
            pass


def report_unconfirmed_state(error: BaseException, worker_label: str, log: Callable[[str], None] = print) -> None:
    identity = getattr(error, "openplan_stage", None)
    where = (f"run={identity['run_id']} stage={identity['stage_id']} ({identity['stage_name']})"
             if isinstance(identity, dict) else "stage identity unavailable")
    log(f"[{time.strftime('%X')}] UNCONFIRMED STATE WRITE in {worker_label}: {where}: {error}. "
        "This worker stopped work on that stage and left its saved status as it is. If the stage "
        f"is still running with no worker holding it, it is marked interrupted after "
        f"{LEASE_LAPSE_SECONDS // 60} minutes; an owner or administrator can review execution recovery.")


class PollCustody:
    """This process's current stage lease and its poll-mode shutdown record.

    One stage at a time per process (both workers serialize execution), so one
    lease slot is enough.
    """

    def __init__(self, *, base_url: str, headers: dict, heartbeat: Callable[[], Any], worker_label: str,
                 http=requests, exit_process: Callable[[int], None] = os._exit,
                 log: Callable[[str], None] = print, clock: Callable[[], datetime] = _utc_now) -> None:
        self._base_url = base_url
        self._headers = headers
        self._heartbeat = heartbeat
        self._label = worker_label
        self._http = http
        self._exit = exit_process
        self._log = log
        self._clock = clock
        # Reentrant: the signal handler runs on the main thread, which may be
        # inside hold() or release() when the signal arrives.
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._lease: tuple[dict, str] | None = None
        self._recording = False

    def stop_requested(self) -> bool:
        return self._stop.is_set()

    def hold(self, stage: dict, claimed_at: str, progress=None) -> None:
        """Hold a confirmed claim: name it in the heartbeat and renew it at once."""
        heartbeat = self._heartbeat()
        if heartbeat is not None:
            heartbeat.set_current_work(lease_work(stage, claimed_at), progress=progress)
            try:
                heartbeat.emit_once()
            except Exception as error:  # noqa: BLE001 - the scheduled heartbeat retries; work continues
                self._log(f"{self._label}: immediate lease renewal failed ({type(error).__name__}); "
                          "the next heartbeat renews it.")
        with self._lock:
            self._lease = (dict(stage), claimed_at)
            record = self._stop.is_set() and not self._recording
            if record:
                self._recording = True
        if record:
            # Shutdown arrived between the last stop check and this claim.
            self._record_shutdown_and_exit()

    def release(self) -> None:
        with self._lock:
            self._lease = None
        heartbeat = self._heartbeat()
        if heartbeat is not None:
            heartbeat.set_current_work(None)

    def install_signal_handlers(self) -> Callable[[], None]:
        """Poll mode only. Returns a function that restores the previous handlers."""
        previous = {}
        try:
            for signum in (signal.SIGTERM, signal.SIGINT):
                previous[signum] = signal.signal(signum, self._on_signal)
        except ValueError:
            # Not the main thread (the poll thread of AEQ_WORKER_MODE=both); the
            # push listener owns shutdown there.
            pass

        def restore() -> None:
            for signum, handler in previous.items():
                signal.signal(signum, handler)
        return restore

    def _on_signal(self, _signum, _frame) -> None:
        # No printing or network I/O here: the handler interrupts the main
        # thread anywhere, and a reentrant write to stdout raises inside
        # whatever stage code was running. The poll loop and the record thread
        # log instead.
        with self._lock:
            self._stop.set()
            record = self._lease is not None and not self._recording
            if record:
                self._recording = True
        if record:
            threading.Thread(target=self._record_shutdown_and_exit, name="stage-shutdown-record").start()

    def _record_shutdown_and_exit(self) -> None:
        self._log(f"[{time.strftime('%X')}] {self._label}: shutdown requested; recording the held stage.")
        gated = STATE_WRITE_GATE.acquire(timeout=SHUTDOWN_GATE_WAIT_SECONDS)
        try:
            with self._lock:
                lease = self._lease
            if lease is not None:
                stage, claimed_at = lease
                identity = f"run={stage.get('run_id')} stage={stage.get('id')} ({stage.get('stage_name')})"
                try:
                    recorded = mark_stage_interrupted(
                        base_url=self._base_url, headers=self._headers,
                        stage={**stage, "started_at": claimed_at},
                        message=interruption_message("shutdown", at=self._clock()),
                        http=self._http, timeout=SHUTDOWN_WRITE_TIMEOUT_SECONDS, log=self._log,
                    )
                    self._log(f"{self._label}: shutdown recorded as an interruption of {identity}." if recorded
                              else f"{self._label}: {identity} had already left running; nothing recorded.")
                except Exception as error:  # noqa: BLE001
                    self._log(f"{self._label}: could not record the shutdown of {identity} ({type(error).__name__}); "
                              f"it is marked interrupted once its lease lapses.")
        finally:
            sys.stdout.flush()
            try:
                # The write gate stays held: the process ends here.
                self._exit(0)
            finally:
                # Reached only when an injected exit returns (unit tests).
                if gated:
                    STATE_WRITE_GATE.release()
