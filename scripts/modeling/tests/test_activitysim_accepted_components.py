#!/usr/bin/env python3
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from activitysim_accepted_components import (  # noqa: E402
    AcceptedComponentError,
    install_accepted_components,
    resolve_accepted_components,
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class AcceptedComponentTests(unittest.TestCase):
    def fixture(self, root: Path) -> Path:
        overlay = root / "overlay"
        overlay.mkdir()
        coefficient = overlay / "component.csv"
        coefficient.write_text("coefficient,value\nconstant,1\n")
        package = overlay / "coefficient_package.json"
        package.write_text(json.dumps({"files_sha256": {"component.csv": digest(coefficient)}}))
        acceptance = root / "acceptance.json"
        acceptance.write_text(json.dumps({
            "status": "accepted_component",
            "scope": "one component only",
            "evidence_hashes": {"candidate_package_manifest_sha256": digest(package)},
        }))
        registry = root / "registry.json"
        registry.write_text(json.dumps({
            "schema_version": "openplan.activitysim-accepted-components.v1",
            "status": "active",
            "components": [{
                "component": "component",
                "status": "accepted_for_production",
                "overlay_directory": "overlay",
                "candidate_package_manifest": "overlay/coefficient_package.json",
                "candidate_package_manifest_sha256": digest(package),
                "acceptance_result": "acceptance.json",
                "acceptance_result_sha256": digest(acceptance),
                "overlay_files_sha256": {"component.csv": digest(coefficient)},
                "scope": "one component only",
            }],
        }))
        return registry

    def test_installs_only_hash_verified_accepted_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry = self.fixture(root)
            destination = root / "destination"
            destination.mkdir()

            installed = install_accepted_components(destination, registry)

            self.assertEqual((destination / "component.csv").read_text(), "coefficient,value\nconstant,1\n")
            self.assertEqual(installed[0]["component"], "component")
            self.assertEqual(
                installed[0]["installed_files_sha256"]["component.csv"],
                digest(destination / "component.csv"),
            )

    def test_changed_coefficient_bytes_are_refused_before_installation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry = self.fixture(root)
            (root / "overlay" / "component.csv").write_text("coefficient,value\nconstant,2\n")

            with self.assertRaisesRegex(AcceptedComponentError, "changed after approval"):
                resolve_accepted_components(registry)

    def test_acceptance_must_name_the_same_candidate_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry = self.fixture(root)
            acceptance = root / "acceptance.json"
            payload = json.loads(acceptance.read_text())
            payload["evidence_hashes"]["candidate_package_manifest_sha256"] = "0" * 64
            acceptance.write_text(json.dumps(payload))
            registry_payload = json.loads(registry.read_text())
            registry_payload["components"][0]["acceptance_result_sha256"] = digest(acceptance)
            registry.write_text(json.dumps(registry_payload))

            with self.assertRaisesRegex(AcceptedComponentError, "different candidate package"):
                resolve_accepted_components(registry)

    def test_rejected_acceptance_result_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry = self.fixture(root)
            acceptance = root / "acceptance.json"
            payload = json.loads(acceptance.read_text())
            payload["status"] = "rejected_component"
            acceptance.write_text(json.dumps(payload))
            registry_payload = json.loads(registry.read_text())
            registry_payload["components"][0]["acceptance_result_sha256"] = digest(
                acceptance
            )
            registry.write_text(json.dumps(registry_payload))

            with self.assertRaisesRegex(
                AcceptedComponentError, "no matching accepted decision"
            ):
                resolve_accepted_components(registry)


if __name__ == "__main__":
    unittest.main()
