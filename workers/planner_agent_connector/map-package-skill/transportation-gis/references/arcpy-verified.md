# ArcPy (arcpy.mp) API facts verified against Esri documentation

Researched 2026-10-01. Target: ArcGIS Pro 3.3 and later. The "latest" documentation was Pro 3.7 on this date.

How to read this file:

- Every fact carries its source URL. `pro.arcgis.com/en/pro-app/latest/...` URLs now redirect to `doc.esri.com/en/arcgis-pro/latest/...`. Both resolve.
- "Min version" comes from the "What's new" page of the release that added the item, or from comparing versioned doc pages. Where neither states it, the version is marked UNVERIFIED.
- "CIM spec" means the Esri-authored repository `github.com/Esri/cim-spec` (docs/v3). It lists class properties and enum values. It does not say which properties are required, so code built only from the spec is marked "UNVERIFIED on a real build".
- Nothing here was run. ArcGIS Pro is not installed on this machine.

Source abbreviations used below:

- MP = https://pro.arcgis.com/en/pro-app/latest/arcpy/mapping
- CIM = https://github.com/Esri/cim-spec/blob/main/docs/v3
- WN32, WN33, WN34, WN35 = https://pro.arcgis.com/en/pro-app/3.2/get-started/whats-new-in-arcgis-pro.htm (and 3.3, 3.4, 3.5)
- WN37 = https://pro.arcgis.com/en/pro-app/latest/get-started/whats-new-in-arcgis-pro.htm

---

## 1. Layout.createMapSurroundElement, style items, scale bar and legend settings

### Signature

- `Layout.createMapSurroundElement(geometry, mapsurround_type, {mapframe}, {style_item}, {name})`. Source: MP/layout-class.htm
- Min version: Pro 3.2. Source: WN32 ("The createMapSurroundElement method in the Layout class creates legends, north arrows, and scale bars.")
- `geometry`: `arcpy.Point` or `arcpy.Polygon` in page units. With a Point, the point is the anchor and the element gets a default size. Source: MP/layout-class.htm
- `mapsurround_type` valid strings: `DUAL_SCALE_BAR`, `GRID`, `LEGEND`, `NORTH_ARROW`, `SCALE_BAR`. Source: MP/layout-class.htm
- `DUAL_SCALE_BAR` was added at Pro 3.5. Source: WN35
- Esri samples pass mixed case (`'North_Arrow'`, `'Scale_bar'`, `'Legend'`), so the keyword is treated as case-insensitive in the samples. Source: MP/layout-class.htm (example 3)
- `mapframe`: MapFrame, default None. `style_item`: a StyleItem that must match the surround type. A default style applies if omitted. `name`: optional string. Source: MP/layout-class.htm
- Returns a `MapSurroundElement`, or a `LegendElement` when the type is LEGEND. Source: MP/layout-class.htm
- Default anchor differs by type: north arrow anchors at center, scale bar at lower left. Change it with `setAnchor`. Source: MP/mapsurroundelement-class.htm

### ArcGISProject.listStyleItems

- `ArcGISProject.listStyleItems(style, {style_class}, {wildcard}, {key})`. Returns a list of StyleItem objects. Source: MP/arcgisproject-class.htm
- Min version: Pro 3.2 (method absent from the 3.1 class page, present on the 3.2 page). Sources: https://pro.arcgis.com/en/pro-app/3.1/arcpy/mapping/arcgisproject-class.htm and https://pro.arcgis.com/en/pro-app/3.2/arcpy/mapping/arcgisproject-class.htm
- The `key` parameter was added at Pro 3.7. On 3.3 to 3.6, do not pass `key`. Use `wildcard` on the name. Source: WN37
- `style`: a system style name such as `'ArcGIS 2D'`, the personal style `'Favorites'`, or the full path to a custom `.stylx` that is already loaded in the project. Source: MP/arcgisproject-class.htm
- `style_class` values listed for the method: `LEGEND`, `LEGEND_ITEM`, `LINE`, `NORTH_ARROW`, `POINT`, `POLYGON`, `SCALE_BAR`, `TABLE_FRAME`, `TEXT`. Source: MP/arcgisproject-class.htm
- `LEGEND_ITEM` and `TABLE_FRAME` were added at Pro 3.3. Source: WN33
- Styles must be in the project. Add one with `p.updateStyles(list)` (Pro 3.3). Sources: MP/styleitem-class.htm, WN33
- Esri guidance at 3.7: reference system style items by `key`, because names can change between minor releases. Source: MP/arcgisproject-class.htm
- StyleItem properties: `category`, `key` (3.7), `name`, `style`, `style_class`, `tags`. Source: MP/styleitem-class.htm

### Real item names that appear in Esri samples

- North arrow, ArcGIS 2D: `'Compass North 1'`. Source: MP/layout-class.htm
- North arrow, Favorites: `'Compass North 1'`, `'ArcGIS North 10'`. Source: MP/styleitem-class.htm
- Scale bar, ArcGIS 2D, by name: `'Double Alternating Scale Bar 1 Metric'`. Source: MP/layout-class.htm
- Scale bar, ArcGIS 2D, by key: `'Double Alternating Scale Bar 1 Metric_Metric_8'` and wildcard key `'Alternating Scale Bar 1 Metric*'`. Source: MP/styleitem-class.htm
- Legend, ArcGIS 2D, by key wildcard: `'*Legend 3*'`. Sources: MP/legendelement-class.htm, MP/mapsurroundelement-class.htm
- Legend names `'Legend 1'`, `'Legend 2'` appear only as key wildcards against a custom stylx. Source: MP/styleitem-class.htm
- UNVERIFIED: any other item name (for example `'ArcGIS North 1'`, `'Scale Line 1'`, non-metric scale bar names, and the exact display name of the legend whose key matches `*Legend 3*`). Print the list on the real build:

```python
for sc in ('NORTH_ARROW', 'SCALE_BAR', 'LEGEND'):
    for si in p.listStyleItems('ArcGIS 2D', sc):
        arcpy.AddMessage(f'{sc}: {si.name}')
```

### Working example (adapted from Esri samples, 3.3-safe, no `key`)

```python
def rect(llx, lly, w, h):
    pts = [[llx, lly], [llx, lly+h], [llx+w, lly+h], [llx+w, lly], [llx, lly]]
    return arcpy.Polygon(arcpy.Array([arcpy.Point(*c) for c in pts]))

na_si = p.listStyleItems('ArcGIS 2D', 'NORTH_ARROW', 'Compass North 1')[0]
na = lyt.createMapSurroundElement(arcpy.Point(7, 7), 'NORTH_ARROW', mf, na_si, 'North Arrow')
na.elementWidth = 0.5

sb_si = p.listStyleItems('ArcGIS 2D', 'SCALE_BAR', 'Double Alternating Scale Bar 1 Metric')[0]
sb = lyt.createMapSurroundElement(rect(0.5, 5.5, 2.5, 0.5), 'SCALE_BAR', mf, sb_si, 'Scale Bar')

leg = lyt.createMapSurroundElement(arcpy.Point(0.75, 3.5), 'LEGEND', mf, name='Legend')
```

Sources: MP/layout-class.htm (example 3), MP/legendelement-class.htm (example 1)

### Size and position after creation

- MapSurroundElement and LegendElement properties: `elementWidth`, `elementHeight`, `elementPositionX`, `elementPositionY` (anchor position, page units), `elementRotation`, `anchor` (read), `visible`, `locked`, `name`, `mapFrame`. Sources: MP/mapsurroundelement-class.htm, MP/legendelement-class.htm
- `setAnchor(anchor)` values: `BOTTOM_LEFT_CORNER`, `BOTTOM_MID_POINT`, `BOTTOM_RIGHT_CORNER`, `CENTER_POINT`, `LEFT_MID_POINT`, `RIGHT_MID_POINT`, `TOP_LEFT_CORNER`, `TOP_MID_POINT`, `TOP_RIGHT_CORNER`. Source: MP/mapsurroundelement-class.htm
- `elementRotation` does not apply to north arrows. Source: MP/mapsurroundelement-class.htm
- `applyStyleItem(style_item)` restyles an existing surround (Pro 3.3). Sources: MP/mapsurroundelement-class.htm, WN33

