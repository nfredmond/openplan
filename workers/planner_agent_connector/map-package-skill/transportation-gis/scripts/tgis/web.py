"""The package website: index.html at the package root plus web/.

Opens from the file system with no server and no internet connection: Leaflet is
bundled and the layer data is written as JavaScript files, because a browser will
not fetch local JSON from a file:// page.
"""
from __future__ import annotations

import copy
import html
import json
import shutil
from pathlib import Path

from jinja2 import Template
from PIL import Image

from . import styles, svgsym, vec

ASSETS = Path(__file__).resolve().parents[2] / "assets"
Image.MAX_IMAGE_PIXELS = None

PAGE = Template(r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ p.title }}: maps and GIS package</title>
<link rel="stylesheet" href="web/vendor/leaflet.css">
<link rel="stylesheet" href="web/site.css">
</head>
<body>
<a class="skip" href="#figures">Skip to the figures</a>
<header class="top">
  <div class="wrap">
    <p class="eyebrow">{{ p.client }}{% if status %} <span class="status">{{ status }}</span>{% endif %}</p>
    <h1>{{ p.title }}</h1>
    <p class="lede">Maps and GIS package, {{ p.date_line }}. {{ n_maps }} figure{{ '' if n_maps == 1 else 's' }}{% if atlases %}, {{ atlases|length }} map book{{ '' if atlases|length == 1 else 's' }}{% endif %}, {{ n_layers }} data layer{{ '' if n_layers == 1 else 's' }}. Coordinate system: {{ crs.name }} (EPSG:{{ crs.epsg }}).</p>
    <nav aria-label="Sections">
      <a href="#figures">Figures</a>{% if atlases %}<a href="#mapbooks">Map books</a>{% endif %}<a href="#map">Interactive map</a><a href="#downloads">Downloads</a><a href="#sources">Data and sources</a><a href="#review">Review status</a><a href="#rebuild">Rebuild in GIS</a>
    </nav>
  </div>
</header>
<main class="wrap">
{% if notice %}<p class="notice">{{ notice }}</p>{% endif %}

<section id="figures">
  <h2>Figures</h2>
  <div class="cards">
  {% for m in maps %}
    <article class="card">
      <a href="{{ m.png }}"><img src="{{ m.thumb }}" alt="{{ m.alt }}" loading="lazy" width="{{ m.tw }}" height="{{ m.th }}"></a>
      <div class="meta">
        <p class="fig">{{ m.figure or 'Report figure' }} <span>{{ m.page }}</span></p>
        <h3>{{ m.title }}</h3>
        {% if m.subtitle %}<p class="sub">{{ m.subtitle }}</p>{% endif %}
        <p class="links">{% for label, href in m.links %}<a href="{{ href }}">{{ label }}</a>{% endfor %}</p>
        <p class="scale">{{ m.scale_text }}</p>
      </div>
    </article>
  {% endfor %}
  </div>
</section>

{% if atlases %}
<section id="mapbooks">
  <h2>Map books</h2>
  {% for a in atlases %}
  <article class="book">
    <div>
      <h3>{{ a.title }}</h3>
      <p>{{ a.pages }} sheets at {{ a.scale_text }}, {{ a.page }}.</p>
      <p class="links"><a href="{{ a.pdf }}">PDF map book</a></p>
    </div>
    <div class="sheets">{% for s in a.sheets %}<a href="{{ s }}"><img src="{{ s }}" alt="Sheet {{ loop.index }} of {{ a.title }}" loading="lazy"></a>{% endfor %}</div>
  </article>
  {% endfor %}
</section>
{% endif %}

<section id="map">
  <h2>Interactive map</h2>
  <p class="note">Every data layer in the package, drawn with the same symbols as the figures. Select a feature to read its attributes. The base map is part of the package and needs no connection; the OpenStreetMap option loads tiles from the internet.</p>
  <div class="mapwrap">
    <div id="lmap" role="application" aria-label="Interactive map of the package layers"></div>
    <aside id="legend" aria-label="Layers and legend"></aside>
  </div>
</section>

