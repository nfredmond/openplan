"""Discard a real Docker create reply, then observe without repeating creation."""
import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import socketserver
import sys
import threading
import uuid

from verify_created_container_identity import ROOT, docker
sys.path.insert(0, str(ROOT / 'workers/activitysim_worker'))
from container_identity import ContainerPlan
from container_creation import ContainerCreation
from container_transport import LocalDocker, DockerTransportError, _UnixConnection


class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def forward(self):
        upstream = _UnixConnection(Path('/run/docker.sock'))
        try:
            body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            upstream.request(self.command, self.path, body=body, headers={'Content-Type': 'application/json'})
            reply = upstream.getresponse()
            content = reply.read(1024 * 1024)
            if self.command == 'POST':
                assert self.path.endswith('/containers/create') and reply.status == 201
                self.server.posts += 1
                self.server.container_id = json.loads(content)['Id']
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.send_response(reply.status)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        finally:
            upstream.close()

    do_GET = forward
    do_POST = forward


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


if __name__ == '__main__':
    root = Path(os.environ['OPENPLAN_CONTAINER_LOST_REPLY_PROOF'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    output = root / 'output'
    output.mkdir()
    server = Server(str(root / 'proxy.sock'), Proxy)
    server.posts = 0
    server.container_id = None
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
    thread.start()
    request = uuid.uuid4().hex
    try:
        image = json.loads(docker('--host', 'unix:///run/docker.sock', 'image', 'inspect',
                                  os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE']))[0]
        with LocalDocker(root / 'proxy.sock') as client:
            plan = ContainerPlan(daemon_id=client.daemon_id, image_id=image['Id'], request_id=request,
                command=('python', '-c', "from pathlib import Path;Path('/work/started').touch()"),
                entrypoint=tuple(image['Config'].get('Entrypoint') or []), environment=tuple(image['Config']['Env']),
                user=f'{os.getuid()}:{os.getgid()}', working_dir='/work', memory_bytes=67108864,
                tasks=16, network='none', mounts=((str(output), '/work', False),))
            records = root / 'custody'
            with ContainerCreation(records, plan, client.endpoint_sha256) as creation:
                try:
                    client.create_reserved(creation)
                except DockerTransportError:
                    pass
                else:
                    raise AssertionError('Create reply was not lost')
        original = {p.name: p.read_bytes() for p in records.iterdir()}
        assert set(original) == {'intent.json', 'create-requested.json'}
        with LocalDocker(Path('/run/docker.sock')) as observer:
            observation = observer.observe_creation(plan)
        assert observation['outcome'] == 'verified_unstarted'
        assert observation['identity']['container_id'] == server.container_id
        assert all(observation[key] is False for key in
                   ('start_authorized', 'signal_authorized', 'continuation_authorized', 'retry_authorized'))
        assert {p.name: p.read_bytes() for p in records.iterdir()} == original
        assert server.posts == 1 and not (output / 'started').exists()
        report = {'observation': observation, 'actual_create_reply_discarded': True,
                  'creation_requests': server.posts, 'records_unchanged': True, 'command_not_started': True,
                  'source_sha256': hashlib.sha256((ROOT / 'workers/activitysim_worker/container_transport.py').read_bytes()).hexdigest(),
                  'limits': ['Private Unix proxy discards reply after actual daemon creation',
                             'Read-only observation uses a new explicit connection to the same daemon',
                             'No controller, startup, owner-loss termination or scientific acceptance']}
    finally:
        if server.container_id:
            observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', server.container_id))[0]
            assert observed['Id'] == server.container_id
            assert observed['Config']['Labels']['openplan.execution-request'] == request
            assert observed['State']['Status'] == 'created'
            docker('--host', 'unix:///run/docker.sock', 'rm', server.container_id)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    report['owned_unstarted_container_removed'] = True
    text = json.dumps(report, indent=2) + '\n'
    (root / 'result.json').write_text(text)
    print(text)
