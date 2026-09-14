const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {expect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const source=fs.readFileSync(path.join(__dirname,'translation-resolution-browser.cjs'),'utf8');
const start=source.indexOf('expect(overflow.document).toBeLessThanOrEqual(width);'),end=source.indexOf('if(routeError)',start);assert(start>0&&end>start);
const code=source.slice(start,end),cases=[{name:'baseline',code},{name:'harmless',code:code+'\n// Harmless acceptance guard control.\n'},
 {name:'ignore-overflow',code:code.replace('expect(overflow.document).toBeLessThanOrEqual(width);',''),failure:'wide layout'},
 {name:'ignore-page-error',code:code.replace("expect(consoleEvents.filter(e=>e.type==='pageerror')).toEqual([]);",''),failure:'page exception'},
 {name:'ignore-runtime-error',code:code.replace("expect(consoleEvents.filter(e=>e.type==='error'&&!e.text.includes('net::ERR_FAILED'))).toEqual([]);",''),failure:'unexpected runtime error'}];
const warning={type:'warning',text:'Recorded local development preload warning'},intentional={type:'error',text:'Failed to load resource: net::ERR_FAILED'};
const evaluate=(body,consoleEvents,document=390)=>vm.runInNewContext(body,{expect,consoleEvents,overflow:{document},width:390});
const results=[];
for(const c of cases){
 assert(c.name==='baseline'||c.code!==code);
 let failed=null;
 try{
  evaluate(c.code,[warning,intentional]);
  for(const [name,events,width] of [['wide layout',[warning],410],['page exception',[{type:'pageerror',text:'synthetic exception'}],390],['unexpected runtime error',[{type:'error',text:'synthetic failure'}],390]]){
   let rejected=false;try{evaluate(c.code,events,width)}catch{rejected=true}
   if(!rejected){failed=name;break}
  }
 }catch(e){throw Error(c.name+' failed its harmless control: '+e.message)}
 assert.equal(failed,c.failure??null,c.name);results.push({case:c.name,outcome:failed?'killed':'survived',expectedFailure:c.failure??null,observedFailure:failed});
}
fs.writeFileSync(path.join(__dirname,'resolution-browser-guard-controls.json'),JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),results,limits:'Executes the actual geometry and console assertions extracted from the browser journey. Synthetic events and measured widths test the acceptance predicate. Does not replace rendered screenshot inspection. Warnings remain recorded, not classified as runtime errors; intentional network abort errors are expected in this journey.'},null,2)+'\n');
console.log(results);