<section id="downloads">
  <h2>Downloads</h2>
  <table>
    <thead><tr><th scope="col">Item</th><th scope="col">What it is</th><th scope="col">File</th></tr></thead>
    <tbody>
    {% for d in downloads %}<tr><th scope="row">{{ d.name }}</th><td>{{ d.what }}</td><td>{% for label, href in d.links %}<a href="{{ href }}">{{ label }}</a>{% if not loop.last %} {% endif %}{% endfor %}</td></tr>
    {% endfor %}
    </tbody>
  </table>
</section>

<section id="sources">
  <h2>Data and sources</h2>
  <table>
    <thead><tr><th scope="col">Layer</th><th scope="col">Features</th><th scope="col">Source</th><th scope="col">Retrieved</th><th scope="col">Files</th></tr></thead>
    <tbody>
    {% for l in layers %}<tr><th scope="row">{{ l.title }}<br><code>{{ l.id }}</code></th><td>{{ l.count }} {{ l.kind }}{{ '' if l.count == 1 else 's' }}</td><td>{{ l.source }}{% if l.caveat %}<br><em>{{ l.caveat }}</em>{% endif %}</td><td>{{ l.retrieved }}</td><td>{% if l.geojson %}<a href="{{ l.geojson }}">GeoJSON</a>{% endif %}</td></tr>
    {% endfor %}
    </tbody>
  </table>
  <p class="note">Full notes: <a href="docs/figure_notes.md">figure notes</a>, <a href="docs/data_sources.md">data sources</a>, <a href="docs/data_dictionary.md">data dictionary</a>, <a href="qa/qa_report.md">quality checks</a>.</p>
</section>

<section id="review">
  <h2>Review status</h2>
  <p class="note">{{ 'Every gate below has passed on these figures.' if review.release_ready else 'This is a review package, not a release. A build that ran is not a reviewed package: each gate below is passed only when someone has looked and recorded evidence.' }}</p>
  <table>
    <thead><tr><th scope="col">Gate</th><th scope="col">What it means</th><th scope="col">Status</th><th scope="col">Reviewer and date</th></tr></thead>
    <tbody>
    {% for g in review.gates %}<tr><th scope="row">{{ g.gate.replace('_', ' ') }}</th><td>{{ g.what }}</td><td>{{ g.status }}</td><td>{{ g.reviewer }} {{ g.date }}</td></tr>
    {% endfor %}
    </tbody>
  </table>
  {% if review.blockers %}<details><summary>Open items before release ({{ review.blockers|length }})</summary><ul>{% for b in review.blockers %}<li>{{ b }}</li>{% endfor %}</ul></details>{% endif %}
</section>

<section id="rebuild">
  <h2>Rebuild in GIS and design software</h2>
  <div class="cols">
    <div><h3>QGIS</h3><p>Open <a href="{{ qgz }}"><code>{{ qgz }}</code></a> in QGIS 3.34 or later. Each figure has a layer group, a map theme and a print layout. <a href="qgis/README.md">QGIS notes</a>.</p></div>
    <div><h3>ArcGIS Pro</h3><p>Add <code>arcgis/Build_Maps.pyt</code> as a toolbox in ArcGIS Pro 3.3 or later and run it. It builds the project, geodatabase and layouts on that computer. <a href="arcgis/README.md">ArcGIS Pro notes</a>.</p></div>
    <div><h3>Adobe Illustrator</h3><p>Run <code>illustrator/Open_Maps_In_Illustrator.jsx</code> to open each SVG with named layers and live type. <a href="illustrator/README.md">Illustrator notes</a>.</p></div>
    <div><h3>Google Earth</h3><p>Open <a href="{{ kmz }}"><code>{{ kmz }}</code></a> in Google Earth Pro or Google Earth on the web.</p></div>
  </div>
  <p class="note">An AI agent can do the ArcGIS Pro and QGIS builds from the instructions in <a href="AGENTS.md"><code>AGENTS.md</code></a>.</p>
  <h3>Rebuild from the original sources</h3>
  <p class="note">The package holds every original download it was built from (<code>source/cache</code>, with <code>provenance.json</code>), the project specification (<code>source/project.yaml</code>) and the kit that built it (<code>tools/</code>). On a computer with QGIS 3.34 or later, with no internet connection needed: <code>python3 tools/transportation-gis/scripts/tgis.py build source --offline</code>. The result of the last offline rebuild test is in <a href="qa/rebuild_check.json"><code>qa/rebuild_check.json</code></a>.</p>
