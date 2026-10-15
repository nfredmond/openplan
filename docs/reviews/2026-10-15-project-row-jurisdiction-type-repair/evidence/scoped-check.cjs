const ts = require('./app/node_modules/typescript');
const path = require('node:path');
const app = path.join(__dirname,'app');
const configFile = ts.readConfigFile(path.join(app,'tsconfig.json'),ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config,ts.sys,app);
const roots = process.argv.slice(2);
if (!roots.length) throw new Error('Explicit source roots are required');
const ambient = roots.some(p=>p.startsWith('src/test/')) ? [path.join(app,'node_modules/@testing-library/jest-dom/types/vitest.d.ts')] : [];
const program = ts.createProgram([...roots.map(p=>path.join(app,p)),...ambient],config.options);
const diagnostics = [...config.errors,...program.getOptionsDiagnostics()];
for (const root of roots) {
  const source = program.getSourceFile(path.join(app,root));
  if (!source) throw new Error('Missing source: '+root);
  diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source));
  console.log('CHECKED '+root);
}
console.log(ts.formatDiagnostics(diagnostics,{getCurrentDirectory:()=>app,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
console.log(JSON.stringify({rootCount:roots.length,loadedSourceFiles:program.getSourceFiles().length,diagnostics:diagnostics.length,scope:'Only explicit roots receive syntactic and semantic diagnostics; imported declarations resolve normally. No full-project verdict.'}));
process.exitCode = diagnostics.length ? 1 : 0;
