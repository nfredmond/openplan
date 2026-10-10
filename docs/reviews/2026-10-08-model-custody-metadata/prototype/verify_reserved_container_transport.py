"""Create through the pinned local transport, retaining every response boundary."""
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
from container_transport import LocalDocker, DockerTransportError


if __name__ == "__main__":
    root = Path(os.environ["OPENPLAN_CONTAINER_TRANSPORT_PROOF"])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    output = root / "output"
    output.mkdir()
    image = json.loads(docker("image", "inspect", os.environ["OPENPLAN_CONTAINER_CUSTODY_IMAGE"]))[0]
    token = uuid.uuid4().hex
    container = None
    client = LocalDocker(Path("/var/run/docker.sock"))
    try:
        plan = ContainerPlan(daemon_id=client.daemon_id, image_id=image["Id"], request_id=token,
            command=("python", "-c", "from pathlib import Path;Path('/work/started').touch()"),
            entrypoint=tuple(image["Config"].get("Entrypoint") or []), environment=tuple(image["Config"]["Env"]),
            user=f"{os.getuid()}:{os.getgid()}", working_dir="/work", memory_bytes=67108864,
            tasks=16, network="none", mounts=((str(output), "/work", False),))
        records = root / "custody"
        with ContainerCreation(records, plan, client.endpoint_sha256) as creation:
            identity = client.create_reserved(creation)
            container = identity["container_id"]
            try:
                client.create_reserved(creation)
            except ValueError as error:
                assert "already reserved" in str(error)
            else:
                raise AssertionError("Repeated creation reached the daemon")
        assert {p.name for p in records.iterdir()} == {"intent.json", "create-requested.json", "create-response.json", "created.json"}
        observed = client.inspect(container)
        assert observed["State"]["Status"] == "created"
        assert observed["Config"]["Labels"]["openplan.execution-request"] == token
        assert not (output / "started").exists()
        matches = docker("--host", "unix:///var/run/docker.sock", "ps", "--all", "--no-trunc", "--quiet",
                         "--filter", "label=openplan.execution-request=" + token).splitlines()
        assert matches == [container]
        report = {"transport_identity": client.identity, "endpoint_sha256": client.endpoint_sha256,
            "created_identity": identity, "all_four_records_retained": True,
            "repeat_create_refused": True, "exactly_one_matching_container": True,
            "command_not_started": True,
            "record_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in records.iterdir()},
            "source_sha256": hashlib.sha256((ROOT / "workers/activitysim_worker/container_transport.py").read_bytes()).hexdigest(),
            "limits": ["Live local Docker creation only", "No automatic reconnect or retry",
                       "No independent controller, startup or owner-loss termination"]}
    finally:
        # Failed verification can still leave a known unstarted container.
        if container is None and (root / "custody/create-response.json").exists():
            container = json.loads((root / "custody/create-response.json").read_text())["container_id"]
        if container is not None:
            observed = json.loads(docker("--host", "unix:///var/run/docker.sock", "inspect", container))[0]
            assert observed["Id"] == container and observed["Config"]["Labels"]["openplan.execution-request"] == token
            assert observed["State"]["Status"] == "created"
            docker("--host", "unix:///var/run/docker.sock", "rm", container)
        client.close()
    try:
        client.inspect(container)
    except DockerTransportError:
        pass
    else:
        raise AssertionError("Closed transport reopened")
    report["owned_created_container_removed"] = True
    report["closed_transport_refused"] = True
    text = json.dumps(report, indent=2) + "\n"
    (root / "result.json").write_text(text)
    print(text)
