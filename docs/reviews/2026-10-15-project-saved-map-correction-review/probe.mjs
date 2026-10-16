// Read exact Git objects. Execute pure helpers and the component paint closure in memory.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';

const head = 'ffd21964f38fb9a391e26e89a4cb705d409af6f8';
const bindings = {};
function source(path) {
  const bytes = execFileSync('git', ['show', `${head}:${path}`]);
  bindings[path] = createHash('sha256').update(bytes).digest('hex');
  return bytes.toString();
}
const strip = (text) => stripTypeScriptTypes(text, { mode: 'strip' });
const uri = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const boundsUri = uri(strip(source('openplan/src/lib/geo/wgs84-bounds.ts')));
const bounds = await import(boundsUri);
const camera = await import(uri(strip(source('openplan/src/lib/cartographic/geometry-bbox.ts'))
  .replace('"@/lib/geo/wgs84-bounds"', JSON.stringify(boundsUri))));
const helperText = source('openplan/src/lib/cartographic/saved-geometry-frame.ts');
const loadHelper = async (text) => (await import(uri(strip(text)))).fitInstructionFromSavedGeometry;
const helper = await loadHelper(helperText);
const corridor = await import(uri(strip(source('openplan/src/lib/cartographic/corridor-line-geojson.ts'))));
const inventoryText = source('openplan/src/lib/projects/project-geopackage.ts');
const inventory = await import(uri([
  `const isCorridorLineGeoJson = ${corridor.isCorridorLineGeoJson.toString()};`,
  strip(inventoryText.slice(inventoryText.indexOf('function isPosition('), inventoryText.indexOf('function geometryValue('))),
  strip(inventoryText.slice(inventoryText.indexOf('function parseAreaGeometry('), inventoryText.indexOf('function wkbHeader('))),
].join('\n')));
const renderer = source('openplan/src/components/projects/project-saved-map.tsx');
const paintStart = renderer.indexOf('const paint = () => {');
const paintEnd = renderer.indexOf('const schedulePaint = () => {', paintStart);
assert(paintStart > 0 && paintEnd > paintStart, 'exact paint anchors must exist');
const paintText = strip(renderer.slice(paintStart, paintEnd));
const collection = (...geometries) => ({ type: 'FeatureCollection', features: geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry })) });
const point = (x, y = 0) => ({ type: 'Point', coordinates: [x, y] });
const line = (...coordinates) => ({ type: 'LineString', coordinates });
const rectangle = (w, e, s = 51, n = 51.2) => ({ type: 'Polygon', coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] });
const multi = (...parts) => ({ type: 'MultiPolygon', coordinates: parts.map(p => p.coordinates) });
const split = multi(rectangle(179.7,180), rectangle(-180,-179.7));
const expectedBbox = (w,s,e,n) => ({ kind: 'bbox', bbox: [[w,s],[e,n]] });
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
};
const cases = [
  ['empty', collection(), null],
  ['original-date-line', collection(split,point(179.8,51.1),line([179.8,51.1],[179.9,51.15])), expectedBbox(179.7,51,180.3,51.2)],
  ['opposite-points', collection(point(179.8,51.1),point(-179.8,51.1)), expectedBbox(179.8,51.1,180.2,51.1)],
  ['third-part', collection(multi(...[rectangle(179.7,180),rectangle(-180,-179.7),rectangle(178,179)])), expectedBbox(178,51,180.3,51.2)],
  ['broad', collection(rectangle(-170,170)), expectedBbox(-170,51,170,51.2)],
  ['broad-with-site', collection(rectangle(-170,170),point(175,52)), expectedBbox(-170,51,175,52)],
  ['broad-with-inner-part', collection(multi(rectangle(-170,170),rectangle(-30,30)),point(175,51.1)), expectedBbox(-170,51,175,51.2)],
  ['full-world', collection(rectangle(-180,180)), expectedBbox(-180,51,180,51.2)],
  ['full-world-with-nested', collection(multi(rectangle(-180,180),rectangle(-30,30)),point(179.9,52)), expectedBbox(-180,51,180,52)],
  ['full-world-union', collection(rectangle(-180,0),rectangle(0,180)), expectedBbox(-180,51,180,51.2)],
  ['touching-parts', collection(rectangle(10,20),rectangle(20,30)), expectedBbox(10,51,30,51.2)],
  ['reordered-parts', collection(multi(rectangle(-180,-179.7),rectangle(179.7,180))), expectedBbox(179.7,51,180.3,51.2)],
  ['broad-cartesian-line', collection(line([-170,0],[170,1])), expectedBbox(-170,0,170,1)],
  ['split-corridors', collection(line([179,1],[180,2]),line([-180,2],[-179,3])), expectedBbox(179,1,181,3)],
  ['ordinary-tie', collection(point(-90),point(90)), expectedBbox(-90,0,90,0)],
  ['three-way-tie', collection(point(-120),point(0),point(120)), expectedBbox(-120,0,120,0)],
  ['zero', collection(point(0)), {kind:'center',center:[0,0]}],
  ['negative-zero', collection(point(-0,-0)), {kind:'center',center:[-0,-0]}],
  ['north-pole', collection(point(0,90)), {kind:'center',center:[0,90]}],
  ['south-pole', collection(point(0,-90)), {kind:'center',center:[0,-90]}],
  ['both-poles', collection(point(0,-90),point(0,90)), expectedBbox(0,-90,0,90)],
  ['seam-equivalent-points', collection(point(-180),point(180)), {kind:'center',center:[180,0]}],
  ['seam-with-latitude', collection(point(-180,1),point(180,2)), expectedBbox(180,1,180,2)],
  ['zero-width-line', collection(line([0,0],[0,1])), expectedBbox(0,0,0,1)],
  ['high-precision', collection(point(12.12345678901234,45.12345678901234)), {kind:'center',center:[12.12345678901234,45.12345678901234]}],
  ['hole', collection({...rectangle(0,2,0,2),coordinates:[rectangle(0,2,0,2).coordinates[0],rectangle(.5,1,.5,1).coordinates[0]]}), expectedBbox(0,0,2,2)],
  ['separate-hole-components', collection(multi({...rectangle(179,180),coordinates:[rectangle(179,180).coordinates[0],rectangle(179.2,179.3,51.05,51.1).coordinates[0]]},rectangle(-180,-179))), expectedBbox(179,51,181,51.2)],
  ['extra-dimension', collection({type:'Point',coordinates:[10.1234567890123,20.9876543210987,123.45]}), {kind:'center',center:[10.1234567890123,20.9876543210987]}],
];
const records=[];
for (const [name,input,expected] of cases) {
  const before=structuredClone(input);
  freeze(input);
  const actual=helper(input);
  assert.deepEqual(actual,expected,`${name}: exact camera instruction`);
  assert.deepEqual(input,before,`${name}: exact source coordinates`);
  records.push({name,actual});
}