### Scale bar divisions and units (CIM)

- arcpy.mp exposes no scale bar properties. Use the layout CIM, find the element by name, set properties, call `setDefinition`. Esri sample:

```python
lyt_cim = lyt.getDefinition('V3')
for elm in lyt_cim.elements:
    if elm.name == 'Scale Bar':
        elm.subdivisions = 2
        elm.numberFormat.roundingOption = "esriRoundNumberOfSignificantDigits"
        elm.numberFormat.roundingValue = 2
lyt.setDefinition(lyt_cim)
```

Source: MP/mapsurroundelement-class.htm (scale bar sample)

- CIMScaleBar properties (CIM spec): `division` (double, division value), `divisions` (long), `subdivisions` (long), `divisionsBeforeZero`, `fittingStrategy`, `labelFrequency`, `labelPosition`, `labelSymbol` (CIMSymbolReference), `numberFormat`, `unitLabel` (string), `unitLabelPosition`, `unitLabelSymbol`, `units` (Unit), `barHeight`. Source: CIM/CIMLayout.md#cimscaleline
- `fittingStrategy` enum: `AdjustDivision`, `AdjustDivisions`, `AdjustDivisionAndDivisions`, `AdjustFrame`. The fitting strategy controls which of divisions, subdivisions, and division value the user may set. Sources: CIM/CIMLayout.md, https://pro.arcgis.com/en/pro-app/latest/help/layouts/scale-bars.htm
- `units` is a Unit object with one property, `uwkid` (well-known ID of the unit). Source: CIM/ExternalReferences.md
- UNVERIFIED: the exact Python form for changing units (for example `elm.units.uwkid = 9093` for statute miles) and the uwkid values. No Esri sample shows it. Lower-risk route: pick a style item that already uses the wanted units, then set `elm.unitLabel`.
- North arrow CIM properties from an Esri sample: `elm.northType = 'TrueNorth'`, `elm.calibrationAngle = -2.5`. Source: MP/mapsurroundelement-class.htm

### Legend properties and fonts

- LegendElement properties in arcpy.mp: `title`, `showTitle`, `columnCount`, `fittingStrategy`, `items`, `isOverflowing` (3.5), `syncLayerOrder`, `syncLayerVisibility`, `syncNewLayer`, `syncReferenceScale`. Methods: `addItem(layer, {add_position})`, `moveItem`, `removeItem`, `applyStyleItem`. Sources: MP/legendelement-class.htm, WN35
- `fittingStrategy` strings on LegendElement: `AdjustFontSize`, `AdjustColumns`, `AdjustColumnsAndFont`, `AdjustFrame`, `ManualColumns`. Source: MP/legendelement-class.htm
- The CIM enum uses different names: `AdjustSize`, `AdjustColumns`, `AdjustColumnsAndSize`, `AdjustFrame`, `ManualColumns`. Source: CIM/CIMLayout.md#cimlegend
- Legend title font through CIM (Esri sample):

```python
lyt_cim = lyt.getDefinition('V3')
for elm in lyt_cim.elements:
    if elm.name == 'Legend':
        elm.titleSymbol.symbol.height = 30
        elm.titleSymbol.symbol.fontStyleName = 'Bold'
        elm.titleSymbol.symbol.horizontalAlignment = 'Center'
        elm.titleSymbol.symbol.symbol.symbolLayers[0].color.values = [255, 0, 0, 100]
        for itm in elm.items:
            itm.patchWidth = 50
        if elm.fittingStrategy == 'AdjustColumnsAndSize':
            elm.minFontSize = 8
lyt.setDefinition(lyt_cim)
```

Sources: MP/legendelement-class.htm (example 3), MP/mapsurroundelement-class.htm (legend sample)

- Per-item text symbols on each CIM legend item (CIM spec): `labelSymbol`, `layerNameSymbol`, `headingSymbol`, `descriptionSymbol`, `groupLayerNameSymbol` (each a CIMSymbolReference to a CIMTextSymbol), plus `showLayerName`, `showHeading`, `patchWidth`, `patchHeight`. Source: CIM/CIMLayout.md#cimhorizontallegenditem
- UNVERIFIED on a real build: setting `itm.labelSymbol.symbol.fontFamilyName` and `.height` per item. The property names are in the spec. No Esri sample sets them.
- With an "adjust font size" fitting strategy the legend overrides font sizes. Set `fittingStrategy = 'AdjustFrame'` or `'ManualColumns'` before fixing font sizes. This follows from the fitting strategy descriptions. Source: MP/legendelement-class.htm

---

## 2. Label classes

### arcpy.mp API

- `Layer.listLabelClasses({wildcard})` returns a list of LabelClass objects. Source: MP/layer-class.htm
- `Layer.showLabels` (Boolean, read and write). Test with `lyr.supports("SHOWLABELS")`. Source: MP/layer-class.htm
- LabelClass properties: `expression`, `name`, `SQLQuery`, `visible` (all read and write). Source: MP/labelclass-class.htm
- `LabelClass.getDefinition(cim_version)` and `setDefinition` were added at Pro 3.3. Source: WN33
- `Layer.createLabelClass(name, expression, {sql_query}, {labelclass_language})`. Languages: `ARCADE` (default), `JSCRIPT`, `PYTHON`, `VBSCRIPT`. Min version Pro 3.3. Sources: MP/layer-class.htm, WN33
- Labels draw only when both `layer.showLabels = True` and `labelClass.visible = True`. Source: MP/layer-class.htm
- VBScript is a feature on demand from Windows 11 24H2. Use Arcade or Python. Source: MP/labelclass-class.htm

```python
lyr.showLabels = True
for lc in lyr.listLabelClasses():
    lc.visible = False
lc = lyr.createLabelClass(name='Streets', expression='$feature.NAME',
                          sql_query="CLASS = 'Arterial'", labelclass_language='ARCADE')
lc.visible = True
```

Source: MP/labelclass-class.htm (example 3)

### Arcade syntax and expression engine

- Field: `$feature.fieldname`. Joined field or special characters: `$feature['tablename.fieldname']`, `$feature['33field']`. Coded value domain: `DomainName($feature, 'fieldname')`. Source: https://pro.arcgis.com/en/pro-app/latest/help/mapping/text/specify-text-for-labels.htm
- Python, VBScript, JScript use `[FIELD]`. Arcade keeps field data types. The other engines cast values to text. Source: same page
- Arcade ignores layer field formatting. Format numbers in the expression. Source: same page
- Engine through CIM: `lc.expressionEngine` takes `'Arcade'`, `'Python'`, `'JScript'`, `'VBScript'`. Change `expression` in the same edit or the application misbehaves. Sources: MP/python-cim-access.htm (example 2), CIM/CIMLabelPlacement.md (LabelExpressionEngine)

```python
l_cim = lyr.getDefinition('V3')
lc = l_cim.labelClasses[0]
lc.expressionEngine = 'Arcade'
lc.expression = '$feature.NAME'
lyr.setDefinition(l_cim)
```

Source: MP/labelclass-class.htm (example 4)

### CIM path for font, size, colour, halo

