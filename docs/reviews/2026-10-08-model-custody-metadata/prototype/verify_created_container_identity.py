"""Check real Docker prestart identity without starting its command."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "workers/activitysim_worker"))
from container_identity import ContainerPlan, verify_created_container


def docker(*args):
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=True).stdout.strip()


if __name__ == "__main__":
    root = Path(os.environ["OPENPLAN_CREATED_CONTAINER_PROOF"])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source, output = root / "input", root / "output"
    source.mkdir()
    output.mkdir()
    image = os.environ["OPENPLAN_CONTAINER_CUSTODY_IMAGE"]
    image_info = json.loads(docker("image", "inspect", image))[0]
    daemon = docker("info", "--format", "{{.ID}}")
    token = uuid.uuid4().hex
    user = f"{os.getuid()}:{os.getgid()}"
    command = ("python", "-c", "from pathlib import Path;Path('/work/started').touch()")
    plan = ContainerPlan(daemon_id=daemon, image_id=image_info["Id"], request_id=token,
        command=command, entrypoint=tuple(image_info["Config"].get("Entrypoint") or []),
        environment=tuple(image_info["Config"]["Env"]), user=user, working_dir="/work",
        memory_bytes=67108864, tasks=16, network="none",
        mounts=((str(source), "/input", True), (str(output), "/work", False)))
    container = docker("create", "--pull=never", "--label", "openplan.execution-request=" + token,
        "--memory=67108864", "--memory-swap=67108864", "--pids-limit=16", "--network=none",
        "--user", user, "--workdir=/work", "-v", str(source) + ":/input:ro",
        "-v", str(output) + ":/work", image, *command)
    try:
        def observed():
            value = json.loads(docker("inspect", container))[0]
            assert value["Id"] == container and value["Config"]["Labels"]["openplan.execution-request"] == token
            return value

        baseline = verify_created_container(plan, docker("info", "--format", "{{.ID}}"), observed())
        docker("update", "--memory-swap=134217728", container)
        try:
            verify_created_container(plan, daemon, observed())
        except ValueError as error:
            assert "resource policy differs" in str(error)
        else:
            raise AssertionError("Changed live container policy was accepted")
        docker("update", "--memory-swap=67108864", container)
        restored = verify_created_container(plan, daemon, observed())
        assert baseline == restored
        assert observed()["State"]["Status"] == "created"
        assert not (output / "started").exists()
        report = {"baseline": baseline, "changed_live_swap_policy_refused": True,
            "restored_identity_equal": True, "command_never_started": True,
            "source_sha256": hashlib.sha256((ROOT / "workers/activitysim_worker/container_identity.py").read_bytes()).hexdigest(),
            "limits": ["Created local Docker container only", "No controller, start, owner-loss cleanup or saved-identity authority"]}
    finally:
        docker("rm", container)
    report["owned_created_container_removed"] = True
    content = json.dumps(report, indent=2) + "\n"
    (root / "result.json").write_text(content)
    print(content)