// Execute the component's complete paint closure, including size and identity checks.
function componentPaint(input,fit=helper) {
  const ref={current:input},container={clientWidth:390,clientHeight:360},calls=[],sources=new Map(),layers=new Map();
  const map={
    getSource:id=>sources.get(id),
    addSource:(id,spec)=>sources.set(id,{data:spec.data,setData(data){this.data=data;}}),
    getLayer:id=>layers.get(id),addLayer:spec=>layers.set(spec.id,spec),
    easeTo:options=>calls.push({method:'easeTo',options}),
    fitBounds:(bbox,options)=>calls.push({method:'fitBounds',bbox,options}),
  };
  const paint=new Function('latestCollectionRef','container','map','SOURCE','fitInstructionFromSavedGeometry','applyFitInstruction',`let framedCollection=null; ${paintText}; return paint;`)(ref,container,map,'project-saved-geography',fit,camera.applyFitInstruction);
  return {paint,ref,container,calls,sources,layers};
}
const ui=componentPaint(cases[1][1]);
ui.container.clientWidth=0;ui.paint();
assert.equal(ui.calls.length,0,'hidden container: no camera call');
ui.ref.current=collection(split,point(-179.5,51.1));ui.container.clientWidth=390;ui.paint();
assert.deepEqual(ui.calls,[{method:'fitBounds',bbox:[[179.7,51],[180.5,51.2]],options:{padding:64,maxZoom:15,duration:400}}],'visible latest data: exact component camera call');
assert.deepEqual(ui.sources.get('project-saved-geography').data,ui.ref.current,'visible latest data: exact source');
ui.sources.clear();ui.layers.clear();ui.paint();
assert.equal(ui.calls.length,1,'same collection style recovery: no repeat camera');
assert.equal(ui.layers.size,4,'style recovery: four layers');
const zero=componentPaint(collection(point(0)));zero.paint();
assert.deepEqual(zero.calls,[{method:'easeTo',options:{center:[0,0],zoom:14,duration:400}}],'zero: exact shared camera options');

