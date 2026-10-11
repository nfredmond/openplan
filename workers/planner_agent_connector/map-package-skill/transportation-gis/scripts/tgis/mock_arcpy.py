"""A stand-in for ArcPy, used to dry-run the ArcGIS Pro builder on a computer without ArcGIS Pro.

What the dry run proves: the builder's own Python runs from start to finish against the real
package spec and data (every layer, renderer, label class, layout element and export call is
reached with arguments of the right shape), and its counts match the spec.

What it cannot prove: that ArcGIS Pro accepts those calls or draws the result as intended. Only a
build on a computer with ArcGIS Pro shows that. Report the dry run as a logic check, never as a
native build.
"""
import sqlite3
import sys
import types
from contextlib import closing
from pathlib import Path

LOG = {"calls": [], "layouts": {}, "maps": {}, "files": []}
_COUNTS = {}       # geodatabase path -> feature count
_SOURCE = {}       # geodatabase path -> (gpkg path, table)


def _log(name, *args):
    LOG["calls"].append((name, args))


class Bag:
    """Attribute bag that grows whatever is asked of it, like a CIM object."""

    def __init__(self, kind="Bag", **kw):
        object.__setattr__(self, "_kind", kind)
        for k, v in kw.items():
            object.__setattr__(self, k, v)

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        v = Bag(name)
        object.__setattr__(self, name, v)
        return v


def _gpkg_of(path):
    """Split '.../file.gpkg/main.layer' into (gpkg, table)."""
    p = Path(str(path))
    return p.parent, p.name.split(".")[-1]


def _query(gpkg, sql, args=()):
    with closing(sqlite3.connect(Path(gpkg).as_uri() + "?mode=ro", uri=True)) as con:
        return con.execute(sql, args).fetchall()


class Symbology:
    def __init__(self, layer):
        self._layer = layer
        self.renderer = Bag("renderer", type="SimpleRenderer")

    def updateRenderer(self, name):
        self.renderer = Bag("renderer", type=name)


class LabelClass:
    def __init__(self, name, expression="", sql=""):
        self.name, self.expression, self.SQLQuery, self.visible = name, expression, sql, True


class Layer:
    def __init__(self, path):
        self.dataSource = str(path)
        self.name = Path(str(path)).name
        self.definitionQuery = ""
        self.showLabels = False
        self.transparency = 0
        self.isFeatureLayer = True
        self.isBroken = False
        self._sym = Symbology(self)
        self._labels = [LabelClass("Class 1")]
        self._cim = None

    @property
    def longName(self):
        return "%s#%d" % (self.name, id(self))

    def supports(self, what):
        return True

    @property
    def symbology(self):
        return self._sym

    @symbology.setter
    def symbology(self, value):
        self._sym = value
        self._cim = None

    def listLabelClasses(self):
        return list(self._labels)

    def createLabelClass(self, name, expression, sql_query="", labelclass_language="ARCADE"):
        if "$feature." not in expression:
            raise RuntimeError("mock: label expression is not Arcade: " + expression)
        lc = LabelClass(name, expression, sql_query)
        self._labels.append(lc)
        self._cim = None
        return lc

    def getDefinition(self, version):
        assert version == "V3"
        if self._cim is None:
            c = Bag("CIMFeatureLayer")
            r = self._sym.renderer
            rtype = getattr(r, "type", "SimpleRenderer")
            if rtype == "UniqueValueRenderer":
                gpkg, table = _SOURCE[self.dataSource]
                field = r.fields[0]
                where = (" WHERE " + self.definitionQuery) if self.definitionQuery else ""
                vals = [row[0] for row in _query(gpkg, 'SELECT DISTINCT "%s" FROM "%s"%s' % (field, table, where)) if row[0] is not None]
                classes = [Bag("CIMUniqueValueClass", values=[Bag("CIMUniqueValue", fieldValues=[str(v)])], label=str(v)) for v in vals]
                c.renderer = Bag("CIMUniqueValueRenderer", groups=[Bag("CIMUniqueValueGroup", classes=classes)])
            elif rtype == "GraduatedColorsRenderer":
                c.renderer = Bag("CIMClassBreaksRenderer", breaks=[Bag("CIMClassBreak") for _ in range(int(r.breakCount))])
            else:
                c.renderer = Bag("CIMSimpleRenderer")
            c.labelClasses = [Bag("CIMLabelClass", name=l.name) for l in self._labels]
            self._cim = c
        return self._cim

    def setDefinition(self, c):
        self._cim = c
        _log("Layer.setDefinition", self.name)

    def saveACopy(self, path):
        LOG["files"].append(str(path))


