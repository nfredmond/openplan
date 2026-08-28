from __future__ import annotations

import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODELING = ROOT / "scripts" / "modeling"
WORKER = ROOT / "workers" / "aequilibrae_worker"
for directory in (MODELING, WORKER):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import model_validation_core as core
import tmas_count_source as tmas


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def zip_bytes(member: str, payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, payload)
    return buffer.getvalue()


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class TMASAdapterTests(unittest.TestCase):
    def setUp(self):
        self.station_payload = (FIXTURES / "tmas_2024_station_real.txt").read_bytes()
        self.volume_payload = (FIXTURES / "tmas_2024_volume_real.txt").read_bytes()

    def write_archives(self, directory: Path):
        station = directory / "2024_station_data.zip"
        volume = directory / "jan_2024_ccs_data.zip"
        station.write_bytes(zip_bytes("AK_2024 (TMAS).STA", self.station_payload))
        volume.write_bytes(zip_bytes("AK_JAN_2024 (TMAS).VOL", self.volume_payload))
        return station, volume

    def test_pinned_real_station_and_volume_record_normalize_without_defaults(self):
        with tempfile.TemporaryDirectory() as temporary:
            station, volume = self.write_archives(Path(temporary))
            observations = tmas.build_monthly_observations(
                station, volume, downloaded_at="2026-08-27T00:00:00Z"
            )
        self.assertEqual(len(observations), 1)
        item = observations[0]
        core.validate_observation(item)
        self.assertEqual(item["evidence_grade"], "B")
        self.assertEqual(item["geometry"]["longitude_hemisphere"], "unknown")
        self.assertEqual(item["estimate"]["source_supported_bounds"], "unknown")
        self.assertEqual(item["match_audit"]["status"], "unresolved")
        self.assertEqual(item["estimate"]["center"], 2507)

    def test_schema_drift_is_a_failure_not_an_empty_source(self):
        damaged = self.volume_payload.replace(b"|hour_23|", b"|last_hour|")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            station = directory / "2024_station_data.zip"
            volume = directory / "jan_2024_ccs_data.zip"
            station.write_bytes(zip_bytes("station.STA", self.station_payload))
            volume.write_bytes(zip_bytes("volume.VOL", damaged))
            with self.assertRaisesRegex(tmas.TMASSchemaDriftError, "24 hourly"):
                tmas.build_monthly_observations(station, volume, downloaded_at="recorded")

    def test_filtered_package_skips_unassignable_out_of_scope_volume_rows(self):
        extra = self.volume_payload.replace(b"|000002|", b"|999999|", 1)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            station, volume = self.write_archives(directory)
            with zipfile.ZipFile(volume, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("AK_JAN_2024 (TMAS).VOL", extra)
            observations = tmas.build_monthly_observations(
                station,
                volume,
                downloaded_at="recorded",
                state_codes={"06"},
                county_codes={"007"},
            )
        self.assertEqual(observations, [])

    def test_complete_fetch_preserves_every_exact_archive_and_sha256(self):
        payloads = {
            name: zip_bytes("member.txt", name.encode("ascii"))
            for name in tmas.ARCHIVE_NAMES
        }

        def opener(url, timeout):
            del timeout
            return Response(payloads[url.rsplit("/", 1)[-1]])

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            manifest = tmas.fetch_complete_2024_archives(
                directory, opener=opener, downloaded_at="2026-08-27T00:00:00Z"
            )
            self.assertTrue(manifest["complete"])
            self.assertEqual(len(manifest["archives"]), 13)
            for entry in manifest["archives"]:
                exact = (directory / entry["name"]).read_bytes()
                self.assertEqual(exact, payloads[entry["name"]])
                self.assertEqual(entry["sha256"], hashlib.sha256(exact).hexdigest())
            written = json.loads((directory / "source-manifest.json").read_text())
            self.assertEqual(written, manifest)


if __name__ == "__main__":
    unittest.main()
