"""Real local HTTP sockets with synthetic Docker replies and dropped responses."""
import copy
import http.server
import json
from pathlib import Path
import socket
import socketserver
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs
from dataclasses import replace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from container_creation import ContainerCreation
from container_transport import LocalDocker, DockerTransportError
import container_transport as transport
import test_container_identity as fixtures


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def reply(self, status, body):
        content = json.dumps(body).encode()
        if self.path == "/version":
            content += b" " * max(0, self.server.version_bytes - len(content))
            status = self.server.version_status
        self.send_response(status)
        self.send_header("Content-Length", str(len(content)))
        if self.server.close_version and self.path == "/version":
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        self.server.requests.append(("GET", self.path, None))
        if self.path == "/version":
            self.reply(200, self.server.version)
        elif self.path.endswith("/info"):
            self.reply(200, {"ID": "synthetic-daemon"})
        elif self.path.startswith("/v1.51/containers/json?"):
            self.reply(200, self.server.candidates)
        else:
            self.reply(200, self.server.inspection)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append(("POST", self.path, body))
        self.server.reserved_before_post = all((self.server.records / name).exists()
            for name in ("intent.json", "create-requested.json"))
        if self.server.drop_create:
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        self.reply(201, {"Id": "3" * 64, "Warnings": self.server.warnings})


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True

    def get_request(self):
        result = super().get_request()
        self.connections += 1
        return result


