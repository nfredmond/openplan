"""Container entry point: read one JSON line of variables from stdin, then run a command.

    ... | docker run -i --rm --label openplan-hosted-install IMAGE python3 /kit/stdin_env.py CMD ARGS...

The receiving half of env_to_stdin.py (review 15, N1). The variables enter
this process's environment and the command's, never the container record.
Only names made of capitals, digits and underscores are accepted. Nothing is
echoed. Stdin is then closed, so the command cannot read the line again.
"""

from __future__ import annotations

import json
import os
import re
import sys

_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


def parse(line: str) -> dict[str, str]:
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        raise SystemExit("stdin_env: the first stdin line is not a JSON object") from None
    if not isinstance(data, dict) or not data:
        raise SystemExit("stdin_env: expected a non-empty JSON object")
    for name, value in data.items():
        if not _NAME.fullmatch(name) or not isinstance(value, str):
            raise SystemExit("stdin_env: variable names must be capitals and values strings")
    return data


def main(argv: list[str]) -> int:
    if not argv:
        raise SystemExit("usage: stdin_env.py CMD [ARGS...]")
    line = sys.stdin.buffer.readline().decode("utf-8")
    variables = parse(line)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.environ.update(variables)
    os.execvp(argv[0], argv)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
