"""Publish a complete owned native-proof listener without replacing another file."""
import json
import os


def publish_readiness(path, payload):
    temporary = path.with_name('.'+path.name+'.pending')
    with temporary.open('x') as stream:
        json.dump(payload, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.link(temporary, path)
    temporary.unlink()
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
