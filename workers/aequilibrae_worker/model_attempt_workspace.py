"""Exclusive local attempt directories and pinned state publication.

The configured root is administrator-owned. This prevents accidental reuse and
symlink traversal below that root, not arbitrary engine code or same-user host
administrators from modifying files. It does not authorize predecessor reuse.
"""
from contextlib import contextmanager
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

import model_command_client as client
import model_command_journal as journal

FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


class AttemptWorkspace:
    def __init__(self, root, context):
        for value in (context.workspace_id, context.run_id, context.stage_id,
                      context.attempt_id, context.claim_request_id):
            client._uuid(value)
        installation = hashlib.sha256(context.destination.encode()).hexdigest()
        self.components = (context.run_id, 'attempts', installation, context.stage_id, context.attempt_id)
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        self.root = root.resolve(strict=True)
        self.path = self.root.joinpath(*self.components)
        self.owner = {'schema': 'openplan.attempt-workspace.v1', **asdict(context)}
        self.owner_bytes = (journal.canonical(self.owner) + '\n').encode()
        descriptor = os.open(self.root, FLAGS)
        try:
            self.root_identity = self._identity(os.fstat(descriptor))
            for index, part in enumerate(self.components):
                try:
                    os.mkdir(part, mode=0o700, dir_fd=descriptor)
                    os.fsync(descriptor)
                except FileExistsError:
                    if index == len(self.components) - 1:
                        raise ValueError('Attempt directory already exists; reconcile instead of reusing it') from None
                child = os.open(part, FLAGS, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            self.directory_identity = self._identity(os.fstat(descriptor))
            marker = os.open('attempt_owner.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=descriptor)
            with os.fdopen(marker, 'wb') as stream:
                stream.write(self.owner_bytes)
                stream.flush()
                os.fsync(stream.fileno())
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @staticmethod
    def _identity(info):
        return info.st_dev, info.st_ino

    @contextmanager
    def pinned(self):
        descriptor = os.open(self.root, FLAGS)
        try:
            if self._identity(os.fstat(descriptor)) != self.root_identity:
                raise ValueError('Attempt root identity changed')
            for part in self.components:
                child = os.open(part, FLAGS, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            if self._identity(os.fstat(descriptor)) != self.directory_identity:
                raise ValueError('Attempt directory identity changed')
            marker = os.open('attempt_owner.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=descriptor)
            with os.fdopen(marker, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise ValueError('Attempt ownership record must be a private regular file')
                if stream.read(len(self.owner_bytes) + 1) != self.owner_bytes:
                    raise ValueError('Attempt ownership record differs')
            yield descriptor
        finally:
            os.close(descriptor)

    def verify(self):
        with self.pinned():
            pass

    def publish_state(self, state):
        """Replace state only through the owned descriptor, even after a rename."""
        if not isinstance(state, dict):
            raise ValueError('Attempt state must be an object')
        content = json.dumps(state, allow_nan=False).encode()
        with self.pinned() as descriptor:
            name = '.state-' + uuid.uuid4().hex
            temporary = False
            try:
                file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                               0o600, dir_fd=descriptor)
                temporary = True
                with os.fdopen(file, 'wb') as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(name, 'state.json', src_dir_fd=descriptor, dst_dir_fd=descriptor)
                temporary = False
                os.fsync(descriptor)
            finally:
                if temporary:
                    os.unlink(name, dir_fd=descriptor)
