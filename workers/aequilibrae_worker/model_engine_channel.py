"""Ordered live progress channel; no saved-message execution or dispatcher caller.

The parent retains database authority. This channel is not a sandbox against
same-user processes and does not authorize child startup or output capture.
"""
import json
import os
import socket
import struct

MAX_FRAME = 65536
VERSION = 1
CHANNEL_FD_ENV = "OPENPLAN_ENGINE_CHANNEL_FD"


class ChannelStopped(RuntimeError):
    pass


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate channel field')
        result[key] = value
    return result


class Channel:
    def __init__(self, connection):
        self.connection = connection
        self.stopped = False
        self.sequence = 1

    def stop(self):
        self.stopped = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()

    def _exact(self, size):
        chunks = bytearray()
        while len(chunks) < size:
            block = self.connection.recv(size - len(chunks))
            if not block:
                raise ChannelStopped('Engine channel closed before acknowledgement')
            chunks.extend(block)
        return bytes(chunks)

    def receive(self):
        if self.stopped:
            raise ChannelStopped('Engine channel is stopped')
        try:
            size = struct.unpack('!I', self._exact(4))[0]
            if not 0 < size <= MAX_FRAME:
                raise ValueError('Engine channel frame exceeds its bound')
            body = json.loads(self._exact(size), object_pairs_hook=_unique,
                              parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite channel value')))
            if not isinstance(body, dict):
                raise ValueError('Engine channel frame must be an object')
            return body
        except BaseException:
            self.stop()
            raise

    def send(self, body):
        if self.stopped:
            raise ChannelStopped('Engine channel is stopped')
        try:
            content = json.dumps(body, separators=(',', ':'), allow_nan=False).encode()
            if not 0 < len(content) <= MAX_FRAME:
                raise ValueError('Engine channel frame exceeds its bound')
            self.connection.sendall(struct.pack('!I', len(content)) + content)
        except BaseException:
            self.stop()
            raise


class ProgressClient(Channel):
    def _request(self, operation, arguments, *, result=False):
        try:
            sequence = self.sequence
            self.send({'version': VERSION, 'sequence': sequence, 'operation': operation, **arguments})
            response = self.receive()
            expected = {'version', 'sequence', 'confirmed'} | ({'result'} if result else set())
            if (set(response) != expected
                    or type(response['version']) is not int or response['version'] != VERSION
                    or type(response['sequence']) is not int or response['sequence'] != sequence
                    or response['confirmed'] is not True
                    or (result and not isinstance(response['result'], dict))):
                raise ChannelStopped('Engine acknowledgement differs')
            self.sequence += 1
            return response.get('result')
        except BaseException:
            self.stop()
            raise

    def progress(self, log_tail):
        self._request('progress', {'log_tail': log_tail})

    def read_run(self):
        return self._request('read_run', {}, result=True)

    def read_paths(self):
        return self._request('read_paths', {}, result=True)

    def create_outputs(self):
        return self._request('create_outputs', {}, result=True)


class ProgressParent(Channel):
    def __init__(self, connection, writer, *, output_name=None):
        super().__init__(connection)
        self.writer = writer
        self.output_name = output_name

    def serve_one(self):
        """Run on the writer's owning thread; never accept a child-supplied identity."""
        try:
            self.writer.require_open()
            request = self.receive()
            operation = request.get('operation')
            fields = {'version', 'sequence', 'operation'} | ({'log_tail'} if operation == 'progress' else set())
            if (set(request) != fields
                    or type(request['version']) is not int or request['version'] != VERSION
                    or type(request['sequence']) is not int or request['sequence'] != self.sequence
                    or operation not in ('progress', 'read_run', 'read_paths', 'create_outputs')):
                raise ChannelStopped('Engine request is outside the allowed protocol')
            if operation == 'progress':
                if not isinstance(request['log_tail'], str) or len(request['log_tail']) > 20000:
                    raise ChannelStopped('Engine progress exceeds its text bound')
            sequence = self.sequence
            self.sequence += 1
            response = {'version': VERSION, 'sequence': sequence, 'confirmed': True}
            if operation == 'progress':
                self.writer.patch_stage(self.writer.context.stage_id, {'log_tail': request['log_tail']})
            elif operation == 'read_run':
                response['result'] = self.writer.read_run(self.writer.context.run_id)
            elif operation == 'create_outputs':
                if self.output_name is None or self.writer.files is None:
                    raise ChannelStopped('Engine output destination was not configured by the parent')
                response['result'] = {'output_directory': self.writer.create_assignment_outputs(
                    self.writer.files.path, self.output_name)}
            else:
                if self.writer.files is None:
                    raise ChannelStopped('Engine paths require an owned workspace')
                root = self.writer.files.path
                response['result'] = {
                    'work_directory': str(root),
                    'project_directory': self.writer.project_directory(root),
                    'package_directory': self.writer.package_directory(root),
                }
            self.send(response)
        except BaseException:
            self.writer.stopped = True
            self.stop()
            raise


def inherited_progress_client():
    """Consume this child's descriptor setting, with no persistent reconnect path."""
    raw = os.environ.pop(CHANNEL_FD_ENV, None)
    if raw is None or not raw.isdecimal() or int(raw) < 3:
        raise ChannelStopped('No inherited engine progress endpoint')
    connection = socket.socket(fileno=int(raw))
    connection.set_inheritable(False)
    return ProgressClient(connection)
