// Read-only diagnostic: execute exact candidate helpers and camera statements.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

const head = '92eaacf51bd111d3de37cf72943301aba0f7acde';
const bindings = {};
function source(path) {
  const bytes = execFileSync('git', ['show', `${head}:${path}`]);
  bindings[path] = createHash('sha256').update(bytes).digest('hex');
  return bytes.toString();
}
const strip = (text) => stripTypeScriptTypes(text, { mode: 'strip' });
const uri = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const place = await import(uri(strip(source('openplan/src/lib/geographies/place-of-record.ts'))));
const boundsUri = uri(strip(source('openplan/src/lib/geo/wgs84-bounds.ts')));
const camera = await import(uri(strip(source('openplan/src/lib/cartographic/geometry-bbox.ts'))
  .replace('"@/lib/geo/wgs84-bounds"', JSON.stringify(boundsUri))));
const corridor = await import(uri(strip(source('openplan/src/lib/cartographic/corridor-line-geojson.ts'))));
const inventoryText = source('openplan/src/lib/projects/project-geopackage.ts');
const inventory = await import(uri([
  `const isCorridorLineGeoJson = ${corridor.isCorridorLineGeoJson.toString()};`,
  strip(inventoryText.slice(inventoryText.indexOf('function isPosition('), inventoryText.indexOf('function geometryValue('))),
  strip(inventoryText.slice(inventoryText.indexOf('function parseAreaGeometry('), inventoryText.indexOf('function wkbHeader('))),
].join('\n')));
const renderer = source('openplan/src/components/projects/project-saved-map.tsx');
source('openplan/src/app/(app)/projects/[projectId]/_components/project-map-presence-panel.tsx');
source('openplan/src/components/projects/project-map-presence.tsx');
source('openplan/src/test/project-saved-map.test.tsx');
function frame(text, geometries) {
  const start = text.indexOf('const extents = current.features.flatMap');
  const end = text.indexOf('framedCollection = current;', start);
  if (start < 0 || end < 0) throw Error('Exact camera statements not found');
  const statements = strip(text.slice(start, end));
  const calls = [];
  const map = {
    easeTo: (options) => calls.push({ method: 'easeTo', options }),
    fitBounds: (bbox, options) => calls.push({ method: 'fitBounds', bbox, options }),
  };
  new Function('current', 'bboxOfGeometry', 'fitInstructionFromExtent', 'applyFitInstruction', 'map', statements)(
    { features: geometries.map((geometry) => ({ geometry })) }, place.bboxOfGeometry,
    camera.fitInstructionFromExtent, camera.applyFitInstruction, map,
  );
  return calls;
}
const splitArea = { type: 'MultiPolygon', coordinates: [
  [[[179.7, 51], [180, 51], [180, 51.2], [179.7, 51.2], [179.7, 51]]],
  [[[-180, 51], [-179.7, 51], [-179.7, 51.2], [-180, 51.2], [-180, 51]]],
] };
const zero = { type: 'Point', coordinates: [0, 0] };
const site = { type: 'Point', coordinates: [179.8, 51.1] };
const line = { type: 'LineString', coordinates: [[179.8, 51.1], [179.9, 51.15]] };
const pair = [{ type: 'Point', coordinates: [179.8, 51.1] }, { type: 'Point', coordinates: [-179.8, 51.1] }];
const zeroOracle = (text) => {
  const calls = frame(text, [zero]);
  if (JSON.stringify(calls[0]?.options.center) !== '[0,0]') {
    throw Error('zero-coordinate camera must easeTo center [0,0]');
  }
};
const controlRecords = [];
for (const [name, text, shouldFail] of [
  ['baseline', renderer, false],
  ['harmless-comment', renderer.replace('Draw the validated', 'Display the validated'), false],
  ['targeted-wrong-center', renderer.replace('applyFitInstruction(map, instruction);', 'applyFitInstruction(map, { kind: "center", center: [1, 0] });'), true],
  ['restored', renderer, false],
]) {
  let diagnostic = null;
  try { zeroOracle(text); } catch (error) { diagnostic = error.message; }
  if (Boolean(diagnostic) !== shouldFail || (shouldFail && diagnostic !== 'zero-coordinate camera must easeTo center [0,0]')) {
    throw Error(`Unexpected control result: ${name}: ${diagnostic}`);
  }
  controlRecords.push({ name, result: diagnostic ? 'intended assertion failed' : 'survived', diagnostic });
}
console.log(JSON.stringify({
  head, cwd: process.cwd(), node: process.version, bindings, controlRecords,
  splitArea,
  splitInventory: inventory.projectGeoPackageCoreInventory({ projectAreaGeometry: splitArea, latitude: site.coordinates[1], longitude: site.coordinates[0], corridors: [{ geometry: line }] }),
  splitAreaFrame: frame(renderer, [splitArea, site, line]),
  datelinePairFrame: frame(renderer, pair),
  zeroFrame: frame(renderer, [zero]),
  limitations: ['No DOM, React lifecycle, Mapbox rendering or projection', 'Camera statements extracted from exact candidate; outer visibility and style readiness are outside this diagnostic', 'No database, browser, service or implementation source mutation'],
}, null, 2));
