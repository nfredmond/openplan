"""Inspect a retained ActivitySim host scope without signaling or resuming work."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

SHARED_WORKER = str(Path(__file__).resolve().parent.parent / "aequilibrae_worker")
if SHARED_WORKER not in sys.path:
    sys.path.append(SHARED_WORKER)

from model_engine_recovery import read_record
from model_engine_supervision import inspect_saved_scope, SupervisionUnavailable
from model_owner_guard_recovery import inspect_guard, validate_guard
from model_receipt_values import same_json_value


def inspect_host(records: Path) -> dict:
    directory = os.open(records, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError("Host records directory must be private and owned by this user")
        launch, launch_hash = read_record(directory, "launch-reserved.json")
        if (set(launch) != {"schema", "command_sha256", "owner_guard", "scope_unit", "scientific_acceptance"}
                or launch["schema"] != "openplan.activitysim-host-command.v1"
                or not isinstance(launch["command_sha256"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", launch["command_sha256"])
                or launch["scientific_acceptance"] != "unassessed"):
            raise ValueError("Invalid ActivitySim host launch record")
        validate_guard(launch["owner_guard"])
        if not isinstance(launch["scope_unit"], str) or not re.fullmatch(r"openplan-engine-[0-9a-f]{32}\.scope", launch["scope_unit"]):
            raise ValueError("Invalid ActivitySim host scope unit")
        hashes = {"launch-reserved.json": launch_hash}
        result = {"model_resumed": False, "signal_sent": False, "continuation_authorized": False,
                  "database_status_changed": False, "server_ownership_checked": False,
                  "termination_cause": "unconfirmed", "scientific_acceptance": "unassessed"}
        started, start_hash = read_record(directory, "scope-started.json", optional=True)
        if started is None:
            return {**result, "outcome": "scope_startup_unconfirmed", "record_sha256": hashes}
        hashes["scope-started.json"] = start_hash
        if not same_json_value({k: v for k, v in started.items() if k != "scope"}, launch):
            raise ValueError("Host startup differs from launch")
        scope = started.get("scope")
        if (not isinstance(scope, dict) or scope.get("unit") != launch["scope_unit"]
                or scope.get("boot_id") != launch["owner_guard"]["boot_id"]):
            raise ValueError("Host scope identity differs from launch")
        exit_record, exit_hash = read_record(directory, "observed-exit.json", optional=True)
        if exit_record is not None:
            hashes["observed-exit.json"] = exit_hash
            header = {k: v for k, v in exit_record.items() if k not in {"scope", "returncode", "database_status_changed"}}
            saved_scope = exit_record.get("scope")
            if (not same_json_value(header, launch) or type(exit_record.get("returncode")) is not int
                    or exit_record.get("database_status_changed") is not False
                    or not isinstance(saved_scope, dict) or saved_scope.get("observed_scope_empty") is not True
                    or not same_json_value({k: saved_scope.get(k) for k in scope}, scope)):
                raise ValueError("Host exit differs from startup")
        observation = inspect_saved_scope(scope)
        guard = inspect_guard(launch["owner_guard"])
        # Detect changed files during the two live observations. These reads do
        # not make process state atomic or grant authority to a saved identity.
        for name, expected in hashes.items():
            _, current = read_record(directory, name)
            if current != expected:
                raise ValueError("Host custody changed during inspection")
        return {**result, **observation, "owner_guard": guard,
                "completion_record_present": exit_record is not None,
                "reported_returncode": exit_record.get("returncode") if exit_record else None,
                "record_sha256": hashes}
    finally:
        os.close(directory)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = inspect_host(args.records)
    except (ValueError, TypeError, KeyError, OSError, SupervisionUnavailable, subprocess.TimeoutExpired):
        print(json.dumps({"outcome": "host_inspection_refused", "model_resumed": False,
                          "signal_sent": False, "continuation_authorized": False}))
        return 3
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
