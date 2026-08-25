#!/usr/bin/env python3
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_DIR = REPO_ROOT / "scripts" / "research"
if str(RESEARCH_DIR) not in sys.path:
    sys.path.insert(0, str(RESEARCH_DIR))

import sealed_study  # noqa: E402


EVALUATOR = r'''#!/usr/bin/env python3
import json
import os
import signal
import sys
import time
import zipfile
from pathlib import Path

mode, source, output, receipt, invocations, delay = sys.argv[1:]
with Path(invocations).open("a") as handle:
    handle.write(f"{os.getpid()}\n")
if not Path(receipt).exists():
    raise SystemExit(91)
with zipfile.ZipFile(source) as archive:
    with archive.open("table.csv") as member:
        member.read(1)
print("row-level stdout must stay ephemeral")
print("row-level stderr must stay ephemeral", file=sys.stderr)
if mode == "nonzero":
    raise SystemExit(7)
if mode == "sigkill":
    os.kill(os.getpid(), signal.SIGKILL)
if mode == "missing":
    raise SystemExit(0)
if mode == "candidate_directory":
    Path(output).mkdir()
    raise SystemExit(0)
if mode == "delay":
    time.sleep(float(delay))
    mode = "accepted"
if mode == "parent_interrupt":
    time.sleep(float(delay))
    mode = "accepted"
result = {
    "schema_version": "synthetic.sealed-study-result.v1",
    "study_id": "synthetic-study",
    "decision": mode if mode in {"accepted", "rejected", "inconclusive"} else "accepted",
    "metric": 3,
}
if mode == "wrong_schema":
    result["schema_version"] = "synthetic.sealed-study-result.v0"
if mode == "private":
    result["Person_ID"] = "not-an-artifact"
if mode == "replicates":
    result["replicate_results"] = [1, 2, 3]
if mode == "oversized":
    result["padding"] = "x" * (10 * 1024 * 1024)
Path(output).write_text(json.dumps(result))
'''


VALIDATOR = r'''#!/usr/bin/env python3
import json
import sys
from pathlib import Path

value = json.loads(Path(sys.argv[1]).read_text())
raise SystemExit(0 if value.get("metric") == 3 else 8)
'''


def file_entry(root: Path, name: str) -> dict[str, str]:
    return {"path": name, "sha256": sealed_study.sha256(root / name)}


def closure(entries: list[dict[str, str]]) -> str:
    return sealed_study.canonical_sha256(entries)