class Map:
    def __init__(self, name):
        self.name = name
        self._layers = [Layer("default_basemap")]
        self.spatialReference = None
        self.referenceScale = 0
        self.defaultCamera = None

    def listLayers(self):
        return list(self._layers)

    def removeLayer(self, ly):
        self._layers = [l for l in self._layers if l is not ly]

    def addDataFromPath(self, path):
        if str(path) not in _COUNTS:
            raise RuntimeError("mock: layer added from a path that was never imported: %s" % path)
        ly = Layer(path)
        self._layers.insert(0, ly)
        return ly

    def moveLayer(self, ref, ly, pos="BEFORE"):
        self._layers = [l for l in self._layers if l is not ly]
        self._layers.insert(self._layers.index(ref) + (0 if pos == "BEFORE" else 1), ly)

    def exportToMAPX(self, path):
        LOG["files"].append(str(path))


class Element:
    def __init__(self, kind, name, **kw):
        self.kind, self.name = kind, name
        self.elementPositionX = self.elementPositionY = 0.0
        self.elementWidth = self.elementHeight = 1.0
        self.camera = Bag("camera", scale=24000.0, heading=0, setExtent=lambda e: None)
        self.__dict__.update(kw)
        self._cim = Bag("cim")

    def setAnchor(self, a):
        if a not in ("BOTTOM_LEFT_CORNER", "BOTTOM_MID_POINT", "BOTTOM_RIGHT_CORNER", "CENTER_POINT", "LEFT_MID_POINT",
                     "RIGHT_MID_POINT", "TOP_LEFT_CORNER", "TOP_MID_POINT", "TOP_RIGHT_CORNER"):
            raise ValueError("mock: bad anchor " + str(a))

    def getDefinition(self, v):
        return self._cim

    def setDefinition(self, c):
        self._cim = c


class Series:
    def __init__(self):
        self._cim = Bag("CIMSpatialMapSeries")

    def getDefinition(self, v):
        return self._cim

    def setDefinition(self, c):
        self._cim = c

    def exportToPDF(self, path, *a, **k):
        LOG["files"].append(str(path))


class Layout:
    def __init__(self, w, h, units, name):
        self.name, self.w, self.h = name, w, h
        self._els = []
        self.metadata = Bag("metadata")
        LOG["layouts"][name] = self

    def createMapFrame(self, geometry, m, name=""):
        el = Element("mapframe", name, map=m, geometry=geometry)
        self._els.append(el)
        return el

    def createMapSurroundElement(self, geometry, kind, mapframe=None, style_item=None, name=""):
        if kind.upper() not in ("NORTH_ARROW", "SCALE_BAR", "LEGEND", "GRID", "DUAL_SCALE_BAR"):
            raise ValueError("mock: bad map surround type " + kind)
        el = Element("surround:" + kind, name)
        self._els.append(el)
        return el

    def createSpatialMapSeries(self, mapframe, index_layer, name_field, sort_field=None):
        return Series()

    def listElements(self):
        return list(self._els)

    def exportToPDF(self, path, **k):
        LOG["files"].append(str(path))

    exportToPNG = exportToPDF
    exportToAIX = exportToPDF

    def exportToPAGX(self, path):
        LOG["files"].append(str(path))


