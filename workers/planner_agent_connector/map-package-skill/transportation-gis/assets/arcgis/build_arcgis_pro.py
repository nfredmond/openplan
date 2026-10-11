"""Build a native ArcGIS Pro project from spec/map_package.json.

Creates, in a new dated folder under <package>/arcgis/native/:
  <id>_Maps.aprx     one map and one layout per figure, a map series layout per map book
  <id>_Data.gdb      every layer the maps use, copied from the package GeoPackages
  *.lyrx *.mapx *.pagx   layer, map and layout files for reuse in other projects
  exports/           PDF, PNG and AIX (Adobe Illustrator Exchange) of every layout
  native_build_report.json

Needs ArcGIS Pro 3.3 or later and nothing else: ArcPy plus the standard library.
Do not install packages or clone the Python environment.

Run it one of three ways:
  1. Toolbox: add arcgis/Build_Maps.pyt in the Catalog pane and run "Build project and layouts".
  2. Python window in Pro (View > Python window), one line:
       exec(open(r"C:\\GIS\\<package>\\arcgis\\build_arcgis_pro.py").read()); build(r"C:\\GIS\\<package>")
  3. Stand-alone, with Pro's Python:
       "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\Scripts\\propy.bat" build_arcgis_pro.py --root C:\\GIS\\<package> --template C:\\GIS\\Blank.aprx
     (Pro 3.7 and later can omit --template; earlier versions need any blank .aprx.)

Without ArcPy (any computer):  python build_arcgis_pro.py --preflight
checks that every layer, field and filter the maps use exists in the package.

Design notes for whoever maintains this file
  - Sources are the GeoPackages. A GDAL-written file geodatabase does not open reliably in Pro, so
    the geodatabase is created here, by Pro, and features are copied into it.
  - The page design comes from the spec as exact positions. Titles, legend, scale bar and north
    arrow are native text and graphics at those positions, so the layout matches the delivered PDF.
    A dynamic legend, scale bar and north arrow are also added just off the page edge for editing.
  - Symbols are CIM symbols. Lines with casings are added as two layers (casings under fills) so
    junctions merge the way they do in the delivered figures.
  - Steps that rest on CIM properties with no Esri sample are wrapped individually: a failure is
    logged under "warnings" in the report and the build goes on.
"""
import argparse
import copy
import datetime
import json
import math
import sqlite3
import sys
import time
import traceback
from contextlib import closing
from pathlib import Path

INK = "#1f2d35"
try:
    DEFAULT_ROOT = Path(__file__).resolve().parents[1]
except NameError:       # exec() from the Python window has no __file__
    DEFAULT_ROOT = Path.cwd()
FONT_STYLES = {"regular": "Regular", "medium": "Medium", "semibold": "Semibold", "bold": "Bold"}
ANCHORS = {("left", "top"): "TOP_LEFT_CORNER", ("center", "top"): "TOP_MID_POINT", ("right", "top"): "TOP_RIGHT_CORNER",
           ("left", "middle"): "LEFT_MID_POINT", ("center", "middle"): "CENTER_POINT", ("right", "middle"): "RIGHT_MID_POINT",
           ("left", "bottom"): "BOTTOM_LEFT_CORNER", ("center", "bottom"): "BOTTOM_MID_POINT", ("right", "bottom"): "BOTTOM_RIGHT_CORNER"}
_STATE = {}


# =============================================================== preflight

def load_spec(root):
    return json.loads((Path(root) / "spec" / "map_package.json").read_text(encoding="utf-8"))


def all_layouts(spec):
    return [(m, False) for m in spec["maps"]] + [(a, True) for a in spec.get("atlases", [])]


def layers_of(mp):
    out = list(mp["layers"])
    if mp.get("inset") and mp["inset"].get("layers"):
        out += mp["inset"]["layers"]
    return out


def preflight(root=DEFAULT_ROOT, spec=None):
    """Check sources, fields and filters with sqlite only. Returns {'errors': [...], 'inputs': [...]}."""
    root = Path(root).resolve()
    spec = spec or load_spec(root)
    errors, inputs = [], {}
    for mp, is_atlas in all_layouts(spec):
        specs = layers_of(mp)
        if is_atlas:
            specs = specs + [{"id": "index", "file": mp["atlas"]["file"], "layer": mp["atlas"]["index_layer"],
                              "renderer": {"type": "simple"}, "labels": [], "where": None}]
        for ls in specs:
            key = (ls["file"], ls["layer"])
            path = root / ls["file"]
            try:
                if not path.is_file():
                    raise ValueError("missing data file " + ls["file"])
                with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as con:
                    if key not in inputs:
                        row = con.execute("SELECT srs_id, geometry_type_name FROM gpkg_geometry_columns WHERE table_name=?", (ls["layer"],)).fetchone()
                        if not row:
                            raise ValueError("no spatial layer %s in %s" % (ls["layer"], ls["file"]))
                        if str(row[1]).upper() in ("GEOMETRY", "GEOMETRYCOLLECTION"):
                            raise ValueError("%s has a generic geometry type; ArcGIS Pro cannot import it" % ls["layer"])
                        fields = {r[1] for r in con.execute('PRAGMA table_info("%s")' % ls["layer"])}
                        count = con.execute('SELECT COUNT(*) FROM "%s"' % ls["layer"]).fetchone()[0]
                        inputs[key] = {"file": ls["file"], "layer": ls["layer"], "srs_id": row[0], "geometry_type": row[1], "fields": sorted(fields), "count": count}
                    fields = set(inputs[key]["fields"])
                    r = ls["renderer"]
                    if r.get("field") and r["field"] not in fields:
                        raise ValueError("%s: style field %s is not in %s" % (mp["id"], r["field"], ls["layer"]))
                    for lab in ls.get("labels") or []:
                        if lab.get("field") and lab["field"] not in fields:
                            raise ValueError("%s: label field %s is not in %s" % (mp["id"], lab["field"], ls["layer"]))
                        if lab.get("where"):
                            con.execute('SELECT COUNT(*) FROM "%s" WHERE %s' % (ls["layer"], lab["where"])).fetchone()
                    if ls.get("where"):
                        con.execute('SELECT COUNT(*) FROM "%s" WHERE %s' % (ls["layer"], ls["where"])).fetchone()
            except (ValueError, sqlite3.Error) as err:
                errors.append("%s / %s: %s" % (mp["id"], ls.get("id", ls["layer"]), err))
        fr, pg = mp["frame"], mp["page"]
        if fr["x"] < -1e-6 or fr["y"] < -1e-6 or fr["x"] + fr["w"] > pg["w"] + 1e-6 or fr["y"] + fr["h"] > pg["h"] + 1e-6:
            errors.append(mp["id"] + ": map frame extends past the page")
        e = mp["extent"]
        if not (e[0] < e[2] and e[1] < e[3]):
            errors.append(mp["id"] + ": invalid extent")
    return {"layouts": len(all_layouts(spec)), "input_layers": len(inputs), "errors": errors, "inputs": list(inputs.values()),
            "native_build": "NOT PERFORMED (preflight only)"}