- `layer.getDefinition('V3').labelClasses` is a list of CIMLabelClass. `labelVisibility` on the layer CIM matches `showLabels`. Source: CIM/CIMVectorLayers.md#cimfeaturelayer
- CIMLabelClass properties: `expression`, `expressionEngine`, `expressionTitle`, `featuresToLabel`, `maplexLabelPlacementProperties`, `standardLabelPlacementProperties`, `maximumScale`, `minimumScale`, `name`, `priority`, `textSymbol` (CIMSymbolReference), `useCodedValue`, `whereClause`, `visibility`. Source: CIM/CIMLabelPlacement.md#cimlabelclass
- `textSymbol.symbol` is a CIMTextSymbol. Properties used for labels: `fontFamilyName` (string), `fontStyleName` (string, for example Regular, Bold, Italic), `height` (size in points), `haloSize` (double), `haloSymbol` (CIMPolygonSymbol), `symbol` (CIMPolygonSymbol that fills the glyphs), `horizontalAlignment`, `verticalAlignment`, `letterSpacing`, `wordSpacing`, `textCase`, `underline`, `shadowColor`, `shadowOffsetX`, `shadowOffsetY`. Source: CIM/CIMSymbols.md#cimtextsymbol
- Text colour path: `textSymbol.symbol.symbol.symbolLayers[0].color.values = [R, G, B, alpha]` with alpha 100 opaque. An Esri sample uses this same path on a legend title text symbol. Source: MP/legendelement-class.htm (example 3)

```python
l_cim = lyr.getDefinition('V3')
lc = l_cim.labelClasses[0]
ts = lc.textSymbol.symbol                 # CIMTextSymbol
ts.fontFamilyName = 'Arial'
ts.fontStyleName = 'Bold'
ts.height = 8                             # points
ts.symbol.symbolLayers[0].color.values = [40, 40, 40, 100]

# Halo: built from CIM classes. Property names are from the CIM spec.
rgb = arcpy.cim.CreateCIMObjectFromClassName('CIMRGBColor', 'V3')
rgb.values = [255, 255, 255, 100]
fill = arcpy.cim.CreateCIMObjectFromClassName('CIMSolidFill', 'V3')
fill.color = rgb
fill.enable = True
halo = arcpy.cim.CreateCIMObjectFromClassName('CIMPolygonSymbol', 'V3')
halo.symbolLayers = [fill]
ts.haloSymbol = halo
ts.haloSize = 1
lyr.setDefinition(l_cim)
```

- The font, size, and colour lines follow an Esri sample pattern. The halo block is UNVERIFIED on a real build. It combines the CIMTextSymbol `haloSize` and `haloSymbol` properties from the spec with the `CreateCIMObjectFromClassName` pattern from MP/python-cim-access.htm. No Esri sample builds a halo.
- `symbolLayers[0]` assumes the first layer of the glyph symbol is a solid fill. UNVERIFIED for default label symbols. Check `type(layer).__name__` first.

### Line label placement (CIM)

- `lc.maplexLabelPlacementProperties` is used when the map uses the Maplex label engine. `lc.standardLabelPlacementProperties` is used with the standard engine. Source: CIM/CIMLabelPlacement.md#cimlabelclass
- CIMMaplexLabelPlacementProperties line properties: `featureType` (`Point`, `Line`, `Polygon`), `lineFeatureType`, `linePlacementMethod`, `canStackLabel`, `repeatLabel`, `minimumRepetitionInterval`, `repetitionIntervalUnit`, `spreadCharacters`, `spreadWords`, `primaryOffset`, `primaryOffsetUnit`, `canRemoveOverlappingLabel`, `thinDuplicateLabels`, `thinningDistance`, `canReduceFontSize`, `canOverrunFeature`, `preferHorizontalPlacement`, `alignLabelToLineDirection`, `neverRemoveLabel`, `labelBuffer`, `featureWeight`, `labelPriority`. Source: CIM/CIMLabelPlacement.md#cimmaplexlabelplacementproperties
- `lineFeatureType` enum: `General`, `Street`, `StreetAddressRange`, `Contour`, `River`. Source: CIM/CIMLabelPlacement.md
- `linePlacementMethod` enum: `CenteredHorizontalOnLine`, `CenteredStraightOnLine`, `CenteredCurvedOnLine`, `CenteredPerpendicularOnLine`, `OffsetHorizontalFromLine`, `OffsetStraightFromLine`, `OffsetCurvedFromLine`, `OffsetPerpendicularFromLine`. Source: CIM/CIMLabelPlacement.md
- `pointPlacementMethod` enum: `AroundPoint`, `CenteredOnPoint`, `NorthOfPoint`, `NorthEastOfPoint`, `EastOfPoint`, `SouthEastOfPoint`, `SouthOfPoint`, `SouthWestOfPoint`, `WestOfPoint`, `NorthWestOfPoint`. Source: CIM/CIMLabelPlacement.md
- `polygonPlacementMethod` enum: `HorizontalInPolygon`, `StraightInPolygon`, `CurvedInPolygon`, `HorizontalAroundPolygon`, `RepeatAlongBoundary`, `CurvedAroundPolygon`. Source: CIM/CIMLabelPlacement.md

```python
mp = lc.maplexLabelPlacementProperties
mp.lineFeatureType = 'Street'
mp.linePlacementMethod = 'CenteredCurvedOnLine'
mp.canStackLabel = False
mp.repeatLabel = True
```

- UNVERIFIED on a real build: the block above. The property names and enum strings are in the spec. No Esri arcpy sample sets Maplex properties.
- UNVERIFIED: how to switch a map's label engine to Maplex from arcpy. No doc page found.

---

## 3. Unique value and graduated renderers

### Symbology class

- `sym = lyr.symbology`, edit, then `lyr.symbology = sym`. Test with `hasattr(sym, 'renderer')`. Source: MP/symbology-class.htm
- `sym.updateRenderer(renderer_name)` values: `GraduatedColorsRenderer`, `GraduatedSymbolsRenderer`, `SimpleRenderer`, `UnclassedColorsRenderer`, `UniqueValueRenderer`. Source: MP/symbology-class.htm
- `sym.renderer.type` returns the renderer name string. Source: MP/symbology-class.htm
- Min version: UNVERIFIED from release notes. The class predates Pro 3.0.
- Other renderers: copy CIM symbology with `lyr.setSymbologyDefinition(other.getSymbologyDefinition('V3'))`. Source: MP/symbology-class.htm (example 4), MP/layer-class.htm

### UniqueValueRenderer

- Properties: `fields` (list, even for one field), `groups` (list of ItemGroup), `colorRamp`, `defaultSymbol`, `useDefaultSymbol`, `type`. Methods: `addValues(dict)`, `removeValues(dict)`, `listMissingValues()`. Source: MP/uniquevaluerenderer-class.htm
- Setting `fields` generates every unique value automatically. Source: MP/uniquevaluerenderer-class.htm
- ItemGroup: `heading`, `items`. Item: `label`, `description`, `symbol`, `values`. Sources: MP/itemgroup-class.htm, MP/item-class.htm
- `item.values` is a list of lists. The first value of a single-field item is `itm.values[0][0]`. Source: MP/uniquevaluerenderer-class.htm (example 1)
- `addValues({"group heading": ["v1", "v2"]})`. Reassign `lyr.symbology = sym` after each add or remove before further edits. Source: MP/uniquevaluerenderer-class.htm

```python
sym = lyr.symbology
sym.updateRenderer('UniqueValueRenderer')
sym.renderer.fields = ['CLASS']
colors = {'Arterial': [200, 30, 30, 100], 'Local': [120, 120, 120, 100]}
for grp in sym.renderer.groups:
    for itm in grp.items:
        val = itm.values[0][0]
        if val in colors:
            itm.symbol.color = {'RGB': colors[val]}
            itm.symbol.size = 1.5
            itm.label = str(val)
lyr.symbology = sym
```

Source: adapted from MP/uniquevaluerenderer-class.htm (example 1)

### Symbol

- Properties: `color` (dict), `outlineColor` (dict), `outlineWidth` (double), `size` (point size, line width, or polygon outline width), `angle`, `useRealWorldUnits`, `name`. Methods: `applySymbolFromGallery(wildcard, {index})`, `listSymbolsFromGallery({wildcard})`. Source: MP/symbol-class.htm
- Colour dict forms, read and write: `{'RGB': [R, G, B, A]}`, `{'HSV': [H, S, V, A]}`, `{'HSL': [H, S, L, A]}`, `{'CMYK': [C, M, Y, K, A]}`. Read only: `Lab`, `Grayscale`. Source: MP/symbol-class.htm
- Alpha is opacity. 100 is opaque and shows as 0 percent transparency in the application. Source: MP/symbol-class.htm

