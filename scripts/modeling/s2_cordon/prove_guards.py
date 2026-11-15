"""Run bounded, reversible mutations against synthetic tests only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
WORKER = ROOT / "workers/aequilibrae_worker/external_distribution.py"
EVALUATOR = Path(__file__).with_name("evaluate.py")
VALIDATOR = Path(__file__).with_name("validate.py")
MAIN = ROOT / "workers/aequilibrae_worker/main.py"
RUNTIME = ROOT / "scripts/modeling/screening_runtime.py"
WORKER_TEST = ROOT / "workers/aequilibrae_worker/test_external_distribution.py"
STUDY_TEST = Path(__file__).with_name("test_study.py")


def main(output):
    mutations = [
        ("harmless_comment", WORKER, "Network time changes", "Network travel time changes", WORKER_TEST, None),
        ("default_identity", WORKER, "return matrix, None", "return matrix.copy(), None", WORKER_TEST, "test_default_identity_and_bytes"),
        ("setting", WORKER, 'raise ExternalDistributionRefused("Unknown external distribution setting")', 'return "default"', WORKER_TEST, "test_unknown_setting"),
        ("dimensions", WORKER, 'raise ExternalDistributionRefused("External distribution dimensions or mask are invalid")', "return matrix, None", WORKER_TEST, "test_dimensions"),
        ("input_values", WORKER, 'raise ExternalDistributionRefused("Baseline demand must be finite nonnegative float64")', "return matrix, None", WORKER_TEST, "test_input_values"),
        ("skim_values", WORKER, 'raise ExternalDistributionRefused("Skim has NaN or negative travel time")', "return matrix, None", WORKER_TEST, "test_skim_values"),
        ("conditioning", WORKER, "candidate = base / np.maximum(times, 1.0)", "candidate = base.copy()", WORKER_TEST, "test_conditioning_conservation_and_custody"),
        ("convergence", WORKER, 'raise ExternalDistributionRefused("External distribution did not converge")', "return base.copy(), 0", WORKER_TEST, "test_nonconvergence"),
        ("candidate_values", WORKER, 'raise ExternalDistributionRefused("Candidate demand is invalid")', "pass", WORKER_TEST, "test_candidate_values"),
        ("fixed_cells", WORKER, 'raise ExternalDistributionRefused("Candidate changed a held-fixed cell")', "pass", WORKER_TEST, "test_fixed_cells"),
        ("support", WORKER, 'raise ExternalDistributionRefused("Candidate changed demand support")', "pass", WORKER_TEST, "test_support"),
        ("marginals", WORKER, 'raise ExternalDistributionRefused("Candidate changed demand marginals")', "pass", WORKER_TEST, "test_marginals"),
        ("custody", WORKER, '"output_sha256": array_sha256(candidate)', '"output_sha256": array_sha256(base)', WORKER_TEST, "test_conditioning_conservation_and_custody"),
        ("worker_dispatch", MAIN, "node in set(cordon_map.values()) for node in assignment_centroids", "False for node in assignment_centroids", WORKER_TEST, "test_worker_call_is_executed"),
        ("county_dispatch", RUNTIME, "zone_id in set(external_zone_ids(zones_df)) for zone_id in zone_ids", "False for zone_id in zone_ids", STUDY_TEST, "test_county_default_bytes_and_opt_in_dispatch"),
        ("evaluation_gate", EVALUATOR, 'reasons.append("evaluation_improvement_below_5_points")', "pass", STUDY_TEST, "test_evaluation_gate"),
        ("diagnosis_gate", EVALUATOR, 'reasons.append("diagnosis_worsened_over_1_point")', "pass", STUDY_TEST, "test_diagnosis_gate"),
        ("stratum_gate", EVALUATOR, 'reasons.append(f"road_class_worsened:{kind}")', "pass", STUDY_TEST, "test_stratum_gate"),
        ("coverage_gate", EVALUATOR, 'reasons.append("lost_loaded_station")', "pass", STUDY_TEST, "test_coverage_gate"),
        ("inert_gate", EVALUATOR, 'reasons.append("inert_candidate")', "pass", STUDY_TEST, "test_inert_gate"),
        ("missing_gate", EVALUATOR, 'return ["missing_matched_stations"]', "return []", STUDY_TEST, "test_missing_gate"),
        ("archive_hash", EVALUATOR, 'digest(archive["path"]) == archive["sha256"]', "True", STUDY_TEST, "test_source_guards"),
        ("archive_membership", EVALUATOR, 'set(source.namelist()) == {r["member"] for r in registry["members"]}', "True", STUDY_TEST, "test_source_guards"),
        ("member_hash", EVALUATOR, 'len(payload) == record["bytes"] and hashlib.sha256(payload).hexdigest() == record["sha256"]', "True", STUDY_TEST, "test_source_guards"),
        ("holdout_path", EVALUATOR, 'and "holdout" not in member.lower()', "and True", STUDY_TEST, "test_forbidden_member"),
        ("validator_promotion", VALIDATOR, 'assert value["scientific_accuracy"] == "inconclusive"', "pass", STUDY_TEST, "test_independent_validator"),
        ("validator_default", VALIDATOR, 'assert not any(value[k] for k in ("defaults_changed", "holdout_accessed", "methods_averaged"))', "pass", STUDY_TEST, "test_independent_validator"),
        ("validator_match", VALIDATOR, 'assert b["matched_identity_sha256"] == c["matched_identity_sha256"]', "pass", STUDY_TEST, "test_independent_validator"),
        ("validator_convergence", VALIDATOR, 'passed &= all(record["convergence"]["converged"] for record in case["assignments"].values())', "passed &= True", STUDY_TEST, "test_independent_validator"),
        ("validator_repeat", VALIDATOR, 'passed &= case["repeat_median_ape_delta"] is None or case["repeat_median_ape_delta"] <= 0.1', "passed &= True", STUDY_TEST, "test_independent_validator"),
    ]
    originals = {path: path.read_bytes() for _, path, *_ in mutations}
    records = []
    with tempfile.TemporaryDirectory() as temp:
        for index, (name, path, old, new, test, expected) in enumerate(mutations):
            original = originals[path]
            source = original.decode()
            if source.count(old) != 1:
                raise RuntimeError(f"Mutation {name} has no unique anchor")
            try:
                path.write_text(source.replace(old, new))
                env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
                       "PYTHONPYCACHEPREFIX": str(Path(temp) / str(index))}
                result = subprocess.run([sys.executable, "-B", str(test), "-v"],
                                        env=env, capture_output=True, text=True)
                combined = result.stdout + result.stderr
                passed = result.returncode == 0 if expected is None else (
                    result.returncode != 0 and f"FAIL: {expected}" in combined)
                record = {"name": name, "expected_test": expected, "exit_code": result.returncode,
                          "outcome": "survived" if result.returncode == 0 else "killed",
                          "expected_outcome_confirmed": passed,
                          "output_sha256": hashlib.sha256(combined.encode()).hexdigest()}
                records.append(record)
                if not passed:
                    print(combined)
                    raise RuntimeError(f"Mutation {name} did not produce the intended outcome")
            finally:
                path.write_bytes(original)
        restored = []
        for test in (WORKER_TEST, STUDY_TEST):
            result = subprocess.run([sys.executable, "-B", str(test), "-v"], capture_output=True, text=True,
                                    env={**os.environ, "PYTHONPYCACHEPREFIX": str(Path(temp) / "restored")})
            restored.append({"test": str(test.relative_to(ROOT)), "exit_code": result.returncode})
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
    assert all(path.read_bytes() == original for path, original in originals.items())
    Path(output).write_text(json.dumps({"controls": records, "restored": restored,
        "source_restored_exactly": True,
        "blind_category": "Synthetic guards do not establish native assignment, observed accuracy, hosted execution or recovery after machine failure."}, indent=2) + "\n")
    print(f"{len(records)} controls: 1 harmless survivor, {len(records)-1} intended failures; 2 restored suites pass")


if __name__ == "__main__":
    main(sys.argv[1])