# ================================================================== helpers

def rgba(value, opacity=1.0):
    """'#rrggbb' to [r, g, b, alpha 0-100]. None is fully transparent."""
    if value in (None, "", "none"):
        return [255, 255, 255, 0]
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(ch * 2 for ch in v)
    return [int(v[i:i + 2], 16) for i in (0, 2, 4)] + [int(round(100 * max(0.0, min(1.0, opacity))))]


def class_where(renderer, cls=None, which="class"):
    f = '"%s"' % renderer["field"]

    def lit(v):
        if isinstance(v, bool):
            return "1" if v else "0"
        if isinstance(v, (int, float)):
            return repr(v)
        return "'" + str(v).replace("'", "''") + "'"
    if renderer["type"] == "categorized":
        if which == "other":
            vals = [v for c in renderer["classes"] for v in c["values"]]
            return "(%s IS NULL OR %s NOT IN (%s))" % (f, f, ", ".join(lit(v) for v in vals)) if vals else "1=1"
        return "%s IN (%s)" % (f, ", ".join(lit(v) for v in cls["values"]))
    if which == "nodata":
        return f + " IS NULL"
    parts = []
    if cls["min"] is not None:
        parts.append("%s >= %r" % (f, cls["min"]))
    if cls["max"] is not None:
        parts.append("%s < %r" % (f, cls["max"]))
    return " AND ".join(parts) or (f + " IS NOT NULL")


def marker_ring(shape):
    """Unit polygon (within -0.5..0.5) for a marker shape, closed."""
    if shape == "square":
        pts = [(-.44, -.44), (-.44, .44), (.44, .44), (.44, -.44)]
    elif shape == "triangle":
        pts = [(0, .5), (.5, -.42), (-.5, -.42)]
    elif shape == "diamond":
        pts = [(0, .5), (.42, 0), (0, -.5), (-.42, 0)]
    elif shape == "star":
        pts = [(math.cos(math.pi / 2 - i * math.pi / 5) * (.5 if i % 2 == 0 else .21), math.sin(math.pi / 2 - i * math.pi / 5) * (.5 if i % 2 == 0 else .21)) for i in range(10)]
    elif shape == "pentagon":
        pts = [(math.cos(math.pi / 2 - i * 2 * math.pi / 5) * .5, math.sin(math.pi / 2 - i * 2 * math.pi / 5) * .5) for i in range(5)]
    elif shape == "cross":
        a, b = .5, .16
        pts = [(-b, a), (b, a), (b, b), (a, b), (a, -b), (b, -b), (b, -a), (-b, -a), (-b, -b), (-a, -b), (-a, b), (-b, b)]
    else:
        pts = [(math.cos(-i * math.pi / 24) / 2, math.sin(-i * math.pi / 24) / 2) for i in range(48)]
    return [list(p) for p in pts + pts[:1]]


# ==================================================================== build