### GraduatedColorsRenderer and ClassBreak

- Properties: `classificationField`, `breakCount`, `classBreaks`, `classificationMethod`, `colorRamp`, `deviationInterval`, `intervalSize`, `lowerBound` (Pro 3.4), `normalizationField`, `normalizationType`, `type`. Sources: MP/graduatedcolorsrenderer-class.htm, WN34
- `classificationMethod` strings: `DefinedInterval`, `EqualInterval`, `GeometricInterval`, `ManualInterval`, `NaturalBreaks`, `Quantile`, `StandardDeviation`. Source: MP/graduatedcolorsrenderer-class.htm
- Setting a break's `upperBound` switches the method to `ManualInterval`. Labels do not update on their own. Source: MP/graduatedcolorsrenderer-class.htm
- ClassBreak properties: `upperBound`, `label`, `description`, `symbol`. Source: MP/classbreak-class.htm
- Colour ramp: `sym.renderer.colorRamp = p.listColorRamps('Cyan to Purple')[0]`. Source: MP/graduatedcolorsrenderer-class.htm

```python
sym = lyr.symbology
sym.updateRenderer('GraduatedColorsRenderer')
sym.renderer.classificationField = 'AADT'
sym.renderer.breakCount = 4
bounds = [5000, 15000, 30000, 80000]
for brk, ub in zip(sym.renderer.classBreaks, bounds):
    brk.upperBound = ub
    brk.label = f'up to {ub:,}'
    brk.symbol.color = {'RGB': [255, 0, 0, 100]}
    brk.symbol.outlineColor = {'RGB': [80, 80, 80, 100]}
    brk.symbol.size = 0.5
lyr.symbology = sym
```

Source: adapted from MP/graduatedcolorsrenderer-class.htm (example 2)

- Out-of-range values through CIM: `l_cim.renderer.useDefaultSymbol = True`, `l_cim.renderer.defaultLabel = "Out of range"`. Source: MP/graduatedcolorsrenderer-class.htm (example 3)

### Equivalent CIM classes

- Renderer lives at `layer.getDefinition('V3').renderer`. Source: CIM/CIMVectorLayers.md#cimfeaturelayer
- CIMUniqueValueRenderer: `fields` ([string]), `groups` ([CIMUniqueValueGroup]), `defaultSymbol` (CIMSymbolReference), `defaultLabel`, `useDefaultSymbol`, `colorRamp`, `valueExpressionInfo`. Source: CIM/CIMRenderers.md#cimuniquevaluerenderer
- CIMUniqueValueGroup: `classes` ([CIMUniqueValueClass]), `heading`. Source: CIM/CIMRenderers.md#cimuniquevaluegroup
- CIMUniqueValueClass: `label`, `description`, `symbol` (CIMSymbolReference), `values` ([CIMUniqueValue]), `visible`, `editable`, `patch`. Source: CIM/CIMRenderers.md#cimuniquevalueclass
- CIMUniqueValue: `fieldValues` ([string], one string per renderer field). Source: CIM/CIMRenderers.md#cimuniquevalue
- CIMSymbolReference: `symbol`, `symbolName`, `primitiveOverrides`, `minScale`, `maxScale`. Source: CIM/CIMRenderers.md#cimsymbolreference
- CIMClassBreaksRenderer: `field`, `classBreakType` (`GraduatedColor`, `GraduatedSymbol`, `UnclassedColor`), `classificationMethod` (`DefinedInterval`, `EqualInterval`, `GeometricalInterval`, `Manual`, `NaturalBreaks`, `Quantile`, `StandardDeviation`), `breaks` ([CIMClassBreak]), `minimumBreak`, `defaultSymbol`, `defaultLabel`, `useDefaultSymbol`, `colorRamp`, `heading`, `numberFormat`, `showInAscendingOrder`. Source: CIM/CIMRenderers.md#cimclassbreaksrenderer
- CIMClassBreak: `upperBound`, `label`, `description`, `symbol` (CIMSymbolReference), `patch`. Source: CIM/CIMRenderers.md#cimclassbreak
- An Esri sample walks an existing unique value renderer as `lyr_cim.renderer.groups` then `grp.classes`, and sets `cls.patch`. Source: MP/legendelement-class.htm (example 3)
- The spec does not mark any property as required. Which ones Pro needs is UNVERIFIED.

```python
def cim(name):
    return arcpy.cim.CreateCIMObjectFromClassName(name, 'V3')

def sym_ref(symbol):
    ref = cim('CIMSymbolReference'); ref.symbol = symbol; return ref

l_cim = lyr.getDefinition('V3')
uvr = cim('CIMUniqueValueRenderer')
uvr.fields = ['CLASS']
grp = cim('CIMUniqueValueGroup'); grp.heading = 'CLASS'; grp.classes = []
for value, label, symbol in specs:          # symbol = a CIMLineSymbol etc. built elsewhere
    uv = cim('CIMUniqueValue'); uv.fieldValues = [str(value)]
    c = cim('CIMUniqueValueClass')
    c.values = [uv]; c.label = label; c.symbol = sym_ref(symbol); c.visible = True
    grp.classes.append(c)
uvr.groups = [grp]
uvr.useDefaultSymbol = False
l_cim.renderer = uvr
lyr.setDefinition(l_cim)
```

- UNVERIFIED on a real build: the block above. Class and property names are from the spec. The `CreateCIMObjectFromClassName` pattern, including that dependent objects are not auto-created, is from MP/python-cim-access.htm. Lower-risk route: call `sym.updateRenderer(...)` and set `fields` through the Symbology class so Pro builds the classes, then replace each class symbol through CIM.

---

## 4. Map series

### Layout.createSpatialMapSeries

- `Layout.createSpatialMapSeries(mapframe, index_layer, name_field, {sort_field})`. Returns MapSeries. Source: MP/layout-class.htm
- Min version: Pro 3.2. Source: WN32
- `mapframe`: MapFrame whose map contains the index layer. `index_layer`: Layer object. `name_field`, `sort_field`: field name strings. Source: MP/layout-class.htm
- There are no arcpy.mp parameters for rotation, scale, or extent options. Set them through the CIM (below). Source: MP/layout-class.htm
- Also available: `Layout.createBookmarkMapSeries(mapframe, {bookmarks})` (Pro 3.2). Sources: MP/layout-class.htm, WN32

### MapSeries properties and methods

- `layout.mapSeries` returns a MapSeries, a BookmarkMapSeries, or None when no series exists or it is not enabled. Source: MP/layout-class.htm
- Read and write: `enabled`, `currentPageNumber`, `currentPageName` (3.7), `clipToIndexFeature` (3.2), `mapFrame`. Sources: MP/mapseries-class.htm, WN37, WN32
- Read only: `pageCount`, `indexLayer`, `pageNameField` (Field object), `pageRow` (named tuple, `ms.pageRow.FIELD`), `selectedIndexFeatures`, `type` (3.7, `SPATIAL_MAPSERIES` or `BOOKMARK_MAPSERIES`). Sources: MP/mapseries-class.htm, WN37
- Methods: `export(export_format, {mapseries_export_options}, {display_options})`, `exportToPDF(...)`, `getPageNumberFromName(page_name)`, `refresh()`, `getDefinition(cim_version)`, `setDefinition(obj)`. Source: MP/mapseries-class.htm
- Page numbers are 1-based: `for n in range(1, ms.pageCount + 1): ms.currentPageNumber = n`. Source: MP/mapseries-class.htm (example 2)
- Type test used by Esri: `type(ms).__name__ == 'MapSeries'`. Source: MP/mapseries-class.htm

