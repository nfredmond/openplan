"""The compose file's network posture is a security control, tested as one.

NodeODM has no authentication in this deployment: anything that can reach its
port can list tasks, download the agency's orthomosaics and point clouds, and
submit photogrammetry jobs that eat the machine. Shipped as "3001:3000" the
compose file published exactly that to every interface — office LAN included
(found 2026-08-16). Only the worker on this same machine needs NodeODM, so
every published port here must bind loopback.

The binding is parsed STRUCTURALLY from the ports lists — never grepped from
the whole file, where this very paragraph would satisfy a substring match.
"""

import unittest
from pathlib import Path

COMPOSE = Path(__file__).with_name("docker-compose.yml")


def published_ports(text: str) -> list[str]:
    """Entries of every `ports:` list in the file, comments stripped."""
    ports: list[str] = []
    in_ports = False
    ports_indent = 0
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())
        if stripped == "ports:":
            in_ports = True
            ports_indent = indent
            continue
        if in_ports:
            if stripped.startswith("- ") and indent > ports_indent:
                ports.append(stripped[2:].strip().strip('"').strip("'"))
                continue
            in_ports = False
    return ports


class TheComposeFileKeepsNodeOdmPrivate(unittest.TestCase):
    def test_every_published_port_binds_loopback(self) -> None:
        if not COMPOSE.exists():
            self.skipTest(
                "docker-compose.yml is not shipped in the worker image; run this check from the repo checkout"
            )
        ports = published_ports(COMPOSE.read_text())
        # An empty parse would pass a vacuous loop; the compose file publishes
        # NodeODM today, so finding nothing means the parser lost the file.
        self.assertTrue(ports, "no ports parsed — the compose file or this parser changed shape")
        for entry in ports:
            with self.subTest(entry=entry):
                self.assertTrue(
                    entry.startswith("127.0.0.1:"),
                    f'published port "{entry}" is reachable beyond this machine. NodeODM has no '
                    "auth and the worker reaches it over loopback, so nothing in this file may "
                    "publish wider. If a future bridge-mode worker must publish its own "
                    "bearer-authenticated port, exempt it here BY NAME with the reason.",
                )


if __name__ == "__main__":
    unittest.main()