</section>

<section id="files">
  <h2>Every file</h2>
  <details><summary>Browse all {{ inventory|length }} files</summary><ul class="inv">{% for f in inventory %}<li><a href="{{ f.href }}">{{ f.path }}</a> <span>{{ f.size }}</span></li>{% endfor %}</ul></details>
</section>

</main>
<footer class="wrap foot">
  <p>{{ p.client }}{% if p.prepared_by %}. Prepared by {{ p.prepared_by }}{% endif %}. {{ p.date_line }}. Base map data &copy; OpenStreetMap contributors, available under the Open Database License.</p>
</footer>
<script src="web/vendor/leaflet.js"></script>
<script>var TGIS = {{ config }}; var TGIS_DATA = {};</script>
{% for s in scripts %}<script src="{{ s }}"></script>
{% endfor %}<script src="web/app.js"></script>
</body>
</html>
""")

CSS = r"""
@font-face{font-family:"Inter";src:url("../fonts/inter/Inter-Regular.otf") format("opentype");font-weight:400;font-display:swap}
@font-face{font-family:"Inter";src:url("../fonts/inter/Inter-Medium.otf") format("opentype");font-weight:500;font-display:swap}
@font-face{font-family:"Inter";src:url("../fonts/inter/Inter-SemiBold.otf") format("opentype");font-weight:600;font-display:swap}
:root{--ink:#1f2d35;--muted:#5b6970;--rule:#d5dbdd;--paper:#ffffff;--wash:#f5f4ef;--accent:ACCENT}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper);font-size:16px;line-height:1.5}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:#fff;padding:8px 12px;z-index:2000}
a{color:var(--accent);text-underline-offset:2px}
.top{background:var(--wash);border-top:6px solid var(--accent);border-bottom:1px solid var(--rule);padding:34px 0 0}
.eyebrow{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 6px}
.status{background:var(--ink);color:#fff;border-radius:3px;padding:2px 7px;margin-left:8px;font-size:11px;letter-spacing:.06em}
h1{font-size:38px;line-height:1.12;margin:0 0 10px;font-weight:600;letter-spacing:-.01em;max-width:22ch}
.lede{color:var(--muted);max-width:74ch;margin:0 0 22px}
nav{display:flex;flex-wrap:wrap;gap:4px 22px;border-top:1px solid var(--rule);padding:12px 0}
nav a{font-weight:500;font-size:14.5px;text-decoration:none;color:var(--ink)}
nav a:hover{color:var(--accent);text-decoration:underline}
section{padding:40px 0 8px}
h2{font-size:24px;font-weight:600;margin:0 0 18px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
h3{font-size:17px;font-weight:600;margin:0 0 4px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:22px}
.card{border:1px solid var(--rule);border-radius:4px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.card img{display:block;width:100%;height:auto;background:var(--wash);border-bottom:1px solid var(--rule)}
.meta{padding:14px 16px 16px}
.fig{font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin:0 0 4px;display:flex;justify-content:space-between}
.fig span{color:var(--muted);font-weight:400;letter-spacing:0;text-transform:none}
.sub,.scale{color:var(--muted);font-size:14px;margin:2px 0 0}
.links{margin:10px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.links a{font-size:13px;font-weight:500;border:1px solid var(--rule);border-radius:3px;padding:3px 9px;text-decoration:none}
.links a:hover{border-color:var(--accent);background:var(--wash)}
.book{display:grid;grid-template-columns:260px 1fr;gap:22px;align-items:start;margin-bottom:18px}
.sheets{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.sheets img{width:100%;height:auto;border:1px solid var(--rule);display:block}
.note{color:var(--muted);font-size:14.5px;max-width:86ch}
.mapwrap{display:grid;grid-template-columns:1fr 290px;border:1px solid var(--rule);border-radius:4px;overflow:hidden;height:620px}
#lmap{height:100%;background:var(--wash)}
#legend{border-left:1px solid var(--rule);padding:14px 16px;overflow:auto;font-size:13.5px}
#legend h4{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px}
#legend h4:first-child{margin-top:0}
#legend label{display:flex;align-items:flex-start;gap:8px;font-weight:600;margin:10px 0 3px;cursor:pointer}
#legend .row{display:flex;align-items:center;gap:8px;margin:2px 0 2px 24px;color:var(--ink)}
#legend .row svg{flex:0 0 auto}
#legend .count{color:var(--muted);font-weight:400}
table{width:100%;border-collapse:collapse;font-size:14.5px}
th,td{text-align:left;vertical-align:top;padding:9px 12px 9px 0;border-bottom:1px solid var(--rule)}
thead th{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600}
tbody th{font-weight:600}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;color:var(--muted);font-weight:400}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px;margin-bottom:14px}
.cols p{font-size:14.5px;margin:0}
.foot{color:var(--muted);font-size:13px;border-top:1px solid var(--rule);margin-top:44px;padding-top:16px;padding-bottom:40px}
.leaflet-popup-content{font-family:"Inter",system-ui,sans-serif;font-size:13px;margin:12px 14px}
.leaflet-popup-content h5{margin:0 0 6px;font-size:14px}
.leaflet-popup-content table{font-size:12.5px}
.leaflet-popup-content th,.leaflet-popup-content td{padding:2px 10px 2px 0;border:0}
.leaflet-popup-content th{color:var(--muted);font-weight:500}
.tgis-pt{background:none;border:0}
.notice{border-left:4px solid #b65032;background:#fff7f1;padding:12px 18px;margin:22px 0 0;max-width:none}
details{margin:14px 0}summary{cursor:pointer;font-weight:500}
.inv{columns:2;font-size:13px;padding-left:18px}.inv li{break-inside:avoid;overflow-wrap:anywhere}.inv span{color:var(--muted)}
@media (max-width:820px){.mapwrap{grid-template-columns:1fr;height:auto}#lmap{height:440px}#legend{border-left:0;border-top:1px solid var(--rule)}.book{grid-template-columns:1fr}h1{font-size:30px}}
@media print{nav,.mapwrap,.skip{display:none}}
"""

APP_JS = r"""
(function () {
  var b = TGIS.bbox;
  var map = L.map('lmap', {zoomSnap: 0.25, scrollWheelZoom: false, preferCanvas: false}).fitBounds([[b[1], b[0]], [b[3], b[2]]]);
  map.on('click', function () { map.scrollWheelZoom.enable(); });
  map.attributionControl.setPrefix(false).addAttribution('Base data &copy; OpenStreetMap contributors');
  L.control.scale({metric: false}).addTo(map);
  function pane(name, z) { map.createPane(name); map.getPane(name).style.zIndex = z; return name; }
  pane('base', 300); pane('fills', 350); pane('casing', 395); pane('lines', 400); pane('points', 450);

  function symFor(layer, props) {
    var r = layer.renderer;
    if (r.type === 'simple') return r.symbol;
    var v = props[r.field];
    if (r.type === 'categorized') {
      for (var i = 0; i < r.classes.length; i++) {
        var vals = r.classes[i].values;
        for (var j = 0; j < vals.length; j++) if (String(vals[j]) === String(v)) return r.classes[i].symbol;
      }
      return r.other ? r.other.symbol : null;
    }
    if (v === null || v === undefined) return r.nodata ? r.nodata.symbol : null;
    for (var k = 0; k < r.classes.length; k++) {
      var c = r.classes[k];
      if ((c.min === null || v >= c.min) && (c.max === null || v < c.max)) return c.symbol;
    }
    return null;
  }
  var S = 1.35;  // points to screen pixels
  function pathStyle(s, casing) {
    if (!s) return {opacity: 0, fillOpacity: 0};
    if (s.kind === 'line') {
      if (casing) return {color: s.casing, weight: s.casing_width * S, opacity: 1, lineCap: 'round'};
      return {color: s.color, weight: s.width * S, opacity: s.opacity === undefined ? 1 : s.opacity,
              dashArray: s.dash ? s.dash.map(function (d) { return d * S; }).join(' ') : null, lineCap: s.dash ? 'butt' : 'round'};
    }
    return {fillColor: s.fill || '#000', fillOpacity: s.fill ? (s.fill_opacity === undefined ? 1 : s.fill_opacity) * 0.85 : (s.hatch ? 0.12 : 0),
            color: s.stroke || (s.hatch ? s.hatch.color : '#000'), weight: s.stroke ? s.stroke_width * S : (s.hatch ? 1 : 0), opacity: 1,
            dashArray: s.stroke_dash ? s.stroke_dash.map(function (d) { return d * S; }).join(' ') : null};
  }
  function popup(layer, props) {
    var keys = layer.popup || Object.keys(props);
    var rows = keys.filter(function (k) { return props[k] !== null && props[k] !== undefined && props[k] !== ''; }).slice(0, 14).map(function (k) {
      var v = props[k]; if (typeof v === 'number' && !Number.isInteger(v)) v = Math.round(v * 100) / 100;
      return '<tr><th>' + k + '</th><td>' + String(v).replace(/</g, '&lt;') + '</td></tr>'; }).join('');
    return '<h5>' + layer.title + '</h5><table>' + rows + '</table>';
  }
  var legend = document.getElementById('legend');
  function heading(t) { var h = document.createElement('h4'); h.textContent = t; legend.appendChild(h); }
  function addToggle(title, count, lyr, on, rows) {
    var lab = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = on;
    cb.addEventListener('change', function () { if (cb.checked) lyr.addTo(map); else map.removeLayer(lyr); });
    lab.appendChild(cb);
    var sp = document.createElement('span'); sp.innerHTML = title + (count === null ? '' : ' <span class="count">(' + count + ')</span>'); lab.appendChild(sp);
    legend.appendChild(lab);
    (rows || []).forEach(function (r) { var d = document.createElement('div'); d.className = 'row'; d.innerHTML = r.svg + '<span>' + r.label + '</span>'; legend.appendChild(d); });
    if (on) lyr.addTo(map);
  }

  // Base map from the package
  var base = L.layerGroup();
  (TGIS.base || []).forEach(function (bl) {
    L.geoJSON(TGIS_DATA[bl.id], {pane: 'base', interactive: false, style: function (f) {
      if (bl.field) { var st = bl.styles[f.properties[bl.field]]; return st || {opacity: 0, fillOpacity: 0}; }
      return bl.style; }}).addTo(base);
  });
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', opacity: 0.75});
  heading('Base map');
  addToggle('Package base map', null, base, true);
  addToggle('OpenStreetMap tiles (online)', null, osm, false);

  heading('Data layers');
  TGIS.layers.forEach(function (layer) {
    var data = TGIS_DATA[layer.id]; if (!data) return;
    var group = L.layerGroup();
    var isLine = layer.kind === 'line', isPoint = layer.kind === 'point';
    if (isLine) L.geoJSON(data, {pane: 'casing', interactive: false, filter: function (f) { var s = symFor(layer, f.properties); return s && s.casing; },
      style: function (f) { return pathStyle(symFor(layer, f.properties), true); }}).addTo(group);
    L.geoJSON(data, {
      pane: isPoint ? 'points' : isLine ? 'lines' : 'fills',
      style: function (f) { return pathStyle(symFor(layer, f.properties)); },
      pointToLayer: function (f, ll) {
        var s = symFor(layer, f.properties) || layer.fallback; var px = Math.max(s.size * S * 1.25, 9) + 4;
        return L.marker(ll, {pane: 'points', icon: L.divIcon({className: 'tgis-pt', iconSize: [px, px], iconAnchor: [px / 2, px / 2], html: s.icon || ''})});
      },
      onEachFeature: function (f, l) { l.bindPopup(function () { return popup(layer, f.properties); }); }
    }).addTo(group);
    addToggle(layer.title, data.features.length, group, layer.on, layer.legend);
  });
})();
"""


def _thumb(src, dst, width=900):
    im = Image.open(src).convert("RGB")
    h = int(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "JPEG", quality=86, optimize=True)
    return width, h


def _icon_svg(s):
    px = max(s["size"] * 1.35 * 1.25, 9) + 4
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{px:.0f}" height="{px:.0f}" viewBox="0 0 {px:.0f} {px:.0f}">{svgsym.marker_svg(s, 1.35 * 1.25, px / 2, px / 2)}</svg>'


def _all_symbols(r):
    if r["type"] == "simple":
        return [r["symbol"]]
    out = [c["symbol"] for c in r["classes"]]
    for k in ("other", "nodata"):
        if r.get(k):
            out.append(r[k]["symbol"])
    return out


def build(pkg_dir, package, review=None, log=print):
    pkg = Path(pkg_dir)
    web = pkg / "web"
    (web / "data").mkdir(parents=True, exist_ok=True)
    shutil.copytree(ASSETS / "vendor", web / "vendor", dirs_exist_ok=True)
    epsg = package["crs"]["epsg"]
    tol = 3.0 / package["crs"]["meters_per_unit"]      # about 3 m: invisible on a web map, much smaller files
    scripts, layers = [], []
    prov = package.get("provenance", {})
    table = []
    (pkg / "data" / "geojson").mkdir(parents=True, exist_ok=True)

    for lid, info in package["data"].items():
        if "renderer" not in info:
            continue
        feats, _, _ = vec.read(pkg / info["file"], info["layer"])
        vec.to_geojson(feats, epsg, pkg / "data" / "geojson" / f"{lid}.geojson", precision=7)
        fc = vec.to_geojson(feats, epsg, None, precision=6, simplify_m=tol if info["kind"] != "point" else None)
        (web / "data" / f"{lid}.js").write_text(f"TGIS_DATA[{json.dumps(lid)}]=" + json.dumps(fc, separators=(",", ":")) + ";", encoding="utf-8")
        scripts.append(f"web/data/{lid}.js")
        r = copy.deepcopy(info["renderer"])
        groups = styles.legend_groups([{"id": lid, "title": info["title"], "renderer": r, "legend": True}])
        legend = [{"label": html.escape(it["label"]), "svg": svgsym.swatch(it["symbol"])} for g in groups for it in g["items"]]
        fallback = {"kind": "point", "marker": "circle", "size": 4, "fill": "#8a979e", "stroke": "#ffffff", "stroke_width": 0.5}
        if info["kind"] == "point":
            for s in _all_symbols(r) + [fallback]:
                s["icon"] = _icon_svg(s)      # each point symbol carries its own inline SVG marker
        layers.append({"id": lid, "title": html.escape(info["title"]), "kind": info["kind"], "renderer": r, "legend": legend,
                       "popup": info.get("popup"), "fallback": fallback,
                       # A filled area layer would hide the base map and the other layers on first view; start with it off.
                       "on": not (info["kind"] == "polygon" and any(s.get("fill") for s in _all_symbols(r)))})
    # Thematic polygons under lines under points, as on the figures.
    layers.sort(key=lambda l: {"point": 0, "line": 1, "polygon": 2}[l["kind"]])

    for lid, info in package["data"].items():
        pr = prov.get(lid) or next((v for k, v in prov.items() if k.startswith(lid + " (")), None) or {}
        if lid.startswith(("base_", "region_")) or lid in ("study_mask",) or lid.startswith("atlas_"):
            continue
        src = pr.get("publisher") or info.get("credit") or "See docs/data_sources.md"
        if pr.get("dataset"):
            src += ", " + pr["dataset"]
        table.append({"id": lid, "title": info.get("title", lid), "count": info["count"], "kind": info["kind"] if info["kind"] != "line" else "line",
                      "source": src, "caveat": pr.get("caveat", ""), "retrieved": pr.get("retrieved", ""),
                      "geojson": f"data/geojson/{lid}.geojson" if "renderer" in info else ""})

    # Package base map for the web view: land, water, parks, main roads, study area.
    base = []
    if "base_roads" in package["data"]:
        def dump(bid, file, layer, where=None, keep=None, simp=tol):
            feats, _, _ = vec.read(pkg / file, layer, where)
            fc = vec.to_geojson(feats, epsg, None, precision=5, simplify_m=simp, keep=keep or [])
            (web / "data" / f"{bid}.js").write_text(f"TGIS_DATA[{json.dumps(bid)}]=" + json.dumps(fc, separators=(",", ":")) + ";", encoding="utf-8")
            scripts.append(f"web/data/{bid}.js")
        dump("_parks", "data/base.gpkg", "parks")
        base.append({"id": "_parks", "style": {"fillColor": "#dde8d0", "fillOpacity": 1, "weight": 0}})
        dump("_water", "data/base.gpkg", "water")
        base.append({"id": "_water", "style": {"fillColor": "#cddde6", "fillOpacity": 1, "color": "#a9c4d2", "weight": 0.6}})
        dump("_roads", "data/base.gpkg", "roads", "road_class <> 'service'", keep=["road_class"])
        base.append({"id": "_roads", "field": "road_class", "styles": {
            "freeway": {"color": "#e3c66f", "weight": 4}, "highway": {"color": "#e6d39a", "weight": 3.2}, "major": {"color": "#b7bfbc", "weight": 2.6},
            "arterial": {"color": "#bcc4c1", "weight": 2.2}, "collector": {"color": "#c6ccc9", "weight": 1.6}, "ramp": {"color": "#e3c66f", "weight": 1.4},
            "local": {"color": "#d3d8d4", "weight": 1}}})
    feats, _, _ = vec.read(pkg / "data" / "project.gpkg", "study_area")
    fc = vec.to_geojson(feats, epsg, None, precision=6)
    (web / "data" / "_study.js").write_text('TGIS_DATA["_study"]=' + json.dumps(fc, separators=(",", ":")) + ";", encoding="utf-8")
    scripts.append("web/data/_study.js")
    base.append({"id": "_study", "style": {"fillOpacity": 0, "color": "#2b3a42", "weight": 2, "dashArray": "9 3 2 3"}})

    maps = []
    for m in package["maps"]:
        png = pkg / "maps" / "png" / f"{m['id']}.png"
        if not png.exists():
            continue
        tw, th = _thumb(png, web / "thumbs" / f"{m['id']}.jpg")
        links = [(lab, f"maps/{d}/{m['id']}.{ext}") for lab, d, ext in (("PDF", "pdf", "pdf"), ("PNG", "png", "png"), ("SVG, live type", "svg", "svg"), ("SVG, outlined", "svg_outlined", "svg"))
                 if (pkg / "maps" / d / f"{m['id']}.{ext}").exists()]
        maps.append({"id": m["id"], "figure": m.get("figure"), "title": m["title"], "subtitle": m.get("subtitle"),
                     "alt": m.get("alt") or f"{m['title']}. Map.", "png": f"maps/png/{m['id']}.png", "thumb": f"web/thumbs/{m['id']}.jpg", "tw": tw, "th": th,
                     "links": links, "scale_text": m["scale_text"], "page": f"{m['page']['w']:g} by {m['page']['h']:g} in"})
    atlases = []
    for a in package.get("atlases", []):
        if not (pkg / "atlas" / f"{a['id']}.pdf").exists():
            continue
        sheets = sorted(p.relative_to(pkg).as_posix() for p in (pkg / "atlas" / "sheets").glob(f"{a['id']}_*.png"))
        atlases.append({"title": a["title"], "pages": len(a["atlas"]["pages"]), "scale_text": a["scale_text"], "pdf": f"atlas/{a['id']}.pdf",
                        "sheets": sheets, "page": f"{a['page']['w']:g} by {a['page']['h']:g} in"})

    pid = package["project"]["id"]
    downloads = []

    def dl(name, what, links):
        # The manifest and the ZIP are written after this page, at the very end of the build.
        links = [(lab, href) for lab, href in links if (pkg / href).exists() or href.startswith("../") or href == "MANIFEST.sha256"]
        if links:
            downloads.append({"name": name, "what": what, "links": links})
    dl("All figures", "One PDF with a cover, a list of figures and every figure in order.", [("PDF", f"atlas/{pid}_figures.pdf")])
    dl("GIS data", f"GeoPackages in {package['crs']['name']}. Open in QGIS or ArcGIS Pro.", [("project.gpkg", "data/project.gpkg"), ("base.gpkg", "data/base.gpkg"), ("region.gpkg", "data/region.gpkg")])
    dl("QGIS project", "Layers, symbols, labels, map themes and print layouts for every figure.", [(f"{pid}.qgz", f"qgis/{pid}.qgz"), ("Notes", "qgis/README.md")])
    dl("ArcGIS Pro builder", "Python toolbox and script that build the project, geodatabase and layouts in ArcGIS Pro.", [("Build_Maps.pyt", "arcgis/Build_Maps.pyt"), ("Notes", "arcgis/README.md"), ("Agent instructions", "arcgis/AGENT_PROMPT.md")])
    dl("Adobe Illustrator kit", "Script that opens the SVG figures with named layers, plus colour swatches.", [("Script", "illustrator/Open_Maps_In_Illustrator.jsx"), ("Swatches", f"illustrator/{pid}_swatches.ase"), ("Notes", "illustrator/README.md")])
    dl("Google Earth", "All data layers with the figure symbols and attribute pop-ups.", [("KMZ", f"google-earth/{pid}.kmz")])
    dl("Map specification", "The single description of every map that all builders read.", [("map_package.json", "spec/map_package.json"), ("project.yaml", "spec/project.yaml")])
    dl("Original sources and rebuild kit", "Every original download with its provenance, the project specification and the kit, for an offline rebuild.",
       [("project.yaml", "source/project.yaml"), ("provenance.json", "source/cache/provenance.json"), ("Kit", "tools/transportation-gis/SKILL.md"), ("Rebuild test", "qa/rebuild_check.json")])
    dl("Fonts", "Inter, SIL Open Font License. Install before opening the QGIS or ArcGIS Pro project.", [("Folder", "fonts/inter/"), ("Licence", "fonts/inter/LICENSE_OFL.txt")])
    dl("Checksums", "SHA-256 of every file in the package.", [("MANIFEST.sha256", "MANIFEST.sha256")])
    dl("Everything", "The whole package in one ZIP, for moving to another computer.", [("ZIP", f"../{pkg.name}.zip")])

    accent = (package.get("brand") or {}).get("accent", "#1f5673")
    (web / "site.css").write_text(CSS.replace("ACCENT", accent), encoding="utf-8")
    (web / "app.js").write_text(APP_JS, encoding="utf-8")
    status = (package["project"].get("status") or "").strip()
    cfg = {"bbox": package["study_area"]["bbox_4326"], "layers": layers, "base": base}
    from urllib.parse import quote
    inventory = []
    for f in sorted(pkg.rglob("*")):
        if f.is_file() and "__pycache__" not in f.parts and "arcgis/native" not in f.as_posix():
            rel = f.relative_to(pkg).as_posix()
            inventory.append({"path": rel, "href": quote(rel), "size": f"{f.stat().st_size / 1024:,.0f} KB"})
    proj = package["project"]
    notice = proj.get("notice") or ("Practice package. Some content is hypothetical or unverified; see the figure notes. Not for decisions, applications or publication." if proj.get("practice") else "")
    review = review or {"gates": [], "blockers": [], "release_ready": False}
    page = PAGE.render(inventory=inventory, notice=notice, review=review, p=package["project"], crs=package["crs"], maps=maps, atlases=atlases, layers=table, downloads=downloads,
                       n_maps=len(maps), n_layers=len(table), status=status.upper() if status and status.lower() != "final" else "",
                       scripts=scripts, config=json.dumps(cfg, separators=(",", ":")), qgz=f"qgis/{pid}.qgz", kmz=f"google-earth/{pid}.kmz")
    (pkg / "index.html").write_text(page, encoding="utf-8")
    log(f"  website: index.html with {len(maps)} figures and {len(layers)} interactive layers")
    return {"figures": len(maps), "layers": len(layers)}