### Extent options, rotation, scale (CIM)

- CIMSpatialMapSeries properties: `enabled`, `mapFrameName`, `startingPageNumber`, `currentPageID`, `indexLayerURI`, `nameField`, `numberField`, `categoryField`, `rotationField`, `sortField`, `sortAscending`, `scaleField`, `spatialReferenceField`, `scaleRounding`, `extentOptions`, `marginType`, `marginUnits`, `margin`, `clipMapToIndexFeature`. Source: CIM/CIMLayout.md#cimspatialmapseries
- `extentOptions` enum: `BestFit`, `ExtentCenter`, `DataDriven`. Source: CIM/CIMLayout.md (ExtentFitType)
- Esri sample values: `extentOptions = "BestFit"`, `marginType = "Percent"`, `margin = 10`, `scaleRounding = 1000`. Source: MP/python-cim-access.htm

```python
ms = lyt.createSpatialMapSeries(mf, index_lyr, 'NAME', 'NAME')
ms_cim = ms.getDefinition('V3')
ms_cim.startingPageNumber = 1
ms_cim.scaleRounding = 1000
ms_cim.extentOptions = 'BestFit'
ms_cim.marginType = 'Percent'
ms_cim.margin = 10
ms_cim.rotationField = 'ANGLE'      # UNVERIFIED on a real build, name from CIM spec
ms.setDefinition(ms_cim)
```

Sources: MP/mapseries-class.htm (example 4), MP/python-cim-access.htm

### MapSeries.exportToPDF

- `exportToPDF(out_pdf, {page_range_type}, {page_range_string}, {multiple_files}, {resolution}, {image_quality}, {compress_vector_graphics}, {image_compression}, {embed_fonts}, {layers_attributes}, {georef_info}, {jpeg_compression_quality}, {clip_to_elements}, {show_selection_symbology}, {output_as_image}, {embed_color_profile}, {pdf_accessibility}, {show_export_count}, {keep_layout_background}, {convert_markers}, {simulate_overprint})`. Source: MP/mapseries-class.htm
- Legacy from Pro 3.4. `export` supersedes it. It still works. Source: MP/mapseries-class.htm
- `page_range_type`: `ALL` (default), `CURRENT`, `RANGE`, `SELECTED`. `page_range_string` example `"1, 3, 5-12"`, used only with `RANGE`. Source: MP/mapseries-class.htm
- `multiple_files`: `PDF_SINGLE_FILE` (default), `PDF_MULTIPLE_FILES_PAGE_NAME` (Output.pdf becomes Output_LakeErie.pdf), `PDF_MULTIPLE_FILES_PAGE_NUMBER` (Output_1.pdf). Source: MP/mapseries-class.htm
- Default `resolution` is 96 here. Layout.exportToPDF defaults to 300. Source: MP/mapseries-class.htm, MP/layout-class.htm
- `show_export_count` was added at Pro 3.1. Source: https://pro.arcgis.com/en/pro-app/3.1/get-started/whats-new-in-arcgis-pro.htm

```python
ms.exportToPDF(r'C:\out\Series.pdf', 'ALL', '', 'PDF_SINGLE_FILE', 300)
```

- Pro 3.4 and later route:

```python
pdf = arcpy.mp.CreateExportFormat('PDF', r'C:\out\Series.pdf')
pdf.resolution = 300
opt = arcpy.mp.CreateExportOptions('MAPSERIES')
opt.setExportPages('ALL')                  # ALL, CURRENT, CUSTOM, SELECTED_INDEX_FEATURES
opt.setExportFileOptions('PDF_SINGLE_FILE')
ms.export(pdf, opt)
```

Sources: MP/mapseries-class.htm, MP/mapseriesexportoptions-class.htm, WN34

- The MapSeriesExportOptions page is inconsistent on names. The property text lists `PDF_MULTIPLE_FILES_PAGE_NAME` and `PDF_MULTIPLE_FILES_PAGE_NUMBER`. The `setExportFileOptions` parameter lists `MULTIPLE_FILES_PAGE_NAME` and `MULTIPLE_FILES_PAGE_NUMBER`. The property text names the setter `setFileExportOptions` and the method heading says `setExportFileOptions`. Which strings the method accepts is UNVERIFIED. Source: MP/mapseriesexportoptions-class.htm
- `MapSeries.export` supports PDF from 3.4 and PNG, JPEG, TIFF from 3.5. For other formats, loop pages and call `lyt.export`. Sources: WN35, MP/mapseries-class.htm

---

## 5. Creating a project without an existing .aprx

- Pro 3.7 adds `arcpy.mp.CreateArcGISProject(project_path, project_name, {create_parent_folder}, {home_folder}, {default_database}, {default_toolbox})`. It returns an ArcGISProject. Sources: MP/createarcgisproject.htm, WN37
- The page does not exist in the 3.6 documentation (HTTP 404), so the function is 3.7 and later. Source: https://pro.arcgis.com/en/pro-app/3.6/arcpy/mapping/createarcgisproject.htm
- `project_path` is the folder. `project_name` has no extension, `.aprx` is added. `create_parent_folder` default True (creates a folder named after the project). Defaults create a file geodatabase and an `.atbx` toolbox named after the project. Invalid paths raise an error and nothing is created. Source: MP/createarcgisproject.htm

```python
import arcpy
aprx = arcpy.mp.CreateArcGISProject(r"C:\Projects", "MtRainierNP")
aprx.save()
```

Source: MP/createarcgisproject.htm (example 2)

- Pro 3.3 to 3.6: no arcpy function creates a blank project. The documented pattern is to reference a blank template project on disk and save a copy: `p = arcpy.mp.ArcGISProject(r"C:\Projects\blank.aprx")`, then `p.saveACopy(new_path)`. Source: MP/arcgisproject-class.htm (example 1, "Reference a blank, template project on disk")
- `arcpy.mp.ArcGISProject(aprx_path)` takes the path of an existing `.aprx` or the keyword `CURRENT`. Source: MP/arcgisproject.htm
- `CURRENT` "only works from within an ArcGIS Pro application". It works in the Python window, a notebook, or a script tool. Sources: MP/arcgisproject.htm, MP/guidelines-for-arcpy-mapping.htm
- A project referenced more than once opens read-only after the first reference. Check `p.isReadOnly`, then use `saveACopy`. Source: MP/arcgisproject.htm
- `createMap` in a stand-alone script adds the Topographic basemap automatically. Inside the application it adds the project's default basemap. Remove it if the spec wants no basemap. Source: MP/arcgisproject-class.htm (createMap)
- `openView`, `closeViews`, `activeMap`, `activeView` have no effect or return None outside the application. Sources: MP/layout-class.htm, MP/arcgisproject-class.htm

---

## 6. Layer ordering, grouping, transparency, scale thresholds, reference scale

- `Map.moveLayer(reference_layer, move_layer, {insert_position})`. `insert_position`: `BEFORE` (default, above the reference) or `AFTER` (below). Both layers must be in the same map. It cannot move a layer into an empty group layer. Source: MP/map-class.htm
- `Map.createGroupLayer(name, {group_layer})`. Returns the new group Layer. It is created at the top of the contents. Pass `group_layer` to nest. Source: MP/map-class.htm
- Min version for `createGroupLayer`: Pro 3.0 (absent from the 2.9 Map page, present on the 3.0 page). Sources: https://pro.arcgis.com/en/pro-app/2.9/arcpy/mapping/map-class.htm and https://pro.arcgis.com/en/pro-app/3.0/arcpy/mapping/map-class.htm
- `Map.addLayerToGroup(target_group_layer, add_layer_or_layerfile, {add_position})`. `add_position`: `AUTO_ARRANGE` (default), `BOTTOM`, `TOP`. It is the only way to put a layer in an empty group. It adds a copy, so remove the original with `Map.removeLayer(layer)`. Source: MP/map-class.htm
- `Map.addLayer(add_layer_or_layerfile, {add_position})` returns a list of Layer objects. `Map.insertLayer(reference_layer, insert_layer_or_layerfile, {insert_position})` uses `BEFORE` or `AFTER`. Source: MP/map-class.htm
- `Map.addDataFromPath(data_path, {web_service_type}, {custom_parameters})` returns one Layer and places it by auto-arrange rules. Source: MP/map-class.htm

