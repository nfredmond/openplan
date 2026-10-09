"""Serial native ActivitySim custody checks on a copied development bundle."""
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
WORKER = ROOT / "workers/activitysim_worker"
sys.path.insert(0, str(ROOT / "workers/aequilibrae_worker"))
from model_engine_supervision import inspect_saved_scope


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wait_for(check, owner, timeout=90):
    end = time.monotonic() + timeout
    while not check():
        if owner.poll() is not None:
            raise AssertionError("Runtime exited before native execution readiness")
        if time.monotonic() > end:
            raise AssertionError("Native execution readiness timed out")
        time.sleep(.02)


def one(directory, source, executable, mode):
    directory.mkdir(mode=0o700)
    bundle = directory / "bundle"
    shutil.copytree(source, bundle)
    settings = bundle / "configs/settings.yaml"
    text = settings.read_text()
    assert text.count("households_sample_size: 0") == 1
    settings.write_text(text.replace("households_sample_size: 0", "households_sample_size: 100"))
    runtime = directory / "runtime"
    command = [sys.executable, "-B", str(WORKER / "main.py"),
        "--bundle-path", str(bundle), "--runtime-dir", str(runtime),
        "--activitysim-cli", str(executable), "--host-memory-bytes", "1610612736", "--host-tasks", "32"]
    if mode == "harmless":
        command.extend(["--run-label", "harmless-custody-label"])
    env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1", NUMBA_NUM_THREADS="1")
    records = runtime / "stages/030-run-activitysim/host_supervision"
    log = records.parent / "activitysim_stdout.log"
    identity = None
    with (directory / "owner.log").open("wb") as stream:
        owner = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT, env=env)
        try:
            wait_for(lambda: records.joinpath("scope-started.json").exists() and log.exists()
                and "#run_model running step school_location" in log.read_text(errors="replace"), owner)
            identity = json.loads((records / "scope-started.json").read_text())
            assert inspect_saved_scope(identity["scope"])["scope_has_live_processes"] is True
            assert not (records / "observed-exit.json").exists()
            assert not (runtime / "runtime_summary.json").exists()
            state = subprocess.run(["systemctl", "--user", "show", identity["scope_unit"],
                "-p", "MemoryPeak", "-p", "MemoryMax", "-p", "MemorySwapMax"], capture_output=True, text=True, check=True).stdout
            result = {"case": mode, "native_step_observed": "school_location", "resource_state_at_interruption": state,
                "scope": identity["scope"], "settings_sha256": digest(settings)}
            if mode != "omit-owner-loss":
                owner.kill()
                owner.wait(timeout=10)
                end = time.monotonic() + 10
                while inspect_saved_scope(identity["scope"])["scope_has_live_processes"] is not False:
                    if time.monotonic() > end:
                        raise AssertionError("Native ActivitySim survived runtime owner loss")
                    time.sleep(.02)
                assert not (records / "observed-exit.json").exists()
                assert not (runtime / "runtime_summary.json").exists()
                assert not (runtime / "output/final_trips.csv").exists()
                result.update(owner_terminated=True, scope_empty=True, completion_absent=True,
                    retained_log_bytes=log.stat().st_size)
            else:
                assert owner.wait(timeout=120) == 0
                receipt = json.loads((records / "observed-exit.json").read_text())
                assert receipt["scope"]["observed_scope_empty"] is True
                summary = json.loads((runtime / "runtime_summary.json").read_text())
                assert summary["status"] == "succeeded"
                with (runtime / "output/final_trips.csv").open() as trips:
                    rows = sum(1 for _ in csv.DictReader(trips))
                assert rows > 0
                result.update(fault_detected="Omitted owner loss permits native completion", trips=rows,
                    owner_terminated=False, scope_empty=True, completion_absent=False)
            return result
        finally:
            if owner.poll() is None:
                owner.kill()
            owner.wait(timeout=10)
            if identity is not None:
                end = time.monotonic() + 10
                while inspect_saved_scope(identity["scope"])["scope_has_live_processes"] is not False:
                    if time.monotonic() > end:
                        raise AssertionError("Owned native scope cleanup was not observed")
                    time.sleep(.02)


if __name__ == "__main__":
    output = Path(os.environ["OPENPLAN_ACTIVITYSIM_NATIVE_OUTPUT"])
    source = Path(os.environ["OPENPLAN_ACTIVITYSIM_DEVELOPMENT_BUNDLE"])
    executable = Path(os.environ["OPENPLAN_ACTIVITYSIM_EXECUTABLE"])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    before = {str(p.relative_to(source)): digest(p) for p in source.rglob("*") if p.is_file()}
    results = [one(output / mode, source, executable, mode) for mode in
        ("baseline", "harmless", "omit-owner-loss", "restored")]
    after = {str(p.relative_to(source)): digest(p) for p in source.rglob("*") if p.is_file()}
    assert before == after, "Development source changed"
    report = {"cases": results, "development_source_unchanged": True,
        "source_bundle_sha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
        "worker_sha256": {name: digest(WORKER / name) for name in ("main.py", "runtime.py", "host_supervision.py")},
        "limits": ["100-household copy of development bundle; stock coefficients unchanged",
            "Native step logged before owner loss; exact instruction at kill is not identified",
            "No holdout exposure, accuracy validation, container custody or database continuation acceptance"]}
    content = json.dumps(report, indent=2) + "\n"
    (output / "result.json").write_text(content)
    print(content)
