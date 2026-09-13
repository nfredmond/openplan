const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:10000});
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=require('node:path').resolve(__dirname,'../../..'),base='http://127.0.0.1:3260',evidence='/home/nathaniel/.local/state/openplan/response-write-probe-20260913';
const account=JSON.parse(fs.readFileSync(evidence+'/history-viewer-account.json'));
const targetName='api-settings-7d77d0ed-591e-48e3-a843-202b3c67fd06',ownName='SYNTHETIC history viewer acceptance';
const mode=process.env.OPENPLAN_WORKSPACE_SWITCH_CONTROL??'baseline',prefix=evidence+'/workspace-switch-'+mode+'-'+Date.now();
const files=['openplan/src/app/cartographic.css','openplan/src/components/workspaces/workspace-switcher.tsx','openplan/src/components/cartographic/cartographic-header.tsx'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(root+'/'+file)).digest('hex')]));
(async()=>{
 const before=hashes();fs.writeFileSync(prefix+'-identity.log',execFileSync('bash',[root+'/openplan/scripts/ops/which-openplan.sh',base],{cwd:root,encoding:'utf8'}));
 const browser=await chromium.launch({channel:'chrome',headless:true});let page;const results=[],consoleEvents=[];
 try{
  for(const width of (mode==='hidden'?[390]:mode==='clipped'?[1440]:[1440,900,390,320])){
   const context=await browser.newContext({viewport:{width,height:1000}});page=await context.newPage();page.setDefaultTimeout(60000);
   page.on('pageerror',error=>consoleEvents.push({type:'pageerror',message:error.message}));page.on('console',message=>{if(['error','warning'].includes(message.type()))consoleEvents.push({type:message.type(),message:message.text()})});
   await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/dashboard');
   if(mode==='harmless')await page.addStyleTag({content:'.op-cart-ws-body {outline-color:transparent}'});
   if(mode==='hidden')await page.addStyleTag({content:'.op-cart-hdr .op-cart-ws-body {display:none !important}'});
   if(mode==='clipped')await page.addStyleTag({content:'.op-cart-ws-name {overflow:hidden !important}'});
   await page.screenshot({path:prefix+`-${width}-closed.png`});
   const trigger=page.getByRole('banner').getByRole('button',{name:ownName,exact:true});
   try{await expect(trigger).toBeVisible();}catch(error){throw Error('Workspace switch remains visible: '+error.message);}await trigger.focus();await page.keyboard.press('Enter');
   const menu=page.getByRole('listbox',{name:'Switch workspace'}),target=menu.getByRole('button',{name:targetName,exact:true});await expect(menu).toBeVisible();
   await page.screenshot({path:prefix+`-${width}-menu.png`});
   const hit=await target.evaluate(button=>{const box=button.getBoundingClientRect(),point=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return {reachable:point!==null&&button.contains(point),left:box.left,right:box.right,bottom:box.bottom,viewport:innerWidth};});
   assert.equal(hit.reachable,true,'Workspace menu target is reachable');expect(hit.left).toBeGreaterThanOrEqual(0);expect(hit.right).toBeLessThanOrEqual(width);
   await target.focus();await page.keyboard.press('Enter');await expect(menu).toHaveCount(0,{timeout:45000});await expect(page.getByRole('banner').getByRole('button',{name:targetName,exact:true})).toBeVisible({timeout:45000});
   await page.reload();await expect(page.getByRole('banner').getByRole('button',{name:targetName,exact:true})).toBeVisible({timeout:45000});
   const dimensions=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));expect(dimensions.document).toBeLessThanOrEqual(width);results.push({width,hit,dimensions,persisted:true});await context.close();console.log('Workspace switch passed',width,prefix);
  }
  expect(consoleEvents.filter(event=>event.type==='pageerror')).toEqual([]);expect(hashes()).toEqual(before);fs.writeFileSync(prefix+'-result.json',JSON.stringify({passed:true,mode,sourceHashes:before,results,console:consoleEvents},null,2));
 }catch(error){if(page&&!page.isClosed())await page.screenshot({path:prefix+'-failure.png'});fs.writeFileSync(prefix+'-failure.json',JSON.stringify({mode,message:error.message,results,console:consoleEvents},null,2));throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error.message.replaceAll(account.password,'[redacted]'));process.exitCode=1});
