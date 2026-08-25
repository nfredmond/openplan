#!/usr/bin/env python3
"""Mutation proof for the sealed-study checks. Run only from a clean checkout."""

from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts/research/sealed_study.py"
STREAM = ROOT / "scripts/research/streaming_zip_csv.py"
CUSTODY = ROOT / "data/modeling/mandatory-tour-frequency-2017-successor-custody-lock-2026-08-24.json"
RUNNER_TEST = "scripts/modeling/tests/test_sealed_study_runner.py"
STREAM_TEST = "scripts/modeling/tests/test_streaming_zip_csv.py"
CUSTODY_TEST = "scripts/modeling/tests/test_mandatory_tour_frequency_2017_custody.py"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: Path
    before: str
    after: str
    test: str
    must_survive: bool = False


def test_name(file: str, case: str) -> str:
    class_name = "StreamingZipCsvTests" if file == STREAM_TEST else "SealedStudyRunnerTests"
    return f"{file} {class_name}.{case}"


MUTATIONS = (
    Mutation(
        "comment-only control",
        RUNNER,
        '"""Run or close one frozen sealed study without weakening its decision."""',
        '"""Run or close one frozen sealed study without changing its decision."""',
        f"{RUNNER_TEST}|{STREAM_TEST}|{CUSTODY_TEST}",
        must_survive=True,
    ),
    Mutation(
        "schema identifier drift",
        ROOT / "schemas/research/sealed-study-lock-v1.schema.json",
        '"$id": "openplan.sealed-study.lock.v1"',
        '"$id": "openplan.sealed-study.lock.MUTANT"',
        test_name(RUNNER_TEST, "test_published_json_contract_ids_match_the_runner"),
    ),
    Mutation(
        "runner overrides evaluator rejection",
        RUNNER,
        '"decision": candidate["decision"],',
        '"decision": "accepted",',
        test_name(RUNNER_TEST, "test_evaluator_owns_accepted_rejected_and_inconclusive_decisions"),
    ),
    Mutation(
        "receipt and aggregate fsync removed",
        RUNNER,
        "            os.fsync(handle.fileno())\n        try:\n            os.link",
        "            # MUTANT: no file fsync\n        try:\n            os.link",
        test_name(RUNNER_TEST, "test_receipt_and_aggregate_are_fsynced_in_order"),
    ),
    Mutation(
        "process failure ignored",
        RUNNER,
        '            if evaluator_facts["exit_status"] != 0 or evaluator_facts["signal"] is not None:',
        "            if False:",
        test_name(RUNNER_TEST, "test_nonzero_exit_and_sigkill_publish_durable_inconclusive_results"),
    ),
    Mutation(
        "candidate schema ignored",
        RUNNER,
        '    if result.get("schema_version") != lock["candidate_result_schema_version"]:',
        '    if False and result.get("schema_version") != lock["candidate_result_schema_version"]:',
        test_name(RUNNER_TEST, "test_invalid_missing_private_replicate_and_oversized_results_are_inconclusive"),
    ),
    Mutation(
        "prohibited identifiers ignored",
        RUNNER,
        "            if normalized in prohibited:",
        "            if False and normalized in prohibited:",
        test_name(RUNNER_TEST, "test_invalid_missing_private_replicate_and_oversized_results_are_inconclusive"),
    ),
    Mutation(
        "replicate arrays ignored",
        RUNNER,
        "            if normalized in prohibited_arrays and isinstance(nested, list):",
        "            if False and normalized in prohibited_arrays and isinstance(nested, list):",
        test_name(RUNNER_TEST, "test_invalid_missing_private_replicate_and_oversized_results_are_inconclusive"),
    ),
    Mutation(
        "candidate limit doubled",
        RUNNER,
        '    result = _read_json(path, "candidate result", MAX_AGGREGATE_BYTES)',
        '    result = _read_json(path, "candidate result", MAX_AGGREGATE_BYTES * 2)',
        test_name(RUNNER_TEST, "test_invalid_missing_private_replicate_and_oversized_results_are_inconclusive"),
    ),
    Mutation(
        "source hash ignored",
        RUNNER,
        '        if digest != source["sha256"]:',
        '        if False and digest != source["sha256"]:',
        test_name(RUNNER_TEST, "test_source_and_evaluator_hash_mismatches_fail_before_receipt_or_result"),
    ),
    Mutation(
        "candidate cleanup failure ignored",
        RUNNER,
        '    except OSError as exc:\n        raise SealedStudyError("scratch candidate result could not be removed") from exc',
        "    except OSError:\n        pass",
        test_name(RUNNER_TEST, "test_unremovable_candidate_blocks_publication"),
    ),
    Mutation(
        "code hashes ignored",
        RUNNER,
        '        if digest != entry["sha256"]:\n            raise SealedStudyError(f"{name} file hash mismatch: {entry[\'path\']}")\n        measured[entry["path"]] = digest\n        canonical.append({"path": entry["path"], "sha256": digest})',
        '        if False and digest != entry["sha256"]:\n            raise SealedStudyError(f"{name} file hash mismatch: {entry[\'path\']}")\n        measured[entry["path"]] = digest\n        canonical.append({"path": entry["path"], "sha256": entry["sha256"]})',
        test_name(RUNNER_TEST, "test_source_and_evaluator_hash_mismatches_fail_before_receipt_or_result"),
    ),
    Mutation(
        "code closure ignored",
        RUNNER,
        '    if canonical_sha256(canonical) != closure["closure_sha256"]:',
        '    if False and canonical_sha256(canonical) != closure["closure_sha256"]:',
        test_name(RUNNER_TEST, "test_source_and_evaluator_hash_mismatches_fail_before_receipt_or_result"),
    ),
    Mutation(
        "validator rejection ignored",
        RUNNER,
        '                if validator_facts["exit_status"] != 0 or validator_facts["signal"] is not None:',
        "                if False:",
        test_name(RUNNER_TEST, "test_validator_hash_and_rejection_cannot_publish_an_evaluator_decision"),
    ),
    Mutation(
        "scratch result boundary removed",
        RUNNER,
        "    if not _is_within(candidate_path, scratch_directory) or candidate_path == scratch_directory:",
        "    if False:",
        test_name(RUNNER_TEST, "test_output_paths_schema_size_policy_and_cli_overrides_are_refused"),
    ),
    Mutation(
        "lock schema ignored",
        RUNNER,
        "    if lock.get(\"schema_version\") != LOCK_SCHEMA_VERSION:",
        "    if False:",
        test_name(RUNNER_TEST, "test_output_paths_schema_size_policy_and_cli_overrides_are_refused"),
    ),
    Mutation(
        "locked size policy ignored",
        RUNNER,
        "    if policy.get(\"maximum_bytes\") != MAX_AGGREGATE_BYTES:",
        "    if False:",
        test_name(RUNNER_TEST, "test_output_paths_schema_size_policy_and_cli_overrides_are_refused"),
    ),
    Mutation(
        "runtime override accepted",
        RUNNER,
        '    run_parser.add_argument("lock")',
        '    run_parser.add_argument("lock")\n    run_parser.add_argument("--timeout")',
        test_name(RUNNER_TEST, "test_output_paths_schema_size_policy_and_cli_overrides_are_refused"),
    ),
    Mutation(
        "delayed evaluator skipped",
        Path("fixture"),
        'if mode == "delay":\n    time.sleep(float(delay))',
        'if mode == "delay":\n    # MUTANT: delay skipped',
        test_name(RUNNER_TEST, "test_delayed_child_has_no_timeout_and_stream_content_is_not_published"),
    ),
    Mutation(
        "scratch multiplier reduced",
        RUNNER,
        "    required = selected_bytes * 3 + SCRATCH_RESERVE_BYTES",
        "    required = selected_bytes * 2 + SCRATCH_RESERVE_BYTES",
        test_name(RUNNER_TEST, "test_scratch_space_is_three_times_selected_members_plus_one_gibibyte"),
    ),
    Mutation(
        "lease conflict ignored",
        RUNNER,
        '        except BlockingIOError as exc:\n            raise SealedStudyError("another process holds the host lease") from exc',
        "        except BlockingIOError:\n            pass",
        test_name(RUNNER_TEST, "test_both_commands_refuse_a_lease_held_by_another_process"),
    ),
    Mutation(
        "recovery opens source",
        RUNNER,
        '        _verified_receipt(lock, resolved, lock_digest)\n        _remove_candidate',
        '        _verified_receipt(lock, resolved, lock_digest)\n        for source in lock["sources"]:\n            sha256(_resolve(resolved["base"], source["path"], "source path"))\n        _remove_candidate',
        test_name(RUNNER_TEST, "test_interrupted_runner_recovery_does_not_invoke_evaluator_or_open_source"),
    ),
    Mutation(
        "recovery acts like evaluator invocation",
        RUNNER,
        '        _verified_receipt(lock, resolved, lock_digest)\n        _remove_candidate',
        '        _verified_receipt(lock, resolved, lock_digest)\n        with (resolved["base"] / "invocations.txt").open("a") as marker:\n            marker.write("recovery-invocation\\n")\n        _remove_candidate',
        test_name(RUNNER_TEST, "test_interrupted_runner_recovery_does_not_invoke_evaluator_or_open_source"),
    ),
    Mutation(
        "receipt ownership ignored",
        RUNNER,
        '    if receipt.get("study_id") != lock["study_id"] or receipt.get("lock_sha256") != lock_digest:',
        '    if False and (receipt.get("study_id") != lock["study_id"] or receipt.get("lock_sha256") != lock_digest):',
        test_name(RUNNER_TEST, "test_recovery_verifies_receipt_and_frozen_evaluator_closure"),
    ),
    Mutation(
        "two-thousand row boundary changed",
        STREAM,
        "DEFAULT_BATCH_SIZE = 2_000",
        "DEFAULT_BATCH_SIZE = 2_001",
        test_name(STREAM_TEST, "test_selected_tables_are_staged_in_two_thousand_row_batches"),
    ),
    Mutation(
        "complete source table retained",
        STREAM,
        "                                if len(batch) == batch_size:",
        "                                if False:",
        test_name(STREAM_TEST, "test_peak_python_allocation_stays_bounded_when_rows_grow_tenfold"),
    ),
    Mutation(
        "uncompressed inventory miscounted",
        STREAM,
        "            return sum(by_name[member].file_size for member in members)",
        "            return 1 + sum(by_name[member].file_size for member in members)",
        test_name(STREAM_TEST, "test_member_inventory_uses_uncompressed_sizes_and_missing_members_fail"),
    ),
    Mutation(
        "existing SQLite file allowed",
        STREAM,
        "    if destination.exists() or destination.is_symlink():",
        "    if False:",
        test_name(STREAM_TEST, "test_existing_database_and_changed_headers_are_refused"),
    ),
    Mutation(
        "frozen CSV header ignored",
        STREAM,
        "                            if configured_columns is not None and header != configured_columns:",
        "                            if False:",
        test_name(STREAM_TEST, "test_existing_database_and_changed_headers_are_refused"),
    ),
    Mutation(
        "2017 custody digest changed",
        CUSTODY,
        "be319ab981fc9742a6ba4c31c565a2019625af8f9311e377607fe373f5aa7998",
        "0e319ab981fc9742a6ba4c31c565a2019625af8f9311e377607fe373f5aa7998",
        CUSTODY_TEST,
    ),
)


