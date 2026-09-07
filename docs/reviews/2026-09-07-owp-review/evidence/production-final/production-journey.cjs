const {createRequire}=require('node:module');
const req=createRequire('/home/nathaniel/code/openplan/qa-harness/package.json');
const {chromium}=req('playwright');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root='/home/nathaniel/.local/state/openplan/owp-review-2026-09-07';
const privateRoot='/home/nathaniel/.local/state/openplan/owp-review-verification';
const output=privateRoot+'/production-final';
const base='http://localhost:3226';
const programId='c21b0ea6-0046-4e01-ba09-141d8c2bb231';
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.connectOverCDP('http://localhost:9336');
 const context=browser.contexts()[0];
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[], checks=[], received=[];
 page.on('pageerror',e=>errors.push({kind:'pageerror',message:e.message}));
 page.on('console',e=>{if(e.type()==='error')errors.push({kind:'console',message:e.text()});});
 const health=await (await context.request.get(base+'/api/health')).json();
 assert.equal(health.deployment.commit,'b8e81af737e2');checks.push('stamped production build');
 async function navigate(){
  await page.getByRole('link',{name:'Programming Cycles',exact:true}).first().click();
  await page.locator(`a[href='/programs/${programId}']`).last().click();
  await page.locator('a[href$="/work-program"]').click();
  await page.getByRole('heading',{name:'Work program preparation',exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Selected review revision',exact:true}).selectOption({label:'Revision 9'});
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/my-work');await navigate();
 await page.locator('#work-program-review').getByText(/Effective adopted baseline: revision 5/).waitFor();
 let changes=page.getByText('Amendment differences from adopted revision 5: 3 changed fields',{exact:true});
 await changes.click();await page.getByText('After: Unresolved',{exact:true}).waitFor();
 await page.locator('#work-program-review h2').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/desktop-review.png'});
 const action=page.getByRole('combobox',{name:'Review action',exact:true});
 await action.focus();await action.press('Home');await action.press('ArrowDown');assert.equal(await action.inputValue(),'comment');
 const note=page.getByRole('textbox',{name:'Review note or requested changes',exact:true});
 await note.fill('Unsent keyboard recovery check for revision 9');await note.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'INPUT');
 await page.getByRole('link',{name:'My Work',exact:true}).first().click();await navigate();
 assert.equal(await note.inputValue(),'Unsent keyboard recovery check for revision 9');await note.fill('');checks.push('keyboard form operation and exact-version unsent recovery through real navigation');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.locator('#work-program-review h2').scrollIntoViewIfNeeded();
  const layout=await page.evaluate(()=>{const panel=document.querySelector('#work-program-review').getBoundingClientRect();return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('#work-program-review input,#work-program-review select,#work-program-review button,#work-program-review textarea')].filter(e=>{let b=e.getBoundingClientRect();return b.width&&(b.left<panel.left-1||b.right>panel.right+1||b.right>innerWidth+1)}).map(e=>e.tagName)};});
  assert.equal(layout.documentWidth,width);assert.deepEqual(layout.overflow,[]);checks.push({layout});
  await page.screenshot({path:output+`/${width}-review.png`});
  const audience=page.getByRole('combobox',{name:'Review file audience',exact:true});await audience.selectOption('public');
  const consent=page.getByRole('checkbox',{name:/I am a workspace administrator/});await consent.check();
  const selected=page.getByRole('combobox',{name:'Selected review revision',exact:true});await selected.focus();await selected.press('Home');await selected.press('ArrowDown');assert.equal(await consent.isChecked(),false);await selected.press('Home');
  await page.locator('#work-program-review').getByRole('button',{name:'Save selected action',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:output+`/${width}-controls.png`});
  checks.push(`keyboard revision selection clears disclosure consent at ${width}px`);
 }
 const accepted=[...JSON.parse(await fs.readFile(root+'/docs/reviews/2026-09-07-owp-review/independent/evidence-b/delivered-final14-reconciliation.json','utf8')).map(x=>({...x,revision:9})),...JSON.parse(await fs.readFile(root+'/docs/reviews/2026-09-07-owp-review/independent/evidence-b/delivered-baseline14-reconciliation.json','utf8')).map(x=>({...x,revision:5}))];
 for(const expected of accepted){
  await page.getByRole('combobox',{name:'Selected review revision',exact:true}).selectOption({label:expected.revision===5?'Revision 5 · effective adopted baseline':'Revision 9'});
  await page.getByRole('combobox',{name:'Review file audience',exact:true}).selectOption(expected.audience);
  for(const format of ['html','pdf','xlsx']){
   const pending=page.waitForEvent('download');await page.locator('#work-program-review').getByRole('button',{name:'Download '+format.toUpperCase(),exact:true}).click();const download=await pending;
   const target=output+'/'+download.suggestedFilename();await download.saveAs(target);const hash=crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex');assert.equal(hash,expected.files[format]);received.push({name:download.suggestedFilename(),sha256:hash});
  }
 }
 checks.push('all nine final files received with independently accepted byte hashes');
 await page.getByRole('combobox',{name:'Selected review revision',exact:true}).selectOption({label:'Revision 9'});await page.getByRole('combobox',{name:'Review file audience',exact:true}).selectOption('internal');
 let intercepted=0, corruptDownloads=0;const count=()=>corruptDownloads++;page.on('download',count);
 const matcher=/\/work-program\/packets\?.*/;
 await page.route(matcher,async route=>{if(!route.request().url().includes('download=1'))return route.continue();intercepted++;const response=await route.fetch();assert.equal(response.status(),200);const bytes=await response.body();const truncated=bytes.subarray(0,Math.floor(bytes.length/2));await route.fulfill({response,body:truncated,headers:{...response.headers(),'content-length':String(truncated.length)}});});
 await page.locator('#work-program-review').getByRole('button',{name:'Download PDF',exact:true}).click();
 const refusal=await page.locator('#work-program-review [role=alert]').innerText();assert.match(refusal,/differs from the saved artifact/);assert.equal(intercepted,1);assert.equal(corruptDownloads,0);
 await page.unroute(matcher);page.off('download',count);
 const pending=page.waitForEvent('download');await page.locator('#work-program-review').getByRole('button',{name:'Download PDF',exact:true}).click();const download=await pending;await download.saveAs(output+'/recovered-download.pdf');
 const recovered=crypto.createHash('sha256').update(await fs.readFile(output+'/recovered-download.pdf')).digest('hex');assert.equal(recovered,accepted.find(x=>x.revision===9&&x.audience==='internal').files.pdf);checks.push({truncatedDownload:{intercepted,corruptDownloads,refusal,recovered}});
 assert.deepEqual(errors,[]);checks.push('no console errors or uncaught exceptions in production navigation and downloads');
 await fs.writeFile(output+'/browser-result.json',JSON.stringify({health,checks,received,errors},null,2));
 console.log(JSON.stringify({checks:checks.length,received:received.length,errors:errors.length,output}));
 await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
