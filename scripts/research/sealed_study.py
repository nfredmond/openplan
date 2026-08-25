#!/usr/bin/env python3
"""Run or close one frozen sealed study without weakening its decision."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
from collections.abc import Iterable, Mapping, Sequence
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from streaming_zip_csv import StreamingZipCsvError, selected_uncompressed_bytes


LOCK_SCHEMA_VERSION = "openplan.sealed-study.lock.v1"
RECEIPT_SCHEMA_VERSION = "openplan.sealed-study.receipt.v1"
LEASE_SCHEMA_VERSION = "openplan.sealed-study.lease.v1"
AGGREGATE_SCHEMA_VERSION = "openplan.sealed-study.aggregate-result.v1"
MAX_AGGREGATE_BYTES = 10 * 1024 * 1024
SCRATCH_RESERVE_BYTES = 1024 * 1024 * 1024
DECISIONS = frozenset(("accepted", "rejected", "inconclusive"))


class SealedStudyError(RuntimeError):
    """The sealed study cannot proceed without breaking its frozen contract."""


def sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SealedStudyError(f"{label} must be a JSON object")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise SealedStudyError(f"{label} must be a non-empty string")
    return value


def _string_array(value: Any, label: str) -> list[str]:
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(item, str) and item for item in value)
    ):
        raise SealedStudyError(f"{label} must be a non-empty string array")
    if len(set(value)) != len(value):
        raise SealedStudyError(f"{label} contains duplicates")
    return value


def _exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = expected - actual
        extra = actual - expected
        detail = []
        if missing:
            detail.append("missing " + ", ".join(sorted(missing)))
        if extra:
            detail.append("unexpected " + ", ".join(sorted(extra)))
        raise SealedStudyError(f"{label} fields are invalid: {'; '.join(detail)}")


def _read_json(path: Path, label: str, maximum_bytes: int | None = None) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            payload = handle.read(None if maximum_bytes is None else maximum_bytes + 1)
    except OSError as exc:
        raise SealedStudyError(f"{label} is unreadable") from exc
    if maximum_bytes is not None and len(payload) > maximum_bytes:
        raise SealedStudyError(f"{label} exceeds {maximum_bytes} bytes")

    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite JSON number: {value}")

    try:
        return _object(
            json.loads(payload, parse_constant=reject_constant),
            label,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise SealedStudyError(f"{label} is not valid UTF-8 JSON") from exc


def _resolve(base: Path, value: Any, label: str) -> Path:
    raw = Path(_string(value, label))
    return Path(os.path.abspath(raw if raw.is_absolute() else base / raw))


def _is_within(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
        return True
    except ValueError:
        return False


def _command(value: Any, label: str) -> list[str]:
    command = _string_array(value, label)
    if any("{" in argument or "}" in argument for argument in command):
        raise SealedStudyError(f"{label} must contain exact arguments, not placeholders")
    return command


def _validate_lock_shape(lock: dict[str, Any], lock_path: Path) -> dict[str, Any]:
    expected = {
        "schema_version",
        "study_id",
        "status",
        "working_directory",
        "scratch_directory",
        "lease_path",
        "receipt_path",
        "candidate_result_path",
        "aggregate_result_path",
        "candidate_result_schema_version",
        "evaluator",
        "validator",
        "sources",
        "output_policy",
    }
    _exact_keys(lock, expected, "lock")
    if lock.get("schema_version") != LOCK_SCHEMA_VERSION:
        raise SealedStudyError("lock schema version is unsupported")
    _string(lock.get("study_id"), "study_id")
    if lock.get("status") != "frozen_unopened":
        raise SealedStudyError("lock status must be frozen_unopened")
    _string(lock.get("candidate_result_schema_version"), "candidate result schema version")

    base = lock_path.parent.resolve()
    working_directory = _resolve(base, lock.get("working_directory"), "working_directory")
    scratch_directory = _resolve(base, lock.get("scratch_directory"), "scratch_directory")
    lease_path = _resolve(base, lock.get("lease_path"), "lease_path")
    receipt_path = _resolve(base, lock.get("receipt_path"), "receipt_path")
    candidate_path = _resolve(base, lock.get("candidate_result_path"), "candidate_result_path")
    aggregate_path = _resolve(base, lock.get("aggregate_result_path"), "aggregate_result_path")
    if not working_directory.is_dir():
        raise SealedStudyError("working_directory does not exist")
    if not scratch_directory.is_dir():
        raise SealedStudyError("scratch_directory does not exist")
    if not _is_within(candidate_path, scratch_directory) or candidate_path == scratch_directory:
        raise SealedStudyError("candidate_result_path must be inside scratch_directory")

    path_roles = {
        "lock": lock_path.resolve(),
        "lease": lease_path,
        "receipt": receipt_path,
        "candidate result": candidate_path,
        "aggregate result": aggregate_path,
    }
    if len(set(path_roles.values())) != len(path_roles):
        raise SealedStudyError("lock and result paths must all be distinct")

    evaluator = _object(lock.get("evaluator"), "evaluator")
    _exact_keys(evaluator, {"command", "files", "closure_sha256"}, "evaluator")
    validator = _object(lock.get("validator"), "validator")
    _exact_keys(validator, {"command", "files", "closure_sha256"}, "validator")
    _command(evaluator.get("command"), "evaluator command")
    _command(validator.get("command"), "validator command")

    known_paths = set(path_roles.values())
    for label, closure in (("evaluator", evaluator), ("validator", validator)):
        files = closure.get("files")
        if not isinstance(files, list) or not files:
            raise SealedStudyError(f"{label} files must be a non-empty array")
        for index, raw_file in enumerate(files):
            entry = _object(raw_file, f"{label} file {index}")
            _exact_keys(entry, {"path", "sha256"}, f"{label} file {index}")
            path = _resolve(base, entry.get("path"), f"{label} file path")
            _string(entry.get("sha256"), f"{label} file sha256")
            if path in known_paths:
                raise SealedStudyError(f"{label} file overlaps a control or result path")
            known_paths.add(path)
        _string(closure.get("closure_sha256"), f"{label} closure_sha256")

    sources = lock.get("sources")
    if not isinstance(sources, list) or not sources:
        raise SealedStudyError("sources must be a non-empty array")
    source_names: set[str] = set()
    for index, raw_source in enumerate(sources):
        source = _object(raw_source, f"source {index}")
        _exact_keys(source, {"name", "path", "sha256", "selected_members"}, f"source {index}")
        name = _string(source.get("name"), f"source {index} name")
        if name in source_names:
            raise SealedStudyError("source names must be unique")
        source_names.add(name)
        path = _resolve(base, source.get("path"), f"source {index} path")
        if path in known_paths:
            raise SealedStudyError("a source overlaps a control, code, or result path")
        known_paths.add(path)
        _string(source.get("sha256"), f"source {index} sha256")
        _string_array(source.get("selected_members"), f"source {index} selected_members")

    policy = _object(lock.get("output_policy"), "output_policy")
    _exact_keys(
        policy,
        {"maximum_bytes", "prohibited_fields", "prohibited_array_fields"},
        "output_policy",
    )
    if policy.get("maximum_bytes") != MAX_AGGREGATE_BYTES:
        raise SealedStudyError(f"output_policy.maximum_bytes must be {MAX_AGGREGATE_BYTES}")
    _string_array(policy.get("prohibited_fields"), "output_policy.prohibited_fields")
    _string_array(
        policy.get("prohibited_array_fields"), "output_policy.prohibited_array_fields"
    )
    return {
        "base": base,
        "working_directory": working_directory,
        "scratch_directory": scratch_directory,
        "lease_path": lease_path,
        "receipt_path": receipt_path,
        "candidate_path": candidate_path,
        "aggregate_path": aggregate_path,
    }


def load_lock(lock_path: str | Path) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    path = Path(lock_path).resolve()
    lock = _read_json(path, "lock", MAX_AGGREGATE_BYTES)
    resolved = _validate_lock_shape(lock, path)
    return path, lock, resolved


def _verify_closure(
    lock: dict[str, Any], base: Path, name: str
) -> dict[str, str]:
    closure = _object(lock[name], name)
    measured: dict[str, str] = {}
    canonical: list[dict[str, str]] = []
    for raw_entry in closure["files"]:
        entry = _object(raw_entry, f"{name} file")
        path = _resolve(base, entry["path"], f"{name} file path")
        try:
            digest = sha256(path)
        except OSError as exc:
            raise SealedStudyError(f"{name} file is unreadable: {entry['path']}") from exc
        if digest != entry["sha256"]:
            raise SealedStudyError(f"{name} file hash mismatch: {entry['path']}")
        measured[entry["path"]] = digest
        canonical.append({"path": entry["path"], "sha256": digest})
    if canonical_sha256(canonical) != closure["closure_sha256"]:
        raise SealedStudyError(f"{name} closure hash mismatch")
    return measured


def verify_frozen_code(lock: dict[str, Any], resolved: dict[str, Any]) -> dict[str, str]:
    measured = _verify_closure(lock, resolved["base"], "evaluator")
    measured.update(_verify_closure(lock, resolved["base"], "validator"))
    return measured


def verify_sources_and_space(
    lock: dict[str, Any], resolved: dict[str, Any]
) -> tuple[dict[str, str], int, int]:
    source_hashes: dict[str, str] = {}
    selected_bytes = 0
    for source in lock["sources"]:
        path = _resolve(resolved["base"], source["path"], "source path")
        try:
            digest = sha256(path)
        except OSError as exc:
            raise SealedStudyError(f"source is unreadable: {source['name']}") from exc
        if digest != source["sha256"]:
            raise SealedStudyError(f"source hash mismatch: {source['name']}")
        source_hashes[source["name"]] = digest
        try:
            selected_bytes += selected_uncompressed_bytes(path, source["selected_members"])
        except StreamingZipCsvError as exc:
            raise SealedStudyError(f"source member contract failed: {source['name']}") from exc
    required = selected_bytes * 3 + SCRATCH_RESERVE_BYTES
    free = shutil.disk_usage(resolved["scratch_directory"]).free
    if free < required:
        raise SealedStudyError(
            f"scratch space is insufficient: {free} bytes free, {required} required"
        )
    return source_hashes, selected_bytes, required


def _write_fsynced_exclusive(path: Path, value: Mapping[str, Any]) -> None:
    rendered = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            os.fchmod(handle.fileno(), 0o644)
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary_path, path)
        except FileExistsError as exc:
            raise SealedStudyError(f"exclusive artifact already exists: {path}") from exc
        directory_descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


@contextmanager
def host_lease(path: Path, study_id: str, lock_digest: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise SealedStudyError("lease_path must not be a symbolic link")
    handle = path.open("a+b")
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SealedStudyError("another process holds the host lease") from exc
        lease = {
            "schema_version": LEASE_SCHEMA_VERSION,
            "study_id": study_id,
            "lock_sha256": lock_digest,
            "host": socket.gethostname(),
            "pid": os.getpid(),
            "acquired_at": _now(),
        }
        payload = (json.dumps(lease, indent=2, sort_keys=True) + "\n").encode("utf-8")
        handle.seek(0)
        handle.truncate()
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
        yield handle
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _empty_output_preflight(resolved: dict[str, Any]) -> None:
    for name in ("receipt_path", "candidate_path", "aggregate_path"):
        path = resolved[name]
        if path.exists() or path.is_symlink():
            raise SealedStudyError(f"{name} must not already exist")


def _stream_facts(handle: BinaryIO) -> dict[str, Any]:
    handle.flush()
    handle.seek(0)
    digest = hashlib.sha256()
    count = 0
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        count += len(chunk)
        digest.update(chunk)
    return {"bytes": count, "sha256": digest.hexdigest()}


def _wait_for_child(process: subprocess.Popen[bytes]) -> tuple[dict[str, int | None], int]:
    pid, wait_status, usage = os.wait4(process.pid, 0)
    if pid != process.pid:
        raise SealedStudyError("wait4 returned the wrong evaluator process")
    if os.WIFEXITED(wait_status):
        exit_status: int | None = os.WEXITSTATUS(wait_status)
        signal: int | None = None
        process.returncode = exit_status
    elif os.WIFSIGNALED(wait_status):
        exit_status = None
        signal = os.WTERMSIG(wait_status)
        process.returncode = -signal
    else:
        exit_status = None
        signal = None
        process.returncode = wait_status
    peak_rss_bytes = int(usage.ru_maxrss) * 1024
    return {"exit_status": exit_status, "signal": signal}, peak_rss_bytes


def _run_command(
    command: Sequence[str], cwd: Path, lease_fd: int
) -> tuple[dict[str, Any], BinaryIO, BinaryIO]:
    stdout = tempfile.TemporaryFile()
    stderr = tempfile.TemporaryFile()
    try:
        process = subprocess.Popen(
            list(command),
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            pass_fds=(lease_fd,),
            start_new_session=True,
        )
    except BaseException:
        stdout.close()
        stderr.close()
        raise
    status, peak_rss_bytes = _wait_for_child(process)
    facts = {
        **status,
        "peak_rss_bytes": peak_rss_bytes,
        "stdout": _stream_facts(stdout),
        "stderr": _stream_facts(stderr),
    }
    return facts, stdout, stderr


def _close_ephemeral(*handles: BinaryIO) -> None:
    for handle in handles:
        handle.close()


def _prohibited_output(value: Any, policy: Mapping[str, Any], path: str = "$") -> None:
    prohibited = {field.casefold() for field in policy["prohibited_fields"]}
    prohibited_arrays = {field.casefold() for field in policy["prohibited_array_fields"]}
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = key.casefold()
            if normalized in prohibited:
                raise SealedStudyError(
                    f"candidate result contains prohibited field at {path}.{key}"
                )
            if normalized in prohibited_arrays and isinstance(nested, list):
                raise SealedStudyError(
                    f"candidate result contains prohibited array at {path}.{key}"
                )
            _prohibited_output(nested, policy, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _prohibited_output(nested, policy, f"{path}[{index}]")


def _candidate_result(lock: dict[str, Any], path: Path) -> tuple[dict[str, Any], str, int]:
    try:
        before = path.lstat()
    except OSError as exc:
        raise SealedStudyError("candidate result is missing") from exc
    if not stat.S_ISREG(before.st_mode) or path.is_symlink():
        raise SealedStudyError("candidate result must be a regular file, not a link")
    result = _read_json(path, "candidate result", MAX_AGGREGATE_BYTES)
    if result.get("schema_version") != lock["candidate_result_schema_version"]:
        raise SealedStudyError("candidate result schema version differs from the lock")
    if result.get("study_id") != lock["study_id"]:
        raise SealedStudyError("candidate result study_id differs from the lock")
    if result.get("decision") not in DECISIONS:
        raise SealedStudyError("candidate result decision is invalid")
    _prohibited_output(result, lock["output_policy"])
    raw = path.read_bytes()
    after = path.lstat()
    if (before.st_dev, before.st_ino, before.st_size) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
    ):
        raise SealedStudyError("candidate result changed while it was being read")
    return result, hashlib.sha256(raw).hexdigest(), len(raw)


def _execution_facts(
    evaluator: Mapping[str, Any],
    receipt_path: Path,
    candidate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    facts = {
        "evaluator": dict(evaluator),
        "receipt_sha256": sha256(receipt_path),
    }
    if candidate:
        facts["candidate_result"] = dict(candidate)
    return facts


def _publish_inconclusive(
    lock: dict[str, Any],
    resolved: dict[str, Any],
    evaluator_facts: Mapping[str, Any],
    kind: str,
    reason: str,
) -> dict[str, Any]:
    result = {
        "schema_version": AGGREGATE_SCHEMA_VERSION,
        "study_id": lock["study_id"],
        "status": "evaluated_once_inconclusive",
        "decision": "inconclusive",
        "inconclusive_error_kind": kind,
        "inconclusive_reason": reason,
        "execution": _execution_facts(evaluator_facts, resolved["receipt_path"]),
        "recorded_at": _now(),
    }
    _write_fsynced_exclusive(resolved["aggregate_path"], result)
    return result


def _remove_candidate(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        raise SealedStudyError("scratch candidate result could not be removed") from exc


def run(lock_path: str | Path) -> dict[str, Any]:
    path, lock, resolved = load_lock(lock_path)
    lock_digest = sha256(path)
    with host_lease(resolved["lease_path"], lock["study_id"], lock_digest) as lease:
        _empty_output_preflight(resolved)
        code_hashes = verify_frozen_code(lock, resolved)
        source_hashes, selected_bytes, required_scratch = verify_sources_and_space(lock, resolved)
        receipt = {
            "schema_version": RECEIPT_SCHEMA_VERSION,
            "study_id": lock["study_id"],
            "status": "source_consumed_before_first_selected_member_read",
            "lock_sha256": lock_digest,
            "source_sha256": source_hashes,
            "selected_members_uncompressed_bytes": selected_bytes,
            "required_scratch_bytes": required_scratch,
            "written_at": _now(),
        }
        _write_fsynced_exclusive(resolved["receipt_path"], receipt)

        evaluator_command = _command(lock["evaluator"]["command"], "evaluator command")
        try:
            evaluator_facts, stdout, stderr = _run_command(
                evaluator_command, resolved["working_directory"], lease.fileno()
            )
        except OSError:
            evaluator_facts = {
                "exit_status": None,
                "signal": None,
                "peak_rss_bytes": 0,
                "stdout": {"bytes": 0, "sha256": hashlib.sha256(b"").hexdigest()},
                "stderr": {"bytes": 0, "sha256": hashlib.sha256(b"").hexdigest()},
            }
            return _publish_inconclusive(
                lock,
                resolved,
                evaluator_facts,
                "EvaluatorLaunchFailed",
                "The frozen evaluator could not be launched after receipt creation.",
            )
        try:
            if evaluator_facts["exit_status"] != 0 or evaluator_facts["signal"] is not None:
                _remove_candidate(resolved["candidate_path"])
                return _publish_inconclusive(
                    lock,
                    resolved,
                    evaluator_facts,
                    "EvaluatorProcessFailed",
                    "The frozen evaluator exited unsuccessfully after receipt creation.",
                )
            try:
                candidate, candidate_digest, candidate_bytes = _candidate_result(
                    lock, resolved["candidate_path"]
                )
                before_validation = (candidate_digest, candidate_bytes)
                validator_facts, validator_stdout, validator_stderr = _run_command(
                    _command(lock["validator"]["command"], "validator command"),
                    resolved["working_directory"],
                    lease.fileno(),
                )
                _close_ephemeral(validator_stdout, validator_stderr)
                if validator_facts["exit_status"] != 0 or validator_facts["signal"] is not None:
                    raise SealedStudyError("the frozen validator rejected the candidate result")
                after_validation = (
                    sha256(resolved["candidate_path"]),
                    resolved["candidate_path"].stat().st_size,
                )
                if after_validation != before_validation:
                    raise SealedStudyError("the frozen validator changed the candidate result")
            except (OSError, SealedStudyError):
                _remove_candidate(resolved["candidate_path"])
                return _publish_inconclusive(
                    lock,
                    resolved,
                    evaluator_facts,
                    "InvalidEvaluatorResult",
                    "The evaluator result was missing, oversized, invalid, private, "
                    "or rejected by its frozen validator.",
                )

            _remove_candidate(resolved["candidate_path"])
            result = {
                "schema_version": AGGREGATE_SCHEMA_VERSION,
                "study_id": lock["study_id"],
                "status": "evaluated_once",
                "decision": candidate["decision"],
                "evaluator_result": candidate,
                "execution": _execution_facts(
                    evaluator_facts,
                    resolved["receipt_path"],
                    {"bytes": candidate_bytes, "sha256": candidate_digest},
                ),
                "evidence": {
                    "lock_sha256": lock_digest,
                    "code_sha256": code_hashes,
                    "source_sha256": source_hashes,
                },
                "recorded_at": _now(),
            }
            _write_fsynced_exclusive(resolved["aggregate_path"], result)
            return result
        finally:
            _close_ephemeral(stdout, stderr)


def _verified_receipt(
    lock: dict[str, Any], resolved: dict[str, Any], lock_digest: str
) -> dict[str, Any]:
    receipt = _read_json(resolved["receipt_path"], "receipt", MAX_AGGREGATE_BYTES)
    expected = {
        "schema_version",
        "study_id",
        "status",
        "lock_sha256",
        "source_sha256",
        "selected_members_uncompressed_bytes",
        "required_scratch_bytes",
        "written_at",
    }
    _exact_keys(receipt, expected, "receipt")
    if receipt.get("schema_version") != RECEIPT_SCHEMA_VERSION:
        raise SealedStudyError("receipt schema version is unsupported")
    if receipt.get("study_id") != lock["study_id"] or receipt.get("lock_sha256") != lock_digest:
        raise SealedStudyError("receipt does not belong to this lock")
    if receipt.get("status") != "source_consumed_before_first_selected_member_read":
        raise SealedStudyError("receipt does not record source consumption")
    expected_sources = {source["name"]: source["sha256"] for source in lock["sources"]}
    if receipt.get("source_sha256") != expected_sources:
        raise SealedStudyError("receipt source hashes differ from the lock")
    return receipt


def finalize_interrupted(lock_path: str | Path) -> dict[str, Any]:
    path, lock, resolved = load_lock(lock_path)
    lock_digest = sha256(path)
    with host_lease(resolved["lease_path"], lock["study_id"], lock_digest):
        if resolved["aggregate_path"].exists() or resolved["aggregate_path"].is_symlink():
            raise SealedStudyError("aggregate result already exists")
        verify_frozen_code(lock, resolved)
        _verified_receipt(lock, resolved, lock_digest)
        _remove_candidate(resolved["candidate_path"])
        evaluator_facts = {
            "exit_status": None,
            "signal": None,
            "peak_rss_bytes": None,
            "stdout": {"bytes": None, "sha256": None},
            "stderr": {"bytes": None, "sha256": None},
        }
        return _publish_inconclusive(
            lock,
            resolved,
            evaluator_facts,
            "RunnerInterruptedAfterReceipt",
            "The runner ended after the durable receipt and before one aggregate "
            "result was committed. Recovery did not invoke the evaluator or open "
            "any source archive.",
        )


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run_parser = commands.add_parser("run", help="consume and evaluate one frozen study")
    run_parser.add_argument("lock")
    finalize_parser = commands.add_parser(
        "finalize-interrupted", help="close a consumed study after its runner died"
    )
    finalize_parser.add_argument("lock")
    args = parser.parse_args(argv)
    try:
        result = run(args.lock) if args.command == "run" else finalize_interrupted(args.lock)
    except SealedStudyError as exc:
        print(f"sealed study refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
