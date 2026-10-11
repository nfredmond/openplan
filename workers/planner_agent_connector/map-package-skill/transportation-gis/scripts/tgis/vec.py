"""Small vector toolkit on GDAL/OGR.

Everything the data step needs: read any OGR source, reproject, clip, and write
GeoPackage layers with a concrete geometry type. Features are plain tuples of
(ogr.Geometry, dict), which keeps the code readable at city and corridor scale.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()

KINDS = {"point": ogr.wkbMultiPoint, "line": ogr.wkbMultiLineString, "polygon": ogr.wkbMultiPolygon}
SINGLE_POINT = ogr.wkbPoint


def srs(code) -> osr.SpatialReference:
    """EPSG int, 'EPSG:2226' string, or WKT. Axis order is always x, y."""
    s = osr.SpatialReference()
    if isinstance(code, int) or str(code).isdigit():
        s.ImportFromEPSG(int(code))
    else:
        s.SetFromUserInput(str(code))
    s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return s


def transformer(src, dst) -> osr.CoordinateTransformation:
    return osr.CoordinateTransformation(srs(src), srs(dst))


def kind_of(geom: ogr.Geometry) -> str | None:
    t = ogr.GT_Flatten(geom.GetGeometryType())
    if t in (ogr.wkbPoint, ogr.wkbMultiPoint):
        return "point"
    if t in (ogr.wkbLineString, ogr.wkbMultiLineString):
        return "line"
    if t in (ogr.wkbPolygon, ogr.wkbMultiPolygon):
        return "polygon"
    return None


def parts_of_kind(geom: ogr.Geometry, kind: str) -> ogr.Geometry | None:
    """Return the parts of geom that match kind as one multi geometry.

    Clipping a line against a polygon can return a collection with stray points;
    this keeps only what the layer type can hold.
    """
    if geom is None or geom.IsEmpty():
        return None
    out = ogr.Geometry(KINDS[kind])

    def walk(g):
        if kind_of(g) == kind:
            if g.GetGeometryCount() and ogr.GT_Flatten(g.GetGeometryType()) in (
                ogr.wkbMultiPoint, ogr.wkbMultiLineString, ogr.wkbMultiPolygon):
                for i in range(g.GetGeometryCount()):
                    out.AddGeometry(g.GetGeometryRef(i))
            else:
                out.AddGeometry(g)
        elif ogr.GT_Flatten(g.GetGeometryType()) == ogr.wkbGeometryCollection:
            for i in range(g.GetGeometryCount()):
                walk(g.GetGeometryRef(i))

    walk(geom)
    return None if out.IsEmpty() else out


def read(path, layer=None, where=None, to_epsg=None, sql=None, open_options=None):
    """Read features from any OGR source. Returns (features, source_epsg_or_wkt, field_names)."""
    ds = gdal.OpenEx(str(path), gdal.OF_VECTOR, open_options=open_options or [])
    if ds is None:
        raise FileNotFoundError(f"Cannot open vector source: {path}")
    if sql:
        lyr = ds.ExecuteSQL(sql)
    else:
        lyr = ds.GetLayerByName(layer) if layer else ds.GetLayer(0)
    if lyr is None:
        raise ValueError(f"Layer {layer!r} not found in {path}")
    if where:
        lyr.SetAttributeFilter(where)
    src = lyr.GetSpatialRef()
    if src is not None:
        src = src.Clone()
        src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    ct = None
    if to_epsg and src is not None:
        ct = osr.CoordinateTransformation(src, srs(to_epsg))
    defn = lyr.GetLayerDefn()
    names = [defn.GetFieldDefn(i).GetName() for i in range(defn.GetFieldCount())]
    feats = []
    for f in lyr:
        g = f.GetGeometryRef()
        if g is None or g.IsEmpty():
            continue
        g = g.Clone()
        if g.HasCurveGeometry():
            g = g.GetLinearGeometry()
        if ct:
            g.Transform(ct)
        g.FlattenTo2D()
        props = {}
        for i, n in enumerate(names):      # by index: looking fields up by name is several times slower
            v = f.GetField(i)
            if isinstance(v, (list, bytes, bytearray)):
                v = str(v)
            props[n] = v
        feats.append((g, props))
    if sql:
        ds.ReleaseResultSet(lyr)
    epsg = None
    if src is not None:
        try:
            src.AutoIdentifyEPSG()
            epsg = int(src.GetAuthorityCode(None))
        except Exception:
            epsg = src.ExportToWkt()
    return feats, (to_epsg or epsg), names


def reproject(feats, src, dst):
    ct = transformer(src, dst)
    out = []
    for g, p in feats:
        g = g.Clone()
        g.Transform(ct)
        out.append((g, p))
    return out


def bbox_polygon(xmin, ymin, xmax, ymax) -> ogr.Geometry:
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in ((xmin, ymin), (xmin, ymax), (xmax, ymax), (xmax, ymin), (xmin, ymin)):
        ring.AddPoint_2D(x, y)
    poly = ogr.Geometry(ogr.wkbPolygon)
    poly.AddGeometry(ring)
    return poly


def clip(feats, mask: ogr.Geometry, kind: str):
    """Clip features to a mask polygon, keeping only parts of the stated kind."""
    env = mask.GetEnvelope()
    out = []
    gdal.PushErrorHandler("CPLQuietErrorHandler")   # invalid input rings are repaired below; no need to print each one
    try:
        return _clip(feats, mask, kind, env)
    finally:
        gdal.PopErrorHandler()


def _clip(feats, mask, kind, env):
    out = []
    for g, p in feats:
        e = g.GetEnvelope()
        if e[1] < env[0] or e[0] > env[1] or e[3] < env[2] or e[2] > env[3]:
            continue
        if not g.IsValid():
            g = g.MakeValid()
        try:
            c = g.Intersection(mask)
        except RuntimeError:
            c = g.Buffer(0).Intersection(mask)
        c = parts_of_kind(c, kind)
        if c is not None:
            out.append((c, p))
    return out


def union(geoms) -> ogr.Geometry | None:
    coll = ogr.Geometry(ogr.wkbGeometryCollection)
    for g in geoms:
        coll.AddGeometry(g if g.IsValid() else g.MakeValid())
    return None if coll.IsEmpty() else coll.UnaryUnion()


def extent(feats):
    """(xmin, ymin, xmax, ymax) of a feature list."""
    xs0, ys0, xs1, ys1 = [], [], [], []
    for g, _ in feats:
        e = g.GetEnvelope()
        xs0.append(e[0]); xs1.append(e[1]); ys0.append(e[2]); ys1.append(e[3])
    if not xs0:
        raise ValueError("No features to take an extent from")
    return min(xs0), min(ys0), max(xs1), max(ys1)


_OGR_TYPES = {int: ogr.OFTInteger64, float: ogr.OFTReal, str: ogr.OFTString, bool: ogr.OFTInteger}


def safe_field(name: str) -> str:
    """Field names that survive GeoPackage, file geodatabase, shapefile joins and SQL."""
    out = "".join(c if (c.isalnum() or c == "_") else "_" for c in str(name)).strip("_") or "field"
    if out[0].isdigit():
        out = "f_" + out
    if out.lower() in {"fid", "geom", "shape", "objectid", "order", "group", "select", "from", "where", "index"}:
        out = out + "_"
    return out


def write_gpkg(path, layer, feats, epsg, kind, fields=None, description=None):
    """Write one layer to a GeoPackage with a concrete multi geometry type.

    ArcGIS Pro cannot import a generic GEOMETRY layer, so the type is always
    declared, even for an empty layer.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    drv = ogr.GetDriverByName("GPKG")
    ds = drv.Open(str(path), 1) if path.exists() else drv.CreateDataSource(str(path))
    for i in range(ds.GetLayerCount()):
        if ds.GetLayerByIndex(i).GetName() == layer:
            ds.DeleteLayer(i)
            break
    gtype = KINDS[kind]
    if kind == "point" and all(ogr.GT_Flatten(g.GetGeometryType()) == ogr.wkbPoint for g, _ in feats):
        gtype = SINGLE_POINT
    opts = ["GEOMETRY_NAME=geom", "FID=fid"]
    if description:
        opts.append("DESCRIPTION=" + description[:250])
    lyr = ds.CreateLayer(layer, srs(epsg), gtype, opts)
    # Field schema: stated order first, then anything else seen in the features.
    order = list(fields or [])
    seen = set(order)
    for _, p in feats:
        for k in p:
            if k not in seen:
                seen.add(k); order.append(k)
    types = {}
    for k in order:
        t = None
        for _, p in feats:
            v = p.get(k)
            if v is None:
                continue
            vt = type(v)
            if vt is bool:
                vt = int
            if t is None or (t is int and vt is float):
                t = vt
            elif vt is str:
                t = str
        types[k] = t or str
    rename = {}
    used = set()
    for k in order:
        n = safe_field(k)
        base, i = n, 2
        while n.lower() in used:
            n = f"{base}_{i}"; i += 1
        used.add(n.lower()); rename[k] = n
        lyr.CreateField(ogr.FieldDefn(n, _OGR_TYPES[types[k]]))
    defn = lyr.GetLayerDefn()
    lyr.StartTransaction()
    for g, p in feats:
        if gtype != SINGLE_POINT:
            g = parts_of_kind(g, kind)
            if g is None:
                continue
        f = ogr.Feature(defn)
        f.SetGeometry(g)
        for k, v in p.items():
            if v is None or k not in rename:
                continue
            if types[k] is str:
                v = str(v)
            elif types[k] is float:
                v = float(v)
            elif types[k] is int:
                v = int(v)
            f.SetField(rename[k], v)
        lyr.CreateFeature(f)
    lyr.CommitTransaction()
    n = lyr.GetFeatureCount()
    ds.FlushCache()
    ds = None
    return {"file": str(path), "layer": layer, "count": n, "kind": kind, "fields": [rename[k] for k in order]}


