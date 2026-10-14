"""Supervise one exact progress POST without redirects or automatic retries."""
import base64
import ipaddress
import json
import os
from pathlib import Path
import selectors
import struct
import subprocess
import sys
import threading
import time

from draft_http import Transport as ChildSupervisor, exact_input, watch_parent
from runtime_progress_delivery import BODY_LIMIT, REPLY_LIMIT
from runtime_dispatch_custody import strict_object
from url_transport import Transport as AddressPolicy, connection, deadline_check, parse_url, resolve, response_length

WIRE_LIMIT = 128 * 1024
METADATA_LIMIT = 128 * 1024
ERROR_LIMIT = 4096
MAX_BODY_LIMIT = 64 * 1024


def decode_response(payload):
    if type(payload) is not bytes or not 0 < len(payload) <= WIRE_LIMIT:
        raise ValueError('Progress HTTP response wire bytes differ')
    value = json.loads(payload, object_pairs_hook=strict_object)
    if not isinstance(value, dict) or set(value) != {'status', 'bodyBase64'} or type(value['status']) is not int or not 100 <= value['status'] <= 599 or not isinstance(value['bodyBase64'], str):
        raise ValueError('Progress HTTP response envelope differs')
    reply = base64.b64decode(value['bodyBase64'], validate=True)
    if len(reply) > REPLY_LIMIT:
        raise ValueError('Progress HTTP response exceeds its bound')
    return value['status'], reply


