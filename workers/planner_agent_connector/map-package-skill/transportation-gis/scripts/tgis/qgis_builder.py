"""Build the QGIS project, print layouts and exports from spec/map_package.json.

Runs three ways, with nothing but QGIS 3.34 or later and its own Python:

  1. Headless, from a shell:        python3 build_qgis_project.py <package folder>
  2. QGIS Python console:           exec(open(r'<package>/qgis/build_qgis_project.py').read()); build(r'<package>')
  3. Imported by the tgis pipeline: qgis_builder.build(package_folder)

What it creates in <package>/qgis/: <project id>.qgz with one layer group, one map
theme and one print layout per figure, an atlas layout per map book, a .qml style
per layer and a .qpt template per layout. With export=True it also writes the PDF,
PNG and SVG of every layout and the atlas PDFs.

The script is deliberately one file with no third-party imports so that it can be
copied into the delivered package and run on any computer that has QGIS.
"""
import json
import math
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
# Qt seeds its hash tables randomly per process, and the label engine walks one when it merges
# connected lines, so label positions would vary from run to run. A fixed seed makes a rebuild
# of the same data produce the same pixels. It must be set before Qt loads.
os.environ.setdefault("QT_HASH_SEED", "0")

from qgis.core import (  # noqa: E402
    Qgis, QgsApplication, QgsCategorizedSymbolRenderer, QgsCoordinateReferenceSystem, QgsFillSymbol,
    QgsGraduatedSymbolRenderer, QgsNullSymbolRenderer, QgsLayoutExporter, QgsLayoutItemLabel, QgsLayoutItemMap, QgsLayoutItemMapOverview,
    QgsLayoutItemMarker, QgsLayoutItemPage, QgsLayoutItemPicture, QgsLayoutItemPolyline, QgsLayoutItemScaleBar,
    QgsLayoutItemShape, QgsLayoutMeasurement, QgsLayoutObject, QgsLayoutPoint, QgsLayoutSize, QgsLinePatternFillSymbolLayer,
    QgsLineSymbol, QgsMapThemeCollection, QgsMarkerSymbol, QgsPalLayerSettings, QgsPrintLayout, QgsProject, QgsProperty,
    QgsReadWriteContext, QgsRectangle, QgsRendererCategory, QgsRendererRange,
    QgsSimpleFillSymbolLayer, QgsSimpleLineSymbolLayer, QgsSimpleMarkerSymbolLayer, QgsSingleSymbolRenderer,
    QgsTextBackgroundSettings, QgsTextBufferSettings, QgsTextFormat, QgsUnitTypes, QgsVectorLayer,
    QgsVectorLayerSimpleLabeling, QgsLabelLineSettings, QgsLayoutItem,
)
from qgis.PyQt.QtCore import QPointF, QSizeF, Qt  # noqa: E402
from qgis.PyQt.QtGui import QColor, QFont, QFontDatabase, QPolygonF  # noqa: E402

IN = QgsUnitTypes.LayoutInches
PT = QgsUnitTypes.RenderPoints
MM = 25.4
INK = "#1f2d35"
WEIGHTS = {"regular": ("Regular", QFont.Normal), "medium": ("Medium", QFont.Medium), "semibold": ("SemiBold", QFont.DemiBold),
           "bold": ("Bold", QFont.Bold)}
SHAPES = {"circle": Qgis.MarkerShape.Circle, "square": Qgis.MarkerShape.Square, "triangle": Qgis.MarkerShape.Triangle,
          "diamond": Qgis.MarkerShape.Diamond, "star": Qgis.MarkerShape.Star, "cross": Qgis.MarkerShape.CrossFill,
          "pentagon": Qgis.MarkerShape.Pentagon}

try:
    ON_LINE = Qgis.LabelLinePlacementFlags(Qgis.LabelLinePlacementFlag.OnLine)
except AttributeError:   # QGIS before 3.32
    from qgis.core import QgsLabeling
    ON_LINE = QgsLabeling.LinePlacementFlags(QgsLabeling.OnLine)

