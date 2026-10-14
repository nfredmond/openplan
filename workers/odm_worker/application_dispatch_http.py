"""One bounded private original-dispatch read from a fixed operator endpoint.

The owned child carries credentials in its pipe, refuses redirects and stops
on cancellation, deadline or parent loss. No engine command is sent here.
"""
import http.client
import json
import math
import os
from pathlib import Path
import selectors
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

from draft_http import Transport as DraftTransport, exact_input, watch_parent
from runtime_dispatch_custody import MAX_BYTES, strict_object

CHUNK = 128 * 1024
METADATA_LIMIT = 128 * 1024
RESPONSE_LIMIT = 6 * MAX_BYTES + 1024 * 1024
ERROR_LIMIT = 4096
PARAMETERS = {'p_request', 'p_installation', 'p_target'}
DEFAULT_RPC = 'read_aerial_original_dispatch'
DELIVERY_RPC = 'read_aerial_delivery_authority'
DELIVERY_PARAMETERS = PARAMETERS | {'p_reference', 'p_operation', 'p_callback'}
DELIVERY_BODY_LIMIT = 64 * 1024


def rpc_name(value):
    if not isinstance(value, str) or value not in (DEFAULT_RPC, DELIVERY_RPC):
        raise ValueError('Private dispatch RPC selection differs')
    return value


