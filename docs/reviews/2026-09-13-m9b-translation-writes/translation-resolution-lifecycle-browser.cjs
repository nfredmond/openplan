const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),app=path.join(root,'openplan'),base='http://127.0.0.1:3260',container='supabase_db_openplan-restore-target-2026091050';
const prefix=path.join('/home/nathaniel/.local/state/openplan/response-write-probe-20260913','translation-resolution-lifecycle-browser-'+Date.now());fs.mkdirSync(prefix,{mode:0o700});
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'), save=(name,value)=>fs.writeFileSync(path.join(prefix,name),JSON.stringify(value,null,2),{mode:0o600});
const sql=query=>execFileSync('docker',['exec',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
const handled=p=>{p.catch(()=>{});return p};
function expectedLifecycleConsoleError(event,campaignId){
 if(/net::ERR_(FAILED|ABORTED)/.test(event.text))return true;
 return ['signing-out','signed-out','signing-in'].includes(event.phase)&&event.location===base+`/api/engagement/campaigns/${campaignId}/reports`&&
  event.text==='Failed to load resource: the server responded with a status of 401 (Unauthorized)';
}
async function click(page,button){await expect(button).toBeEnabled();await button.focus();await page.keyboard.press('Enter')}
const results=[];
async function journey(browser,width){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);
 const consoleEvents=[],sent=[];let campaignId,requestId,releaseRead,phase='working';
 page.on('console',m=>{if(['error','warning'].includes(m.type()))consoleEvents.push({type:m.type(),text:m.text(),location:m.location().url,phase})});page.on('pageerror',e=>consoleEvents.push({type:'pageerror',text:e.message}));
 const checkpoint=step=>{save(width+'-checkpoint.json',{step,campaignId,requestId,sent});console.log(width,step)};
 try{
  await page.goto(base);await click(page,page.getByRole('link',{name:/Sign in/i}).first());await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
  await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');
  await click(page,page.getByRole('button',{name:'New campaign',exact:true}));const dialog=page.getByRole('dialog');await click(page,dialog.getByRole('button',{name:'Next',exact:true}));
  const campaignTitle=`SYNTHETIC resolution lifecycle browser ${width} ${Date.now()}`;await dialog.getByLabel('Title',{exact:true}).fill(campaignTitle);await click(page,dialog.getByRole('button',{name:'Next',exact:true}));await click(page,dialog.getByRole('button',{name:'Create campaign',exact:true}));
  await page.waitForURL(u=>/^\/engagement\/[-a-f0-9]{36}$/.test(u.pathname));campaignId=new URL(page.url()).pathname.split('/').pop();
  await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));await page.waitForURL(u=>u.searchParams.get('tab')==='setup');
  const panel=page.locator('article').filter({has:page.getByRole('heading',{name:/Publish this campaign in your community/})});await click(page,panel.getByRole('button',{name:/Español.*Spanish/}));
  const row=panel.getByRole('listitem').filter({has:page.getByText('Campaign title',{exact:true})}),input=row.getByRole('textbox');
  const generationPath=`/api/engagement/campaigns/${campaignId}/translations/generation`,resolutionPath=generationPath+'/resolutions',historyPath=`/api/engagement/campaigns/${campaignId}/translations/history`;
  const baseline=`SINTÉTICO original antes de resolver ${width}`;await input.fill(baseline);await click(page,row.getByRole('button',{name:'Save as our wording',exact:true}));await expect(input).toBeEditable();
  await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);
  const history=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('History unavailable');return(await r.json()).history},historyPath);expect(history).toHaveLength(1);

  await page.route(url=>url.pathname===generationPath&&!url.search,async route=>{if(route.request().method()==='POST')await route.abort('failed');else await route.continue()});
  await click(page,row.getByRole('button',{name:'Generate translation for review',exact:true}));await expect(panel.getByRole('button',{name:'Retry same generation request',exact:true})).toBeEnabled();
  const local=await page.evaluate(campaign=>{const keys=Object.keys(localStorage).filter(key=>key.startsWith('openplan:translation-generation:')&&key.includes(campaign));if(keys.length!==1)throw Error('Expected one actual UI request');const key=keys[0],raw=localStorage.getItem(key);return{key,raw,value:JSON.parse(raw)}},campaignId);
  requestId=local.value.intent.requestId;save(width+'-original-pending.json',local);
  let readReady,readFinished,heldRequest,heldResponse,routeDisposition;
  const ready=new Promise(resolve=>{readReady=resolve}),finished=new Promise(resolve=>{readFinished=resolve}),release=new Promise(resolve=>{releaseRead=resolve});
  const readMatcher=url=>url.pathname===resolutionPath;
  await page.route(readMatcher,async route=>{
   heldRequest=route.request();
   try{heldResponse=await route.fetch();expect(heldResponse.status()).toBe(201);readReady();await release;await route.fulfill({response:heldResponse});routeDisposition='response delivered or discarded by cancelled browser request'}
   catch(error){routeDisposition=error.message;readReady();await route.abort('failed').catch(()=>{})}
   finally{readFinished()}
  });
  await click(page,panel.getByRole('button',{name:'Review request resolution',exact:true}));await click(page,panel.getByRole('region',{name:'Confirm generation resolution',exact:true}).getByRole('button',{name:'Confirm resolution and preserve copies',exact:true}));
  await ready;expect(heldResponse?.status()).toBe(201);
  const resolution=await page.evaluate(campaign=>{const keys=Object.keys(localStorage).filter(key=>key.startsWith('openplan:translation-resolution:')&&key.includes(campaign));if(keys.length!==1)throw Error('Expected one retained resolution');const key=keys[0],raw=localStorage.getItem(key);return{key,raw,value:JSON.parse(raw)}},campaignId);
  save(width+'-original-resolution.json',resolution);expect(heldRequest.postDataJSON()).toEqual(resolution.value.intents[0]);checkpoint('server resolution committed while its acknowledgement is held');
  const signOut=page.getByRole('button',{name:'Sign out',exact:true});await expect(signOut).toBeVisible();
  const harmless=await page.addStyleTag({content:'/* Harmless sign-out visibility control. */'});await expect(signOut).toBeVisible();await harmless.evaluate(node=>node.remove());
  const hidden=await page.addStyleTag({content:(width===390?'.op-cart-mobile-account':'.op-cart-account')+' {display:none!important}'});let hiddenRejected=false;
  try{await expect(signOut).toBeVisible({timeout:500})}catch{hiddenRejected=true}finally{await hidden.evaluate(node=>node.remove())}
  expect(hiddenRejected,'visibility assertion must reject a hidden sign-out action').toBe(true);await expect(signOut).toBeVisible();
  const signOutBox=await signOut.boundingBox();expect(signOutBox.x).toBeGreaterThanOrEqual(0);expect(signOutBox.x+signOutBox.width).toBeLessThanOrEqual(width);
  await signOut.focus();await page.screenshot({path:path.join(prefix,width+'-sign-out.png')});phase='signing-out';await page.keyboard.press('Enter');await page.waitForURL(url=>url.pathname==='/');
  releaseRead();await finished;await page.unroute(readMatcher);phase='signed-out';
  expect(await page.evaluate(key=>localStorage.getItem(key),local.key),'sign-out must preserve the retained request').toBe(local.raw);
  expect(await page.evaluate(key=>localStorage.getItem(key),resolution.key),'sign-out must preserve the retained resolution').toBe(resolution.raw);
  const refused=await context.request.get(base+generationPath+'?requestId='+requestId);expect(refused.status()).toBe(401);checkpoint('signed-out browser keeps its exact recovery copy');phase='signing-in';
  await click(page,page.getByRole('link',{name:/Sign in/i}).first());await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(url=>!url.pathname.includes('sign-in'));phase='working';
  await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');
  await click(page,page.getByRole('link').filter({has:page.getByRole('heading',{name:campaignTitle,exact:true})}));await page.waitForURL(url=>url.pathname.endsWith(campaignId));
  await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));await page.waitForURL(url=>url.searchParams.get('tab')==='setup');
  await click(page,panel.getByRole('button',{name:/Español.*Spanish/}));await expect(panel.getByRole('button',{name:'Retry same resolution',exact:true})).toBeEnabled();await expect(panel.getByRole('button',{name:'Retry same generation request',exact:true})).toBeDisabled();await expect(input).toHaveValue(baseline);
  expect(await page.evaluate(key=>localStorage.getItem(key),local.key)).toBe(local.raw);
  const retainedDownload=handled(page.waitForEvent('download'));await click(page,panel.getByRole('button',{name:'Download retained resolution',exact:true}));const downloadFile=path.join(prefix,width+'-retained-request.json');await(await retainedDownload).saveAs(downloadFile);expect(JSON.parse(fs.readFileSync(downloadFile))).toEqual(resolution.value);
  const requestPanel=panel.getByRole('region',{name:'Generation resolution recovery',exact:true});await requestPanel.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(prefix,width+'-recovered-after-sign-in.png')});
  const retries=[];await page.route(readMatcher,async route=>{retries.push(route.request().postDataJSON());await route.continue()});
  await click(page,panel.getByRole('button',{name:'Retry same resolution',exact:true}));await expect(panel.getByText(/Resolution confirmed and copies archived/)).toBeVisible();expect(retries).toEqual(resolution.value.intents);
  await click(page,panel.locator('summary').filter({hasText:'Archived generation resolutions'}));const archiveDownload=handled(page.waitForEvent('download'));await click(page,panel.getByRole('button',{name:'Download archived resolution 1',exact:true}));const archiveFile=path.join(prefix,width+'-archive.json');await(await archiveDownload).saveAs(archiveFile);const archive=JSON.parse(fs.readFileSync(archiveFile));expect(archive.request).toEqual(resolution.value);
  for(const [index,intent] of resolution.value.intents.entries()){
   if(!/^[a-f0-9-]{36}$/.test(intent.resolutionId))throw Error("Invalid resolution identity");
   const receipt=JSON.parse(sql(`select json_build_object('payloadText',payload_json::text,'payloadSha256',payload_sha256,'resultText',result_json::text,'resultSha256',result_sha256,'replayed',false) from engagement_translation_generation_resolutions where id='${intent.resolutionId}'`));expect(archive.receipts[index]).toEqual(receipt);expect(sha(receipt.payloadText)).toBe(receipt.payloadSha256);expect(sha(receipt.resultText)).toBe(receipt.resultSha256);
  }
  expect(await page.evaluate(key=>localStorage.getItem(key),resolution.key)).toBeNull();
  const finalHistory=await page.evaluate(async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('Final history unavailable');return(await response.json()).history},historyPath);expect(finalHistory).toEqual(history);await expect(input).toHaveValue(baseline);
  expect(await page.evaluate(key=>localStorage.getItem(key),local.key)).toBeNull();
  expect(sql(`select count(*) from engagement_translation_generation_requests where id='${requestId}'`)).toBe('0');
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(width);expect(consoleEvents.filter(event=>event.type==='pageerror')).toEqual([]);expect(consoleEvents.filter(event=>event.type==='error'&&!expectedLifecycleConsoleError(event,campaignId))).toEqual([]);
  results.push({width,campaignId,requestId,passed:true,signOutVisibilityControls:{harmless:"survived",hidden:"killed"},signOutBox,routeDisposition,retainedSha256:sha(local.raw),resolutionSha256:sha(resolution.raw),archiveSha256:sha(fs.readFileSync(archiveFile)),downloadSha256:sha(fs.readFileSync(downloadFile)),signedOutRead:refused.status(),originalHistory:history,finalHistory,overflow,console:consoleEvents});save('results.json',results);checkpoint('sign-out and sign-in recovery passed');
 }catch(error){save(width+'-failure.json',{message:error.message,campaignId,requestId,console:consoleEvents});await page.screenshot({path:path.join(prefix,width+'-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(prefix,width+'-failure.txt'),await page.locator('body').ariaSnapshot().catch(()=>''),{mode:0o600});throw error}
 finally{releaseRead?.();await context.close()}
}
(async()=>{
 fs.writeFileSync(path.join(prefix,'identity.log'),execFileSync('bash',[path.join(app,'scripts/ops/which-openplan.sh'),base],{cwd:root,encoding:'utf8'}));
 expect(sql("select count(*)||':'||max(version) from supabase_migrations.schema_migrations")).toBe('338:20261014000019');
 const sources=['src/components/engagement/translation-resolution-panel.tsx','src/components/engagement/translation-generation-panel.tsx','src/components/cartographic/cartographic-header.tsx','src/components/cartographic/cartographic-shell.tsx','src/app/cartographic.css'];const digests=Object.fromEntries(sources.map(file=>[file,sha(fs.readFileSync(path.join(app,file)))]));save('source-sha256.json',digests);
 console.log('Generation lifecycle browser evidence',prefix);const browser=await chromium.launch({channel:'chrome',headless:true});try{for(const width of [1440,390])await journey(browser,width)}finally{await browser.close();for(const file of sources)expect(sha(fs.readFileSync(path.join(app,file)))).toBe(digests[file])}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
