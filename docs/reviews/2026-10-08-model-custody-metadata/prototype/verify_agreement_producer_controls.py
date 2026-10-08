"""Exercise actual agreement input guards without changing checkout sources."""
import hashlib
import inspect
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / "workers/aequilibrae_worker"
sys.path.insert(0, str(WORKER))
import test_activitysim_assignment_handoff as tests


def main():
    module = tests.main
    original = module.require_completed_artifact_producer
    query = module.sb_get_run_artifacts
    source = inspect.getsource(original)
    query_source = inspect.getsource(query)
    cases = [
        ("baseline", source, None),
        ("harmless", "# Harmless comment.\n" + source, None),
        ("ignore-completion", source.replace('or producer.get("status") != "succeeded"', 'or False'), tests.test_agreement_refuses_unconfirmed_producer_before_file_access),
        ("ignore-active-attempt", source.replace('or producer.get("active_attempt_id") != attempt', 'or False'), tests.test_agreement_refuses_unconfirmed_producer_before_file_access),
        ("ignore-artifact-run", source.replace('artifact["run_id"] != run_id', 'False'), tests.test_agreement_refuses_unconfirmed_producer_before_file_access),
        ("restored", source, None),
    ]
    records = []
    try:
        for name, candidate, target in cases:
            if target is not None and candidate == source:
                raise AssertionError("Missing mutation anchor: " + name)
            namespace = dict(module.__dict__)
            exec(compile(candidate, "<producer-control>", "exec"), namespace)
            module.require_completed_artifact_producer = namespace[original.__name__]
            failed = False
            try:
                if target:
                    target()
                else:
                    tests.test_agreement_refuses_unconfirmed_producer_before_file_access()
                    tests.test_agreement_accepts_explicit_completed_legacy_producer()
                    tests.test_latest_local_artifact_requires_full_hash_and_all_identity_metadata()
                    tests.test_agreement_artifact_query_projects_producer_identity()
            except AssertionError:
                if target is None:
                    raise
                failed = True
            if target is not None and not failed:
                raise AssertionError("Targeted fault escaped: " + name)
            records.append({"control": name, "targeted_failure": failed})
        candidate = query_source.replace(',model_run_stages(id,run_id,status,attempt_managed,active_attempt_id)', '')
        if candidate == query_source:
            raise AssertionError("Missing projection mutation anchor")
        namespace = dict(module.__dict__)
        exec(compile(candidate, "<query-control>", "exec"), namespace)
        module.sb_get_run_artifacts = namespace[query.__name__]
        try:
            tests.test_agreement_artifact_query_projects_producer_identity()
        except AssertionError:
            records.append({"control": "omit-producer-projection", "targeted_failure": True})
        else:
            raise AssertionError("Projection fault escaped")
    finally:
        module.require_completed_artifact_producer = original
        module.sb_get_run_artifacts = query
    report = {"source_sha256": hashlib.sha256((WORKER / "main.py").read_bytes()).hexdigest(),
              "controls": records,
              "limits": "Actual agreement guard and mocked HTTP projection. No native database authorization, file immutability, engine execution or scientific acceptance."}
    (ROOT / "agreement-producer-controls.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