def build_fixture(root: Path, mode: str, delay: float = 0) -> Path:
    (root / "scratch").mkdir()
    (root / "evaluator.py").write_text(EVALUATOR)
    (root / "validator.py").write_text(VALIDATOR)
    with zipfile.ZipFile(root / "source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("table.csv", "id,value\n1,alpha\n2,beta\n")
        archive.writestr("unused.csv", "private\nnot-selected\n")
    evaluator_files = [file_entry(root, "evaluator.py")]
    validator_files = [file_entry(root, "validator.py")]
    lock = {
        "schema_version": sealed_study.LOCK_SCHEMA_VERSION,
        "study_id": "synthetic-study",
        "status": "frozen_unopened",
        "working_directory": ".",
        "scratch_directory": "scratch",
        "lease_path": "study.lease.json",
        "receipt_path": "receipt.json",
        "candidate_result_path": "scratch/candidate.json",
        "aggregate_result_path": "aggregate.json",
        "candidate_result_schema_version": "synthetic.sealed-study-result.v1",
        "evaluator": {
            "command": [
                sys.executable,
                "evaluator.py",
                mode,
                "source.zip",
                "scratch/candidate.json",
                "receipt.json",
                "invocations.txt",
                str(delay),
            ],
            "files": evaluator_files,
            "closure_sha256": closure(evaluator_files),
        },
        "validator": {
            "command": [sys.executable, "validator.py", "scratch/candidate.json"],
            "files": validator_files,
            "closure_sha256": closure(validator_files),
        },
        "sources": [
            {
                "name": "synthetic",
                "path": "source.zip",
                "sha256": sealed_study.sha256(root / "source.zip"),
                "selected_members": ["table.csv"],
            }
        ],
        "output_policy": {
            "maximum_bytes": sealed_study.MAX_AGGREGATE_BYTES,
            "prohibited_fields": ["person_id", "household_id", "trip_id"],
            "prohibited_array_fields": ["replicates", "replicate_results"],
        },
    }
    path = root / "lock.json"
    path.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")
    return path


def load(path: Path) -> dict:
    return json.loads(path.read_text())


class SealedStudyRunnerTests(unittest.TestCase):
    def test_published_json_contract_ids_match_the_runner(self) -> None:
        expected = {
            "sealed-study-lock-v1.schema.json": sealed_study.LOCK_SCHEMA_VERSION,
            "sealed-study-receipt-v1.schema.json": sealed_study.RECEIPT_SCHEMA_VERSION,
            "sealed-study-lease-v1.schema.json": sealed_study.LEASE_SCHEMA_VERSION,
            "sealed-study-aggregate-result-v1.schema.json": sealed_study.AGGREGATE_SCHEMA_VERSION,
        }
        for filename, schema_id in expected.items():
            schema = load(REPO_ROOT / "schemas" / "research" / filename)
            self.assertEqual(schema["$id"], schema_id)

    def test_evaluator_owns_accepted_rejected_and_inconclusive_decisions(self) -> None:
        for decision in ("accepted", "rejected", "inconclusive"):
            with self.subTest(decision=decision), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result = sealed_study.run(build_fixture(root, decision))
                self.assertEqual(result["decision"], decision)
                self.assertEqual(result["evaluator_result"]["decision"], decision)
                self.assertEqual(result["status"], "evaluated_once")
                self.assertFalse((root / "scratch/candidate.json").exists())

    def test_receipt_and_aggregate_are_fsynced_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_path = build_fixture(root, "accepted")
            real_fsync = os.fsync
            real_popen = subprocess.Popen
            fsynced: list[str] = []

            def recording_fsync(descriptor: int) -> None:
                try:
                    fsynced.append(Path(os.readlink(f"/proc/self/fd/{descriptor}")).name)
                except OSError:
                    fsynced.append("directory")
                real_fsync(descriptor)

            def evaluator_after_receipt(*args, **kwargs):
                self.assertTrue((root / "receipt.json").is_file())
                self.assertTrue(any(name.startswith(".receipt.json.") for name in fsynced))
                return real_popen(*args, **kwargs)

            with (
                mock.patch.object(sealed_study.os, "fsync", side_effect=recording_fsync),
                mock.patch.object(sealed_study.subprocess, "Popen", side_effect=evaluator_after_receipt),
            ):
                sealed_study.run(lock_path)
            self.assertTrue(any(name.startswith(".receipt.json.") for name in fsynced))
            self.assertTrue(any(name.startswith(".aggregate.json.") for name in fsynced))

    def test_nonzero_exit_and_sigkill_publish_durable_inconclusive_results(self) -> None:
        for mode, expected_status, expected_signal in (("nonzero", 7, None), ("sigkill", None, 9)):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result = sealed_study.run(build_fixture(root, mode))
                persisted = load(root / "aggregate.json")
                self.assertEqual(result, persisted)
                self.assertEqual(result["decision"], "inconclusive")
                self.assertEqual(result["inconclusive_error_kind"], "EvaluatorProcessFailed")
                self.assertEqual(result["execution"]["evaluator"]["exit_status"], expected_status)
                self.assertEqual(result["execution"]["evaluator"]["signal"], expected_signal)

    def test_invalid_missing_private_replicate_and_oversized_results_are_inconclusive(self) -> None:
        for mode in ("missing", "wrong_schema", "private", "replicates", "oversized"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result = sealed_study.run(build_fixture(root, mode))
                self.assertEqual(result["decision"], "inconclusive")
                self.assertEqual(result["inconclusive_error_kind"], "InvalidEvaluatorResult")
                self.assertNotIn("evaluator_result", result)
                self.assertFalse((root / "scratch/candidate.json").exists())

    def test_unremovable_candidate_blocks_publication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(
                sealed_study.SealedStudyError, "candidate result could not be removed"
            ):
                sealed_study.run(build_fixture(root, "candidate_directory"))
            self.assertTrue((root / "receipt.json").is_file())
            self.assertFalse((root / "aggregate.json").exists())

    def test_source_and_evaluator_hash_mismatches_fail_before_receipt_or_result(self) -> None:
        for target in ("source", "evaluator", "closure"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                lock_path = build_fixture(root, "accepted")
                if target == "closure":
                    lock = load(lock_path)
                    lock["evaluator"]["closure_sha256"] = "0" * 64
                    lock_path.write_text(json.dumps(lock))
                else:
                    path = root / ("source.zip" if target == "source" else "evaluator.py")
                    with path.open("ab") as handle:
                        handle.write(b"changed")
                with self.assertRaisesRegex(sealed_study.SealedStudyError, "hash mismatch"):
                    sealed_study.run(lock_path)
                self.assertFalse((root / "receipt.json").exists())
                self.assertFalse((root / "aggregate.json").exists())

    def test_validator_hash_and_rejection_cannot_publish_an_evaluator_decision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_path = build_fixture(root, "accepted")
            (root / "validator.py").write_text(VALIDATOR + "# changed\n")
            with self.assertRaisesRegex(sealed_study.SealedStudyError, "hash mismatch"):
                sealed_study.run(lock_path)
            self.assertFalse((root / "receipt.json").exists())

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_path = build_fixture(root, "accepted")
            rejecting = VALIDATOR.replace("value.get(\"metric\") == 3", "False")
            (root / "validator.py").write_text(rejecting)
            lock = load(lock_path)
            files = [file_entry(root, "validator.py")]
            lock["validator"]["files"] = files
            lock["validator"]["closure_sha256"] = closure(files)
            lock_path.write_text(json.dumps(lock))
            result = sealed_study.run(lock_path)
            self.assertEqual(result["decision"], "inconclusive")
            self.assertNotIn("evaluator_result", result)

    def test_output_paths_schema_size_policy_and_cli_overrides_are_refused(self) -> None:
        mutations = (
            ("candidate_result_path", "candidate.json", "inside scratch_directory"),
            ("aggregate_result_path", "source.zip", "overlaps"),
            ("schema_version", "openplan.sealed-study.lock.v0", "schema version"),
        )
        for field, value, error in mutations:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                lock_path = build_fixture(root, "accepted")
                lock = load(lock_path)
                lock[field] = value
                lock_path.write_text(json.dumps(lock))
                with self.assertRaisesRegex(sealed_study.SealedStudyError, error):
                    sealed_study.run(lock_path)
                self.assertFalse((root / "receipt.json").exists())

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_path = build_fixture(root, "accepted")
            lock = load(lock_path)
            lock["output_policy"]["maximum_bytes"] -= 1
            lock_path.write_text(json.dumps(lock))
            with self.assertRaisesRegex(sealed_study.SealedStudyError, "maximum_bytes"):
                sealed_study.run(lock_path)

            cli = subprocess.run(
                [sys.executable, str(RESEARCH_DIR / "sealed_study.py"), "run", str(lock_path), "--timeout", "1"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(cli.returncode, 0)
            self.assertIn("unrecognized arguments", cli.stderr)

    def test_delayed_child_has_no_timeout_and_stream_content_is_not_published(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            started = time.monotonic()
            result = sealed_study.run(build_fixture(root, "delay", 1.1))
            self.assertGreaterEqual(time.monotonic() - started, 1.0)
            self.assertEqual(result["decision"], "accepted")
            rendered = json.dumps(result)
            self.assertNotIn("row-level stdout", rendered)
            self.assertNotIn("row-level stderr", rendered)
            evaluator = result["execution"]["evaluator"]
            self.assertGreater(evaluator["stdout"]["bytes"], 0)
            self.assertGreater(evaluator["stderr"]["bytes"], 0)
            self.assertGreater(evaluator["peak_rss_bytes"], 0)

    def test_scratch_space_is_three_times_selected_members_plus_one_gibibyte(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_path = build_fixture(root, "accepted")
            _path, lock, resolved = sealed_study.load_lock(lock_path)
            selected = len("id,value\n1,alpha\n2,beta\n".encode())
            required = selected * 3 + sealed_study.SCRATCH_RESERVE_BYTES
            with mock.patch.object(
                sealed_study.shutil,
                "disk_usage",
                return_value=shutil_usage(total=required, used=1, free=required - 1),
            ):
                with self.assertRaisesRegex(sealed_study.SealedStudyError, "insufficient"):
                    sealed_study.verify_sources_and_space(lock, resolved)

    def test_both_commands_refuse_a_lease_held_by_another_process(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_path = build_fixture(root, "accepted")
            lease = (root / "study.lease.json").open("a+b")
            try:
                fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                for command in (sealed_study.run, sealed_study.finalize_interrupted):
                    with self.assertRaisesRegex(sealed_study.SealedStudyError, "holds the host lease"):
                        command(lock_path)
            finally:
                fcntl.flock(lease.fileno(), fcntl.LOCK_UN)
                lease.close()

    def test_interrupted_runner_recovery_does_not_invoke_evaluator_or_open_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_path = build_fixture(root, "parent_interrupt", 30)
            runner = subprocess.Popen(
                [sys.executable, str(RESEARCH_DIR / "sealed_study.py"), "run", str(lock_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            child_pid = None
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if (root / "receipt.json").exists() and (root / "invocations.txt").exists():
                    child_pid = int((root / "invocations.txt").read_text().splitlines()[0])
                    break
                time.sleep(0.02)
            self.assertIsNotNone(child_pid, "runner did not reach the post-receipt evaluator")
            runner.kill()
            runner.wait(timeout=5)
            with self.assertRaisesRegex(sealed_study.SealedStudyError, "holds the host lease"):
                sealed_study.finalize_interrupted(lock_path)
            os.kill(child_pid, signal.SIGKILL)
            source = root / "source.zip"
            moved_source = root / "source.was-not-opened-by-recovery"
            source.rename(moved_source)
            deadline = time.monotonic() + 5
            while True:
                try:
                    result = sealed_study.finalize_interrupted(lock_path)
                    break
                except sealed_study.SealedStudyError as exc:
                    if "holds the host lease" not in str(exc) or time.monotonic() >= deadline:
                        raise
                    time.sleep(0.02)
            self.assertEqual(result["decision"], "inconclusive")
            self.assertEqual(result["inconclusive_error_kind"], "RunnerInterruptedAfterReceipt")
            self.assertEqual((root / "invocations.txt").read_text().splitlines(), [str(child_pid)])
            self.assertTrue(moved_source.exists())

    def test_recovery_verifies_receipt_and_frozen_evaluator_closure(self) -> None:
        for target, expected in (("receipt", "receipt"), ("evaluator", "hash mismatch")):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                lock_path = build_fixture(root, "accepted")
                _path, lock, resolved = sealed_study.load_lock(lock_path)
                digest = sealed_study.sha256(lock_path)
                source_hashes = {source["name"]: source["sha256"] for source in lock["sources"]}
                receipt = {
                    "schema_version": sealed_study.RECEIPT_SCHEMA_VERSION,
                    "study_id": lock["study_id"],
                    "status": "source_consumed_before_first_selected_member_read",
                    "lock_sha256": digest,
                    "source_sha256": source_hashes,
                    "selected_members_uncompressed_bytes": 1,
                    "required_scratch_bytes": sealed_study.SCRATCH_RESERVE_BYTES + 3,
                    "written_at": "2026-08-25T00:00:00+00:00",
                }
                sealed_study._write_fsynced_exclusive(resolved["receipt_path"], receipt)
                if target == "receipt":
                    receipt["study_id"] = "another-study"
                    (root / "receipt.json").write_text(json.dumps(receipt))
                else:
                    (root / "evaluator.py").write_text(EVALUATOR + "# changed\n")
                with self.assertRaisesRegex(sealed_study.SealedStudyError, expected):
                    sealed_study.finalize_interrupted(lock_path)
                self.assertFalse((root / "aggregate.json").exists())


def shutil_usage(total: int, used: int, free: int):
    return mock.Mock(total=total, used=used, free=free)


if __name__ == "__main__":
    unittest.main()
