"""Publish a complete local stage handoff without exposing a partially written file.

The caller owns this run directory. Atomic replacement is not an ownership fence,
a version history, or authorization to replay a scientific stage.
"""
import json
import os
from pathlib import Path
import tempfile


def publish(directory, state):
    if not isinstance(state, dict):
        raise ValueError('Run state must be an object')
    content = json.dumps(state, allow_nan=False).encode('utf-8')
    directory = Path(directory)
    target = directory / 'state.json'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix='.state-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        temporary = None
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
