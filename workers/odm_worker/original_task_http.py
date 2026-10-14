"""Read one original task through owned Linux supervision, without engine writes.

Supplied ownership and engine checks are required. Retained metadata still does
not establish processing quality, current actor authority or permission to resume.
"""
import copy
import http.client
import json
import os
from pathlib import Path
import selectors
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlencode, urlsplit

from draft_custody import original_plan
from draft_http import Transport as DraftTransport, exact_input, watch_parent, finite_deadline, TASK
from engine_effects import RESPONSE_LIMIT, engine_identity, same
from url_transport import response_length
import re

CHUNK = 128 * 1024
METADATA_LIMIT = 128 * 1024
ERROR_LIMIT = 4096


class Transport:
    def __init__(self, plan, resolve, attest, *, cancelled=lambda: False):
        if sys.platform != 'linux' or not all(callable(x) for x in (resolve, attest, cancelled)):
            raise ValueError('Original task supervision and explicit adapters are required')
        self.plan = original_plan(copy.deepcopy(plan))
        self.resolve = resolve
        self.attest = attest
        self.cancelled = cancelled

    def _check(self, deadline, owned):
        ownership = owned()
        if type(ownership) is not bool:
            raise ValueError('Original task ownership must be a boolean')
        if not ownership:
            raise InterruptedError('Original task ownership ended')
        decision = self.cancelled()
        if type(decision) is not bool:
            raise ValueError('Original task cancellation must be a boolean')
        if decision:
            raise InterruptedError('Original task read cancelled')
        finite_deadline(deadline)

    def _attest(self, deadline, owned):
        self._check(deadline, owned)
        if self.attest(copy.deepcopy(self.plan['engine']), deadline) is not True:
            raise ValueError('Original task engine check refused')
        self._check(deadline, owned)

    def __call__(self, plan, deadline, *, owned):
        """Return a complete exact reply from the plan's fixed engine and UUID."""
        if not callable(owned):
            raise ValueError('Original task ownership adapter is required')
        self._check(deadline, owned)
        if not same(original_plan(copy.deepcopy(plan)), self.plan):
            raise ValueError('Original task plan differs')
        self._attest(deadline, owned)
        try:
            token = self.resolve(self.plan['engine']['credentialReference'])
        except Exception:
            raise ValueError('Original task credential resolution failed') from None
        if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):
            raise ValueError('Original task credential value differs')
        metadata = json.dumps({'engine': self.plan['engine'], 'taskUuid': self.plan['taskUuid'],
            'token': token, 'deadline': deadline}, allow_nan=False, separators=(',', ':')).encode()
        if len(metadata) > METADATA_LIMIT:
            raise ValueError('Original task metadata exceeds its bound')
        self._check(deadline, owned)
        lifetime_read, lifetime_write = os.pipe()
        process = None
        try:
            process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--child', str(lifetime_read)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True,
                pass_fds=(lifetime_read,), bufsize=0,
                env={key: value for key, value in os.environ.items() if key in {'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}})
            os.close(lifetime_read)
            lifetime_read = None
            pending = struct.pack('!I', len(metadata)) + metadata
            output, errors = bytearray(), bytearray()
            with selectors.DefaultSelector() as selector:
                for name, handle, event in [('input', process.stdin, selectors.EVENT_WRITE), ('output', process.stdout, selectors.EVENT_READ), ('error', process.stderr, selectors.EVENT_READ)]:
                    os.set_blocking(handle.fileno(), False)
                    selector.register(handle, event, name)
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
                                selector.unregister(key.fileobj)
                                key.fileobj.close()
                            continue
                        try:
                            chunk = os.read(key.fd, CHUNK)
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        target, bound = (output, RESPONSE_LIMIT) if key.data == 'output' else (errors, ERROR_LIMIT)
                        if len(chunk) > bound - len(target):
                            raise ValueError('Original task child output exceeds its bound')
                        target.extend(chunk)
            self._check(deadline, owned)
            if process.wait(timeout=max(.001, deadline - time.monotonic())) != 0 or errors or not output:
                raise ValueError('Original task read did not complete')
            self._attest(deadline, owned)
            return 200, bytes(output)
        finally:
            if lifetime_read is not None:
                os.close(lifetime_read)
            os.close(lifetime_write)
            if process is not None:
                DraftTransport._stop(process)
                for handle in (process.stdin, process.stdout, process.stderr):
                    if handle is not None:
                        handle.close()

    def retain(self, observations, *, deadline, owned):
        """Compose the checked original read with the separate private ledger."""
        status, body = self(observations.plan, deadline, owned=owned)
        self._check(deadline, owned)
        result = observations.record(status, body, deadline=deadline)
        self._check(deadline, owned)
        return result


def child(lifetime):
    threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()
    size = struct.unpack('!I', exact_input(4))[0]
    if size > METADATA_LIMIT:
        raise ValueError('Original task metadata exceeds its bound')
    value = json.loads(exact_input(size))
    if not isinstance(value, dict) or set(value) != {'engine', 'taskUuid', 'token', 'deadline'}:
        raise ValueError('Original task metadata differs')
    engine = engine_identity(value['engine'])
    task = value['taskUuid']
    if not isinstance(task, str) or not re.fullmatch(TASK, task):
        raise ValueError('Original task UUID differs')
    token = value['token']
    if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):
        raise ValueError('Original task credential value differs')
    deadline = value['deadline']
    finite_deadline(deadline)
    endpoint = urlsplit(engine['endpoint'])
    factory = http.client.HTTPSConnection if endpoint.scheme == 'https' else http.client.HTTPConnection
    connection = factory(endpoint.hostname, endpoint.port, timeout=max(.001, deadline - time.monotonic()))
    path = endpoint.path + '/task/' + task + '/info'
    if token is not None:
        path += '?' + urlencode({'token': token})
    try:
        connection.request('GET', path, headers={'Accept': 'application/json', 'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError('Original task response status differs')
        declared = response_length(response.headers, RESPONSE_LIMIT)
        payload = response.read(RESPONSE_LIMIT + 1)
        if not payload or len(payload) > RESPONSE_LIMIT or declared is not None and len(payload) != declared or response.length not in (None, 0):
            raise ValueError('Original task response bytes differ')
        finite_deadline(deadline)
        sys.stdout.buffer.write(payload)
        sys.stdout.buffer.flush()
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] != '--child':
            raise ValueError('Owned original task child invocation is required')
        child(int(sys.argv[2]))
    except Exception:
        sys.stderr.write('Original task HTTP read failed\n')
        sys.exit(2)