NORTH_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 64" width="40" height="64">
<path d="M20 14 L9 60 L20 51 Z" fill="#1f2d35"/>
<path d="M20 14 L31 60 L20 51 Z" fill="#ffffff" stroke="#1f2d35" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M15.2 11 V1 h2.3 l5 6.6 V1 h2.3 v10 h-2.3 l-5 -6.6 V11 Z" fill="#1f2d35"/>
</svg>
"""


# ------------------------------------------------------------------ helpers

def qcolor(value, opacity=1.0):
    if value in (None, "none", ""):
        return QColor(0, 0, 0, 0)
    c = QColor(value)
    c.setAlphaF(max(0.0, min(1.0, opacity)))
    return c


def qfont(family, weight="regular", italic=False, letter_spacing=0.0):
    style, w = WEIGHTS.get(weight, WEIGHTS["regular"])
    f = QFont(family)
    f.setWeight(w)
    f.setItalic(bool(italic))
    name = (style + " Italic") if italic and style != "Regular" else ("Italic" if italic else style)
    f.setStyleName(name)
    if letter_spacing:
        f.setLetterSpacing(QFont.AbsoluteSpacing, letter_spacing)
    return f


def text_format(family, size, weight="regular", color=INK, italic=False, letter_spacing=0.0, halo=0.0, halo_color="#ffffff", upper=False):
    tf = QgsTextFormat()
    tf.setFont(qfont(family, weight, italic, letter_spacing))
    tf.setNamedStyle(tf.font().styleName())
    tf.setSize(size)
    tf.setSizeUnit(PT)
    tf.setColor(qcolor(color))
    if upper:
        tf.setCapitalization(Qgis.Capitalization.AllUppercase)
    if halo:
        b = QgsTextBufferSettings()
        b.setEnabled(True)
        b.setSize(halo)
        b.setSizeUnit(PT)
        b.setColor(qcolor(halo_color, 0.94))
        tf.setBuffer(b)
    return tf


def line_layers(s):
    """Symbol layers for a line dict, casing first (it draws underneath)."""
    out = []
    op = s.get("opacity", 1.0)
    if s.get("casing"):
        c = QgsSimpleLineSymbolLayer(qcolor(s["casing"], op), s["casing_width"])
        c.setWidthUnit(PT)
        c.setPenCapStyle(Qt.RoundCap if not s.get("dash") else Qt.FlatCap)
        c.setPenJoinStyle(Qt.RoundJoin)
        out.append(c)
    m = QgsSimpleLineSymbolLayer(qcolor(s["color"], op), s["width"])
    m.setWidthUnit(PT)
    m.setPenJoinStyle(Qt.RoundJoin)
    if s.get("dash"):
        m.setUseCustomDashPattern(True)
        m.setCustomDashVector([float(v) for v in s["dash"]])
        m.setCustomDashPatternUnit(PT)
        m.setPenCapStyle(Qt.FlatCap)
    else:
        m.setPenCapStyle(Qt.RoundCap)
    out.append(m)
    return out


def make_symbol(s):
    kind = s["kind"]
    if kind == "line":
        sym = QgsLineSymbol()
        sym.deleteSymbolLayer(0)
        for l in line_layers(s):
            sym.appendSymbolLayer(l)
        return sym
    if kind == "polygon":
        sym = QgsFillSymbol()
        sym.deleteSymbolLayer(0)
        fill = QgsSimpleFillSymbolLayer(qcolor(s.get("fill"), s.get("fill_opacity", 1.0)))
        fill.setStrokeStyle(Qt.NoPen)
        if not s.get("fill"):
            fill.setBrushStyle(Qt.NoBrush)
        sym.appendSymbolLayer(fill)
        if s.get("hatch"):
            h = s["hatch"]
            hl = QgsLinePatternFillSymbolLayer()
            hl.setLineAngle(h.get("angle", 45))
            hl.setDistance(h.get("spacing", 4))
            hl.setDistanceUnit(PT)
            ls = QgsLineSymbol()
            ls.deleteSymbolLayer(0)
            sl = QgsSimpleLineSymbolLayer(qcolor(h.get("color", INK)), h.get("width", 0.5))
            sl.setWidthUnit(PT)
            ls.appendSymbolLayer(sl)
            hl.setSubSymbol(ls)
            sym.appendSymbolLayer(hl)
        if s.get("stroke") and s.get("stroke_width"):
            ol = QgsSimpleLineSymbolLayer(qcolor(s["stroke"]), s["stroke_width"])
            ol.setWidthUnit(PT)
            ol.setPenJoinStyle(Qt.RoundJoin)
            if s.get("stroke_dash"):
                ol.setUseCustomDashPattern(True)
                ol.setCustomDashVector([float(v) for v in s["stroke_dash"]])
                ol.setCustomDashPatternUnit(PT)
                ol.setPenCapStyle(Qt.FlatCap)
            sym.appendSymbolLayer(ol)
        return sym
    sym = QgsMarkerSymbol()
    sym.deleteSymbolLayer(0)
    ml = QgsSimpleMarkerSymbolLayer(SHAPES.get(s.get("marker", "circle"), Qgis.MarkerShape.Circle), s.get("size", 5))
    ml.setSizeUnit(PT)
    ml.setColor(qcolor(s.get("fill"), s.get("fill_opacity", 1.0)))
    if s.get("stroke") and s.get("stroke_width"):
        ml.setStrokeColor(qcolor(s["stroke"]))
        ml.setStrokeWidth(s["stroke_width"])
        ml.setStrokeWidthUnit(PT)
        ml.setPenJoinStyle(Qt.RoundJoin)
    else:
        ml.setStrokeStyle(Qt.NoPen)
    sym.appendSymbolLayer(ml)
    return sym


def make_renderer(r, kind):
    if r["type"] == "simple":
        sym = make_symbol(r["symbol"])
        rend = QgsSingleSymbolRenderer(sym)
        if kind == "line" and sym.symbolLayerCount() == 2:
            # Draw every casing before any fill so the segments of one line join without end caps showing.
            sym.symbolLayer(0).setRenderingPass(0)
            sym.symbolLayer(1).setRenderingPass(1)
            rend.setUsingSymbolLevels(True)
        return rend
    if r["type"] == "categorized":
        cats = []
        n = len(r["classes"])
        for i, c in enumerate(r["classes"]):
            sym = make_symbol(c["symbol"])
            if r.get("symbol_levels") and kind == "line":
                # Casings of every class draw before any fill, so junctions merge cleanly.
                layers = sym.symbolLayers()
                if len(layers) == 2:
                    layers[0].setRenderingPass(i)
                    layers[1].setRenderingPass(n + i)
                else:
                    layers[0].setRenderingPass(n + i)
            else:
                order = i if r.get("draw_order") == "listed_last_on_top" else (n - 1 - i)   # first class in the legend draws on top
                layers = sym.symbolLayers()
                if kind == "line" and len(layers) == 2:
                    layers[0].setRenderingPass(order)
                    layers[1].setRenderingPass(n + order)
                else:
                    for sl in layers:
                        sl.setRenderingPass(order)
            vals = c["values"]
            cats.append(QgsRendererCategory(vals if len(vals) > 1 else vals[0], sym, c["label"]))
        if r.get("other"):
            cats.append(QgsRendererCategory("", make_symbol(r["other"]["symbol"]), r["other"]["label"]))
        rend = QgsCategorizedSymbolRenderer(r["field"], cats)
        rend.setUsingSymbolLevels(True)
        return rend
    if r["type"] == "graduated":
        ranges = []
        for c in r["classes"]:
            lo = -1e300 if c["min"] is None else c["min"]
            # QGIS ranges include their upper bound; step just below it so a value on a break joins the upper class.
            hi = 1e300 if c["max"] is None else c["max"] - 1e-9 * max(1.0, abs(c["max"]))
            ranges.append(QgsRendererRange(lo, hi, make_symbol(c["symbol"]), c["label"]))
        return QgsGraduatedSymbolRenderer(r["field"], ranges)
    raise ValueError("Unknown renderer type " + str(r["type"]))


def pal_settings(lab, family):
    s = QgsPalLayerSettings()
    if lab.get("upper") or lab.get("expression"):
        s.fieldName = lab.get("expression") or '"%s"' % lab["field"]
        s.isExpression = bool(lab.get("expression"))
        if not lab.get("expression"):
            s.fieldName = lab["field"]
    else:
        s.fieldName = lab["field"]
    tf = text_format(family, lab["size"], lab.get("weight", "regular"), lab.get("color", INK), lab.get("italic", False),
                     lab.get("letter_spacing", 0.0), lab.get("halo", 0.0), lab.get("halo_color", "#ffffff"), lab.get("upper", False))
    if lab.get("shield"):
        bg = QgsTextBackgroundSettings()
        bg.setEnabled(True)
        bg.setType(QgsTextBackgroundSettings.ShapeRectangle)
        bg.setSizeType(QgsTextBackgroundSettings.SizeBuffer)
        bg.setSize(QSizeF(lab["size"] * 0.32, lab["size"] * 0.16))
        bg.setSizeUnit(PT)
        bg.setRadii(QSizeF(lab["size"] * 0.3, lab["size"] * 0.3))
        bg.setRadiiUnit(PT)
        bg.setFillColor(QColor("#ffffff"))
        bg.setStrokeColor(QColor("#4c5b63"))
        bg.setStrokeWidth(0.6)
        bg.setStrokeWidthUnit(PT)
        tf.setBackground(bg)
    s.setFormat(tf)
    placement = lab.get("placement", "point")
    if placement == "curved":
        s.placement = Qgis.LabelPlacement.Curved
        ls = s.lineSettings()
        ls.setPlacementFlags(ON_LINE)
        ls.setMergeLines(True)
        s.maxCurvedCharAngleIn = 22
        s.maxCurvedCharAngleOut = 22
    elif placement == "line":
        s.placement = Qgis.LabelPlacement.Horizontal if lab.get("shield") else Qgis.LabelPlacement.Line
        ls = s.lineSettings()
        ls.setPlacementFlags(ON_LINE)
        ls.setMergeLines(True)
    elif placement == "polygon":
        s.placement = Qgis.LabelPlacement.Horizontal
        s.centroidInside = True
        s.fitInPolygonOnly = False
    else:
        s.placement = Qgis.LabelPlacement.OrderedPositionsAroundPoint
        s.dist = max(1.6, lab["size"] * 0.42)
        s.distUnits = PT
    if lab.get("repeat_in") and placement in ("curved", "line"):
        s.repeatDistance = lab["repeat_in"] * 72
        s.repeatDistanceUnit = PT
    if lab.get("wrap"):
        s.autoWrapLength = int(lab["wrap"])
        s.multilineAlign = Qgis.LabelMultiLineAlignment.Center
    if lab.get("min_size_mm"):
        s.thinningSettings().setMinimumFeatureSize(float(lab["min_size_mm"]))
    s.priority = int(lab.get("priority", 5))
    th = s.thinningSettings()
    if placement in ("curved", "line") and hasattr(th, "setAllowDuplicateRemoval"):
        # Divided roads and split segments carry the same name or route number several times; keep
        # repeats of the same text at least one repeat distance apart.
        th.setAllowDuplicateRemoval(True)
        th.setMinimumDistanceToDuplicate(lab.get("repeat_in", 3.0) * 72 * 0.9)
        th.setMinimumDistanceToDuplicateUnit(PT)
    return s


def apply_labels(layer, labels, family, obstacle=False):
    """Give a layer one label class. Layers with several classes get one label-only layer per extra class (see add_layer)."""
    if not labels:
        if obstacle:
            # No labels of its own, but other layers' labels should keep clear of these features.
            s = QgsPalLayerSettings()
            s.drawLabels = False
            s.obstacleSettings().setIsObstacle(True)
            s.obstacleSettings().setFactor(2.0)
            layer.setLabeling(QgsVectorLayerSimpleLabeling(s))
            layer.setLabelsEnabled(True)
        else:
            layer.setLabelsEnabled(False)
        return
    lab = labels[0]
    s = pal_settings(lab, family)
    if lab.get("where"):
        s.dataDefinedProperties().setProperty(QgsPalLayerSettings.Show, QgsProperty.fromExpression(lab["where"]))
    layer.setLabeling(QgsVectorLayerSimpleLabeling(s))
    layer.setLabelsEnabled(True)


# -------------------------------------------------------------------- layers

_SEQ = [0]


def add_layer(project, root, group, spec, family, name_prefix=""):
    """Load one resolved layer dict into the group (on top of what is already there)."""
    uri = "%s|layername=%s" % (root / spec["file"], spec["layer"])
    made = []
    r = spec["renderer"]
    variants = [(spec, spec.get("where"), spec["title"])]
    if r["type"] == "graduated" and r.get("nodata"):
        f = '"%s" IS NULL' % r["field"]
        nd = dict(spec, renderer={"type": "simple", "symbol": r["nodata"]["symbol"], "label": r["nodata"]["label"]}, labels=[])
        variants.insert(0, (nd, ("(%s) AND %s" % (spec["where"], f)) if spec.get("where") else f, spec["title"] + " (no data)"))
    for sp, where, title in variants:
        lyr = QgsVectorLayer(uri, title, "ogr")
        if not lyr.isValid():
            raise RuntimeError("Layer failed to load: " + uri)
        _SEQ[0] += 1
        lyr.setId("L%04d_%s" % (_SEQ[0], "".join(ch if ch.isalnum() else "_" for ch in sp["id"])))   # fixed ids, for repeatable builds
        if where:
            if not lyr.setSubsetString(where):
                raise RuntimeError("Filter rejected for %s: %s" % (title, where))
        lyr.setRenderer(make_renderer(sp["renderer"], sp["kind"]))
        apply_labels(lyr, sp.get("labels") or [], family, obstacle=sp.get("group") == "thematic" and sp["kind"] == "point")
        lyr.setOpacity(float(sp.get("opacity", 1.0)))
        lyr.setCustomProperty("tgis/id", sp["id"])
        project.addMapLayer(lyr, False)
        group.insertLayer(0, lyr)
        made.append(lyr)
        # Further label classes go on label-only copies of the layer. QGIS rule-based labelling would be the
        # usual tool, but it registers its rules in an order that changes between runs, so the same data
        # could give different label positions. One simple label class per layer is repeatable.
        for n, lab in enumerate((sp.get("labels") or [])[1:], 2):
            extra = QgsVectorLayer(uri, "%s (labels %d)" % (title, n), "ogr")
            _SEQ[0] += 1
            extra.setId("L%04d_%s_labels%d" % (_SEQ[0], "".join(ch if ch.isalnum() else "_" for ch in sp["id"]), n))
            q = " AND ".join("(%s)" % x for x in (where, lab.get("where")) if x)
            if q and not extra.setSubsetString(q):
                raise RuntimeError("Filter rejected for %s: %s" % (title, q))
            extra.setRenderer(QgsNullSymbolRenderer())
            extra.setCustomProperty("tgis/id", sp["id"] + "_labels%d" % n)
            apply_labels(extra, [dict(lab, where=None)], family)
            project.addMapLayer(extra, False)
            group.insertLayer(0, extra)
            made.append(extra)
    return made


def add_theme(project, name, layers):
    rec = QgsMapThemeCollection.MapThemeRecord()
    for lyr in layers:
        lr = QgsMapThemeCollection.MapThemeLayerRecord(lyr)
        lr.isVisible = True
        rec.addLayerRecord(lr)
    project.mapThemeCollection().insert(name, rec)


# -------------------------------------------------------------------- layout

def place(item, x, y, w=None, h=None):
    if w is not None:
        item.attemptResize(QgsLayoutSize(w, h, IN))
    item.attemptMove(QgsLayoutPoint(x, y, IN))


def add_text(layout, el, family, subs=None):
    lab = QgsLayoutItemLabel(layout)
    text = el["text"]
    for k, v in (subs or {}).items():
        text = text.replace(k, v)
    lab.setText(text)
    lab.setTextFormat(text_format(family, el["size"], el.get("weight", "regular"), el.get("color", INK), el.get("italic", False),
                                  el.get("letter_spacing", 0.0)))
    lab.setHAlign({"left": Qt.AlignLeft, "right": Qt.AlignRight, "center": Qt.AlignHCenter}[el.get("align", "left")])
    lab.setVAlign({"top": Qt.AlignTop, "middle": Qt.AlignVCenter, "bottom": Qt.AlignBottom}[el.get("valign", "top")])
    lab.setMarginX(0)
    lab.setMarginY(0)
    lab.setId(el["id"])
    layout.addLayoutItem(lab)
    # A little extra height keeps descenders from clipping; the top edge is what the design fixes.
    place(lab, el["x"], el["y"] - 0.012, el["w"] + 0.03, el["h"] + 0.06)
    lab.setBackgroundEnabled(False)
    return lab


def add_rect(layout, x, y, w, h, fill=None, stroke=None, stroke_width=0.5, opacity=1.0, item_id="rect", radius=0.0):
    sh = QgsLayoutItemShape(layout)
    sh.setShapeType(QgsLayoutItemShape.Rectangle)
    sh.setSymbol(make_symbol({"kind": "polygon", "fill": fill, "fill_opacity": opacity, "stroke": stroke, "stroke_width": stroke_width}))
    if radius:
        sh.setCornerRadius(QgsLayoutMeasurement(radius, IN))
    sh.setId(item_id)
    layout.addLayoutItem(sh)
    place(sh, x, y, w, h)
    return sh


def add_line(layout, pts_in, sym, item_id="line"):
    poly = QPolygonF([QPointF(x * MM, y * MM) for x, y in pts_in])
    it = QgsLayoutItemPolyline(poly, layout)
    it.setSymbol(make_symbol(sym))
    it.setId(item_id)
    layout.addLayoutItem(it)
    return it


def add_legend(layout, lg, family, k):
    """Draw the legend as editable page items placed from the computed rows."""
    ox, oy = lg["x"], lg["y"]
    kk = lg.get("k", k)
    font, title_font = 7.8 * kk, 8.0 * kk
    sym_w, sym_h, gap = 0.30 * kk, 0.125 * kk, 0.09 * kk
    if lg.get("panel"):
        pad = lg.get("pad", 0.09)
        add_rect(layout, ox - pad, oy - pad, lg["w"] + 2 * pad, lg["h"] + 2 * pad, fill="#ffffff", opacity=1.0, stroke="#8e9a9e", stroke_width=0.5, item_id="legend_panel")
    for i, row in enumerate(lg["rows"]):
        x, y = ox + row["x"], oy + row["y"]
        if row["type"] == "title":
            add_text(layout, {"id": "legend_title_%d" % i, "text": "\n".join(row["lines"]), "x": x, "y": y + 0.03 * kk, "w": row["w"], "h": row["h"],
                              "size": title_font, "weight": "semibold", "color": INK}, family)
            continue
        if row["type"] == "note":
            add_text(layout, {"id": "legend_note_%d" % i, "text": "\n".join(row["lines"]), "x": x, "y": y, "w": row["w"], "h": row["h"],
                              "size": font * 0.92, "color": "#5b6970"}, family)
            continue
        s = row["symbol"]
        first_line_h = font * 1.22 / 72
        cy = y + max(first_line_h, sym_h) / 2 + 0.012 * kk
        if s["kind"] == "line":
            add_line(layout, [(x, cy), (x + sym_w, cy)], s, "legend_symbol_%d" % i)
        elif s["kind"] == "polygon":
            sh = QgsLayoutItemShape(layout)
            sh.setShapeType(QgsLayoutItemShape.Rectangle)
            sh.setSymbol(make_symbol(s))
            sh.setId("legend_symbol_%d" % i)
            layout.addLayoutItem(sh)
            place(sh, x, cy - sym_h / 2, sym_w, sym_h)
        else:
            mk = QgsLayoutItemMarker(layout)
            mk.setSymbol(make_symbol(s))
            mk.setId("legend_symbol_%d" % i)
            layout.addLayoutItem(mk)
            mk.setReferencePoint(QgsLayoutItem.Middle)
            mk.attemptMove(QgsLayoutPoint(x + sym_w / 2, cy, IN), True)
        add_text(layout, {"id": "legend_label_%d" % i, "text": "\n".join(row["lines"]), "x": x + sym_w + gap, "y": y + 0.012 * kk,
                          "w": row["w"] - sym_w - gap, "h": row["h"], "size": font, "color": INK}, family)


def add_map_item(layout, rect, extent, layers, item_id, bg="#f5f4ef", border=0.6):
    m = QgsLayoutItemMap(layout)
    m.setId(item_id)
    layout.addLayoutItem(m)
    place(m, rect["x"], rect["y"], rect["w"], rect["h"])
    m.setLayers(list(reversed(layers)))     # setLayers wants the top layer first
    m.setKeepLayerSet(True)
    m.setKeepLayerStyles(False)
    m.zoomToExtent(QgsRectangle(*extent))     # keeps the frame size; setExtent would resize the item to the extent's shape
    m.setBackgroundEnabled(True)
    m.setBackgroundColor(QColor(bg))
    m.setFrameEnabled(True)
    m.setFrameStrokeColor(QColor("#8e9a9e"))
    m.setFrameStrokeWidth(QgsLayoutMeasurement(border, QgsUnitTypes.LayoutPoints))
    return m


def add_furniture(layout, mp, mapitem, family, north_svg, is_feet):
    """Scale bar and north arrow on a soft white panel inside the bottom-left of the frame."""
    f, sb, k = mp["furniture"], mp["scalebar"], mp["furniture"]["k"]
    bar_w = sb["length_in"]
    pad = 0.08 * k
    arrow_w, arrow_h = 0.27 * k, 0.43 * k
    panel_w = pad + arrow_w + 0.14 * k + bar_w + 0.3 * k + pad
    panel_h = arrow_h + 2 * pad
    if f.get("panel", True):
        x0 = f["x"] if f.get("corner", "bl").endswith("l") else f["x"] - panel_w
        y0 = f["y"] - panel_h if f.get("corner", "bl").startswith("b") else f["y"]
        add_rect(layout, x0, y0, panel_w, panel_h, fill="#ffffff", opacity=1.0, stroke="#8e9a9e", stroke_width=0.4, item_id="furniture_panel")
    else:                       # under the map frame: no panel needed
        x0, y0, pad = f["x"], f["y"] - 0.02 * k, 0.0
        panel_h = arrow_h
    pic = QgsLayoutItemPicture(layout)
    pic.setPicturePath(str(north_svg))
    pic.setId("north_arrow")
    layout.addLayoutItem(pic)
    place(pic, x0 + pad, y0 + pad, arrow_w, arrow_h)
    pic.setLinkedMap(mapitem)
    pic.setNorthMode(QgsLayoutItemPicture.GridNorth)
    bar = QgsLayoutItemScaleBar(layout)
    bar.setStyle("Single Box")
    bar.setLinkedMap(mapitem)
    unit = {"mi": Qgis.DistanceUnit.Miles, "ft": Qgis.DistanceUnit.Feet, "m": Qgis.DistanceUnit.Meters, "km": Qgis.DistanceUnit.Kilometers}[sb["units"]]
    bar.setUnits(unit)
    bar.setUnitLabel({"mi": "mi", "ft": "ft", "m": "m", "km": "km"}[sb["units"]])
    bar.setSegmentSizeMode(Qgis.ScaleBarSegmentSizeMode.Fixed)
    bar.setNumberOfSegments(sb["segments"])
    bar.setNumberOfSegmentsLeft(0)
    bar.setUnitsPerSegment(sb["total"] / sb["segments"])
    bar.setHeight(0.05 * k * MM)
    bar.setTextFormat(text_format(family, 6.6 * k, "regular", INK))
    bar.setLabelBarSpace(0.9 * k)
    bar.setBoxContentSpace(0.4)
    bar.setFillSymbol(make_symbol({"kind": "polygon", "fill": INK, "stroke": INK, "stroke_width": 0.4}))
    bar.setAlternateFillSymbol(make_symbol({"kind": "polygon", "fill": "#ffffff", "stroke": INK, "stroke_width": 0.4}))
    bar.setLineSymbol(make_symbol({"kind": "line", "color": INK, "width": 0.4}))
    bar.setBackgroundEnabled(False)
    bar.setId("scale_bar")
    layout.addLayoutItem(bar)
    bar.update()
    bh = bar.rect().height() / MM
    bar.attemptMove(QgsLayoutPoint(x0 + pad + arrow_w + 0.14 * k, y0 + pad + max(0.0, (arrow_h - bh) / 2), IN))


def build_layout(project, mp, layer_sets, family, north_svg, is_feet, atlas=False):
    layout = QgsPrintLayout(project)
    layout.initializeDefaults()
    name = (mp["figure"] + ". " if mp.get("figure") and not atlas else "") + mp["title"]
    layout.setName(mp["id"] + " | " + name)
    page = layout.pageCollection().page(0)
    page.setPageSize(QgsLayoutSize(mp["page"]["w"], mp["page"]["h"], IN))
    mapitem = add_map_item(layout, mp["frame"], mp["extent"], layer_sets["main"], "main_map", mp.get("background", "#f5f4ef"))
    mapitem.setScale(mp["scale"])
    mapitem.setFollowVisibilityPreset(False)
    subs = None
    if atlas:
        subs = {"{page_name}": "[% @atlas_pagename %]", "{page_number}": "[% @atlas_featurenumber %]", "{page_count}": "[% @atlas_totalfeatures %]"}
        subs.update({k.upper(): v for k, v in subs.items()})
    for el in mp["elements"]:
        if el["type"] == "text":
            if el.get("text"):
                add_text(layout, el, family, subs)
        elif el["type"] == "rect":
            add_rect(layout, el["x"], el["y"], el["w"], el["h"], el.get("fill"), el.get("stroke"), el.get("stroke_width", 0.5), el.get("opacity", 1.0), el["id"])
        elif el["type"] == "line":
            add_line(layout, [(el["x1"], el["y1"]), (el["x2"], el["y2"])], {"kind": "line", "color": el["color"], "width": el["width"]}, el["id"])
    add_furniture(layout, mp, mapitem, family, north_svg, is_feet)
    add_legend(layout, mp["legend"], family, mp["k"])
    ins = mp.get("inset")
    if ins and layer_sets.get("inset"):
        if ins.get("overlay"):
            add_rect(layout, ins["x"] - 0.03, ins["y"] - 0.03, ins["w"] + 0.06, ins["h"] + 0.06, fill="#ffffff", stroke=None, item_id="inset_halo")
        im = add_map_item(layout, ins, ins["extent"], layer_sets["inset"], "inset_map", "#eef2f3" if not ins.get("overview") else "#f5f4ef", border=0.5)
        if ins.get("overview"):
            ov = QgsLayoutItemMapOverview("Current sheet", im)
            ov.setLinkedMap(mapitem)
            ov.setFrameSymbol(make_symbol({"kind": "polygon", "fill": "#E8A51D", "fill_opacity": 0.45, "stroke": "#4a3a12", "stroke_width": 0.9}))
            im.overviews().addOverview(ov)
    if atlas:
        a = layout.atlas()
        cov = layer_sets["index"]
        a.setCoverageLayer(cov)
        a.setEnabled(True)
        a.setPageNameExpression('"name"')
        a.setSortFeatures(True)
        a.setSortExpression('"page"')
        a.setSortAscending(True)
        a.setHideCoverage(True)
        a.setFilenameExpression("'%s_' || lpad(@atlas_featurenumber, 2, '0')" % mp["id"])
        mapitem.setAtlasDriven(True)
        mapitem.setAtlasScalingMode(QgsLayoutItemMap.Fixed)
        mapitem.dataDefinedProperties().setProperty(QgsLayoutObject.MapRotation, QgsProperty.fromExpression('attribute(@atlas_feature, \'rotation\')'))
    project.layoutManager().addLayout(layout)
    return layout, mapitem


# -------------------------------------------------------------------- export

def _quiet_gdal():
    """QGIS tries to write georeferencing into PNG files, which GDAL reports as an error on every export. Silence it."""
    try:
        from osgeo import gdal
        gdal.PushErrorHandler("CPLQuietErrorHandler")
    except Exception:   # noqa: BLE001
        pass


def export_layout(layout, root, mid, formats, dpi, report):
    ex = QgsLayoutExporter(layout)
    out = {}
    if "pdf" in formats:
        s = QgsLayoutExporter.PdfExportSettings()
        s.dpi = dpi
        s.forceVectorOutput = True
        s.rasterizeWholeImage = False
        s.textRenderFormat = Qgis.TextRenderFormat.AlwaysText
        s.simplifyGeometries = False
        s.appendGeoreference = True
        s.exportMetadata = True
        p = root / "maps" / "pdf" / (mid + ".pdf")
        p.parent.mkdir(parents=True, exist_ok=True)
        res = ex.exportToPdf(str(p), s)
        if res != QgsLayoutExporter.Success:
            raise RuntimeError("PDF export failed for %s (code %s)" % (mid, res))
        out["pdf"] = "maps/pdf/%s.pdf" % mid
    if "png" in formats:
        layout.setCustomProperty("exportWorldFile", False)
        s = QgsLayoutExporter.ImageExportSettings()
        s.dpi = dpi
        s.generateWorldFile = False
        s.exportMetadata = False
        p = root / "maps" / "png" / (mid + ".png")
        p.parent.mkdir(parents=True, exist_ok=True)
        res = ex.exportToImage(str(p), s)
        if res != QgsLayoutExporter.Success:
            raise RuntimeError("PNG export failed for %s (code %s)" % (mid, res))
        out["png"] = "maps/png/%s.png" % mid
    if "svg" in formats:
        s = QgsLayoutExporter.SvgExportSettings()
        s.dpi = dpi
        s.forceVectorOutput = True
        s.exportAsLayers = True
        s.exportLabelsToSeparateLayers = True
        s.textRenderFormat = Qgis.TextRenderFormat.AlwaysText
        s.simplifyGeometries = False
        s.exportMetadata = True
        p = root / "maps" / "svg" / (mid + ".svg")
        p.parent.mkdir(parents=True, exist_ok=True)
        res = ex.exportToSvg(str(p), s)
        if res != QgsLayoutExporter.Success:
            raise RuntimeError("SVG export failed for %s (code %s)" % (mid, res))
        out["svg"] = "maps/svg/%s.svg" % mid
        # Second copy with type converted to outlines: opens the same on a computer without the fonts.
        s.textRenderFormat = Qgis.TextRenderFormat.AlwaysOutlines
        p = root / "maps" / "svg_outlined" / (mid + ".svg")
        p.parent.mkdir(parents=True, exist_ok=True)
        if ex.exportToSvg(str(p), s) != QgsLayoutExporter.Success:
            raise RuntimeError("Outlined SVG export failed for %s" % mid)
        out["svg_outlined"] = "maps/svg_outlined/%s.svg" % mid
    return out


def export_atlas(layout, root, aid, dpi):
    s = QgsLayoutExporter.PdfExportSettings()
    s.dpi = dpi
    s.forceVectorOutput = True
    s.textRenderFormat = Qgis.TextRenderFormat.AlwaysText
    s.simplifyGeometries = False
    p = root / "atlas" / (aid + ".pdf")
    p.parent.mkdir(parents=True, exist_ok=True)
    res, err = QgsLayoutExporter.exportToPdf(layout.atlas(), str(p), s)
    if res != QgsLayoutExporter.Success:
        raise RuntimeError("Atlas export failed for %s: %s" % (aid, err))
    # Sheet previews for the web gallery and for review.
    si = QgsLayoutExporter.ImageExportSettings()
    si.dpi = 150
    si.exportMetadata = False        # no timestamp in the file, so a rebuild gives the same bytes
    si.generateWorldFile = False
    d = root / "atlas" / "sheets"
    d.mkdir(parents=True, exist_ok=True)
    QgsLayoutExporter.exportToImage(layout.atlas(), str(d / aid), "png", si)
    # Layered SVG of each sheet, for Illustrator.
    sv = QgsLayoutExporter.SvgExportSettings()
    sv.dpi = dpi
    sv.forceVectorOutput = True
    sv.exportAsLayers = True
    sv.exportLabelsToSeparateLayers = True
    sv.textRenderFormat = Qgis.TextRenderFormat.AlwaysText
    sv.simplifyGeometries = False
    ds = root / "atlas" / "svg"
    ds.mkdir(parents=True, exist_ok=True)
    QgsLayoutExporter.exportToSvg(layout.atlas(), str(ds / aid), sv)
    return "atlas/%s.pdf" % aid


# ---------------------------------------------------------------------- main

def load_fonts(root, family, log):
    have = set(QFontDatabase().families())
    if family not in have:
        dirs = [root / "fonts"]
        try:
            dirs.append(Path(__file__).resolve().parents[2] / "assets" / "fonts")
        except (NameError, IndexError):     # run with exec() from the QGIS console, or from a shallow path
            pass
        for d in dirs:
            for f in sorted(d.glob("**/*.otf")) if d.exists() else []:
                QFontDatabase.addApplicationFont(str(f))
        have = set(QFontDatabase().families())
    if family not in have:
        log("WARNING: font '%s' is not installed. Install the files in fonts/ and rebuild; QGIS will substitute for now." % family)
        return False
    return True


def _relativize(qgz, root, qdir):
    """Replace absolute paths that QGIS writes into layout layer references with package-relative ones.

    Layer data sources are already stored relative. Layout map items also keep a copy of each
    layer's source for reference, and QGIS writes that copy as an absolute path, which would
    carry the build computer's folder names into the delivered project.
    """
    import zipfile
    prefix = str(root).replace("\\", "/") + "/"
    tmp = qgz.with_suffix(".tmp")
    with zipfile.ZipFile(qgz) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith(".qgs"):
                data = data.decode("utf-8").replace(prefix, "../").replace(str(root) + "\\", "..\\").encode("utf-8")
            zout.writestr(item, data)
    tmp.replace(qgz)
    for f in list((qdir / "layouts").glob("*.qpt")) + list((qdir / "styles").glob("*.qml")):
        t = f.read_text(encoding="utf-8")
        if prefix in t:
            f.write_text(t.replace(prefix, "../"), encoding="utf-8")


def build(root, export=True, formats=("pdf", "png", "svg"), dpi=300, only=None, log=print):
    """Build <root>/qgis/<id>.qgz and, with export=True, every map and atlas export."""
    root = Path(root).resolve()
    spec = json.loads((root / "spec" / "map_package.json").read_text(encoding="utf-8"))
    _quiet_gdal()
    app = QgsApplication.instance()
    own_app = app is None
    if own_app:
        app = QgsApplication([], False)
        app.initQgis()
        # One render thread: with several, label candidates register in a varying order and two
        # builds of the same data can differ by a few label positions.
        QgsApplication.setMaxThreads(1)
        from qgis.core import QgsSettings
        QgsSettings().setValue("qgis/parallel_rendering", False)
    family = spec["font"]["family"]
    report = {"qgis_version": Qgis.QGIS_VERSION, "font_installed": load_fonts(root, family, log), "maps": [], "atlases": [], "warnings": []}
    project = QgsProject.instance()
    project.clear()
    _SEQ[0] = 0
    project.setCrs(QgsCoordinateReferenceSystem("EPSG:%d" % spec["crs"]["epsg"]))
    project.setTitle(spec["project"]["title"])
    project.setFilePathStorage(Qgis.FilePathType.Relative)
    project.setBackgroundColor(QColor("#f5f4ef"))
    les = project.labelingEngineSettings()
    les.setDefaultTextRenderFormat(Qgis.TextRenderFormat.AlwaysText)
    project.setLabelingEngineSettings(les)
    qdir = root / "qgis"
    (qdir / "styles").mkdir(parents=True, exist_ok=True)
    (qdir / "layouts").mkdir(parents=True, exist_ok=True)
    north = root / "styles" / "north_arrow.svg"
    north.parent.mkdir(parents=True, exist_ok=True)
    north.write_text(NORTH_SVG, encoding="utf-8")
    tree = project.layerTreeRoot()
    is_feet = spec["crs"]["is_feet"]
    # QGIS opens a writable GeoPackage in WAL mode, and its render threads then race on the -wal and
    # -shm files ("unable to open database file", layers silently missing from an export). Opening
    # the files read-only for the length of the build avoids that. Permissions are restored at the end.
    gpkgs = sorted((root / "data").glob("*.gpkg"))
    modes = {g: g.stat().st_mode for g in gpkgs}
    for g in gpkgs:
        g.chmod(modes[g] & ~0o222)
    try:
        return _build(root, spec, project, tree, family, north, qdir, is_feet, export, formats, dpi, only, log, report, own_app, app)
    finally:
        for g, m in modes.items():
            g.chmod(m)


def _build(root, spec, project, tree, family, north, qdir, is_feet, export, formats, dpi, only, log, report, own_app, app):
    layouts = []
    saved_styles = set()

    def load_group(title, layer_specs, visible):
        grp = tree.addGroup(title)
        made = []
        for ls in layer_specs:
            new = add_layer(project, root, grp, ls, family)
            made += new
            for lyr in new:
                tag = "%s__%s" % (title.split(" | ")[0], lyr.customProperty("tgis/id"))
                if tag not in saved_styles:
                    lyr.saveNamedStyle(str(qdir / "styles" / (tag + ".qml")))
                    saved_styles.add(tag)
        grp.setItemVisibilityChecked(visible)
        grp.setExpanded(False)
        return made

    items = [(m, False) for m in spec["maps"]] + [(a, True) for a in spec.get("atlases", [])]
    for i, (mp, is_atlas) in enumerate(items):
        if only and mp["id"] not in only:
            continue
        t0 = time.time()
        title = "%s | %s" % (mp["id"], mp["title"])
        sets = {"main": load_group(title, mp["layers"], visible=(i == 0))}
        add_theme(project, mp["id"], sets["main"])
        ins = mp.get("inset")
        if ins and ins.get("layers"):
            sets["inset"] = load_group(title + " (inset)", ins["layers"], visible=False)
        if is_atlas:
            idx = QgsVectorLayer("%s|layername=%s" % (root / mp["atlas"]["file"], mp["atlas"]["index_layer"]), "Sheet index: " + mp["title"], "ogr")
            idx.setId("index_" + mp["id"])
            idx.setRenderer(QgsSingleSymbolRenderer(make_symbol({"kind": "polygon", "fill": None, "stroke": "#4a3a12", "stroke_width": 0.8})))
            project.addMapLayer(idx, False)
            node = tree.addLayer(idx)
            node.setItemVisibilityChecked(False)
            sets["index"] = idx
        layout, mapitem = build_layout(project, mp, sets, family, north, is_feet, atlas=is_atlas)
        layout.saveAsTemplate(str(qdir / "layouts" / (mp["id"] + ".qpt")), QgsReadWriteContext())
        layouts.append((mp, layout, is_atlas))
        entry = {"id": mp["id"], "layers": len(sets["main"]), "layout_items": len(layout.items())}
        if export:
            if is_atlas:
                entry["pdf"] = export_atlas(layout, root, mp["id"], dpi)
                entry["pages"] = len(mp["atlas"]["pages"])
            else:
                big = max(mp["page"]["w"], mp["page"]["h"]) > 20
                entry.update(export_layout(layout, root, mp["id"], formats, 150 if big else dpi, report))
        entry["seconds"] = round(time.time() - t0, 1)
        (report["atlases"] if is_atlas else report["maps"]).append(entry)
        log("  %s  %s" % (mp["id"], ", ".join(k for k in ("pdf", "png", "svg") if k in entry) or "layout built"))

    path = qdir / (spec["project"]["id"] + ".qgz")
    if not project.write(str(path)):
        raise RuntimeError("Could not write " + str(path))
    _relativize(path, root, qdir)
    report["project"] = "qgis/" + path.name
    broken = [l.name() for l in project.mapLayers().values() if not l.isValid()]
    if broken:
        raise RuntimeError("Broken layers in the QGIS project: " + ", ".join(broken))
    (qdir / "qgis_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    if own_app:
        project.clear()
        app.exitQgis()
    return report


if __name__ == "__main__":
    here = Path(__file__).resolve()
    default_root = here.parents[1] if (here.parents[1] / "spec" / "map_package.json").exists() else Path.cwd()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    rep = build(args[0] if args else default_root, export="--no-export" not in sys.argv)
    print(json.dumps(rep, indent=2))
