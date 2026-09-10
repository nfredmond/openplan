#!/usr/bin/env python3
"""Identify a local listener and whether its launch chain is this app's next dev.

This checks process provenance, not application health or the bytes of a build.
It never reads process environments, credentials or unrelated open files.
"""
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit


def local_port(url: str) -> int | None:
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            return None
        return parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return None


def process_state(pid: int, proc_root: Path) -> tuple[int, str]:
    fields = (proc_root / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
    return int(fields[1]), fields[19]  # parent PID and kernel start ticks


def describe_listener(pid: int, proc_root: Path = Path("/proc")) -> dict:
    try:
        initial = process_state(pid, proc_root)
        directory = (proc_root / str(pid) / "cwd").resolve(strict=True)
        expected_cli = (directory / "node_modules/next/dist/bin/next").resolve()
        current = pid
        seen = set()
        next_dev = False
        for _ in range(4):
            if current <= 1 or current in seen:
                break
            seen.add(current)
            process = proc_root / str(current)
            args = [part.decode() for part in (process / "cmdline").read_bytes().split(b"\0") if part]
            if (process / "cwd").resolve(strict=True) == directory and args and Path(args[0]).name in {"node", "nodejs"}:
                for index in range(1, len(args) - 1):
                    candidate = Path(args[index])
                    if not candidate.is_absolute():
                        candidate = directory / candidate
                    if candidate.resolve() == expected_cli and args[index + 1] == "dev":
                        next_dev = True
            current, _ = process_state(current, proc_root)
        if process_state(pid, proc_root) != initial:
            return {}
        return {"directory": str(directory), "nextDev": next_dev}
    except (OSError, ValueError, IndexError, UnicodeError):
        return {}


def identify(url: str) -> dict:
    port = local_port(url)
    if port is None:
        return {}
    try:
        result = subprocess.run(["ss", "-ltnp", f"( sport = :{port} )"], capture_output=True, text=True, timeout=5, check=True)
    except (OSError, subprocess.SubprocessError):
        return {}
    pids = {int(value) for value in re.findall(r"pid=(\d+)", result.stdout)}
    # Multiple listeners can belong to different addresses on the same port.
    # Refuse ambiguous provenance instead of picking the first process.
    return describe_listener(pids.pop()) if len(pids) == 1 else {}


if __name__ == "__main__":
    print(json.dumps(identify(sys.argv[1]) if len(sys.argv) == 2 else {}))
