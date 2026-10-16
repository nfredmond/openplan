const fs = require('fs');
const {createRequire} = require('module');
const deps = createRequire('/home/nathaniel/code/openplan/openplan/package.json');
const ts = deps('typescript');
const sourcePath = '/tmp/jurisdiction-review-jfelat4k/openplan/src/components/projects/project-jurisdiction-editor.tsx';
const source = fs.readFileSync(sourcePath, 'utf8')
 .replace(process.argv[2] === 'harmless' ? '"use client";' : '__absent__', '"use client"; // Harmless review control.')
 .replace(process.argv[2] === 'capture-actor' ? 'const [baseRevision, setBaseRevision] = useState(revision);' : '__absent__', 'const [draftUserId] = useState(userId); const [baseRevision, setBaseRevision] = useState(revision);')
 .replace(process.argv[2] === 'capture-actor' ? '"x-openplan-expected-user": userId' : '__absent__', '"x-openplan-expected-user": draftUserId');
const compiled = ts.transpileModule(source, {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function probe(nextProps) {
 const state=[]; let cursor=0; const requests=[];
 const mockRequire = name => {
  if(name==='react') return {useState:initial=>{const i=cursor++; if(!(i in state)) state[i]=initial; return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]}};
  if(name==='react/jsx-runtime') return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='next/navigation') return {useRouter:()=>({refresh(){}})};
  if(name.endsWith('study-area-picker')) return {StudyAreaPicker:'StudyAreaPicker'};
  if(name.endsWith('ui/button')) return {Button:'Button'};
  if(name.endsWith('ui/input')) return {Input:'Input'};
  if(name.endsWith('project-jurisdiction')) return {readProjectJurisdiction:()=>null,jurisdictionDraft:()=>[]};
  throw Error(name);
 };
 const exports={}; new Function('require','exports',compiled)(mockRequire,exports);
 const props={projectId:'P',context:null,revision:'2026-10-15T00:00:00.000Z',userId:'A',workspaceId:'W',canWrite:true};
 const render = p=>{cursor=0;return exports.ProjectJurisdictionEditor(p)};
 const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
 let tree=render(props); nodes(tree).find(n=>n.props?.children==='Edit jurisdiction context').props.onClick();
 tree=render(props); nodes(tree).find(n=>n.type==='StudyAreaPicker').props.onPlaceResolved({kind:'county',geoid:'06045',label:'A draft'});
 tree=render({...props,...nextProps});
 global.fetch=async(url,options)=>{requests.push({url,headers:options.headers,body:JSON.parse(options.body)});return {ok:true}};
 nodes(tree).find(n=>n.props?.children==='Save jurisdiction context').props.onClick();
 return requests;
}
console.log(JSON.stringify({sourcePath,accountChanged:probe({userId:'B'}),workspaceChanged:probe({workspaceId:'W2'}),canWriteRevoked:probe({canWrite:false})},null,2));
