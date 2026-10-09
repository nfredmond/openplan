"""Retain output identities for exact stage inputs before external writes.

This is local preparation, not an ownership lease or permission to replay writes.
Database attempt fences and retained output commands remain separate obligations.
"""
from contextlib import closing
import json
import re
from uuid import uuid4
import model_command_client as client
import model_command_journal as journal


def prepare(directory, *, base_url, deployment_id, run_id, stage_id, source_files, inputs):
    client._uuid(run_id)
    client._uuid(stage_id)
    bound = client.destination(base_url, deployment_id)
    if not isinstance(source_files, dict) or not source_files or not isinstance(inputs, dict):
        raise ValueError('Stage preparation requires source files and input settings')
    for label, facts in source_files.items():
        if not isinstance(label, str) or not label.strip() or not isinstance(facts, dict) or set(facts) != {'sha256', 'size_bytes'}:
            raise ValueError('Invalid prepared source file')
        if not isinstance(facts['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', facts['sha256']) or type(facts['size_bytes']) is not int or facts['size_bytes'] < 0:
            raise ValueError('Invalid prepared source byte identity')
    evidence = journal.canonical({'source_files': source_files, 'inputs': inputs})
    with closing(journal.connect(directory)) as connection, connection:
        connection.execute('CREATE TABLE IF NOT EXISTS stage_preparations (destination TEXT NOT NULL, run_id TEXT NOT NULL, stage_id TEXT NOT NULL, evidence_json TEXT NOT NULL, output_artifact_id TEXT NOT NULL, PRIMARY KEY(destination,run_id,stage_id))')
        connection.execute('BEGIN IMMEDIATE')
        row = connection.execute('SELECT evidence_json,output_artifact_id FROM stage_preparations WHERE destination=? AND run_id=? AND stage_id=?', (bound, run_id, stage_id)).fetchone()
        if row is None:
            identity = str(uuid4())
            connection.execute('INSERT INTO stage_preparations VALUES(?,?,?,?,?)', (bound, run_id, stage_id, evidence, identity))
        else:
            if row[0] != evidence:
                raise ValueError('Stage inputs changed after preparation; explicit reconciliation required')
            identity = row[1]
            client._uuid(identity)
    return {'destination': bound, 'run_id': run_id, 'stage_id': stage_id,
            'output_artifact_id': identity, **json.loads(evidence)}


def file_facts(path):
    """Hash a regular file and refuse mutation or path replacement during reading."""
    import hashlib
    import os
    import stat
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Stage source must be a regular file')
        digest = hashlib.sha256()
        count = 0
        with os.fdopen(descriptor, 'rb') as stream:
            descriptor = None
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
                count += len(chunk)
            after = os.fstat(stream.fileno())
            current = os.stat(path)
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        snapshot = lambda value: tuple(getattr(value, field) for field in fields)
        if snapshot(before) != snapshot(after) or snapshot(after) != snapshot(current) or count != after.st_size:
            raise ValueError('Stage source changed while reading')
        return {'sha256': digest.hexdigest(), 'size_bytes': count}
    finally:
        if descriptor is not None:
            os.close(descriptor)


def prepare_files(directory, *, source_paths, **arguments):
    """Prepare from actual bytes after the caller's scientific access gates pass.

    This does not pin files for later readers. They must verify the saved facts
    again or consume an immutable copy before a recovered operation uses them.
    """
    if not isinstance(source_paths, dict) or not source_paths or any(not isinstance(label, str) or not label.strip() for label in source_paths):
        raise ValueError('Named stage source files required')
    facts = {label: file_facts(path) for label, path in source_paths.items()}
    return prepare(directory, source_files=facts, **arguments)
