"""Read a GeoTIFF's own georeferencing and reproject its bounds to WGS84.

The worker HAS the orthomosaic locally, which is why georeferencing is read
here and carried on the callback artifact (contract v1.1's optional
boundsWgs84/crs/pixelSizeM) rather than re-derived app-side: the consumer
would otherwise need its own GeoTIFF parser and projection tables inside a
serverless function.

The tag parser is stdlib `struct` on purpose — testable against a byte-built
fixture with no dependency. Only the reprojection needs pyproj, and it is
imported lazily so everything else in this module runs without it.

HONESTY RULE: any file this parser cannot read (BigTIFF, tiled exotica,
missing geo tags) raises GeorefError with the reason, and the pipeline then
sends the artifact WITHOUT georeferencing and says so in the callback message.
Absent fields are the consumer's cue to refuse map placement — never guess.
"""

import struct

# TIFF tag ids.
TAG_IMAGE_WIDTH = 256
TAG_IMAGE_LENGTH = 257
TAG_MODEL_PIXEL_SCALE = 33550
TAG_MODEL_TIEPOINT = 33922
TAG_MODEL_TRANSFORMATION = 34264
TAG_GEO_KEY_DIRECTORY = 34735

# GeoKey ids.
KEY_GEOGRAPHIC_TYPE = 2048
KEY_PROJECTED_CS_TYPE = 3072

_TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8}
_TYPE_FORMATS = {3: "H", 4: "I", 8: "h", 9: "i", 11: "f", 12: "d"}


class GeorefError(Exception):
    """The file's georeferencing could not be read; the message says why."""


def _read_ifd_entries(data, order):
    if len(data) < 8:
        raise GeorefError("file too short to be a TIFF")
    magic = struct.unpack(order + "H", data[2:4])[0]
    if magic == 43:
        raise GeorefError(
            "BigTIFF is not supported by this worker's tag reader; "
            "georeferencing was not read"
        )
    if magic != 42:
        raise GeorefError(f"not a TIFF (magic {magic})")
    ifd_offset = struct.unpack(order + "I", data[4:8])[0]
    if ifd_offset + 2 > len(data):
        raise GeorefError("first IFD offset points outside the file")
    count = struct.unpack(order + "H", data[ifd_offset : ifd_offset + 2])[0]
    entries = {}
    for i in range(count):
        base = ifd_offset + 2 + i * 12
        if base + 12 > len(data):
            raise GeorefError("IFD entry truncated")
        tag, field_type, value_count = struct.unpack(order + "HHI", data[base : base + 8])
        entries[tag] = (field_type, value_count, data[base + 8 : base + 12])
    return entries


def _read_values(data, order, entry):
    field_type, count, inline = entry
    size = _TYPE_SIZES.get(field_type)
    fmt = _TYPE_FORMATS.get(field_type)
    if size is None or fmt is None:
        raise GeorefError(f"unsupported TIFF field type {field_type}")
    total = size * count
    if total <= 4:
        raw = inline[:total]
    else:
        offset = struct.unpack(order + "I", inline)[0]
        if offset + total > len(data):
            raise GeorefError("tag value offset points outside the file")
        raw = data[offset : offset + total]
    return list(struct.unpack(order + fmt * count, raw))


def _epsg_from_geokeys(keys):
    """GeoKeyDirectory: a 4-short header then entries of 4 shorts
    (keyId, tagLocation, count, value). tagLocation 0 means the value is the
    short itself. Projected CS wins over geographic when both appear."""
    if len(keys) < 4:
        raise GeorefError("GeoKeyDirectory too short")
    entry_count = keys[3]
    found = {}
    for i in range(entry_count):
        base = 4 + i * 4
        if base + 4 > len(keys):
            break
        key_id, location, _count, value = keys[base : base + 4]
        if location == 0 and key_id in (KEY_PROJECTED_CS_TYPE, KEY_GEOGRAPHIC_TYPE):
            found[key_id] = value
    epsg = found.get(KEY_PROJECTED_CS_TYPE) or found.get(KEY_GEOGRAPHIC_TYPE)
    if not epsg or epsg in (32767, 0):  # 32767 = user-defined
        raise GeorefError("the GeoTIFF names no EPSG code (user-defined CRS)")
    return int(epsg)


