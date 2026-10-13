"""Deliver a legacy (non-attempt) KPI or artifact row through a saved request journal.

Shared by the AequilibraE worker (main.py) and the ActivitySim poller
(activitysim_worker/supabase_poll.py), so both engines retain the complete
request before it is sent and a lost acknowledgement leaves a saved request
that `model_command_recovery.py` can reconcile. Identities are derived from the
run, stage and a stable logical name, so a resend of the same request returns
the original receipt instead of inserting a second row.

Each caller converts any exception from here into its own
WorkerStateWriteUnconfirmed; nothing here retries, falls back to a plain
insert, or decides that an unconfirmed write failed.
"""
from pathlib import Path

import model_command_client
import model_legacy_artifact_command
import model_legacy_kpi_command

KPI_INPUT_FIELDS = model_legacy_kpi_command.FIELDS - {"id", "stage_id"}


def deliver_kpi(payload: dict, *, workspace_id: str, stage_id: str, journal_dir, base_url: str,
                deployment_id: str, service_key: str, post) -> dict:
    """Retain and send one KPI row named `<kpi_category>.<kpi_name>` for this stage."""
    if not isinstance(payload, dict) or set(payload) - KPI_INPUT_FIELDS:
        raise ValueError("Unexpected KPI input fields")
    normalized = {"kpi_category": "accessibility", "unit": "", "geometry_ref": None, "breakdown_json": {},
                  **payload, "stage_id": stage_id}
    directory = Path(journal_dir)
    command = model_legacy_kpi_command.prepare(
        directory, workspace_id, normalized,
        name=normalized["kpi_category"] + "." + normalized["kpi_name"],
        base_url=base_url, deployment_id=deployment_id,
    )
    return model_command_client.deliver(directory, command, base_url=base_url,
                                        deployment_id=deployment_id, service_key=service_key, post=post)


def deliver_artifact(payload: dict, *, workspace_id: str, journal_dir, base_url: str, deployment_id: str,
                     service_key: str, post, logical_name: str | None = None) -> dict:
    """Retain and send one artifact row, by explicit id or by stable logical name."""
    if not deployment_id.strip():
        raise ValueError("Artifact recovery deployment identity is missing")
    directory = Path(journal_dir)
    if logical_name is None:
        command = model_legacy_artifact_command.prepare(
            directory, workspace_id, payload, base_url=base_url, deployment_id=deployment_id,
        )
    else:
        command = model_legacy_artifact_command.prepare_named(
            directory, workspace_id, payload, name=logical_name,
            base_url=base_url, deployment_id=deployment_id,
        )
    return model_command_client.deliver(directory, command, base_url=base_url, deployment_id=deployment_id,
                                        service_key=service_key, post=post)
