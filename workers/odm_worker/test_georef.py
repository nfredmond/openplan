#!/usr/bin/env python3
"""The GeoTIFF reader reports what the file says, and refuses what it cannot
read — because these numbers place an orthomosaic on a public-facing map.

The tag parser is exercised against byte-built fixtures (no GDAL, no test
data files): a well-formed little-endian GeoTIFF with pixel scale + tiepoint +
a UTM EPSG code, a BigTIFF (refused by name), and a TIFF with no geo tags
(refused — it is not a GeoTIFF). The reprojection half needs pyproj and says
so plainly when it is absent instead of quietly passing.

Run: python3 workers/odm_worker/test_georef.py
  (tag parser: stdlib; reprojection checks: pyproj — present in the worker
  container and its venv, honestly SKIPPED elsewhere)
"""
import os
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import georef

WIDTH, HEIGHT = 100, 80
SCALE = (0.05, 0.05)
TIEPOINT_MODEL = (500000.0, 4400000.0)  # an arbitrary UTM 10N test coordinate
EPSG_UTM10N = 32610


def build_geotiff(epsg=EPSG_UTM10N, include_geokeys=True, magic=42):
    """A minimal classic little-endian TIFF carrying exactly the tags the
    parser needs. Layout: 8-byte header, one IFD, then the out-of-line data."""
    entries = []
    # (tag, type, count, inline_or_offset_marker)
    # Data block offsets are computed after we know the IFD size.
    tags = [
        (256, 3, 1, WIDTH),   # ImageWidth SHORT
        (257, 3, 1, HEIGHT),  # ImageLength SHORT
        (33550, 12, 3, "scale"),
        (33922, 12, 6, "tiepoint"),
    ]
    if include_geokeys:
        tags.append((34735, 3, 8, "geokeys"))

    ifd_offset = 8
    ifd_size = 2 + len(tags) * 12 + 4
    data_offset = ifd_offset + ifd_size

    blocks = {}
    cursor = data_offset
    scale_bytes = struct.pack("<3d", SCALE[0], SCALE[1], 0.0)
    blocks["scale"] = (cursor, scale_bytes)
    cursor += len(scale_bytes)
    tiepoint_bytes = struct.pack(
        "<6d", 0.0, 0.0, 0.0, TIEPOINT_MODEL[0], TIEPOINT_MODEL[1], 0.0
    )
    blocks["tiepoint"] = (cursor, tiepoint_bytes)
    cursor += len(tiepoint_bytes)
    # GeoKeyDirectory: header (version, rev, minor, count=1) + one entry
    # (ProjectedCSTypeGeoKey, location 0 => value is the short itself).
    geokey_bytes = struct.pack("<8H", 1, 1, 0, 1, 3072, 0, 1, epsg)
    blocks["geokeys"] = (cursor, geokey_bytes)

    for tag, field_type, count, value in tags:
        if isinstance(value, str):
            entries.append(struct.pack("<HHII", tag, field_type, count, blocks[value][0]))
        else:
            entries.append(struct.pack("<HHI", tag, field_type, count) + struct.pack("<HH", value, 0))

    out = struct.pack("<2sHI", b"II", magic, ifd_offset)
    out += struct.pack("<H", len(tags)) + b"".join(entries) + struct.pack("<I", 0)
    for _name, (offset, data) in sorted(blocks.items(), key=lambda item: item[1][0]):
        assert len(out) == offset, f"layout drift: at {len(out)}, expected {offset}"
        out += data
    return out


def write_fixture(data):
    handle = tempfile.NamedTemporaryFile(suffix=".tif", delete=False)
    handle.write(data)
    handle.close()
    return handle.name


def check_parse_reads_the_files_own_numbers():
    path = write_fixture(build_geotiff())
    parsed = georef.parse_geotiff(path)
    os.unlink(path)
    assert parsed["width"] == WIDTH and parsed["height"] == HEIGHT
    assert parsed["epsg"] == EPSG_UTM10N
    assert parsed["pixel_size"] == (0.05, 0.05)
    minx, miny, maxx, maxy = parsed["native_bounds"]
    assert (minx, maxy) == TIEPOINT_MODEL, "origin must come from the tiepoint"
    assert abs(maxx - (TIEPOINT_MODEL[0] + WIDTH * 0.05)) < 1e-9
    assert abs(miny - (TIEPOINT_MODEL[1] - HEIGHT * 0.05)) < 1e-9
    print("  parser reads width/height/EPSG/scale/bounds from the tags")


def check_bigtiff_is_refused_by_name():
    path = write_fixture(build_geotiff(magic=43))
    try:
        georef.parse_geotiff(path)
        raise AssertionError("BigTIFF must be refused, not misread")
    except georef.GeorefError as exc:
        assert "BigTIFF" in str(exc), str(exc)
    finally:
        os.unlink(path)
    print("  BigTIFF refused by name")


def check_missing_geokeys_is_not_a_geotiff():
    path = write_fixture(build_geotiff(include_geokeys=False))
    try:
        georef.parse_geotiff(path)
        raise AssertionError("a TIFF without geo keys must be refused")
    except georef.GeorefError as exc:
        assert "GeoKeyDirectory" in str(exc), str(exc)
    finally:
        os.unlink(path)
    print("  a TIFF with no GeoKeyDirectory is refused")


def check_user_defined_crs_is_refused():
    path = write_fixture(build_geotiff(epsg=32767))  # 32767 = user-defined
    try:
        georef.parse_geotiff(path)
        raise AssertionError("a user-defined CRS names no EPSG and must be refused")
    except georef.GeorefError as exc:
        assert "EPSG" in str(exc), str(exc)
    finally:
        os.unlink(path)
    print("  a user-defined CRS (no EPSG) is refused, never guessed")


def check_reprojection_with_pyproj():
    try:
        import pyproj  # noqa: F401
    except ImportError:
        print(
            "  SKIPPED (pyproj not installed): WGS84 reprojection and meter-unit "
            "checks — run inside the worker container or a venv with "
            "requirements.txt to exercise them"
        )
        return
    path = write_fixture(build_geotiff())
    parsed = georef.parse_geotiff(path)
    west, south, east, north = georef.wgs84_bounds(parsed)
    os.unlink(path)
    assert west < east and south < north
    # UTM 10N easting 500000 is the central meridian, longitude -123; northing
    # 4400000 is just under 40°N. The five-meter fixture is a speck there.
    assert -123.1 < west < -122.9, west
    assert 39.5 < south < 40.0, south
    assert (east - west) < 0.01 and (north - south) < 0.01, "a 5 m fixture is not a county"
    assert georef.pixel_size_meters(parsed) == 0.05, "UTM meters => pixel size in meters"

    geographic = {"epsg": 4326, "native_bounds": (0, 0, 1, 1), "pixel_size": (0.001, 0.001)}
    assert georef.pixel_size_meters(geographic) is None, (
        "a degree-unit CRS must NOT report a pixel size in meters"
    )
    print("  UTM 10N corners land at ~(-123, 39.7) in WGS84; degree CRS gives no meter size")


def main():
    print("georef checks:")
    check_parse_reads_the_files_own_numbers()
    check_bigtiff_is_refused_by_name()
    check_missing_geokeys_is_not_a_geotiff()
    check_user_defined_crs_is_refused()
    check_reprojection_with_pyproj()
    print("all georef checks passed")


if __name__ == "__main__":
    main()
