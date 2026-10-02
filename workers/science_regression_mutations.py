"""Prove focused worker regressions in disposable source copies, never live code."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "workers/activitysim_worker/main.py", "workers/activitysim_worker/runtime.py",
    "workers/activitysim_worker/Dockerfile", "workers/activitysim_worker/test_http_security.py",
    "workers/activitysim_worker/tests/test_runtime.py",
    "workers/county_onramp_worker/main.py", "workers/county_onramp_worker/tests/test_process_cancellation.py",
    "scripts/modeling/validation_instrument_v2.py", "scripts/modeling/tests/test_validation_instrument_v2.py",
    "scripts/modeling/tests/test_directional_refusal.py", "workers/aequilibrae_worker/model_validation_core_v5.py",
]
HTTP = "workers/activitysim_worker/test_http_security.py"
CANCEL = "workers/county_onramp_worker/tests/test_process_cancellation.py"
DIRECTION = "scripts/modeling/tests/test_directional_refusal.py"
MUTATIONS = [
    ("http-auth", "workers/activitysim_worker/main.py", 'if not WORKER_TOKEN or request_token is None or not hmac.compare_digest(request_token, WORKER_TOKEN):', 'if False:', HTTP, 'test_all_endpoints_require_configured_and_present_token_before_runtime', 'AssertionError'),
    ("http-command-fields", "workers/activitysim_worker/main.py", 'if set(payload) - {"bundlePath", "manifestPath", "runLabel"}:', 'if False:', HTTP, 'test_request_cannot_choose_executable_or_replace_unrelated_directory', 'AssertionError'),
    ("http-root", "workers/activitysim_worker/main.py", 'if selected != bundle_root and bundle_root not in selected.parents:', 'if False:', HTTP, 'test_bundle_paths_and_symlinks_cannot_escape_operator_root', 'AssertionError'),
    ("http-force", "workers/activitysim_worker/main.py", '"force": False,', '"force": True,', HTTP, 'test_operator_selects_execution_and_http_never_forces', 'AssertionError'),
    ("http-startup", "workers/activitysim_worker/main.py", 'if not WORKER_TOKEN:', 'if False:', HTTP, 'test_startup_preflight_refuses_missing_token_and_accepts_owned_configuration', 'AssertionError'),
    ("owned-session", "workers/county_onramp_worker/main.py", 'start_new_session=True,', 'start_new_session=False,', CANCEL, 'test_job_launch_owns_a_new_session', 'AssertionError'),
    ("owned-group", "workers/county_onramp_worker/main.py", 'os.killpg(process.pid, signal.SIGKILL)', 'process.kill()', CANCEL, 'test_group_termination_stops_inherited_pipe_holder_and_releases_queue', 'Cancellation could not confirm termination'),
    ("direction-matcher", "scripts/modeling/validation_instrument_v2.py", '"compatible": False, "basis": "directional_output_unproven"', '"compatible": True, "basis": "directional_output_unproven"', DIRECTION, 'test_directional_counts_on_bidirectional_links_remain_ambiguous', 'AssertionError'),
    ("direction-legacy-audit", "workers/aequilibrae_worker/model_validation_core_v5.py", 'if match.get("status") == "matched" and match.get("direction_aggregation") == "one_direction":', 'if False:', DIRECTION, 'test_legacy_directional_total_audit_is_refused_before_scoring', 'AssertionError'),
]
CLASSES = {HTTP: "HttpSecurityTests", CANCEL: "CancellationTests", DIRECTION: "DirectionalRefusalTests"}

def run(root, suite, method=None):
    command = [sys.executable, "-B", str(root / suite)]
    if method: command.append(CLASSES[suite] + "." + method)
    return subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=30)


def main():
    records = []
    with tempfile.TemporaryDirectory(prefix="openplan-science-mutations-") as temp:
        root = Path(temp)
        for name in FILES:
            target = root / name; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        for suite in (HTTP, CANCEL, DIRECTION):
            outcome = run(root, suite)
            if outcome.returncode: raise AssertionError(f"baseline failed: {suite}\n{outcome.stderr}")
            records.append({"suite": suite, "baseline": "passed"})
        for name, relative, old, new, suite, method, expected in MUTATIONS:
            path = root / relative; original = path.read_text()
            assert old in original, name
            try:
                path.write_text(original + "\n# Harmless mutation control.\n")
                control = run(root, suite, method)
                if control.returncode: raise AssertionError(f"no-op did not survive {name}: {control.stderr}")
                path.write_text(original.replace(old, new))
                broken = run(root, suite, method)
                detail = broken.stdout + broken.stderr
                if broken.returncode == 0 or expected not in detail:
                    raise AssertionError(f"mutation {name} did not fail for its expected reason: {detail}")
                records.append({"mutation": name, "harmless": "survived", "targeted": "detected", "expected_failure": expected, "observed": detail[-2500:]})
            finally: path.write_text(original)
    print(json.dumps(records, indent=2))

if __name__ == "__main__": main()