@unittest.skipUnless(sys.platform == "linux", "Linux Unix peer credentials required")
class ContainerTransportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.socket_path = self.root / "docker.sock"
        fixture = fixtures.ContainerIdentityTests()
        fixture.setUp()
        self.plan = fixture.plan
        self.server = Server(str(self.socket_path), Handler)
        self.server.inspection = copy.deepcopy(fixture.observed)
        self.server.version = {"ApiVersion": "1.52", "MinAPIVersion": "1.44"}
        self.server.version_bytes = 0
        self.server.version_status = 200
        self.server.warnings = []
        self.server.candidates = [{"Id": "3" * 64}]
        self.server.requests = []
        self.server.connections = 0
        self.server.drop_create = self.server.close_version = False
        self.server.records = self.root / "custody"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        self.thread.start()
        self.client = None
        self.addCleanup(self.cleanup)

    def cleanup(self):
        if self.client:
            self.client.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def connect(self):
        self.client = LocalDocker(self.socket_path)
        return self.client

    def test_create_retains_intent_response_and_verified_identity(self):
        client = self.connect()
        with ContainerCreation(self.server.records, self.plan, client.endpoint_sha256) as creation:
            identity = client.create_reserved(creation)
        self.assertTrue(self.server.reserved_before_post)
        posts = [entry for entry in self.server.requests if entry[0] == "POST"]
        self.assertEqual(len(posts), 1)
        payload = posts[0][2]
        self.assertEqual(payload["Image"], self.plan.image_id)
        self.assertEqual(payload["HostConfig"]["MemorySwap"], self.plan.memory_bytes)
        self.assertEqual(payload["HostConfig"]["Mounts"][0]["ReadOnly"], True)
        self.assertIs(identity["start_authorized"], False)
        response = json.loads((self.server.records / "create-response.json").read_text())
        self.assertEqual(response["container_id"], identity["container_id"])
        self.assertTrue((self.server.records / "created.json").exists())
        self.assertEqual(self.server.connections, 1)

    def test_dropped_create_reply_never_reconnects_or_repeats_create(self):
        client = self.connect()
        self.server.drop_create = True
        with ContainerCreation(self.server.records, self.plan, client.endpoint_sha256) as creation:
            with self.assertRaises(DockerTransportError):
                client.create_reserved(creation)
            with self.assertRaises(DockerTransportError):
                client.inspect("3" * 64)
            with self.assertRaisesRegex(ValueError, "already reserved"):
                client.create_reserved(creation)
        self.assertTrue((self.server.records / "create-requested.json").exists())
        self.assertFalse((self.server.records / "create-response.json").exists())
        self.assertFalse((self.server.records / "created.json").exists())
        self.assertEqual(len([entry for entry in self.server.requests if entry[0] == "POST"]), 1)
        self.assertEqual(self.server.connections, 1)

    def test_connection_close_during_handshake_is_not_reopened(self):
        self.server.close_version = True
        with self.assertRaises(DockerTransportError):
            self.connect()
        self.assertEqual(self.server.connections, 1)
        self.assertEqual(len(self.server.requests), 1)

    def test_other_endpoint_refuses_before_create_reservation(self):
        client = self.connect()
        with ContainerCreation(self.server.records, self.plan, "a" * 64) as creation:
            with self.assertRaisesRegex(ValueError, "connected endpoint"):
                client.create_reserved(creation)
        self.assertFalse((self.server.records / "create-requested.json").exists())
        self.assertFalse(any(entry[0] == "POST" for entry in self.server.requests))

    def test_inspection_cannot_substitute_another_container_id(self):
        client = self.connect()
        self.server.inspection["Id"] = "4" * 64
        with ContainerCreation(self.server.records, self.plan, client.endpoint_sha256) as creation:
            with self.assertRaisesRegex(DockerTransportError, "differs from creation response"):
                client.create_reserved(creation)
        self.assertTrue((self.server.records / "create-response.json").exists())
        self.assertFalse((self.server.records / "created.json").exists())

    def test_unsupported_api_is_refused(self):
        self.server.version = {"ApiVersion": "1.40", "MinAPIVersion": "1.24"}
        with self.assertRaisesRegex(DockerTransportError, "unavailable"):
            self.connect()
        self.assertEqual(len(self.server.requests), 1)

    def test_unexpected_http_status_is_refused(self):
        self.server.version_status = 201
        with self.assertRaises(DockerTransportError):
            self.connect()

    def test_valid_json_over_response_limit_is_refused(self):
        self.server.version_bytes = 101
        with patch.object(transport, "MAX_RESPONSE_BYTES", 100), self.assertRaises(DockerTransportError):
            self.connect()

    def test_creation_warning_remains_unverified(self):
        client = self.connect()
        self.server.warnings = ["synthetic unsupported policy"]
        with ContainerCreation(self.server.records, self.plan, client.endpoint_sha256) as creation:
            with self.assertRaisesRegex(DockerTransportError, "warnings"):
                client.create_reserved(creation)
        self.assertTrue((self.server.records / "create-response.json").exists())
        self.assertFalse((self.server.records / "created.json").exists())

    def test_other_user_peer_is_refused(self):
        with patch.object(transport.struct, "unpack", return_value=(123, 987654, 987654)):
            with self.assertRaises(DockerTransportError):
                self.connect()

    def test_lost_reply_can_be_observed_without_repeating_creation(self):
        client = self.connect()
        self.server.drop_create = True
        with ContainerCreation(self.server.records, self.plan, client.endpoint_sha256) as creation:
            with self.assertRaises(DockerTransportError):
                client.create_reserved(creation)
        original = {p.name: p.read_bytes() for p in self.server.records.iterdir()}
        observation = self.connect().observe_creation(self.plan)
        self.assertEqual(observation["outcome"], "verified_unstarted")
        for flag in ("start_authorized", "signal_authorized", "continuation_authorized", "retry_authorized"):
            self.assertIs(observation[flag], False)
        self.assertEqual(original, {p.name: p.read_bytes() for p in self.server.records.iterdir()})
        self.assertEqual(sum(method == "POST" for method, _, _ in self.server.requests), 1)
        lists = [path for _, path, _ in self.server.requests if "/containers/json?" in path]
        self.assertEqual(len(lists), 1)
        query = parse_qs(urlparse(lists[0]).query)
        self.assertEqual(query["all"], ["1"])
        self.assertEqual(json.loads(query["filters"][0]), {"label": ["openplan.execution-request=" + self.plan.request_id]})

    def test_absence_and_ambiguity_do_not_authorize_retry(self):
        client = self.connect()
        for candidates, outcome in [([], "not_observed"), ([{"Id": "3" * 64}] * 2, "ambiguous")]:
            self.server.candidates = candidates
            result = client.observe_creation(self.plan)
            self.assertEqual(result["outcome"], outcome)
            self.assertIs(result["retry_authorized"], False)
        self.assertFalse(any(path.endswith("/json") for _, path, _ in self.server.requests))

    def test_recovery_refuses_changed_daemon_before_listing(self):
        client = self.connect()
        with self.assertRaisesRegex(ValueError, "original daemon"):
            client.observe_creation(replace(self.plan, daemon_id="another-daemon"))
        self.assertFalse(any("/containers/" in path for _, path, _ in self.server.requests))

    def test_recovery_rechecks_full_inspection_and_exact_id(self):
        client = self.connect()
        original = copy.deepcopy(self.server.inspection)
        self.server.inspection["Id"] = "4" * 64
        with self.assertRaisesRegex(DockerTransportError, "another container"):
            client.observe_creation(self.plan)
        self.server.inspection = original
        self.server.inspection["Config"]["Cmd"] = ["unexpected-command"]
        with self.assertRaises(ValueError):
            client.observe_creation(self.plan)