def layer_info(path, layer):
    ds = gdal.OpenEx(str(path), gdal.OF_VECTOR)
    lyr = ds.GetLayerByName(layer)
    if lyr is None:
        raise ValueError(f"{layer} not in {path}")
    defn = lyr.GetLayerDefn()
    e = lyr.GetExtent() if lyr.GetFeatureCount() else (0, 0, 0, 0)
    return {
        "count": lyr.GetFeatureCount(),
        "fields": {defn.GetFieldDefn(i).GetName(): defn.GetFieldDefn(i).GetTypeName() for i in range(defn.GetFieldCount())},
        "extent": [e[0], e[2], e[1], e[3]],
        "geometry_type": ogr.GeometryTypeToName(lyr.GetGeomType()),
    }


def to_geojson(feats, src_epsg, path=None, precision=6, simplify_m=None, keep=None):
    """Feature list to a WGS84 GeoJSON dict (and file). Used for the web map and KML."""
    ct = transformer(src_epsg, 4326)
    out = []
    for g, p in feats:
        g = g.Clone()
        if simplify_m:
            g = g.SimplifyPreserveTopology(simplify_m) or g
        g.Transform(ct)
        gj = json.loads(g.ExportToJson(options=[f"COORDINATE_PRECISION={precision}"]))
        props = {k: v for k, v in p.items() if (keep is None or k in keep) and v is not None}
        out.append({"type": "Feature", "properties": props, "geometry": gj})
    fc = {"type": "FeatureCollection", "features": out}
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    return fc


def from_geojson_obj(fc):
    feats = []
    for f in fc.get("features", []):
        if not f.get("geometry"):
            continue
        g = ogr.CreateGeometryFromJson(json.dumps(f["geometry"]))
        if g is None or g.IsEmpty():
            continue
        feats.append((g, dict(f.get("properties") or {})))
    return feats