```python
grp = m.createGroupLayer('Roads')
m.addLayerToGroup(grp, lyr, 'BOTTOM')
m.removeLayer(lyr)
m.moveLayer(ref_lyr, grp, 'BEFORE')
```

Source: adapted from MP/map-class.htm

- `Layer.transparency`: integer 0 to 100. 0 is not transparent. Above 90 the layer usually does not draw. Source: MP/layer-class.htm
- `Layer.minThreshold`: the layer does not draw when zoomed out beyond this scale. `Layer.maxThreshold`: the layer does not draw when zoomed in beyond this scale. Both are doubles (scale denominators). Set 0 to clear. Source: MP/layer-class.htm
- `Layer.supports(...)` keywords include `TRANSPARENCY`, `MINTHRESHOLD`, `MAXTHRESHOLD`, `DEFINITIONQUERY`, `SHOWLABELS`, `SYMBOLOGY`. Source: MP/layer-class.htm
- `Map.referenceScale`: double, read and write. Set 0.0 to clear. Source: MP/map-class.htm
- Effect: a reference scale "fixes the size of symbols and text to the desired height and width at that scale". Symbols and text then grow and shrink as the map scale changes. With no reference scale, sizes stay constant. Source: https://pro.arcgis.com/en/pro-app/latest/help/mapping/properties/map-reference-scales.htm
- All feature symbology and labels scale by default. Per-layer opt out is the layer CIM property `scaleSymbols` (Boolean). Annotation and dimensions keep their own reference scales. Sources: same page, CIM/CIMVectorLayers.md#cimfeaturelayer
- Legend: `LegendElement.syncReferenceScale` makes legend patches match the map's reference-scale sizing. Source: MP/legendelement-class.htm
- Practical consequence: if the map frame scale equals the reference scale, symbols print at their nominal point sizes. At a frame scale of half the denominator they print twice as large.

---

## 7. Map frame camera, extent, spatial reference, dynamic text

### Camera

- `MapFrame.camera` returns a Camera. Properties: `scale` (double, 2D), `heading` (double), `X`, `Y`, `Z`, `pitch`, `roll`, `mode` (`MAP`, `GLOBAL`, `LOCAL`). Methods: `getExtent()`, `setExtent(extent)`. Source: MP/camera-class.htm
- `heading`: degrees the map data rotates, counterclockwise from north. Use a negative value to rotate clockwise. Source: MP/camera-class.htm
- `X` and `Y` are the center of the map frame for 2D maps. Source: MP/camera-class.htm
- `setExtent(extent)` takes an `arcpy.Extent`. Extent is derived from X, Y, and scale, and is not stored. Source: MP/camera-class.htm
- `MapFrame.getLayerExtent(layer, {selection_only}, {symbolized_extent})`. Both default to True. It honors the definition query. With no selection it returns the full layer extent. Source: MP/mapframe-class.htm
- Other navigation: `MapFrame.panToExtent(extent)` (keeps scale), `zoomToAllLayers({selection_only}, {symbolized_extent})`, `zoomToBookmark(bookmark)`. Source: MP/mapframe-class.htm

```python
mf.camera.setExtent(mf.getLayerExtent(lyr, False, True))
mf.camera.scale = mf.camera.scale * 1.1      # margin
mf.camera.scale = 24000                      # or a fixed scale
mf.camera.heading = 0
```

Source: MP/mapframe-class.htm (example 1)

- Extent from explicit coordinates: `mf.camera.setExtent(arcpy.Extent(xmin, ymin, xmax, ymax))`. The Esri sample passes a geometry's `.extent`. Whether a bare Extent needs a spatial reference that matches the map is UNVERIFIED. Source: MP/mapframe-class.htm
- `Map.defaultCamera` only affects newly opened views and newly inserted map frames. Source: MP/map-class.htm

### Map spatial reference

- `Map.spatialReference` is read and write and takes an `arcpy.SpatialReference`. Source: MP/map-class.htm
- Esri says to use this property and not the CIM, because a CIM edit of the wkid leaves transformations and extents inconsistent. Source: MP/python-cim-access.htm (example 1)

```python
m.spatialReference = arcpy.SpatialReference(2226)   # NAD83 California zone 2 (ftUS)
```

### Dynamic text tags (exact syntax)

Put these strings in a text element's `text`. Sources: https://pro.arcgis.com/en/pro-app/latest/help/layouts/add-and-modify-dynamic-text.htm (page title "Dynamic text tags") and https://pro.arcgis.com/en/pro-app/latest/help/layouts/use-dynamic-text-with-map-series.htm

- Map frame scale: `<dyn type="mapFrame" name="MapFrameName" property="scale" preStr="1:"/>`
- Scale at frame center: `<dyn type="mapFrame" name="MapFrameName" property="centerscale" preStr="1:"/>`
- Relative scale text: `1 centimeter equals <dyn type="mapFrame" name="Map Map Frame" property="scale" pageUnits="cm" mapUnits="km" pageValue="1" decimalPlaces="2"/> kilometers`
- Map frame name, map name: `property="name"`, `property="mapName"`
- Rotation: `<dyn type="mapFrame" name="MapFrameName" property="rotation"/>`
- Reference scale: `<dyn type="mapFrame" name="MapFrameName" property="referenceScale"/>`
- Map units: `<dyn type="mapFrame" name="MapFrameName" property="mapUnits"/>`
- Credits: `<dyn type="mapFrame" name="Map Frame" property="credits"/>`
- Coordinate system: `<dyn type="mapFrame" name="MapFrameName" property="sr" srProperty="name"/>`. Other `srProperty` values: `pcs`, `gcs`, `datum`, `projection`, `units`, `wkid`, `authority`, `central meridian`, `false easting`, `false northing`, `scale factor`.
- Frame coordinates: `<dyn type="mapFrame" name="MapFrameName" property="center" units="dms" decimalPlaces="0"/>`. Also `lowerLeft`, `upperRight`, `center.x`, and so on.
- Layout: `<dyn type="layout" name="LayoutName" property="name"/>`, `property="dateExported" format="short"`, `property="serviceLayerCredits"`, `property="pageSize" attribute="width"`
- Project: `<dyn type="project" property="name"/>`, `property="path"`, `property="dateSaved" format="short|short"`
- System: `<dyn type="date" format=""/>`, `<dyn type="time" format=""/>`, `<dyn type="user"/>`, `<dyn type="computer"/>`
- Map series page name: `<dyn type="page" property="name"/>`
- Map series page number: `<dyn type="page" property="number"/>`
- Page of count: `Page <dyn type="page" property="index"/> of <dyn type="page" property="count"/>`. `index` ignores the starting page number.
- Index attribute: `<dyn type="page" property="attribute" field="<Field Name>" domainlookup="true"/>`
- Common attributes: `preStr="..."`, `postStr="..."`, `emptyStr="..."`, `newLine="true"`, `decimalPlaces="2"`.
- The `name` attribute is the map frame's name when the tag was written. Renaming the frame later does not update the tag text. Create the map frame with its final name first. Source: add-and-modify-dynamic-text.htm
- Esri writes both `type="mapFrame"` and `type="mapframe"` on the same page, so the type value appears case-insensitive. Source: same page

```python
p.createTextElement(lyt, arcpy.Point(0.5, 0.4), 'POINT',
    'Scale <dyn type="mapFrame" name="Main Map Frame" property="scale" preStr="1:"/>',
    8, 'Arial', 'Regular', name='Scale Text')
```

---

## 8. Picture elements