def build(root=DEFAULT_ROOT, template="CURRENT", output=None, font=None, export=True, export_aix=True, only=None):
    """Build the native project. Returns the path of the .aprx.

    If the build fails, native_build_report.json is still written with the error and the
    warnings gathered so far, and BUILD_INCOMPLETE.txt stays in the run folder.
    """
    _STATE.clear()
    try:
        return _build(Path(root).resolve(), template, output, font, export, export_aix, only)
    except Exception as err:
        if _STATE.get("out") is not None:
            rep = _STATE["report"]
            rep["status"] = "FAILED"
            rep["error"] = str(err)
            rep["traceback"] = traceback.format_exc()
            try:
                (_STATE["out"] / "native_build_report.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
            except OSError:
                pass
        raise


def _build(root, template, output, font, export, export_aix, only):
    import arcpy

    spec = load_spec(root)
    check = preflight(root, spec)
    if check["errors"]:
        raise ValueError("Preflight failed:\n" + "\n".join(check["errors"]))
    version = arcpy.GetInstallInfo()["Version"]
    vnum = tuple(int(x) for x in version.split(".")[:2])
    if vnum < (3, 3):
        raise RuntimeError("ArcGIS Pro 3.3 or later is required (found %s)" % version)
    font = font or spec["font"]["family"]
    pid = spec["project"]["id"]
    epsg = int(spec["crs"]["epsg"])
    sr = arcpy.SpatialReference(epsg)

    parent = Path(output).resolve() if output else root / "arcgis" / "native"
    out = parent / datetime.datetime.now().strftime("build_%Y%m%d_%H%M%S")
    out.mkdir(parents=True, exist_ok=False)
    (out / "exports").mkdir()
    incomplete = out / "BUILD_INCOMPLETE.txt"
    incomplete.write_text("The native build has not finished. Partial outputs are not accepted deliverables.\n", encoding="utf-8")
    report = {"arcgis_version": version, "font": font, "package": str(root), "started": datetime.datetime.now().isoformat(timespec="seconds"),
              "imports": [], "layouts": [], "warnings": [], "status": "RUNNING", "visual_review": "PENDING"}
    _STATE.update(out=out, report=report)

    def warn(msg):
        report["warnings"].append(msg)
        arcpy.AddWarning(msg)

    def attempt(label, fn):
        """Run a step that rests on unverified CIM detail; log and continue if it fails."""
        try:
            return fn()
        except Exception as err:   # noqa: BLE001  (any ArcPy failure here is non-fatal by design)
            warn("%s: skipped (%s)" % (label, str(err).strip().splitlines()[-1][:160] if str(err).strip() else type(err).__name__))
            return None

    # ------------------------------------------------------------ project
    target = out / (pid + "_Maps.aprx")
    if template == "CURRENT" or (template and Path(str(template)).suffix.lower() == ".aprx"):
        source = arcpy.mp.ArcGISProject(str(template))
        source.saveACopy(str(target))
        project = arcpy.mp.ArcGISProject(str(target))
    elif hasattr(arcpy.mp, "CreateArcGISProject"):      # Pro 3.7 and later
        project = arcpy.mp.CreateArcGISProject(str(out), pid + "_Maps", False)
        project.save()
        target = Path(project.filePath)
    else:
        raise RuntimeError("Give --template a blank .aprx, or run from inside ArcGIS Pro (template='CURRENT').")
    # Only the saved copy is edited. Maps and layouts already in it are removed so the result holds just this package.
    for item in project.listLayouts() + project.listMaps():
        attempt("remove template item", lambda item=item: project.deleteItem(item))
    gdb = out / (pid + "_Data.gdb")
    arcpy.management.CreateFileGDB(str(out), gdb.name)
    attempt("project defaults", lambda: (setattr(project, "defaultGeodatabase", str(gdb)), setattr(project, "homeFolder", str(out))))
    arcpy.env.addOutputsToMap = False     # never add intermediate outputs to a map the user has open
    arcpy.env.overwriteOutput = True

    fonts = attempt("list fonts", lambda: list(arcpy.ListFonts())) or []
    if fonts and font not in fonts:
        warn('Font family "%s" is not installed, so Pro substitutes another. Install the files in fonts/ and rebuild or re-export.' % font)
    report["font_installed"] = bool(fonts) and font in fonts

    # ------------------------------------------------------------- import
    native = {}

    def retry(label, fn, tries=4, wait=4):
        last = None
        for i in range(tries):
            try:
                return fn()
            except (arcpy.ExecuteError, OSError, RuntimeError) as err:
                last = err
                warn("%s: attempt %d failed (%s)" % (label, i + 1, str(err).strip().splitlines()[-1][:120]))
                time.sleep(wait)
        raise last

    for item in check["inputs"]:
        file, layer = item["file"], item["layer"]
        workspace = str(root / file)
        with arcpy.EnvManager(workspace=workspace):
            names = arcpy.ListFeatureClasses() or []
        matches = [n for n in names if n == layer or n.split(".")[-1] == layer]
        name = arcpy.ValidateTableName(Path(file).stem + "_" + layer, str(gdb))
        dest = str(gdb / name)
        gtype = str(item.get("geometry_type", "")).upper()
        shape = "POINT" if gtype == "POINT" else "MULTIPOINT" if gtype == "MULTIPOINT" else "POLYLINE" if "LINE" in gtype else "POLYGON"
        if item["count"] == 0 or len(matches) != 1:
            if item["count"] > 0:
                raise RuntimeError("Cannot find GeoPackage layer %s in %s (Pro lists: %s)" % (layer, file, names))
            arcpy.management.CreateFeatureclass(str(gdb), name, shape, spatial_reference=sr)
            native[(file, layer)] = dest
            report["imports"].append({"file": file, "layer": layer, "native": name, "count": 0, "note": "empty source; empty class created"})
            continue
        src = str(Path(workspace) / matches[0])

        def do_import(src=src, dest=dest):
            if arcpy.Exists(dest):
                arcpy.management.Delete(dest)
            if arcpy.Describe(src).spatialReference.factoryCode == epsg:
                arcpy.management.CopyFeatures(src, dest)
            else:
                arcpy.management.Project(src, dest, sr)
            return int(arcpy.management.GetCount(dest)[0])
        n = retry("import " + layer, do_import)
        if n != item["count"]:
            raise RuntimeError("Feature count changed on import of %s: %d in the GeoPackage, %d in the geodatabase" % (layer, item["count"], n))
        native[(file, layer)] = dest
        report["imports"].append({"file": file, "layer": layer, "native": name, "count": n})

    # ---------------------------------------------------------- CIM symbols
    def obj(kind):
        return arcpy.cim.CreateCIMObjectFromClassName(kind, "V3")

    def color(value, opacity=1.0):
        c = obj("CIMRGBColor")
        c.values = rgba(value, opacity)
        return c

    def stroke(value, width, dash=None, opacity=1.0, cap=None):
        s = obj("CIMSolidStroke")
        s.enable = True
        s.color = color(value, opacity)
        s.width = float(width)
        s.capStyle = cap or ("Butt" if dash else "Round")
        s.joinStyle = "Round"
        if dash:
            d = obj("CIMGeometricEffectDashes")
            d.dashTemplate = [float(v) for v in dash]
            d.lineDashEnding = "NoConstraint"
            s.effects = [d]
        return s

    def solid_fill(value, opacity=1.0):
        f = obj("CIMSolidFill")
        f.enable = True
        f.color = color(value, opacity)
        return f

    def reference(sym):
        ref = obj("CIMSymbolReference")
        ref.symbol = sym
        return ref

    def line_symbol(s, part="both"):
        """part: 'both' (fill stroke over casing), 'casing' or 'fill'."""
        sym = obj("CIMLineSymbol")
        layers = []
        op = s.get("opacity", 1.0)
        if part in ("both", "fill"):
            layers.append(stroke(s["color"], s["width"], s.get("dash"), op))
        if part in ("both", "casing") and s.get("casing"):
            layers.append(stroke(s["casing"], s["casing_width"], None, op, cap="Round" if not s.get("dash") else "Butt"))
        sym.symbolLayers = layers          # first layer draws on top
        return sym

    def polygon_symbol(s):
        sym = obj("CIMPolygonSymbol")
        layers = []
        if s.get("stroke") and s.get("stroke_width"):
            layers.append(stroke(s["stroke"], s["stroke_width"], s.get("stroke_dash")))
        if s.get("hatch"):
            h = s["hatch"]
            hf = obj("CIMHatchFill")
            hf.enable = True
            hf.rotation = float(h.get("angle", 45))
            hf.separation = float(h.get("spacing", 4))
            hl = obj("CIMLineSymbol")
            hl.symbolLayers = [stroke(h.get("color", INK), h.get("width", 0.5))]
            hf.lineSymbol = hl
            layers.append(hf)
        layers.append(solid_fill(s.get("fill"), s.get("fill_opacity", 1.0) if s.get("fill") else 0.0))
        sym.symbolLayers = layers
        return sym

    def point_symbol(s):
        sym = obj("CIMPointSymbol")
        m = obj("CIMVectorMarker")
        m.enable = True
        m.size = float(s.get("size", 5))
        m.frame = {"xmin": -0.5, "ymin": -0.5, "xmax": 0.5, "ymax": 0.5}
        m.respectFrame = True
        m.scaleSymbolsProportionally = False
        g = obj("CIMMarkerGraphic")
        g.geometry = {"rings": [marker_ring(s.get("marker", "circle"))]}
        g.symbol = polygon_symbol({"fill": s.get("fill"), "fill_opacity": s.get("fill_opacity", 1.0), "stroke": s.get("stroke"), "stroke_width": s.get("stroke_width")})
        m.markerGraphics = [g]
        sym.symbolLayers = [m]
        return sym

    def cim_symbol(s, part="both"):
        if s["kind"] == "line":
            return line_symbol(s, part)
        if s["kind"] == "polygon":
            return polygon_symbol(s)
        return point_symbol(s)

    def text_symbol_edit(ts, lab_or_el, halo=0.0):
        """Set family, style, size, colour and halo on a CIMTextSymbol."""
        ts.fontFamilyName = font
        style = FONT_STYLES.get(lab_or_el.get("weight", "regular"), "Regular")
        if lab_or_el.get("italic"):
            style = "Italic" if style == "Regular" else style + " Italic"
        ts.fontStyleName = style
        ts.height = float(lab_or_el["size"])
        fill = obj("CIMPolygonSymbol")
        fill.symbolLayers = [solid_fill(lab_or_el.get("color", INK))]
        ts.symbol = fill
        if halo:
            hs = obj("CIMPolygonSymbol")
            hs.symbolLayers = [solid_fill(lab_or_el.get("halo_color", "#ffffff"), 0.88)]
            ts.haloSymbol = hs
            ts.haloSize = float(halo)
        if lab_or_el.get("letter_spacing"):
            ts.letterSpacing = float(lab_or_el["letter_spacing"]) / float(lab_or_el["size"]) * 100.0   # percent of the font size

    # ------------------------------------------------------- map and layers
    def new_map(name):
        m = project.createMap(name, "MAP")
        m.spatialReference = sr
        for ly in m.listLayers():          # createMap adds a default basemap
            m.removeLayer(ly)
        return m

    def add_data(m, path):
        return retry("add " + Path(path).name, lambda: m.addDataFromPath(path), tries=5)

    def to_top(m, ly):
        top = m.listLayers()[0]
        if ly.longName != top.longName:
            m.moveLayer(top, ly, "BEFORE")

    def set_simple(ly, symbol_obj):
        sy = ly.symbology
        sy.updateRenderer("SimpleRenderer")
        ly.symbology = sy
        c = ly.getDefinition("V3")
        c.renderer.symbol = reference(symbol_obj)
        ly.setDefinition(c)

    def native_unique(ly, r, part):
        """One layer, unique value renderer. Pro builds the classes; the symbols and labels are then replaced."""
        sy = ly.symbology
        sy.updateRenderer("UniqueValueRenderer")
        sy.renderer.fields = [r["field"]]
        ly.symbology = sy
        c = ly.getDefinition("V3")
        by_value = {}
        for g in c.renderer.groups:
            for cl in g.classes:
                by_value[str(cl.values[0].fieldValues[0])] = cl
        classes = []
        for spec_cls in r["classes"]:
            hits = [by_value[str(v)] for v in spec_cls["values"] if str(v) in by_value]
            if not hits:
                continue
            keep = hits[0]
            keep.values = [v for h in hits for v in h.values]
            keep.label = spec_cls["label"]
            keep.symbol = reference(cim_symbol(spec_cls["symbol"], part))
            keep.visible = True
            classes.append(keep)
        c.renderer.groups[0].classes = classes
        c.renderer.groups = [c.renderer.groups[0]]
        c.renderer.groups[0].heading = r.get("title") or ""
        if r.get("other"):
            c.renderer.useDefaultSymbol = True
            c.renderer.defaultLabel = r["other"]["label"]
            c.renderer.defaultSymbol = reference(cim_symbol(r["other"]["symbol"], part))
        else:
            c.renderer.useDefaultSymbol = False
        ly.setDefinition(c)

    def native_breaks(ly, r, part):
        sy = ly.symbology
        sy.updateRenderer("GraduatedColorsRenderer")
        sy.renderer.classificationField = r["field"]
        sy.renderer.breakCount = len(r["classes"])
        ly.symbology = sy
        c = ly.getDefinition("V3")
        if len(c.renderer.breaks) != len(r["classes"]):
            raise RuntimeError("Pro made %d classes, the spec has %d" % (len(c.renderer.breaks), len(r["classes"])))
        c.renderer.classificationMethod = "Manual"
        for brk, spec_cls in zip(c.renderer.breaks, r["classes"]):
            hi = 1e300 if spec_cls["max"] is None else spec_cls["max"] - 1e-9 * max(1.0, abs(spec_cls["max"]))
            brk.upperBound = hi
            brk.label = spec_cls["label"]
            brk.symbol = reference(cim_symbol(spec_cls["symbol"], part))
        ly.setDefinition(c)

    def apply_labels(ly, labels):
        if not labels or not ly.supports("SHOWLABELS"):
            return
        for lc in ly.listLabelClasses():
            lc.visible = False
        made = []
        for i, lab in enumerate(labels):
            expr = "$feature.%s" % lab["field"]
            if lab.get("upper"):
                expr = "Upper(%s)" % expr
            name = lab.get("name") or ("Label class %d" % (i + 1))
            lc = ly.createLabelClass(name, expr, lab.get("where") or "", "ARCADE")
            lc.visible = True
            made.append((name, lab))
        ly.showLabels = True
        c = ly.getDefinition("V3")
        for cl in c.labelClasses:
            lab = next((l for n, l in made if n == cl.name), None)
            if lab is None:
                continue
            text_symbol_edit(cl.textSymbol.symbol, lab, lab.get("halo", 0.0))

            def place(cl=cl, lab=lab):
                mp_ = cl.maplexLabelPlacementProperties
                p = lab.get("placement")
                if p in ("curved", "line"):
                    mp_.featureType = "Line"
                    mp_.lineFeatureType = "Street"
                    mp_.linePlacementMethod = "CenteredCurvedOnLine" if p == "curved" and not lab.get("shield") else "CenteredHorizontalOnLine"
                    mp_.repeatLabel = True
                    mp_.minimumRepetitionInterval = float(lab.get("repeat_in", 4.0)) * 72.0
                    mp_.thinDuplicateLabels = True
                elif p == "polygon":
                    mp_.featureType = "Polygon"
                    mp_.polygonPlacementMethod = "HorizontalInPolygon"
                    mp_.canStackLabel = True
                else:
                    mp_.featureType = "Point"
                    mp_.pointPlacementMethod = "AroundPoint"
                    mp_.canStackLabel = True
                cl.priority = int(lab.get("priority", 5))
            attempt("label placement for " + ly.name, place)
        ly.setDefinition(c)

    def add_layer(m, ls, report_layers):
        """Add one resolved layer (possibly as several native layers). Each new layer goes on top."""
        path = native[(ls["file"], ls["layer"])]
        r = ls["renderer"]
        kind = ls["kind"]
        base_q = ls.get("where") or ""

        def one(name, query, symbol_or_fn, labels=None):
            ly = add_data(m, path)
            ly.name = name
            q = " AND ".join("(%s)" % x for x in (base_q, query) if x)
            if q:
                ly.definitionQuery = q
            if ly.supports("SHOWLABELS"):
                ly.showLabels = False
            if callable(symbol_or_fn):
                symbol_or_fn(ly)
            else:
                set_simple(ly, symbol_or_fn)
            if ls.get("opacity", 1.0) < 1.0 and ly.supports("TRANSPARENCY"):
                ly.transparency = int(round((1 - ls["opacity"]) * 100))
            if labels:
                attempt("labels for " + name, lambda: apply_labels(ly, labels))
            to_top(m, ly)
            return ly

        title = ls["title"]
        syms = [r["symbol"]] if r["type"] == "simple" else [c["symbol"] for c in r["classes"]]
        cased = kind == "line" and any(s.get("casing") for s in syms)
        parts = [("casing", title + " (casings)"), ("fill", title)] if cased else [("both", title)]
        mode = "simple"
        if r["type"] == "graduated" and r.get("nodata"):
            one(title + " (no data)", class_where(r, None, "nodata"), cim_symbol(r["nodata"]["symbol"]))
        for part, name in parts:
            labels = ls.get("labels") if part != "casing" else None
            if r["type"] == "simple":
                one(name, "", cim_symbol(r["symbol"], part), labels)
                continue
            try:
                fn = (lambda ly, part=part: native_unique(ly, r, part)) if r["type"] == "categorized" else (lambda ly, part=part: native_breaks(ly, r, part))
                one(name, "", fn, labels)
                mode = "native renderer"
            except Exception as err:   # noqa: BLE001
                # Fall back to one definition-queried layer per class, which uses only proven calls.
                warn("%s: native %s renderer failed (%s); built one layer per class instead" % (name, r["type"], str(err).strip().splitlines()[-1][:120]))
                for ly in [l for l in m.listLayers() if l.name == name]:
                    m.removeLayer(ly)
                order = list(reversed(r["classes"]))     # layers are added bottom first; the first class ends on top
                if r.get("other"):
                    one(name + ": " + r["other"]["label"], class_where(r, None, "other"), cim_symbol(r["other"]["symbol"], part))
                for i, c in enumerate(order):
                    one(name + ": " + c["label"], class_where(r, c), cim_symbol(c["symbol"], part), labels if i == len(order) - 1 else None)
                mode = "one layer per class"
        report_layers.append({"id": ls["id"], "renderer": r["type"], "built_as": mode})

    # -------------------------------------------------------------- layout
    def polygon(points):
        return arcpy.Polygon(arcpy.Array([arcpy.Point(*p) for p in points]))

    def rect(x, y, w, h, H):
        """Rectangle from top-left page inches (y down) to ArcGIS page coordinates (y up)."""
        y0 = H - y - h
        return polygon([[x, y0], [x, y0 + h], [x + w, y0 + h], [x + w, y0], [x, y0]])

    def graphic(container, geometry, symbol_obj, name):
        el = project.createGraphicElement(container, geometry, name=name)
        c = el.getDefinition("V3")
        c.graphic.symbol = reference(symbol_obj)
        el.setDefinition(c)
        return el

    def text(lyt, el, H, content=None):
        size = float(el["size"])
        style = FONT_STYLES.get(el.get("weight", "regular"), "Regular")
        if el.get("italic"):
            style = "Italic" if style == "Regular" else style + " Italic"
        align = el.get("align", "left")
        x = el["x"] + (el["w"] if align == "right" else el["w"] / 2 if align == "center" else 0)
        y = H - el["y"]
        t = project.createTextElement(lyt, arcpy.Point(x, y), "POINT", content if content is not None else el["text"], size, font, style, name=el["id"])
        t.setAnchor(ANCHORS[(align, "top")])
        t.elementPositionX = x
        t.elementPositionY = y

        def colour():
            c = t.getDefinition("V3")
            text_symbol_edit(c.graphic.symbol.symbol, el)
            c.graphic.symbol.symbol.horizontalAlignment = {"left": "Left", "right": "Right", "center": "Center"}[align]
            t.setDefinition(c)
        attempt("text style for " + el["id"], colour)
        return t

    def frame(lyt, m, fr, extent, scale, name, H, bg, border=0.6):
        mf = lyt.createMapFrame(rect(fr["x"], fr["y"], fr["w"], fr["h"], H), m, name)
        mf.camera.setExtent(arcpy.Extent(*extent))
        if scale:
            mf.camera.scale = float(scale)
        mf.camera.heading = 0
        m.defaultCamera = mf.camera
        m.referenceScale = mf.camera.scale     # symbols print at their stated point sizes at this scale

        def style():
            c = mf.getDefinition("V3")
            c.graphicFrame.backgroundSymbol = reference(polygon_symbol({"fill": bg}))
            ls_ = obj("CIMLineSymbol")
            ls_.symbolLayers = [stroke("#8e9a9e", border)]
            c.graphicFrame.borderSymbol = reference(ls_)
            mf.setDefinition(c)
        attempt("frame style for " + name, style)
        return mf

    def legend(lyt, lg, H, k):
        kk = lg.get("k", k)
        fsize, tsize = 7.8 * kk, 8.0 * kk
        sym_w, sym_h, gap = 0.30 * kk, 0.125 * kk, 0.09 * kk
        if lg.get("panel"):
            pad = lg.get("pad", 0.09)
            graphic(lyt, rect(lg["x"] - pad, lg["y"] - pad, lg["w"] + 2 * pad, lg["h"] + 2 * pad, H),
                    polygon_symbol({"fill": "#ffffff", "stroke": "#8e9a9e", "stroke_width": 0.5}), "Legend panel")
        for i, row in enumerate(lg["rows"]):
            x, y = lg["x"] + row["x"], lg["y"] + row["y"]
            if row["type"] == "title":
                text(lyt, {"id": "Legend title %d" % i, "text": "\n".join(row["lines"]), "x": x, "y": y + 0.03 * kk, "w": row["w"], "size": tsize, "weight": "semibold"}, H)
                continue
            if row["type"] == "note":
                text(lyt, {"id": "Legend note %d" % i, "text": "\n".join(row["lines"]), "x": x, "y": y, "w": row["w"], "size": fsize * 0.92, "color": "#5b6970"}, H)
                continue
            s = row["symbol"]
            cy = H - (y + max(fsize * 1.22 / 72, sym_h) / 2 + 0.012 * kk)
            nm = "Legend symbol: " + row["label"]
            if s["kind"] == "line":
                graphic(lyt, arcpy.Polyline(arcpy.Array([arcpy.Point(x, cy), arcpy.Point(x + sym_w, cy)])), line_symbol(s), nm)
            elif s["kind"] == "polygon":
                graphic(lyt, polygon([[x, cy - sym_h / 2], [x, cy + sym_h / 2], [x + sym_w, cy + sym_h / 2], [x + sym_w, cy - sym_h / 2], [x, cy - sym_h / 2]]), polygon_symbol(s), nm)
            else:
                graphic(lyt, arcpy.Point(x + sym_w / 2, cy), point_symbol(s), nm)
            text(lyt, {"id": "Legend label: " + row["label"], "text": "\n".join(row["lines"]), "x": x + sym_w + gap, "y": y + 0.012 * kk, "w": row["w"] - sym_w - gap, "size": fsize}, H)

    def furniture(lyt, mp, H):
        """Scale bar and north arrow as graphics, fixed to the delivered scale (same as the PDF)."""
        f, sb = mp["furniture"], mp["scalebar"]
        k = f["k"]
        pad, arrow_w, arrow_h = 0.08 * k, 0.27 * k, 0.43 * k
        bar_w = sb["length_in"]
        panel_w = pad + arrow_w + 0.14 * k + bar_w + 0.3 * k + pad
        panel_h = arrow_h + 2 * pad
        if f.get("panel", True):
            x0 = f["x"] if f.get("corner", "bl").endswith("l") else f["x"] - panel_w
            y0 = f["y"] - panel_h if f.get("corner", "bl").startswith("b") else f["y"]
            graphic(lyt, rect(x0, y0, panel_w, panel_h, H), polygon_symbol({"fill": "#ffffff", "stroke": "#8e9a9e", "stroke_width": 0.4}), "Scale and north panel")
        else:                   # under the map frame: no panel
            x0, y0, pad = f["x"], f["y"] - 0.02 * k, 0.0
            panel_h = arrow_h
        # North arrow: dark left half, light right half, letter N above.
        ax, top, bot = x0 + pad + arrow_w / 2, H - (y0 + pad + arrow_h * 0.22), H - (y0 + pad + arrow_h)
        notch = bot + arrow_h * 0.14
        graphic(lyt, polygon([[ax, top], [ax - arrow_w * 0.36, bot], [ax, notch], [ax, top]]), polygon_symbol({"fill": INK}), "North arrow, dark half")
        graphic(lyt, polygon([[ax, top], [ax + arrow_w * 0.36, bot], [ax, notch], [ax, top]]), polygon_symbol({"fill": "#ffffff", "stroke": INK, "stroke_width": 0.5}), "North arrow, light half")
        text(lyt, {"id": "North arrow N", "text": "N", "x": ax - 0.1, "y": y0 + pad - 0.02 * k, "w": 0.2, "size": 6.2 * k, "weight": "bold", "align": "center"}, H)
        bx = x0 + pad + arrow_w + 0.14 * k
        by = H - (y0 + panel_h / 2 + 0.07 * k)
        bh = 0.05 * k
        seg = bar_w / sb["segments"]
        for i in range(sb["segments"]):
            graphic(lyt, polygon([[bx + i * seg, by], [bx + i * seg, by + bh], [bx + (i + 1) * seg, by + bh], [bx + (i + 1) * seg, by], [bx + i * seg, by]]),
                    polygon_symbol({"fill": INK if i % 2 == 0 else "#ffffff", "stroke": INK, "stroke_width": 0.4}), "Scale bar segment %d" % (i + 1))
        for i in range(sb["segments"] + 1):
            v = sb["total"] * i / sb["segments"]
            label = ("%g" % v) + ((" " + sb["units"]) if i == sb["segments"] else "")
            text(lyt, {"id": "Scale bar label %d" % i, "text": label, "x": bx + i * seg - 0.4 + (0.12 * k if i == sb["segments"] else 0), "y": H - (by + bh) - 0.115 * k,
                       "w": 0.8, "size": 6.6 * k, "align": "center"}, H)

    def pasteboard(lyt, mf, mp, W, H):
        """Dynamic legend, scale bar and north arrow parked beside the page for whoever edits the layout."""
        x = W + 0.5
        attempt("pasteboard note", lambda: project.createTextElement(
            lyt, arcpy.Point(x, H - 0.3), "POINT",
            "Dynamic elements for editing.\nThe page uses fixed graphics that match the delivered PDF.\nDrag these onto the page if you change the extent or layers.",
            8, font, "Regular", name="Pasteboard note"))

        def north():
            items = project.listStyleItems("ArcGIS 2D", "NORTH_ARROW")
            pick = next((s for s in items if s.name in ("ArcGIS North 1", "Compass North 1")), items[0])
            el = lyt.createMapSurroundElement(arcpy.Point(x + 0.3, H - 1.4), "NORTH_ARROW", mf, pick, "Dynamic north arrow")
            el.elementWidth = 0.3
        attempt("dynamic north arrow", north)

        def bar():
            items = project.listStyleItems("ArcGIS 2D", "SCALE_BAR")
            pick = next((s for s in items if "Scale Line 1" in s.name and "Metric" not in s.name), None) or \
                next((s for s in items if "Metric" not in s.name), items[0])
            lyt.createMapSurroundElement(rect(x, 2.2, 2.5, 0.4, H), "SCALE_BAR", mf, pick, "Dynamic scale bar")
        attempt("dynamic scale bar", bar)

        def leg():
            el = lyt.createMapSurroundElement(arcpy.Point(x, H - 3.2), "LEGEND", mf, name="Dynamic legend")
            el.setAnchor("TOP_LEFT_CORNER")
            el.elementPositionX = x
            el.elementPositionY = H - 3.2
        attempt("dynamic legend", leg)

    # ------------------------------------------------------------ assemble
    for mp, is_atlas in all_layouts(spec):
        if only and mp["id"] not in only:
            continue
        t0 = time.time()
        W, H = mp["page"]["w"], mp["page"]["h"]
        name = mp["id"]
        entry = {"id": name, "atlas": is_atlas, "layers": []}
        m = new_map(name)
        for ls in mp["layers"]:
            add_layer(m, ls, entry["layers"])
        lyt = project.createLayout(W, H, "INCH", name)
        mf = frame(lyt, m, mp["frame"], mp["extent"], mp["scale"], "Main map", H, mp.get("background", "#f5f4ef"))
        subs = {}
        if is_atlas:
            subs = {"{page_name}": '<dyn type="page" property="name"/>', "{page_number}": '<dyn type="page" property="index"/>',
                    "{page_count}": '<dyn type="page" property="count"/>'}
            subs.update({k.upper(): v for k, v in list(subs.items())})
        for el in mp["elements"]:
            if el["type"] == "text" and el.get("text"):
                content = el["text"]
                for a, b in subs.items():
                    content = content.replace(a, b)
                text(lyt, el, H, content)
            elif el["type"] == "rect":
                graphic(lyt, rect(el["x"], el["y"], el["w"], el["h"], H),
                        polygon_symbol({"fill": el.get("fill"), "fill_opacity": el.get("opacity", 1.0), "stroke": el.get("stroke"), "stroke_width": el.get("stroke_width", 0.5)}), el["id"])
            elif el["type"] == "line":
                ls_ = obj("CIMLineSymbol")
                ls_.symbolLayers = [stroke(el["color"], el["width"])]
                graphic(lyt, arcpy.Polyline(arcpy.Array([arcpy.Point(el["x1"], H - el["y1"]), arcpy.Point(el["x2"], H - el["y2"])])), ls_, el["id"])
        ins = mp.get("inset")
        if ins and ins.get("layers"):
            im = new_map(name + "_inset")
            for ls in ins["layers"]:
                add_layer(im, ls, entry["layers"])
            if ins.get("overlay"):
                graphic(lyt, rect(ins["x"] - 0.03, ins["y"] - 0.03, ins["w"] + 0.06, ins["h"] + 0.06, H), polygon_symbol({"fill": "#ffffff"}), "Inset halo")
            frame(lyt, im, ins, ins["extent"], None, "Inset map", H, "#f5f4ef" if ins.get("overview") else "#eef2f3", border=0.5)
        furniture(lyt, mp, H)
        legend(lyt, mp["legend"], H, mp["k"])
        pasteboard(lyt, mf, mp, W, H)

        series = None
        if is_atlas:
            idx = add_data(m, native[(mp["atlas"]["file"], mp["atlas"]["index_layer"])])
            idx.name = "Sheet index"
            set_simple(idx, polygon_symbol({"fill": None, "stroke": None}))
            series = lyt.createSpatialMapSeries(mf, idx, "name", "page")

            def tune():
                c = series.getDefinition("V3")
                c.extentOptions = "BestFit"
                c.marginType = "Percent"
                c.margin = 0
                c.scaleRounding = 1
                if mp["atlas"].get("kind") == "strip":
                    c.rotationField = "rotation"
                series.setDefinition(c)
            attempt("map series options for " + name, tune)

        def meta():
            md = lyt.metadata
            md.title = ((mp.get("figure") + ". ") if mp.get("figure") and not is_atlas else "") + mp["title"]
            md.summary = mp.get("alt") or mp["title"]
            md.description = mp.get("sources", "")
            lyt.metadata = md
        attempt("layout metadata for " + name, meta)

        for i, layer in enumerate(m.listLayers()):
            if layer.isFeatureLayer:
                attempt("save lyrx", lambda layer=layer, i=i: layer.saveACopy(str(out / ("%s_%02d.lyrx" % (name, i)))))
        attempt("export mapx", lambda: m.exportToMAPX(str(out / (name + ".mapx"))))
        attempt("export pagx", lambda: lyt.exportToPAGX(str(out / (name + ".pagx"))))
        if export:
            if series is not None:
                series.exportToPDF(str(out / "exports" / (name + ".pdf")), "ALL", "", "PDF_SINGLE_FILE", 300)
            else:
                lyt.exportToPDF(str(out / "exports" / (name + ".pdf")), resolution=300, embed_fonts=True, georef_info=True, output_as_image=False)
                lyt.exportToPNG(str(out / "exports" / (name + ".png")), resolution=200)
                if export_aix:
                    attempt("AIX export for " + name, lambda: lyt.exportToAIX(str(out / "exports" / (name + ".aix")), resolution=300, embed_fonts=True))
        broken = [ly.name for ly in m.listLayers() if ly.isBroken]
        if broken:
            raise RuntimeError("Broken layers in %s: %s" % (name, ", ".join(broken)))
        entry.update(page_inches=[W, H], layer_count=len(m.listLayers()), layout_elements=len(lyt.listElements()), seconds=round(time.time() - t0, 1))
        report["layouts"].append(entry)
        project.save()
        arcpy.AddMessage("Built " + name)

    project.save()
    reopened = arcpy.mp.ArcGISProject(str(target))
    broken = [m.name + ": " + ly.name for m in reopened.listMaps() for ly in m.listLayers() if ly.isBroken]
    report["reopen"] = {"maps": len(reopened.listMaps()), "layouts": len(reopened.listLayouts()), "broken_layers": broken}
    expected = len(report["layouts"])
    if broken or len(reopened.listLayouts()) != expected:
        raise RuntimeError("The reopened project has %d layouts (expected %d) and %d broken layers" % (len(reopened.listLayouts()), expected, len(broken)))
    report["project"] = str(target)
    report["finished"] = datetime.datetime.now().isoformat(timespec="seconds")
    report["status"] = "BUILT; visual review pending"
    (out / "native_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (out / "VISUAL_REVIEW_PENDING.txt").write_text(
        "Compare every layout and export with the reference figure in maps/pdf and maps/png. Check: symbols and colours, road casings at "
        "junctions, labels and halos, legend entries, title block, inset, scale bar length, page edges, fonts. A finished build does not "
        "record visual acceptance. Write what you find in ARCGIS_BUILD_REPORT.md (see arcgis/AGENT_PROMPT.md).\n", encoding="utf-8")
    incomplete.unlink()
    return str(target)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build the native ArcGIS Pro project for this map package.")
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="package folder (the one that holds spec/ and data/)")
    ap.add_argument("--template", default="CURRENT", help="CURRENT (inside Pro), a blank .aprx, or NEW (Pro 3.7 and later)")
    ap.add_argument("--output", type=Path, help="parent folder for the run folder (default: <root>/arcgis/native)")
    ap.add_argument("--font", help="font family (default: from the spec)")
    ap.add_argument("--only", nargs="*", help="build only these map ids")
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--no-aix", action="store_true")
    ap.add_argument("--preflight", action="store_true", help="check the package without ArcPy and exit")
    a = ap.parse_args()
    if a.preflight:
        res = preflight(a.root)
        print(json.dumps({k: v for k, v in res.items() if k != "inputs"}, indent=2))
        raise SystemExit(1 if res["errors"] else 0)
    print(build(a.root, None if a.template == "NEW" else a.template, a.output, a.font, not a.no_export, not a.no_aix, a.only))
