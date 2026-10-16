import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
app = root / 'openplan'
proof = Path(__file__).resolve().parent
map_file = app / 'src/components/projects/project-saved-map.tsx'
panel_file = app / 'src/app/(app)/projects/[projectId]/_components/project-map-presence-panel.tsx'
owned = [map_file, panel_file]
originals = {p: p.read_text() for p in owned}
records = []

def run(name, pattern=None):
    output = proof / (name + '.json')
    command = [str(app / 'node_modules/.bin/vitest'), 'run', 'src/test/project-saved-map.test.tsx', '--maxWorkers=1', '--no-file-parallelism', '--cache=false', '--reporter=json', '--outputFile=' + str(output)]
    if pattern:
        command += ['--testNamePattern', pattern]
    completed = subprocess.run(command, cwd=app, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=45)
    (proof / (name + '.log')).write_text(completed.stdout)
    report = json.loads(output.read_text())
    assertions = [a for f in report['testResults'] for a in f['assertionResults']]
    failed = [a for a in assertions if a['status'] == 'failed']
    record = {'name': name, 'exit': completed.returncode, 'passed': sum(a['status'] == 'passed' for a in assertions), 'failed': [{'name': a['fullName'], 'messages': a['failureMessages']} for a in failed]}
    records.append(record)
    if pattern:
        assert completed.returncode != 0 and failed, record
        assert all(pattern in a['fullName'] and a['failureMessages'] for a in failed), record
        assert not report.get('numRuntimeErrorTestSuites'), record
        print(name + ': KILLED by ' + str(len(failed)) + ' intended assertions', flush=True)
    else:
        assert completed.returncode == 0 and not failed and record['passed'] == 21, record
        print(name + ': SURVIVED, 21 passed', flush=True)

def mutation(name, path, old, new, pattern):
    try:
        assert originals[path].count(old) == 1, (name, originals[path].count(old))
        path.write_text(originals[path].replace(old, new))
        run(name, pattern)
    finally:
        for p, original in originals.items():
            p.write_text(original)

try:
    run('baseline')
    mutation('harmless-comment', map_file, 'Draw the validated project-record features', 'Display the validated project-record features', None)
    mutation('missing-site', panel_file, 'if (packageInventory.layers[1].featureCount > 0)', 'if (false)', "draws the inventory's exact three geometries")
    mutation('drop-saved-holes', panel_file, 'geometry: area, properties:', 'geometry: area.type === "MultiPolygon" ? { ...area, coordinates: area.coordinates.map((polygon) => [polygon[0]]) } : area, properties:', "draws the inventory's exact three geometries")
    mutation('wrong-area-filter', map_file, 'id: `${SOURCE}-area`, type: "fill", source: SOURCE, filter: ["==", ["geometry-type"], "Polygon"]', 'id: `${SOURCE}-area`, type: "fill", source: SOURCE, filter: ["==", ["geometry-type"], "LineString"]', "draws the inventory's exact three geometries")
    mutation('pending-corridors-hide-map', panel_file, '<ProjectSavedMap collection={{ type: "FeatureCollection", features: savedFeatures }} />', '{!corridorsPending && <ProjectSavedMap collection={{ type: "FeatureCollection", features: savedFeatures }} />}', 'keeps the saved area and site')
    mutation('invalid-area-bypass', panel_file, 'if (packageInventory.layers[0].featureCount > 0)', 'if (projectAreaGeometry != null)', 'reports invalid saved shapes')
    mutation('drop-global-site', panel_file, 'if (packageInventory.layers[1].featureCount > 0)', 'if (false)', 'retains a valid site')
    mutation('hide-unconfigured-notice', map_file, 'if (MAP_ENGINE.kind === "none" || cannotStart) {', 'if (MAP_ENGINE.kind === "none") return null;\n  if (cannotStart) {', 'keeps inventory and download access')
    mutation('ignore-late-mount', map_file, '}, [hasFeatures, cannotStart]);', '}, []);', 'draws late geometry')
    mutation('stale-style-data', map_file, 'latestCollectionRef.current = collection;', '// Do not update retained geometry.', 'uses the newest geometry')
    mutation('skip-source-refresh', map_file, 'if (source) source.setData(current);', 'if (source) void current;', 'replaces removed features')
    mutation('skip-style-recovery', map_file, 'map.on("style.load", schedulePaint);', '// No style-reload repaint.', 'repaints saved layers')
    mutation('leak-pending-paint', map_file, 'schedulePaintRef.current = null;\n        cancelPaint();', 'schedulePaintRef.current = null;\n        // Leave pending paint active.', 'cancels pending paint')
    mutation('skip-sizing', map_file, 'stopSizing = keepMapSizedToContainer(map, container);', 'stopSizing = () => {};', 'resizes its actual container')
    mutation('skip-visible-framing', map_file, 'map.on("resize", schedulePaint);', '// No framing after a hidden tab opens.', 'resizes its actual container')
    mutation('fit-hidden-container', map_file, 'framedCollection !== current && container.clientWidth > 0 && container.clientHeight > 0', 'framedCollection !== current', 'resizes its actual container')
    mutation('stale-async-data', map_file, 'latestCollectionRef.current = collection;', '// Do not update retained geometry.', 'uses latest saved geometry after asynchronous')
    mutation('leak-async-build', map_file, 'return startMap(MAP_ENGINE, mapboxgl, (gl) => {', 'startMap(MAP_ENGINE, mapboxgl, (gl) => {', 'does not construct an asynchronous map')
    mutation('leak-setup-map', map_file, 'stopSizing();\n        map.remove();\n        schedulePaintRef.current = null;', 'stopSizing();\n        schedulePaintRef.current = null;', 'releases a constructed map')
    mutation('ignore-style-error', map_file, 'if (!map.getSource(SOURCE)) setCannotStart(true);', '// Ignore initial style failure.', 'states an initial style failure')
    run('restored')
finally:
    for p, original in originals.items():
        p.write_text(original)
    report = {'records': records, 'sourceBindings': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [*owned, app / 'src/components/projects/project-map-presence.tsx', app / 'src/test/project-saved-map.test.tsx']}, 'blindCategories': ['WebGL rendering and browser style acceptance', 'desktop and exact 390px identified-build journey', 'live database, authorization and export byte parity', 'practitioner usefulness and full accessibility']}
    (proof / 'controls.json').write_text(json.dumps(report, indent=2) + '\n')