class Project:
    def __init__(self, path):
        self.filePath = str(path)
        self._maps, self._layouts = [Map("Template map")], []
        self.defaultGeodatabase = self.homeFolder = ""

    def saveACopy(self, path):
        LOG["files"].append(str(path))

    def save(self):
        pass

    def listMaps(self):
        return list(self._maps)

    def listLayouts(self):
        return list(self._layouts)

    def deleteItem(self, item):
        self._maps = [m for m in self._maps if m is not item]
        self._layouts = [l for l in self._layouts if l is not item]

    def createMap(self, name, kind="MAP"):
        m = Map(name)
        self._maps.append(m)
        LOG["maps"][name] = m
        return m

    def createLayout(self, w, h, units, name):
        l = Layout(w, h, units, name)
        self._layouts.append(l)
        return l

    def createTextElement(self, container, geometry, kind, text, size, font, style, name=""):
        if not isinstance(text, str) or not text:
            raise ValueError("mock: empty text element " + name)
        if style not in ("Regular", "Medium", "Semibold", "Bold", "Italic", "Medium Italic", "Semibold Italic", "Bold Italic"):
            raise ValueError("mock: unknown font style " + str(style))
        el = Element("text", name, text=text, size=size, x=geometry.X, y=geometry.Y)
        container._els.append(el)
        return el

    def createGraphicElement(self, container, geometry, name=""):
        el = Element("graphic", name, geometry=geometry)
        container._els.append(el)
        return el

    def listStyleItems(self, style, style_class=None, wildcard=None):
        return [Bag("StyleItem", name="ArcGIS North 1"), Bag("StyleItem", name="Scale Line 1")]


_PROJECTS = {}


def install():
    """Put a fake `arcpy` in sys.modules and return it."""
    for d in (LOG["calls"], LOG["files"]):
        d.clear()
    LOG["layouts"].clear(); LOG["maps"].clear(); _COUNTS.clear(); _SOURCE.clear(); _PROJECTS.clear()
    a = types.ModuleType("arcpy")

    class ExecuteError(Exception):
        pass

    class Point:
        def __init__(self, x=0.0, y=0.0):
            self.X, self.Y = float(x), float(y)

    a.ExecuteError = ExecuteError
    a.Point = Point
    a.Array = lambda pts: list(pts)
    a.Polygon = lambda arr: Bag("Polygon", points=arr)
    a.Polyline = lambda arr: Bag("Polyline", points=arr)
    a.Extent = lambda *v: Bag("Extent", values=v)
    a.SpatialReference = lambda code: Bag("SpatialReference", factoryCode=int(code))
    a.GetInstallInfo = lambda: {"Version": "3.5.0"}
    a.AddWarning = lambda m: None
    a.AddMessage = lambda m: None
    a.ListFonts = lambda: ["Inter", "Arial"]
    a.Exists = lambda p: str(p) in _COUNTS
    a.ValidateTableName = lambda n, ws=None: n.replace(".", "_")
    a.env = Bag("env", workspace=None)

    class EnvManager:
        def __init__(self, **kw):
            self.kw = kw

        def __enter__(self):
            a.env.workspace = self.kw.get("workspace")

        def __exit__(self, *e):
            a.env.workspace = None

    a.EnvManager = EnvManager
    a.ListFeatureClasses = lambda: ["main." + r[0] for r in _query(a.env.workspace, "SELECT table_name FROM gpkg_geometry_columns")]

    def describe(path):
        gpkg, table = _gpkg_of(path)
        srs = _query(gpkg, "SELECT srs_id FROM gpkg_geometry_columns WHERE table_name=?", (table,))[0][0]
        return Bag("Describe", spatialReference=Bag("sr", factoryCode=srs), shapeType="Polygon")

    a.Describe = describe
    mg = types.SimpleNamespace()

    def copy_features(src, dest):
        gpkg, table = _gpkg_of(src)
        _COUNTS[str(dest)] = _query(gpkg, 'SELECT COUNT(*) FROM "%s"' % table)[0][0]
        _SOURCE[str(dest)] = (gpkg, table)

    mg.CopyFeatures = copy_features
    mg.Project = lambda src, dest, sr: copy_features(src, dest)
    mg.GetCount = lambda p: [str(_COUNTS[str(p)])]
    mg.Delete = lambda p: _COUNTS.pop(str(p), None)
    mg.CreateFileGDB = lambda folder, name: None

    def create_fc(gdb, name, shape, spatial_reference=None):
        if shape not in ("POINT", "MULTIPOINT", "POLYLINE", "POLYGON"):
            raise ValueError("mock: bad shape type " + shape)
        _COUNTS[str(Path(gdb) / name)] = 0
        _SOURCE[str(Path(gdb) / name)] = (None, None)

    mg.CreateFeatureclass = create_fc
    a.management = mg
    a.cim = types.SimpleNamespace(CreateCIMObjectFromClassName=lambda kind, v: Bag(kind))

    def project(path):
        return _PROJECTS.setdefault(str(path), Project(path))

    a.mp = types.SimpleNamespace(ArcGISProject=project)
    sys.modules["arcpy"] = a
    return a
