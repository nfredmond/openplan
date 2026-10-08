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