def apply_mutation(mutation: Mutation) -> tuple[Path, bytes]:
    path = mutation.path
    if path == Path("fixture"):
        path = ROOT / "scripts/modeling/tests/test_sealed_study_runner.py"
    original = path.read_bytes()
    source = original.decode()
    count = source.count(mutation.before)
    if count != 1:
        raise RuntimeError(f"{mutation.name}: expected one mutation site, found {count}")
    path.write_text(source.replace(mutation.before, mutation.after, 1))
    return path, original


def main() -> int:
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    failures: list[str] = []
    for mutation in MUTATIONS:
        path, original = apply_mutation(mutation)
        try:
            runs = []
            for test in mutation.test.split("|"):
                runs.append(
                    subprocess.run(
                        [sys.executable, "-B", *test.split()],
                        cwd=ROOT,
                        env=environment,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        check=False,
                    )
                )
            completed = next((run for run in runs if run.returncode != 0), runs[-1])
            all_passed = all(run.returncode == 0 for run in runs)
        finally:
            path.write_bytes(original)
        survived = all_passed
        expected = mutation.must_survive
        outcome = "SURVIVED" if survived else "KILLED"
        print(f"{outcome:8} {mutation.name}")
        if survived != expected:
            failures.append(mutation.name)
            print("\n".join(completed.stdout.splitlines()[-12:]))
    if failures:
        print("Unexpected mutation outcomes: " + ", ".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