const rejected=[];
for(const [name,area,latitude,longitude,corridors] of [
  ['unclosed-area',{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]},null,null,[]],
  ['empty-area',{type:'Polygon',coordinates:[]},null,null,[]],
  ['null-feature',{type:'Feature',geometry:null},null,null,[]],
  ['unsupported-area',{type:'GeometryCollection',geometries:[]},null,null,[]],
  ['nonfinite-area',rectangle(0,Infinity),null,null,[]],
  ['invalid-site',null,91,0,[]],['out-of-range-site',null,0,181,[]],['nonfinite-site',null,NaN,0,[]],
  ['invalid-corridor',null,null,null,[{geometry:line([0,0],[Infinity,0])}]],
  ['unsupported-corridor',null,null,null,[{geometry:{type:'MultiLineString',coordinates:[[[0,0],[1,1]]]}}]],
]){
 const actual=inventory.projectGeoPackageCoreInventory({projectAreaGeometry:area,latitude,longitude,corridors});
 assert.equal(actual.featureCount,0,`${name}: export inventory excludes shape`);
 assert.equal(actual.rejectedFeatureCount,1,`${name}: export inventory records rejection`);
 rejected.push({name,actual});
}
assert.equal(bounds.readWgs84Bbox([179,0,181,1]),null,'ordinary validator rejects wrapped camera east');
assert.equal(bounds.readWgs84Bbox([179,0,-179,1]),null,'ordinary validator rejects reversed extent');
assert.deepEqual(bounds.readWgs84Bbox([-180,-90,180,90]),[-180,-90,180,90],'ordinary validator accepts whole WGS84 boundary');

// Independent interval oracle: enumerate permissible camera cuts, then compare widths.
let seed=42071;
const integer=(maximum)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%maximum;};
for(let index=0;index<300;index++){
 const spans=Array.from({length:1+integer(6)},()=>{const a=integer(361)-180,b=integer(361)-180;return [Math.min(a,b),Math.max(a,b)];});
 const input=collection(...spans.map(([w,e])=>rectangle(w,e,0,1)));
 const ordinaryWest=Math.min(...spans.map(s=>s[0])),ordinaryEast=Math.max(...spans.map(s=>s[1]));
 const candidates=spans.map(s=>s[0]).flatMap(w=>{
   const shifted=spans.map(([a,b])=>{const shift=360*Math.ceil((w-a)/360);return [a+shift,b+shift];});
   return shifted.every(([,b])=>b<=w+360)?[Math.max(...shifted.map(s=>s[1]))-w]:[];
 });
 const minimum=Math.min(...candidates);
 const actual=helper(input);
 const [[w],[e]]=actual.bbox;
 assert.equal(e-w,minimum,`interval oracle ${index}: minimum occupied frame`);
 assert(spans.every(([a,b])=>[-360,0,360].some(shift=>a+shift>=w&&b+shift<=e)),`interval oracle ${index}: every occupied span retained`);
 if(ordinaryEast-ordinaryWest===minimum)assert.deepEqual(actual.bbox,[[ordinaryWest,0],[ordinaryEast,1]],`interval oracle ${index}: ordinary tie retained`);
}

// Controls prove the new diagnostic can survive and can reject specified bad behavior.
const controls=[];
for(const [name,text,shouldFail] of [
 ['baseline',helperText,false],['harmless-comment',helperText.replace('Frame validated','Frame supplied'),false],
 ['no-wrapped-gap',helperText.replace('if (gap > widestGap)', 'if (false && gap > widestGap)'),true],
 ['restored',helperText,false],
]){
 let diagnostic=null;
 const fit=await loadHelper(text);
 try {assert.deepEqual(fit(cases[1][1]),cases[1][2],'original-date-line: exact camera instruction');}catch(e){diagnostic=e.message.split('\n')[0];}
 assert.equal(Boolean(diagnostic),shouldFail,`${name}: control result`);
 if(shouldFail) assert.equal(diagnostic,'original-date-line: exact camera instruction',`${name}: exact failure diagnostic`);
 controls.push({name,result:diagnostic?'intended assertion failure':'survived',diagnostic});
}
console.log(JSON.stringify({head,cwd:process.cwd(),node:process.version,bindings,records,rejected,intervalOracleCases:300,componentCalls:ui.calls,zeroCalls:zero.calls,controls,limits:['Pure helpers and extracted component paint closure only','No React scheduling, browser, WebGL, projection, tessellation, accessibility or database','No source mutation; only in-memory controls']},null,2));