- `ArcGISProject.createPictureElement(container, geometry, path, {name}, {lock_aspect_ratio})`. Returns PictureElement. Source: MP/arcgisproject-class.htm
- Min version: Pro 3.2. Source: WN32
- `container`: Layout, a graphics layer in a Map, or a GroupElement. `geometry`: Point or Polygon in page units for layouts. `path`: full path to the image. `lock_aspect_ratio` default True. False stretches the image to fill the envelope. Source: MP/arcgisproject-class.htm
- With a Point, the picture is added at full pixel size at the anchor. Resize with `elementWidth` and `elementHeight`. A non-rectangular polygon is replaced by its envelope. Source: MP/arcgisproject-class.htm
- `PictureElement.sourceImage` is read and write (swap the file path). Source: MP/pictureelement-class.htm
- WebP support was added at 3.5. `altText` was added at 3.7. Sources: WN35, WN37

```python
logo = p.createPictureElement(lyt, rect(0.5, 0.5, 1.5, 0.75), r'C:\Projects\logo.png', 'Logo')
```

Source: adapted from MP/pictureelement-class.htm (example 2)

---

## 9. Python toolbox (.pyt) essentials

- Template: class `Toolbox` with `label`, `alias`, `tools`. Each tool class has `__init__` (`label`, `description`), `getParameterInfo`, `isLicensed`, `updateParameters`, `updateMessages`, `execute(self, parameters, messages)`, `postExecute`. Source: https://pro.arcgis.com/en/pro-app/latest/arcpy/geoprocessing_and_python/a-template-for-python-toolboxes.htm
- Tool class name and toolbox alias must start with a letter and contain only letters and numbers. Source: same page
- Parameters: `arcpy.Parameter(displayName=, name=, datatype=, parameterType=, direction=)`. `parameterType`: `Required`, `Optional`, `Derived`. `direction`: `Input`, `Output`. Default value through `param.value`. Source: https://pro.arcgis.com/en/pro-app/latest/arcpy/geoprocessing_and_python/defining-parameters-in-a-python-toolbox.htm
- Datatype keywords: folder `DEFolder`, file `DEFile`, Boolean `GPBoolean`, string `GPString`, workspace `DEWorkspace`. Source: https://pro.arcgis.com/en/pro-app/latest/arcpy/geoprocessing_and_python/defining-parameter-data-types-in-a-python-toolbox.htm
- In `execute`, read values with `parameters[i].valueAsText`. Source: https://pro.arcgis.com/en/pro-app/latest/arcpy/geoprocessing_and_python/accessing-parameters-within-a-python-toolbox.htm
- Messages: `messages.addMessage(text)`, `addWarningMessage`, `addErrorMessage`, or `arcpy.AddMessage(message)`. Raise `arcpy.ExecuteError` to stop. Sources: https://pro.arcgis.com/en/pro-app/latest/arcpy/geoprocessing_and_python/writing-messages-in-a-python-toolbox.htm, https://pro.arcgis.com/en/pro-app/latest/arcpy/functions/addmessage.htm

```python
# -*- coding: utf-8 -*-
import arcpy

class Toolbox:
    def __init__(self):
        self.label = "Map Builder"
        self.alias = "mapbuilder"
        self.tools = [BuildMaps]

class BuildMaps:
    def __init__(self):
        self.label = "Build Maps"
        self.description = ""

    def getParameterInfo(self):
        folder = arcpy.Parameter(displayName="Spec Folder", name="spec_folder",
            datatype="DEFolder", parameterType="Required", direction="Input")
        export = arcpy.Parameter(displayName="Export PDFs", name="export_pdf",
            datatype="GPBoolean", parameterType="Optional", direction="Input")
        export.value = True
        prefix = arcpy.Parameter(displayName="Name Prefix", name="prefix",
            datatype="GPString", parameterType="Optional", direction="Input")
        return [folder, export, prefix]

    def isLicensed(self):
        return True

    def updateParameters(self, parameters):
        return

    def updateMessages(self, parameters):
        return

    def execute(self, parameters, messages):
        folder = parameters[0].valueAsText
        export = parameters[1].value          # Boolean
        prefix = parameters[2].valueAsText or ""
        arcpy.AddMessage(f"Building from {folder}")
        aprx = arcpy.mp.ArcGISProject("CURRENT")
        return

    def postExecute(self, parameters):
        return
```

- `parameters[1].value` returning a Python bool for GPBoolean is UNVERIFIED in these pages. `valueAsText` returns the strings `'true'` or `'false'`, also UNVERIFIED here. Test `str(p.valueAsText).lower() == 'true'` to be safe.

---

## 10. Layout export parameter lists

All `exportTo*` methods are "superseded by export at ArcGIS Pro 3.4" and remain for legacy scripts. Source: MP/layout-class.htm

### exportToPDF

`exportToPDF(out_pdf, {resolution}, {image_quality}, {compress_vector_graphics}, {image_compression}, {embed_fonts}, {layers_attributes}, {georef_info}, {jpeg_compression_quality}, {clip_to_elements}, {output_as_image}, {embed_color_profile}, {pdf_accessibility}, {keep_layout_background}, {convert_markers}, {simulate_overprint})`. Source: MP/layout-class.htm

| Parameter | Default | Values |
|---|---|---|
| resolution | 300 | dpi |
| image_quality | BEST | BEST, BETTER, NORMAL, FASTER, FASTEST |
| compress_vector_graphics | True | |
| image_compression | ADAPTIVE | ADAPTIVE, DEFLATE, JPEG, JPEG2000, LZW, NONE, RLE |
| embed_fonts | True | |
| layers_attributes | LAYERS_ONLY | LAYERS_ONLY, LAYERS_AND_ATTRIBUTES, NONE |
| georef_info | True | |
| jpeg_compression_quality | 80 | 1 to 100 |
| clip_to_elements | False | |
| output_as_image | False | |
| embed_color_profile | True | |
| pdf_accessibility | False | |
| keep_layout_background | True | |
| convert_markers | False | |
| simulate_overprint | False | |

### exportToSVG

`exportToSVG(out_svg, {resolution}, {compress_to_svgz}, {image_quality}, {embed_fonts}, {output_as_image}, {clip_to_elements}, {convert_markers})`. Source: MP/layout-class.htm

| Parameter | Default |
|---|---|
| resolution | 96 |
| compress_to_svgz | False |
| image_quality | BEST |
| embed_fonts | True |
| output_as_image | False |
| clip_to_elements | False |
| convert_markers | False |

### exportToAIX

`exportToAIX(out_aix, {resolution}, {image_quality}, {compress_vector_graphics}, {image_compression}, {jpeg_compression_quality}, {embed_fonts}, {embed_color_profile}, {clip_to_elements}, {keep_layout_background}, {convert_markers})`. Source: MP/layout-class.htm

| Parameter | Default |
|---|---|
| resolution | 300 |
| image_quality | BEST |
| compress_vector_graphics | True |
| image_compression | ADAPTIVE |
| jpeg_compression_quality | 80 |
| embed_fonts | True |
| embed_color_profile | True |
| clip_to_elements | False |
| keep_layout_background | False (PDF defaults to True) |
| convert_markers | False |

### exportToPNG (for reference)

`exportToPNG(out_png, {resolution}, {color_mode}, {transparent_background}, {embed_color_profile}, {clip_to_elements})`. Defaults: 96, `32-BIT_WITH_ALPHA`, False, True, False. Source: MP/layout-class.htm

### Pro 3.4 and later replacement

