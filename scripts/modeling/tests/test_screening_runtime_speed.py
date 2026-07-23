"""Unit conversion for OSM `maxspeed` tags consumed by the screening runtime.

screening_runtime imports the heavy geo/modeling stack at module scope, so this test stubs whichever
of those third-party packages is absent. _parse_speed itself is stdlib-only arithmetic, so the stubs
never participate in what is being asserted -- they only let the module import under a bare python3.
"""
from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# Submodules are listed explicitly because `from shapely.geometry import Point` resolves through
# sys.modules, not through attribute access on a stubbed parent.
HEAVY_MODULES = ("geopandas", "numpy", "pandas", "requests", "shapely", "shapely.geometry")


class _StubModule(types.ModuleType):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.__path__: list[str] = []  # marks the stub as a package so submodules can be registered

    def __getattr__(self, name: str) -> object:
        return type(name, (), {})


def _stub_if_missing(module_name: str) -> None:
    parent = module_name.rsplit(".", 1)[0]
    if parent != module_name and isinstance(sys.modules.get(parent), _StubModule):
        sys.modules[module_name] = _StubModule(module_name)
        return
    try:
        importlib.import_module(module_name)
    except ModuleNotFoundError:
        sys.modules[module_name] = _StubModule(module_name)


for module_name in HEAVY_MODULES:
    _stub_if_missing(module_name)

from screening_runtime import LINK_DEFAULTS, _parse_speed  # noqa: E402


class ParseSpeedTests(unittest.TestCase):
    def test_bare_tag_is_metric_not_mph(self) -> None:
        # The defect this guards: OSM's implicit maxspeed unit is km/h, so reading "80" as 80 mph
        # inflated the link by ~1.6x and carried straight through assignment into VMT.
        self.assertEqual(_parse_speed("80"), 50)
        self.assertEqual(_parse_speed("100"), 62)
        self.assertNotEqual(_parse_speed("80"), 80)

    def test_numeric_tag_coerced_by_sqlite_affinity_is_still_metric(self) -> None:
        # links.speed_ab has NUMERIC affinity, so a bare "80" comes back out of the project database
        # as a number rather than a string. It is no less metric for that.
        self.assertEqual(_parse_speed(80), 50)
        self.assertEqual(_parse_speed(80.0), 50)

    def test_explicit_mph_is_taken_verbatim(self) -> None:
        self.assertEqual(_parse_speed("50 mph"), 50)
        self.assertEqual(_parse_speed("50mph"), 50)
        self.assertEqual(_parse_speed("55 MPH"), 55)
        self.assertEqual(_parse_speed("  65 mph  "), 65)

    def test_explicit_metric_units_are_converted(self) -> None:
        for tag in ("80 km/h", "80km/h", "80 kph", "80 kmh", "80 kmph"):
            with self.subTest(tag=tag):
                self.assertEqual(_parse_speed(tag), 50)

    def test_knots_are_converted(self) -> None:
        self.assertEqual(_parse_speed("5 knots"), 6)
        self.assertEqual(_parse_speed("20 knots"), 23)

    def test_first_segment_governs_multi_value_tags(self) -> None:
        self.assertEqual(_parse_speed("50|30"), 31)
        self.assertEqual(_parse_speed("60 mph|40 mph"), 60)

    def test_malformed_tags_yield_none_rather_than_a_stray_digit(self) -> None:
        # Honesty posture: an uninterpretable tag must fall back to the documented link-type default,
        # never to a number mined out of a scheme name.
        for tag in ("walk", "none", "signals", "variable", "DE:zone30", "RO:urban", "", "   ", "0"):
            with self.subTest(tag=tag):
                self.assertIsNone(_parse_speed(tag))

    def test_missing_tag_yields_none(self) -> None:
        self.assertIsNone(_parse_speed(None))

    def test_centroid_connectors_still_resolve_to_their_mph_default(self) -> None:
        # Connectors are inserted with a NULL speed so they are not mistaken for a metric OSM tag;
        # this mirrors the `_parse_speed(...) or default_speed` fallback in build_network.
        default_speed = LINK_DEFAULTS["centroid_connector"][0]
        self.assertEqual(_parse_speed(None) or default_speed, 50)


if __name__ == "__main__":
    unittest.main()
