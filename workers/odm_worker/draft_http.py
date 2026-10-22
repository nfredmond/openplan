"""One supervised original init/upload request, with no retry or commit.

The caller supplies live authority and engine attestation separately. Ending the
owned child does not prove that a remote server discarded already received bytes.
"""
import base64
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import selectors
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlencode, urlsplit
import uuid

from engine_effects import RESPONSE_LIMIT, engine_identity, same

CHUNK = 128 * 1024
METADATA_LIMIT = 1024 * 1024
WIRE_LIMIT = 2 * 1024 * 1024
ERROR_LIMIT = 4096
TASK = r'[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'


def command_size(command, stream_present):
    if not isinstance(command, dict) or command.get('method') != 'POST':
        raise ValueError('Only original init/upload HTTP commands are permitted')
    if command.get('path') == '/task/new/init':
        if set(command) != {'method', 'path', 'headers', 'form'} or stream_present:
            raise ValueError('Original HTTP initialization shape differs')
        headers, form = command['headers'], command['form']
        if not isinstance(headers, dict) or set(headers) != {'set-uuid'} or not isinstance(headers['set-uuid'], str) or not re.fullmatch(TASK, headers['set-uuid']) or not isinstance(form, dict) or set(form) != {'name', 'options'} or not isinstance(form['name'], str) or not form['name'].strip() or len(form['name']) > 512 or not isinstance(form['options'], str):
            raise ValueError('Original HTTP initialization fields differ')
        return 0
    if not isinstance(command.get('path'), str) or not re.fullmatch('/task/new/upload/'+TASK, command['path']):
        raise ValueError('Only original init/upload HTTP commands are permitted')
    descriptor = command.get('multipart')
    if set(command) != {'method', 'path', 'multipart'} or not stream_present or not isinstance(descriptor, dict) or descriptor.get('field') != 'images' or type(descriptor.get('bytes')) is not int or descriptor['bytes'] < 0 or not isinstance(descriptor.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', descriptor['sha256']) or not isinstance(descriptor.get('filename'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|tif|tiff)', descriptor['filename']):
        raise ValueError('Original HTTP upload descriptor differs')
    return descriptor['bytes']


def finite_deadline(deadline):
    if type(deadline) not in (int, float) or not math.isfinite(deadline):
        raise ValueError('Original HTTP deadline must be finite')
    if time.monotonic() >= deadline:
        raise TimeoutError('Original draft HTTP deadline exceeded')


def decode_response(payload):
    if len(payload) > WIRE_LIMIT:
        raise ValueError('Original HTTP child output exceeds its bound')
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:raise ValueError('Original HTTP child response has duplicate keys')
            result[key] = value
        return result
    value = json.loads(payload, object_pairs_hook=pairs)
    if not isinstance(value, dict) or set(value) != {'status', 'bodyBase64'} or type(value['status']) is not int or not isinstance(value['bodyBase64'], str):
        raise ValueError('Original HTTP child response envelope differs')
    body = base64.b64decode(value['bodyBase64'], validate=True)
    if len(body) > RESPONSE_LIMIT:
        raise ValueError('Original HTTP response exceeds its bound')
    return value['status'], body