def delivery_parameters(value):
    if (not isinstance(value, dict) or set(value) != DELIVERY_PARAMETERS
            or any(not isinstance(value[key], str) or not value[key].strip() or len(value[key]) > 4096
                for key in DELIVERY_PARAMETERS - {'p_callback'})):
        raise ValueError('Private delivery RPC parameters differ')
    from application_delivery_authority import ARTIFACT, TERMINAL
    if (value['p_operation'] not in (ARTIFACT, TERMINAL)
            or (value['p_operation'] == ARTIFACT and value['p_callback'] is not None)
            or (value['p_operation'] == TERMINAL and not isinstance(value['p_callback'], dict))):
        raise ValueError('Private delivery RPC operation differs')
    if value['p_callback'] is not None:
        try:
            raw = json.dumps(value['p_callback'], ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
        except (ValueError, UnicodeError, TypeError, RecursionError):
            raise ValueError('Private delivery callback JSON differs') from None
        if len(raw) > DELIVERY_BODY_LIMIT:
            raise ValueError('Private delivery callback exceeds its bound')
    return dict(value)


def endpoint(value, allow_http):
    if type(allow_http) is not bool or not isinstance(value, str) or not value or len(value) > 2048 or any(ord(char) <= 32 or ord(char) >= 127 for char in value) or '\\' in value:
        raise ValueError('Private dispatch endpoint differs')
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        raise ValueError('Private dispatch endpoint differs') from None
    if parts.scheme not in (('https', 'http') if allow_http else ('https',)) or not parts.hostname or parts.username is not None or parts.password is not None or '?' in value or '#' in value or '%' in parts.hostname or parts.path not in ('', '/rest/v1') or port is not None and not 1 <= port <= 65535:
        raise ValueError('Private dispatch endpoint differs')
    return parts


def credentials(value):
    if not isinstance(value, dict) or set(value) != {'apiKey', 'bearerToken'}:
        raise ValueError('Private dispatch credentials differ')
    for key, token in value.items():
        if key == 'bearerToken' and token is None:
            continue
        if not isinstance(token, str) or not 1 <= len(token) <= 8192 or any(ord(char) <= 32 or ord(char) >= 127 for char in token):
            raise ValueError('Private dispatch credentials differ')
    return dict(value)


def parameters(value):
    if not isinstance(value, dict) or set(value) != PARAMETERS or any(not isinstance(item, str) or not item.strip() or len(item) > 4096 for item in value.values()):
        raise ValueError('Private dispatch RPC parameters differ')
    return dict(value)


def deadline_check(deadline):
    if type(deadline) not in (int, float) or not math.isfinite(deadline):
        raise ValueError('Private dispatch deadline must be finite')
    if time.monotonic() >= deadline:
        raise TimeoutError('Private dispatch deadline exceeded')


class Transport:
    def __init__(self, url, credential_reference, resolve, *, cancelled=lambda: False, allow_http=False, max_response_bytes=RESPONSE_LIMIT, rpc=DEFAULT_RPC):
        self.rpc = rpc_name(rpc)
        endpoint(url, allow_http)
        if sys.platform != 'linux' or not isinstance(credential_reference, str) or not credential_reference.strip() or len(credential_reference) > 256 or not callable(resolve) or not callable(cancelled):
            raise ValueError('Private dispatch supervision and credential adapter are required')
        if type(max_response_bytes) is not int or not 1 <= max_response_bytes <= RESPONSE_LIMIT:
            raise ValueError('Private dispatch response bound differs')
        self.url = url;self.reference = credential_reference;self.resolve = resolve
        self.cancelled = cancelled;self.allow_http = allow_http;self.max_response = max_response_bytes

    def _check(self, deadline, owned):
        ownership = owned()
        if type(ownership) is not bool:
            raise ValueError('Private dispatch ownership must be a boolean')
        if not ownership:
            raise InterruptedError('Private dispatch runtime ownership ended')
        decision = self.cancelled()
        if type(decision) is not bool:
            raise ValueError('Private dispatch cancellation must be a boolean')
        if decision:
            raise InterruptedError('Private dispatch read cancelled')
        deadline_check(deadline)

    def __call__(self, arguments, deadline, *, owned=lambda: True):
        if not callable(owned):
            raise ValueError('Private dispatch ownership adapter is required')
        self._check(deadline, owned)
        endpoint(self.url, self.allow_http)
        arguments = parameters(arguments) if self.rpc == DEFAULT_RPC else delivery_parameters(arguments)
        try:
            resolved = self.resolve(self.reference)
        except Exception:
            raise ValueError('Private dispatch credential resolution failed') from None
        tokens = credentials(resolved)
        self._check(deadline, owned)
        metadata = json.dumps({'endpoint': self.url, 'allowHttp': self.allow_http, 'credentials': tokens,
            'parameters': arguments, 'deadline': deadline, 'maxResponseBytes': self.max_response,
            **({'rpc': self.rpc} if self.rpc != DEFAULT_RPC else {})},
            ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
        if len(metadata) > METADATA_LIMIT:
            raise ValueError('Private dispatch metadata exceeds its bound')
        lifetime_read, lifetime_write = os.pipe()
        process = None
        try:
            process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--child', str(lifetime_read)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True,
                pass_fds=(lifetime_read,), bufsize=0,
                env={key: value for key, value in os.environ.items() if key in {'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}})
            os.close(lifetime_read);lifetime_read = None
            pending = struct.pack('!I', len(metadata)) + metadata
            output, errors = bytearray(), bytearray()
            with selectors.DefaultSelector() as selector:
                for name, handle, event in [('input', process.stdin, selectors.EVENT_WRITE), ('output', process.stdout, selectors.EVENT_READ), ('error', process.stderr, selectors.EVENT_READ)]:
                    os.set_blocking(handle.fileno(), False);selector.register(handle, event, name)
                while selector.get_map():
                    self._check(deadline, owned)
                    for key, _event in selector.select(min(.05, max(0, deadline - time.monotonic()))):
                        self._check(deadline, owned)
                        if key.data == 'input':
                            try:
                                written = os.write(key.fd, pending)
                            except BlockingIOError:
                                continue
                            pending = pending[written:]
                            if not pending:
                                selector.unregister(key.fileobj);key.fileobj.close()
                            continue
                        try:
                            chunk = os.read(key.fd, CHUNK)
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj);key.fileobj.close();continue
                        target, bound = (output, self.max_response) if key.data == 'output' else (errors, ERROR_LIMIT)
                        if len(chunk) > bound - len(target):
                            raise ValueError('Private dispatch child output exceeds its bound')
                        target.extend(chunk)
            self._check(deadline, owned)
            if process.wait(timeout=max(.001, deadline - time.monotonic())) != 0 or errors or not output:
                raise ValueError('Private dispatch RPC read did not complete')
            return bytes(output)
        finally:
            if lifetime_read is not None:
                os.close(lifetime_read)
            os.close(lifetime_write)
            if process is not None:
                DraftTransport._stop(process)
                for handle in (process.stdin, process.stdout, process.stderr):
                    if handle is not None:
                        handle.close()


def child(lifetime):
    threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()
    size = struct.unpack('!I', exact_input(4))[0]
    if size > METADATA_LIMIT:
        raise ValueError('Private dispatch metadata exceeds its bound')
    value = json.loads(exact_input(size), object_pairs_hook=strict_object)
    if not isinstance(value, dict) or set(value) not in ({'endpoint', 'allowHttp', 'credentials', 'parameters', 'deadline', 'maxResponseBytes'}, {'endpoint', 'allowHttp', 'credentials', 'parameters', 'deadline', 'maxResponseBytes', 'rpc'}):
        raise ValueError('Private dispatch metadata differs')
    rpc = rpc_name(value.get('rpc', DEFAULT_RPC))
    parts = endpoint(value['endpoint'], value['allowHttp'])
    tokens = credentials(value['credentials']);arguments = parameters(value['parameters']) if rpc == DEFAULT_RPC else delivery_parameters(value['parameters'])
    deadline = value['deadline'];bound = value['maxResponseBytes']
    if type(bound) is not int or not 1 <= bound <= RESPONSE_LIMIT:
        raise ValueError('Private dispatch response bound differs')
    deadline_check(deadline)
    factory = http.client.HTTPSConnection if parts.scheme == 'https' else http.client.HTTPConnection
    connection = factory(parts.hostname, parts.port, timeout=max(.001, deadline - time.monotonic()))
    try:
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'apikey': tokens['apiKey']}
        if tokens['bearerToken'] is not None:
            headers['Authorization'] = 'Bearer ' + tokens['bearerToken']
        body = json.dumps(arguments, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
        path = parts.path + '/rpc/read_aerial_original_dispatch' if rpc == DEFAULT_RPC else parts.path + '/rpc/read_aerial_delivery_authority'
        connection.request('POST', path, body=body, headers=headers)
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError('Private dispatch RPC status differs')
        encodings = response.headers.get_all('Content-Encoding') or []
        lengths = response.headers.get_all('Content-Length') or []
        transfers = response.headers.get_all('Transfer-Encoding') or []
        content_types = response.headers.get_all('Content-Type') or []
        if encodings and encodings != ['identity'] or len(lengths) > 1 or lengths and transfers or transfers and transfers != ['chunked'] or len(content_types) != 1 or content_types[0].lower().split(';', 1)[0].strip() != 'application/json':
            raise ValueError('Private dispatch response headers differ')
        if lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or int(lengths[0]) > bound):
            raise ValueError('Private dispatch response bytes exceed their bound')
        payload = response.read(bound + 1)
        if not payload or len(payload) > bound or lengths and len(payload) != int(lengths[0]):
            raise ValueError('Private dispatch response bytes differ')
        deadline_check(deadline)
        sys.stdout.buffer.write(payload);sys.stdout.buffer.flush()
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] != '--child':
            raise ValueError('Owned private dispatch child invocation is required')
        child(int(sys.argv[2]))
    except Exception:
        sys.stderr.write('Private dispatch RPC read failed\n')
        sys.exit(2)