- `arcpy.mp.CreateExportFormat(format, {file_path})`. Formats: `AIX`, `BMP`, `EMF`, `EPS`, `GIF`, `JPEG`, `PDF`, `PNG`, `SVG`, `TGA`, `TIFF`. Then `Layout.export(export_format, {display_options})`. Sources: MP/createexportformat.htm, MP/layout-class.htm, WN34
- PDFFormat properties: `filePath`, `resolution`, `imageQuality` (set with `setImageQuality`), `imageCompression` (set with `setImageCompression`), `imageCompressionQuality`, `compressVectorGraphics`, `embedFonts`, `embedColorProfile`, `layersAndAttributes`, `georefInfo`, `clipToElements`, `outputAsImage`, `includeAccessibilityTags`, `removeLayoutBackground`, `convertMarkers`, `simulateOverprint`, `rasterAsSingleTile` (3.5), `title`, `author`, `subject`, `keywords`, `languageCode` (3.7). Sources: MP/pdfformat-class.htm, WN35, WN37
- PDFFormat default `resolution` is 96, not the 300 of `Layout.exportToPDF`. Esri samples say "change the resolution from its default value of 96" and `#Default is 96`. Set `pdf.resolution = 300` explicitly. Sources: MP/mapseries-class.htm (example 1), MP/pdfformat-class.htm (code sample)

```python
pdf = arcpy.mp.CreateExportFormat('PDF', r'C:\out\Layout.pdf')
pdf.resolution = 300
lyt.export(pdf)
```

---

## 11. GeoPackage layers and copying into a file geodatabase

- ArcGIS Pro reads SQLite databases and OGC GeoPackage files. A GeoPackage must have the `.gpkg` extension to be recognized. Source: https://pro.arcgis.com/en/pro-app/latest/help/data/databases/database-requirements-sqlite.htm
- Supported GeoPackage versions at Pro 3.7: 1.1 through 1.4. Source: same page
- Single-user connection only. Source: https://pro.arcgis.com/en/pro-app/latest/help/data/databases/work-with-sqlite-databases-in-arcgis-pro.htm
- Data can be added to a map and edited. Source: https://pro.arcgis.com/en/pro-app/latest/help/data/databases/databases-and-arcgis.htm
- Non-linear geometry (curves): Pro reads and displays approximated shapes and cannot create them. Source: database-requirements-sqlite.htm
- Metadata tables in the GeoPackage are not read by ArcGIS. Enumerations, ranges, GLOBs, and MIME types defined with SQL are not recognized. Source: same page
- Web layers that reference registered GeoPackage data cannot be published. Source: same page
- If ArcGIS cannot recognize a field's declared data type, the table cannot be accessed. Time-only and timestamp-offset fields are not supported in GeoPackage. Big integer and date-only are stored as integer and date. Source: https://pro.arcgis.com/en/pro-app/latest/help/data/databases/dbms-data-types-supported.htm
- The fields view cannot delete or rename a field in a GeoPackage table. Use the Alter Field and Delete Field tools. Field names with spaces or non-alphanumeric characters are discouraged. Source: work-with-sqlite-databases-in-arcgis-pro.htm
- Create one with `arcpy.management.CreateSQLiteDatabase('c:/data/example.gpkg', 'GEOPACKAGE_1.2')`. Spatial type values include `GEOPACKAGE`, `GEOPACKAGE_1.0` through `GEOPACKAGE_1.4`. Source: https://pro.arcgis.com/en/pro-app/latest/tool-reference/data-management/create-sqlite-database.htm
- UNVERIFIED in official docs: the path syntax `r'C:\data\file.gpkg\main.layername'`. No Esri documentation page states it. Esri Community threads show ArcGIS exposing GeoPackage tables with a `main.` prefix (SQLite's default schema name) and paths such as `temp_package.gpkg\main.temp_package_layer`. Sources: https://community.esri.com/t5/arcgis-pro-questions/geopackage-layer-name-adds-main-prefix/td-p/1083852 and https://community.esri.com/t5/python-questions/how-do-i-get-the-extent-of-tables-feature-classes/td-p/522584
- Safer than hard-coding: set `arcpy.env.workspace = gpkg_path` and call `arcpy.ListFeatureClasses()`, then join the returned names to the path. That this returns `main.`-prefixed names is community-sourced, UNVERIFIED in official docs.
- Layers added from a GeoPackage are named with the `main.` prefix. Rename with `lyr.name = ...` after `addDataFromPath`. Community-sourced, same thread.
- Copy Features "can read many feature formats (any you can add to a map) and write these to shapefile or geodatabase". `arcpy.management.CopyFeatures(in_features, out_feature_class)`. Source: https://pro.arcgis.com/en/pro-app/latest/tool-reference/data-management/copy-features.htm
- Project accepts "feature class, feature layer, feature dataset, scene layer, scene layer package, or OGC Geopackage" as input. `arcpy.management.Project(in_dataset, out_dataset, out_coor_system, {transform_method}, ...)`. Source: https://pro.arcgis.com/en/pro-app/latest/tool-reference/data-management/project.htm
- UNVERIFIED: whether "OGC Geopackage" as a Project input means a whole `.gpkg` file, one table inside it, or both. The page does not say more.
- A `.` is not valid in a file geodatabase feature class name, so strip `main.` when building the output name. Community-sourced, same thread.

```python
import os, arcpy
src = os.path.join(gpkg, 'main.roads')            # path form UNVERIFIED in official docs
out = os.path.join(gdb, 'roads')
arcpy.management.CopyFeatures(src, out)
# or reproject in one step
arcpy.management.Project(src, out, arcpy.SpatialReference(2226))
lyr = m.addDataFromPath(out)
```

---

## Version summary

| Item | Min Pro version | Source |
|---|---|---|
| `Map.createGroupLayer` | 3.0 | 2.9 and 3.0 Map class pages |
| `ArcGISProject.createMap`, `isReadOnly`, `copyItem`, `deleteItem` | 3.1 | 3.1 What's new |
| `createLayout`, `createMapFrame`, `createMapSurroundElement`, `createTextElement`, `createGraphicElement`, `createPictureElement`, `createGroupElement`, `createSpatialMapSeries`, `createBookmarkMapSeries`, `deleteElement`, `clipToIndexFeature` | 3.2 | WN32 |
| `listStyleItems` | 3.2 | 3.1 and 3.2 class pages |
| `createLabelClass`, LabelClass `getDefinition` and `setDefinition`, `applyStyleItem`, `updateStyles`, `styles`, `changePageSize`, `LEGEND_ITEM` and `TABLE_FRAME` style classes | 3.3 | WN33 |
| `CreateExportFormat`, `CreateExportOptions`, `export` methods, `lowerBound` on graduated renderers | 3.4 | WN34 |
| `DUAL_SCALE_BAR`, `isOverflowing`, map series export to PNG, JPEG, TIFF, type hints, WebP pictures | 3.5 | WN35 |
| `CreateArcGISProject`, `listStyleItems(key=)`, `StyleItem.key`, `MapSeries.currentPageName` and `type` | 3.7 | WN37 |
| `arcpy.cim.CreateCIMObjectFromClassName` | 2.5 | MP/python-cim-access.htm |
| Constructor-level `getDefinition` on more classes | 3.2 | MP/python-cim-access.htm |

## UNVERIFIED list

1. GeoPackage path syntax `file.gpkg\main.layername` and the `main.` prefix behavior (Esri Community only, no official doc page).
2. Scope of "OGC Geopackage" as a Project tool input.
3. Scale bar units through CIM (`units.uwkid` values and assignment form).
4. Label halo creation code (property names from CIM spec, no Esri sample).
5. Maplex line placement code through CIM (enum strings from spec, no Esri sample) and how to switch the label engine to Maplex.
6. Building CIMUniqueValueRenderer or CIMClassBreaksRenderer from scratch, and which properties Pro requires.
7. Per-item legend font through `itm.labelSymbol.symbol`.
8. Map series `rotationField` assignment through CIM (name from spec).
9. Style item names other than those quoted in section 1.
10. Which strings `MapSeriesExportOptions.setExportFileOptions` accepts (the page lists two forms).
11. `Parameter.value` type for GPBoolean in a .pyt.
12. Whether a bare `arcpy.Extent` passed to `camera.setExtent` needs a matching spatial reference.
13. Minimum version of the Symbology and renderer classes (predate 3.0, not confirmed from release notes).