class Transport:
    def __init__(self, engine, credentials, cancelled=lambda: False):
        if sys.platform != 'linux' or not callable(credentials) or not callable(cancelled):
            raise ValueError('Linux original HTTP supervision and explicit adapters are required')
        self.engine = engine_identity(engine)
        self.credentials = credentials
        self.cancelled = cancelled

    def _check(self, deadline):
        decision = self.cancelled()
        if type(decision) is not bool:
            raise ValueError('HTTP cancellation adapter must return a boolean')
        if decision:
            raise InterruptedError('Original draft HTTP transport cancelled')
        finite_deadline(deadline)

    @staticmethod
    def _stop(process):
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)

    def __call__(self, engine, command, stream, deadline):
        self._check(deadline)
        original_engine = engine_identity(engine)
        if not same(original_engine, self.engine):
            raise ValueError('Original HTTP engine identity differs')
        command = json.loads(json.dumps(command, allow_nan=False))
        count = command_size(command, stream is not None)
        try:
            token = self.credentials(original_engine['credentialReference'])
        except Exception:
            raise ValueError('Original engine credential resolution failed') from None
        if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):
            raise ValueError('Original engine credential value differs')
        metadata = json.dumps({'engine': original_engine, 'command': command, 'token': token,
                               'deadline': deadline, 'streamPresent': stream is not None},
                              allow_nan=False, separators=(',', ':')).encode()
        if len(metadata) > METADATA_LIMIT:
            raise ValueError('Original HTTP metadata exceeds its bound')
        self._check(deadline)
        lifetime_read, lifetime_write = os.pipe()
        process = None
        try:
            process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()),
                                        '--child', str(lifetime_read)], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       close_fds=True, pass_fds=(lifetime_read,), bufsize=0,
                                       env={key:value for key,value in os.environ.items()
                                            if key in {'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}})
            os.close(lifetime_read);lifetime_read = None
            with selectors.DefaultSelector() as selector:
                for name, handle, event in [('input', process.stdin, selectors.EVENT_WRITE),
                                             ('output', process.stdout, selectors.EVENT_READ),
                                             ('error', process.stderr, selectors.EVENT_READ)]:
                    os.set_blocking(handle.fileno(), False)
                    selector.register(handle, event, name)
                pending = struct.pack('!I', len(metadata))+metadata
                remaining = count
                output, errors = bytearray(), bytearray()
                while selector.get_map():
                    self._check(deadline)
                    for key, _event in selector.select(min(0.05, max(0, deadline-time.monotonic()))):
                        self._check(deadline)
                        if key.data == 'input':
                            if not pending:
                                if remaining:
                                    pending = stream.read(min(CHUNK, remaining))
                                    if not isinstance(pending, bytes) or not pending or len(pending) > remaining:
                                        raise ValueError('Original HTTP image stream ended early or differs')
                                    remaining -= len(pending)
                                else:
                                    if stream is not None and stream.read(1):
                                        raise ValueError('Original HTTP image stream exceeds its descriptor')
                                    selector.unregister(key.fileobj);key.fileobj.close()
                                    continue
                            try:
                                written = os.write(key.fd, pending)
                            except BlockingIOError:
                                continue
                            pending = pending[written:]
                        else:
                            try:
                                chunk = os.read(key.fd, CHUNK)
                            except BlockingIOError:
                                continue
                            if not chunk:
                                selector.unregister(key.fileobj);key.fileobj.close()
                                continue
                            target, limit = (output, WIRE_LIMIT) if key.data == 'output' else (errors, ERROR_LIMIT)
                            if len(target)+len(chunk) > limit:
                                raise ValueError('Original HTTP child output exceeds its bound')
                            target.extend(chunk)
                self._check(deadline)
                if process.wait(timeout=max(0.001, deadline-time.monotonic())) != 0:
                    raise RuntimeError('Original draft HTTP child failed')
                return decode_response(output)
        finally:
            os.close(lifetime_write)
            if lifetime_read is not None:os.close(lifetime_read)
            if process is not None:
                self._stop(process)
                for handle in (process.stdin, process.stdout, process.stderr):
                    if not handle.closed:handle.close()


def watch_parent(descriptor):
    try:
        os.read(descriptor, 1)
    finally:
        os._exit(97)


def exact_input(count):
    result = bytearray()
    while len(result) < count:
        chunk = sys.stdin.buffer.read(count-len(result))
        if not chunk:
            raise ValueError('Original HTTP child input is incomplete')
        result.extend(chunk)
    return bytes(result)


def child(lifetime):
    threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()
    size = struct.unpack('!I', exact_input(4))[0]
    if size > METADATA_LIMIT:
        raise ValueError('Original HTTP metadata exceeds its bound')
    metadata = json.loads(exact_input(size))
    engine = engine_identity(metadata['engine'])
    command = metadata['command']
    count = command_size(command, metadata['streamPresent'])
    deadline = metadata['deadline'];finite_deadline(deadline)
    endpoint = urlsplit(engine['endpoint'])
    factory = http.client.HTTPSConnection if endpoint.scheme == 'https' else http.client.HTTPConnection
    connection = factory(endpoint.hostname, endpoint.port, timeout=max(0.001, deadline-time.monotonic()))
    token = metadata['token']
    path = endpoint.path+command['path']+('?' + urlencode({'token': token}) if token is not None else '')
    try:
        boundary = 'openplan-'+uuid.uuid4().hex
        if command['path'] == '/task/new/init':
            prefix = b''.join((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n').encode()+value.encode()+b'\r\n' for name,value in command['form'].items())
            suffix = ('--'+boundary+'--\r\n').encode()
        else:
            prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="images"; filename="{command["multipart"]["filename"]}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
            suffix = ('\r\n--'+boundary+'--\r\n').encode()
        content_type = 'multipart/form-data; boundary='+boundary
        connection.putrequest('POST', path)
        connection.putheader('Content-Length', str(len(prefix)+count+len(suffix)))
        connection.putheader('Content-Type', content_type)
        for name, value in command.get('headers', {}).items():connection.putheader(name, value)
        connection.endheaders();connection.send(prefix)
        checksum = hashlib.sha256();remaining = count
        while remaining:
            finite_deadline(deadline)
            chunk = exact_input(min(CHUNK, remaining))
            checksum.update(chunk);connection.send(chunk);remaining -= len(chunk)
        if command['path'] != '/task/new/init' and checksum.hexdigest() != command['multipart']['sha256']:
            raise ValueError('Original HTTP streamed image hash differs')
        connection.send(suffix)
        finite_deadline(deadline)
        response = connection.getresponse()
        body = response.read(RESPONSE_LIMIT+1)
        if len(body) > RESPONSE_LIMIT:
            raise ValueError('Original HTTP response exceeds its bound')
        if response.length not in (None, 0):
            raise ValueError('Original HTTP response is incomplete')
        finite_deadline(deadline)
        payload = {'status': response.status, 'bodyBase64': base64.b64encode(body).decode()}
        sys.stdout.buffer.write(json.dumps(payload, separators=(',', ':')).encode())
        sys.stdout.buffer.flush()
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] != '--child':
            raise ValueError('Owned original HTTP child invocation is required')
        child(int(sys.argv[2]))
    except Exception:
        sys.stderr.write('Original draft HTTP transport failed\n')
        sys.exit(2)
