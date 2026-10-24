"""Validate a JSON object while optionally discarding large array values."""
import codecs
import hashlib
import json
from pathlib import Path
from typing import Callable


def read_object(path: Path, *, decode: Callable, validate: Callable,
                discard_arrays: frozenset[str] = frozenset(), chunk_chars: int = 65536,
                expected_file=None):
    """Validate every value, including discarded elements, with caller policy.

    Only the designated arrays stream element by element. Other values retain
    normal JSON semantics. A discarded array is absent from the returned object.
    """
    decoder = json.JSONDecoder()
    with path.open('rb') as handle:
        buffer = ''
        eof = False
        digest = hashlib.sha256()
        byte_count = 0
        utf8 = codecs.getincrementaldecoder('utf-8')()

        def fill():
            nonlocal buffer, eof, byte_count
            part = handle.read(chunk_chars)
            digest.update(part)
            byte_count += len(part)
            eof = not part
            buffer += utf8.decode(part, final=eof)

        def space():
            nonlocal buffer
            while True:
                buffer = buffer.lstrip(' \t\r\n')
                if buffer or eof:
                    return
                fill()

        def take(character):
            nonlocal buffer
            space()
            if not buffer.startswith(character):
                raise ValueError('Invalid streamed JSON delimiter')
            buffer = buffer[1:]

        def value():
            nonlocal buffer
            space()
            while True:
                try:
                    _, end = decoder.raw_decode(buffer)
                except json.JSONDecodeError:
                    if eof:
                        raise ValueError('Invalid streamed JSON value') from None
                    fill()
                    continue
                # A number may continue in the next read. Require a delimiter
                # or EOF before accepting the decoder's prefix.
                if end == len(buffer) and not eof:
                    fill()
                    continue
                raw, buffer = buffer[:end], buffer[end:]
                result = decode(raw.encode('utf-8'))
                validate(result)
                return result

        take('{')
        result = {}
        seen = set()
        space()
        if buffer.startswith('}'):
            take('}')
        else:
            while True:
                key = value()
                if not isinstance(key, str) or key in seen:
                    raise ValueError('Invalid or duplicate streamed JSON object key')
                seen.add(key)
                take(':')
                validate({key: None})
                space()
                if key in discard_arrays and buffer.startswith('['):
                    take('[')
                    space()
                    if buffer.startswith(']'):
                        take(']')
                    else:
                        while True:
                            item = value()
                            del item
                            space()
                            if buffer.startswith(']'):
                                take(']')
                                break
                            take(',')
                else:
                    item = value()
                    result[key] = item
                space()
                if buffer.startswith('}'):
                    take('}')
                    break
                take(',')
        space()
        if buffer or not eof:
            raise ValueError('Trailing streamed JSON content')
        if expected_file is not None and (digest.hexdigest() != expected_file['sha256']
                                          or byte_count != expected_file['bytes']):
            raise ValueError(f'Retained file identity mismatch: {path.name}')
        return result