class Transport:
    def __init__(self, callback_url, credential_reference, credentials, *,
                 allowed_networks=(), allowed_ports=(80, 443), cancelled=lambda: False,
                 ca_file=None, max_body_bytes=BODY_LIMIT):
        if not isinstance(credential_reference, str) or not credential_reference.strip() or len(credential_reference) > 256 or not callable(credentials):
            raise ValueError('Progress HTTP requires original endpoint and credential adapters')
        if type(max_body_bytes) is not int or not 1 <= max_body_bytes <= MAX_BODY_LIMIT:
            raise ValueError('Progress HTTP body allowance differs')
        self.max_body = max_body_bytes
        self.policy = AddressPolicy(allowed_networks=allowed_networks, allowed_ports=allowed_ports,
            max_redirects=0, cancelled=cancelled, ca_file=ca_file)
        parse_url(callback_url, self.policy.ports)
        self.url = callback_url; self.reference = credential_reference; self.credentials = credentials

    def _check(self, deadline, owned):
        if not callable(owned):
            raise ValueError('Progress HTTP requires boolean lifetime ownership')
        decision = owned()
        if type(decision) is not bool:
            raise ValueError('Progress HTTP requires boolean lifetime ownership')
        if decision is not True:
            raise InterruptedError('Progress HTTP ownership ended')
        self.policy._check(deadline)

    def __call__(self, url, credential_reference, body, deadline, *, owned):
        self._check(deadline, owned)
        if url != self.url or credential_reference != self.reference:
            raise ValueError('Progress HTTP original endpoint or credential reference differs')
        if type(body) is not bytes or not 0 < len(body) <= self.max_body:
            raise ValueError('Progress HTTP exact body bytes exceed their bound')
        try:
            token = self.credentials(self.reference)
        except Exception:
            raise ValueError('Progress HTTP credential resolution failed') from None
        if not isinstance(token, str) or not 0 < len(token) <= 8192 or any(ord(char) <= 32 or ord(char) >= 127 for char in token):
            raise ValueError('Progress HTTP credential value differs')
        metadata = json.dumps({'url': self.url, 'token': token, 'bodyBase64': base64.b64encode(body).decode(),
            'ports': self.policy.ports, 'networks': [str(net) for net in self.policy.networks],
            'caFile': self.policy.ca_file, 'deadline': deadline, 'maxBodyBytes': self.max_body}, allow_nan=False, separators=(',', ':')).encode()
        if len(metadata) > METADATA_LIMIT:
            raise ValueError('Progress HTTP metadata exceeds its bound')
        self._check(deadline, owned)
        lifetime_read, lifetime_write = os.pipe(); process = None
        try:
            process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--child', str(lifetime_read)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True,
                pass_fds=(lifetime_read,), bufsize=0, env={key: value for key, value in os.environ.items()
                    if key in {'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}})
            os.close(lifetime_read); lifetime_read = None
            pending = struct.pack('!I', len(metadata))+metadata; output = bytearray(); errors = bytearray()
            with selectors.DefaultSelector() as selector:
                for name, handle, event in [('input', process.stdin, selectors.EVENT_WRITE),
                        ('output', process.stdout, selectors.EVENT_READ), ('error', process.stderr, selectors.EVENT_READ)]:
                    os.set_blocking(handle.fileno(), False); selector.register(handle, event, name)
                while selector.get_map():
                    self._check(deadline, owned)
                    for key, _ in selector.select(min(0.05, max(0, deadline-time.monotonic()))):
                        self._check(deadline, owned)
                        if key.data == 'input':
                            try:
                                sent = os.write(key.fd, pending)
                            except BlockingIOError:
                                continue
                            pending = pending[sent:]
                            if not pending:
                                selector.unregister(key.fileobj); key.fileobj.close()
                            continue
                        try:
                            chunk = os.read(key.fd, WIRE_LIMIT)
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj); key.fileobj.close(); continue
                        target, limit = (output, WIRE_LIMIT) if key.data == 'output' else (errors, ERROR_LIMIT)
                        if len(target)+len(chunk) > limit:
                            raise ValueError('Progress HTTP child output exceeds its bound')
                        target.extend(chunk)
            self._check(deadline, owned)
            if process.wait(timeout=max(0.001, deadline-time.monotonic())) != 0 or errors:
                raise ValueError('Progress HTTP child did not complete')
            return decode_response(bytes(output))
        finally:
            if lifetime_read is not None: os.close(lifetime_read)
            os.close(lifetime_write)
            if process is not None:
                ChildSupervisor._stop(process)
                for handle in (process.stdin, process.stdout, process.stderr):
                    if handle is not None: handle.close()


def child(lifetime):
    threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()
    size = struct.unpack('!I', exact_input(4))[0]
    if size > METADATA_LIMIT:
        raise ValueError('Progress HTTP metadata exceeds its bound')
    value = json.loads(exact_input(size)); deadline = value['deadline']
    bound = value['maxBodyBytes']
    if type(bound) is not int or not 1 <= bound <= MAX_BODY_LIMIT:
        raise ValueError('Progress HTTP body allowance differs')
    body = base64.b64decode(value['bodyBase64'], validate=True)
    if not 0 < len(body) <= bound:
        raise ValueError('Progress HTTP child body exceeds its allowance')
    deadline_check(deadline)
    parts, port = parse_url(value['url'], value['ports'])
    rows = resolve(parts, port, tuple(ipaddress.ip_network(net, strict=True) for net in value['networks']))
    deadline_check(deadline)
    client = connection(parts, port, rows, deadline, value['caFile'])
    try:
        client.request('POST', (parts.path or '/')+('?' + parts.query if parts.query else ''), body=body,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                'Accept-Encoding': 'identity', 'Authorization': 'Bearer '+value['token'], 'User-Agent': 'openplan-odm-worker'})
        response = client.getresponse(); deadline_check(deadline)
        length = response_length(response.headers, REPLY_LIMIT)
        reply = response.read(REPLY_LIMIT+1)
        if len(reply) > REPLY_LIMIT or length is not None and len(reply) != length or response.length not in (None, 0):
            raise ValueError('Progress HTTP response bytes differ')
        deadline_check(deadline)
        sys.stdout.buffer.write(json.dumps({'status': response.status,
            'bodyBase64': base64.b64encode(reply).decode()}, separators=(',', ':')).encode())
        sys.stdout.buffer.flush()
    finally:
        client.close()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] != '--child':
            raise ValueError('Progress HTTP owned child invocation is required')
        child(int(sys.argv[2]))
    except Exception:
        sys.stderr.write('Progress HTTP transport failed\n'); sys.exit(2)