def parse_geotiff(path, max_header_bytes=64 * 1024 * 1024):
    """Read width/height, pixel scale, native bounds and EPSG from the file's
    own tags. Reads at most max_header_bytes — tag data lives near the front of
    ODM's outputs, and a worker should not slurp a 10 GB raster to read 200
    bytes of metadata."""
    with open(path, "rb") as handle:
        data = handle.read(max_header_bytes)
    if len(data) < 4:
        raise GeorefError("file too short to be a TIFF")
    byte_order = data[:2]
    if byte_order == b"II":
        order = "<"
    elif byte_order == b"MM":
        order = ">"
    else:
        raise GeorefError("not a TIFF (no II/MM byte-order mark)")

    entries = _read_ifd_entries(data, order)

    def values_of(tag):
        entry = entries.get(tag)
        return _read_values(data, order, entry) if entry else None

    width_values = values_of(TAG_IMAGE_WIDTH)
    height_values = values_of(TAG_IMAGE_LENGTH)
    if not width_values or not height_values:
        raise GeorefError("the TIFF carries no image dimensions")
    width, height = int(width_values[0]), int(height_values[0])

    geokeys = values_of(TAG_GEO_KEY_DIRECTORY)
    if not geokeys:
        raise GeorefError("the TIFF carries no GeoKeyDirectory — not a GeoTIFF")
    epsg = _epsg_from_geokeys(geokeys)

    transformation = values_of(TAG_MODEL_TRANSFORMATION)
    scale = values_of(TAG_MODEL_PIXEL_SCALE)
    tiepoint = values_of(TAG_MODEL_TIEPOINT)

    if transformation and len(transformation) == 16:
        a, b, _c, d = transformation[0:4]
        e, f, _g, h = transformation[4:8]

        def to_model(col, row):
            return (a * col + b * row + d, e * col + f * row + h)

        corners = [to_model(0, 0), to_model(width, 0), to_model(0, height), to_model(width, height)]
        xs = [x for x, _y in corners]
        ys = [y for _x, y in corners]
        native_bounds = (min(xs), min(ys), max(xs), max(ys))
        pixel_size = (abs(a), abs(f))
    elif scale and tiepoint and len(scale) >= 2 and len(tiepoint) >= 6:
        sx, sy = scale[0], scale[1]
        i, j, _k, x, y, _z = tiepoint[:6]
        origin_x = x - i * sx
        origin_y = y + j * sy
        native_bounds = (origin_x, origin_y - height * sy, origin_x + width * sx, origin_y)
        pixel_size = (abs(sx), abs(sy))
    else:
        raise GeorefError(
            "the GeoTIFF carries neither ModelTransformation nor "
            "ModelPixelScale+ModelTiepoint — its placement cannot be read"
        )

    return {
        "width": width,
        "height": height,
        "epsg": epsg,
        "native_bounds": native_bounds,
        "pixel_size": pixel_size,
    }


def wgs84_bounds(parsed):
    """Reproject the native corner bounds to a WGS84 [west, south, east, north].
    Needs pyproj; raises GeorefError when it is absent or the CRS is unknown."""
    try:
        from pyproj import CRS, Transformer  # noqa: PLC0415 - lazy on purpose
    except ImportError as exc:
        raise GeorefError(
            "pyproj is not installed, so the native bounds cannot be "
            "reprojected to WGS84"
        ) from exc

    epsg = parsed["epsg"]
    minx, miny, maxx, maxy = parsed["native_bounds"]
    try:
        crs = CRS.from_epsg(epsg)
        transformer = Transformer.from_crs(crs, CRS.from_epsg(4326), always_xy=True)
    except Exception as exc:  # noqa: BLE001 - unknown EPSG etc.
        raise GeorefError(f"EPSG:{epsg} could not be resolved: {exc}") from exc

    corners = [(minx, miny), (minx, maxy), (maxx, miny), (maxx, maxy)]
    lons, lats = [], []
    for x, y in corners:
        lon, lat = transformer.transform(x, y)
        lons.append(lon)
        lats.append(lat)
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise GeorefError(
            f"reprojected bounds are not a WGS84 rectangle: "
            f"[{west}, {south}, {east}, {north}]"
        )
    return (west, south, east, north)


def pixel_size_meters(parsed):
    """The ground pixel size in meters, ONLY when the native CRS's unit is the
    meter. A degree-unit CRS gets None rather than a wrong number."""
    try:
        from pyproj import CRS  # noqa: PLC0415
    except ImportError:
        return None
    try:
        crs = CRS.from_epsg(parsed["epsg"])
    except Exception:  # noqa: BLE001
        return None
    axes = crs.axis_info
    if not axes or axes[0].unit_name not in ("metre", "meter"):
        return None
    return parsed["pixel_size"][0]
