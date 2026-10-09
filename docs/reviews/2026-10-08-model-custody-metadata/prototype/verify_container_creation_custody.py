"""Retain normal and deliberately missing create replies from local Docker."""
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

from verify_created_container_identity import ROOT, docker
sys.path.insert(0, str(ROOT / "workers/activitysim_worker"))
from container_identity import ContainerPlan
from container_creation import ContainerCreation


def one(root, image_info, daemon, endpoint_hash, drop_reply):
    root.mkdir(mode=0o700)
    output = root / "output"
    output.mkdir()
    records = root / "custody"
    token = uuid.uuid4().hex
    user = f"{os.getuid()}:{os.getgid()}"
    command = ("python", "-c", "from pathlib import Path;Path('/work/started').touch()")
    plan = ContainerPlan(daemon_id=daemon, image_id=image_info["Id"], request_id=token,
        command=command, entrypoint=tuple(image_info["Config"].get("Entrypoint") or []),
        environment=tuple(image_info["Config"]["Env"]), user=user, working_dir="/work",
        memory_bytes=67108864, tasks=16, network="none", mounts=((str(output), "/work", False),))
    container = None
    try:
        with ContainerCreation(records, plan, endpoint_hash) as creation:
            creation.begin_create()
            assert (records / "intent.json").exists() and (records / "create-requested.json").exists()
            container = docker("create", "--pull=never", "--label", "openplan.execution-request=" + token,
                "--memory=67108864", "--memory-swap=67108864", "--pids-limit=16", "--network=none",
                "--user", user, "--workdir=/work", "-v", str(output) + ":/work", plan.image_id, *command)
            inspected = json.loads(docker("inspect", container))[0]
            assert inspected["Config"]["Labels"]["openplan.execution-request"] == token
            if not drop_reply:
                identity = creation.record_created(docker("info", "--format", "{{.ID}}"), inspected)
                assert identity["start_authorized"] is False
            try:
                creation.begin_create()
            except ValueError:
                pass
            else:
                raise AssertionError("Repeated create admission succeeded")
        try:
            ContainerCreation(records, plan, endpoint_hash)
        except FileExistsError:
            pass
        else:
            raise AssertionError("Existing custody became a fresh create admission")
        assert (records / "created.json").exists() is (not drop_reply)
        assert json.loads(docker("inspect", container))[0]["State"]["Status"] == "created"
        assert not (output / "started").exists()
        return {"case": "create-reply-unretained" if drop_reply else "created-reply-retained",
            "intent_and_request_retained_before_create": True, "command_not_started": True,
            "created_record_present": not drop_reply, "repeat_create_refused": True,
            "existing_directory_reopen_refused": True,
            "record_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in records.iterdir()}}
    finally:
        if container is not None:
            observed = json.loads(docker("inspect", container))[0]
            assert observed["Id"] == container and observed["Config"]["Labels"]["openplan.execution-request"] == token
            docker("rm", container)


if __name__ == "__main__":
    root = Path(os.environ["OPENPLAN_CONTAINER_CREATION_PROOF"])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    image = json.loads(docker("image", "inspect", os.environ["OPENPLAN_CONTAINER_CUSTODY_IMAGE"]))[0]
    daemon = docker("info", "--format", "{{.ID}}")
    endpoint = docker("context", "inspect", "--format", "{{json .Endpoints.docker}}")
    endpoint_hash = hashlib.sha256(endpoint.encode()).hexdigest()
    cases = [one(root / name, image, daemon, endpoint_hash, drop) for name, drop in (("retained", False), ("unretained", True))]
    report = {"cases": cases, "owned_created_containers_removed": True,
        "source_sha256": hashlib.sha256((ROOT / "workers/activitysim_worker/container_creation.py").read_bytes()).hexdigest(),
        "limits": ["Create reply deliberately not recorded after a successful local create",
            "No lost network response or controller crash injected", "Endpoint fingerprint does not freeze or authenticate future transport",
            "No startup, owner-loss termination, restart or database continuation authority"]}
    text = json.dumps(report, indent=2) + "\n"
    (root / "result.json").write_text(text)
    print(text)
