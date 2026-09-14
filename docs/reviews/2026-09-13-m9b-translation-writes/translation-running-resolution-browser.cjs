const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync,spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),app=path.join(root,'openplan'),base='http://127.0.0.1:3260',container='supabase_db_openplan-restore-target-2026091050';
const prefix=path.join('/home/nathaniel/.local/state/openplan/response-write-probe-20260913','translation-running-resolution-browser-'+Date.now());fs.mkdirSync(prefix,{mode:0o700});
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'), save=(name,value)=>fs.writeFileSync(path.join(prefix,name),JSON.stringify(value,null,2),{mode:0o600});
const sql=query=>execFileSync('docker',['exec',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
const handled=p=>{p.catch(()=>{});return p};
async function click(page,button){await expect(button).toBeEnabled();await button.focus();await page.keyboard.press('Enter')}
// The SQL reader explicitly returns 503 when a worker holds its custody lock.
// Retry this read only; preserve every status and never retry permission failures.
async function readSaved(context,url,statuses){
 for(let attempt=0;attempt<5;attempt++){
  const response=await context.request.get(url);statuses.push({url,status:response.status()});
  if(response.status()!==503)return response;
  if(attempt<4)await new Promise(resolve=>setTimeout(resolve,150));
 }
 throw Error('Saved request remained unavailable after five reads');
}
const results=[];
async function journey(browser,width){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);
 const consoleEvents=[],sent=[],readStatuses=[];let campaignId,requestId,routeError,loss=true,generationIntercepts=0,worker,workerDone;
 page.on('console',m=>{if(['error','warning'].includes(m.type()))consoleEvents.push({type:m.type(),text:m.text()})});page.on('pageerror',e=>consoleEvents.push({type:'pageerror',text:e.message}));
 const checkpoint=step=>{save(width+'-checkpoint.json',{step,campaignId,requestId,sent});console.log(width,step)};
 try{
  await page.goto(base);await click(page,page.getByRole('link',{name:/Sign in/i}).first());await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
  await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');
  await click(page,page.getByRole('button',{name:'New campaign',exact:true}));const dialog=page.getByRole('dialog');await click(page,dialog.getByRole('button',{name:'Next',exact:true}));
  await dialog.getByLabel('Title',{exact:true}).fill(`SYNTHETIC running resolution browser ${width} ${Date.now()}`);await click(page,dialog.getByRole('button',{name:'Next',exact:true}));await click(page,dialog.getByRole('button',{name:'Create campaign',exact:true}));
  await page.waitForURL(u=>/^\/engagement\/[-a-f0-9]{36}$/.test(u.pathname));campaignId=new URL(page.url()).pathname.split('/').pop();
  await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));await page.waitForURL(u=>u.searchParams.get('tab')==='setup');
  const panel=page.locator('article').filter({has:page.getByRole('heading',{name:/Publish this campaign in your community/})});await click(page,panel.getByRole('button',{name:/Español.*Spanish/}));
  const row=panel.getByRole('listitem').filter({has:page.getByText('Campaign title',{exact:true})}),input=row.getByRole('textbox');
  const generationPath=`/api/engagement/campaigns/${campaignId}/translations/generation`,resolutionPath=generationPath+'/resolutions',historyPath=`/api/engagement/campaigns/${campaignId}/translations/history`;
  const baseline=`SINTÉTICO original antes de resolver ${width}`;await input.fill(baseline);await click(page,row.getByRole('button',{name:'Save as our wording',exact:true}));await expect(input).toBeEditable();
  await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);
  const history=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('History unavailable');return(await r.json()).history},historyPath);expect(history).toHaveLength(1);
  await page.route('**'+generationPath,async route=>{if(route.request().method()==='POST'){generationIntercepts++;const response=await route.fetch();expect(response.status()).toBe(202);await route.abort('failed')}else await route.continue()});
  await click(page,row.getByRole('button',{name:'Generate translation for review',exact:true}));await expect(panel.getByRole('button',{name:'Retry same generation request',exact:true})).toBeEnabled();expect(generationIntercepts).toBe(1);
  const local=await page.evaluate(campaign=>{const keys=Object.keys(localStorage).filter(key=>key.startsWith('openplan:translation-generation:')&&key.includes(campaign));if(keys.length!==1)throw Error('Expected one actual UI request');const key=keys[0],raw=localStorage.getItem(key);return{key,raw,value:JSON.parse(raw)}},campaignId);
  requestId=local.value.intent.requestId;if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('Invalid request ID');
  expect(sql(`select count(*) from engagement_translation_generation_requests where id='${requestId}'`)).toBe('1');
  const fieldId=local.value.intent.fields[0].id,outputText=`\u00a0SINTÉTICO salida conservada después del cierre ${width}\ufeff`;
  expect(sql("select string_agg(id::text,',') from engagement_translation_generation_fields where state in ('queued','reserved','running')")).toBe(fieldId);
  const directory=path.join(prefix,width+'-worker');fs.mkdirSync(directory,{mode:0o700});const configPath=path.join(prefix,width+'-worker-config.json');fs.writeFileSync(configPath,JSON.stringify({requestId,fieldId,sourceText:local.value.intent.fields[0].address.expectedSource.text,outputText}),{mode:0o600});
  worker=spawn('node',['--env-file-if-exists=.env.local','--conditions=react-server','--import','tsx',path.join(__dirname,'translation-running-resolution-worker.ts'),configPath,directory,'running'],{cwd:app,env:{...process.env,ANTHROPIC_API_KEY:'SYNTHETIC-TRANSLATION-BROWSER-KEY',OPENPLAN_ENGAGEMENT_TRANSLATION_MODEL:'synthetic-browser-model'},stdio:['ignore','pipe','pipe']});
  let workerOutput='';worker.stdout.on('data',chunk=>workerOutput+=chunk);worker.stderr.on('data',chunk=>workerOutput+=chunk);
  workerDone=handled(new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('close',(code,signal)=>{fs.writeFileSync(path.join(prefix,width+'-worker.log'),workerOutput,{mode:0o600});resolve({code,signal,output:workerOutput})})}));
  await expect.poll(()=>{if(worker.exitCode!==null||worker.signalCode!==null)throw Error('Worker ended before provider dispatch: '+workerOutput);return fs.existsSync(path.join(directory,'provider-events.jsonl'))},{timeout:15000}).toBe(true);
  expect(sql(`select state from engagement_translation_generation_fields where id='${fieldId}'`)).toBe('running');
  expect(JSON.parse(fs.readFileSync(path.join(directory,'pending.json'))).phase).toBe('running');
  const originalOutputResponse=await readSaved(context,base+generationPath+'?requestId='+requestId,readStatuses);expect(originalOutputResponse.status()).toBe(200);const originalOutput=await originalOutputResponse.json();expect(originalOutput.fields[0].state).toBe('running');expect(originalOutput.fields[0].output).toBeNull();save(width+'-original-output.json',originalOutput);checkpoint('actual worker is running in held synthetic provider');
  await page.evaluate(()=>{const original=Storage.prototype.setItem;globalThis.__resolutionArchiveFailure=true;Storage.prototype.setItem=function(key,value){if(globalThis.__resolutionArchiveFailure&&key.startsWith('openplan:translation-resolution-archive:'))throw new DOMException('SYNTHETIC archive quota failure','QuotaExceededError');return original.call(this,key,value)}});
  const damaged=local.raw+'\nSYNTHETIC damaged stored copy\u0000';await page.evaluate(({key,raw})=>{localStorage.setItem(key,raw);window.dispatchEvent(new StorageEvent('storage',{key,newValue:raw}))},{key:local.key,raw:damaged});
  await expect(panel.getByRole('button',{name:'Review damaged request resolution',exact:true})).toBeVisible();
  await page.route('**'+resolutionPath,async route=>{try{sent.push(route.request().postDataJSON());if(loss){loss=false;const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed')}else await route.continue()}catch(error){routeError=error;await route.abort('failed').catch(()=>{})}});
  await click(page,panel.getByRole('button',{name:'Review damaged request resolution',exact:true}));const confirmation=panel.getByRole('region',{name:'Confirm generation resolution',exact:true});await expect(confirmation.getByText(/two recovery copies/)).toBeVisible();
  await confirmation.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(prefix,width+'-confirm.png')});
  await click(page,confirmation.getByRole('button',{name:'Confirm resolution and preserve copies',exact:true}));await expect(panel.getByRole('button',{name:'Retry same resolution',exact:true})).toBeEnabled();checkpoint('resolution acknowledgement lost');
  const workerResult=await workerDone;expect(workerResult.code).toBe(0);expect(workerResult.signal).toBeNull();
  const providerEvents=fs.readFileSync(path.join(directory,'provider-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);expect(providerEvents).toHaveLength(2);expect(providerEvents[1].event,'running provider must observe request closure').toBe('provider_abort_observed');
  const journal=JSON.parse(fs.readFileSync(path.join(directory,'pending.json')));expect(journal.phase).toBe('delivered');expect(journal.acknowledgedState).toBe('interrupted');expect(journal.delivery.kind).toBe('failure');
  const stoppedResponse=await readSaved(context,base+generationPath+'?requestId='+requestId,readStatuses);expect(stoppedResponse.status()).toBe(200);const stoppedOutput=await stoppedResponse.json();expect(stoppedOutput.fields[0].state).toBe('interrupted');expect(stoppedOutput.fields[0].output).toBeNull();save(width+'-stopped-output.json',stoppedOutput);
  expect(sent).toHaveLength(1);const pendingDownload=handled(page.waitForEvent('download'));await click(page,panel.getByRole('button',{name:'Download retained resolution',exact:true}));const pendingFile=path.join(prefix,width+'-pending-resolution.json');await(await pendingDownload).saveAs(pendingFile);
  const retained=JSON.parse(fs.readFileSync(pendingFile));expect(retained.intents.map(i=>JSON.parse(i.copyJson))).toEqual([damaged,JSON.stringify(local.value)]);expect(retained.intents[0]).toEqual(sent[0]);
  await click(page,panel.getByRole('button',{name:'Retry same resolution',exact:true}));await expect(panel.getByText(/archive could not be saved/)).toBeVisible();await expect(panel.getByRole('button',{name:'Retry same resolution',exact:true})).toBeEnabled();expect(sent).toHaveLength(3);expect(sent[1]).toEqual(sent[0]);expect(sent[2]).toEqual(retained.intents[1]);
  expect(await page.evaluate(key=>localStorage.getItem(key),local.key)).toBe(damaged);await expect(row.getByRole('button',{name:'Generate translation for review',exact:true})).toBeDisabled();checkpoint('confirmed server resolution survived browser archive failure');
  const beforeRetry=await readSaved(context,base+generationPath+'?requestId='+requestId,readStatuses);expect(beforeRetry.status()).toBe(200);expect(await beforeRetry.json()).toEqual(stoppedOutput);
  await page.evaluate(()=>{globalThis.__resolutionArchiveFailure=false});await click(page,panel.getByRole('button',{name:'Retry same resolution',exact:true}));await expect(panel.getByText(/Resolution confirmed and copies archived/)).toBeVisible();expect(sent).toHaveLength(5);expect(sent[3]).toEqual(retained.intents[0]);expect(sent[4]).toEqual(retained.intents[1]);
  await expect(panel.getByRole('button',{name:'Retry same generation request',exact:true})).toHaveCount(0);await expect(panel.getByText(/^Generation is unconfirmed/)).toHaveCount(0);await expect(row.getByRole('button',{name:'Generate translation for review',exact:true})).toBeEnabled();
  await click(page,panel.locator('summary').filter({hasText:'Archived generation resolutions'}));const archiveDownload=handled(page.waitForEvent('download'));await click(page,panel.getByRole('button',{name:'Download archived resolution 1',exact:true}));const archiveFile=path.join(prefix,width+'-archive.json');await(await archiveDownload).saveAs(archiveFile);const archive=JSON.parse(fs.readFileSync(archiveFile));expect(archive.request).toEqual(retained);expect(archive.receipts).toHaveLength(2);
  for(const [index,intent] of retained.intents.entries()){
   if(!/^[a-f0-9-]{36}$/.test(intent.resolutionId))throw Error('Invalid resolution ID');
   const receipt=JSON.parse(sql(`select json_build_object('payloadText',payload_json::text,'payloadSha256',payload_sha256,'resultText',result_json::text,'resultSha256',result_sha256,'replayed',false) from engagement_translation_generation_resolutions where id='${intent.resolutionId}'`));
   expect(archive.receipts[index]).toEqual(receipt);expect(sha(receipt.payloadText)).toBe(receipt.payloadSha256);expect(sha(receipt.resultText)).toBe(receipt.resultSha256);expect(JSON.parse(receipt.resultText).requestExisted).toBe(true);expect(JSON.parse(receipt.resultText).fields).toEqual([{fieldId,previousState:index===0?'running':'interrupted',state:'interrupted',attemptId:originalOutput.fields[0].attemptId,outputRetained:false}]);
  }
  await page.unroute('**'+generationPath);await page.unroute('**'+resolutionPath);
  const checks=await context.request.post(base+generationPath,{headers:{origin:base},data:local.value.intent});expect(checks.status()).toBe(409);
  const badScope=await context.request.post(base+resolutionPath,{headers:{origin:base,'x-openplan-expected-user':local.value.userId,'x-openplan-expected-workspace':'77000000-0000-4000-8000-000000000099'},data:retained.intents[0]});expect(badScope.status()).toBe(403);
  const outsider=await browser.newContext();try{const response=await outsider.request.post(base+resolutionPath,{headers:{origin:base,'x-openplan-expected-user':local.value.userId,'x-openplan-expected-workspace':local.value.workspaceId},data:retained.intents[0]});expect(response.status()).toBe(401)}finally{await outsider.close()}
  await click(page,panel.getByRole('button',{name:'Refresh saved generation requests',exact:true}));await click(page,panel.getByRole('button',{name:/Spanish.*0 of 1 fields completed/}));
  await expect(panel.getByRole('button',{name:'Publish this retained output with a machine label',exact:true})).toHaveCount(0);
  await expect(input).toHaveValue(baseline);
  const originalAfter=await readSaved(context,base+generationPath+'?requestId='+requestId,readStatuses);expect(originalAfter.status()).toBe(200);expect(await originalAfter.json()).toEqual(stoppedOutput);
  const finalHistory=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Final history unavailable');return(await r.json()).history},historyPath);expect(finalHistory).toEqual(history);
  expect(await page.evaluate(key=>localStorage.getItem(key),local.key)).toBeNull();
  const resolutionPanel=panel.getByRole('region',{name:'Generation resolution recovery',exact:true});await resolutionPanel.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(prefix,width+'-archive.png')});
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(width);expect(consoleEvents.filter(e=>e.type==='pageerror')).toEqual([]);expect(consoleEvents.filter(e=>e.type==='error'&&!e.text.includes('net::ERR_FAILED'))).toEqual([]);if(routeError)throw routeError;
  expect(sql(`select count(*) from engagement_translation_generation_requests where id='${requestId}'`)).toBe('1');
  results.push({width,campaignId,requestId,fieldId,workerResult,providerEvents,readStatuses,providerCalls:1,originalOutput,stoppedOutput,passed:true,retainedDownloadSha256:sha(fs.readFileSync(pendingFile)),archiveDownloadSha256:sha(fs.readFileSync(archiveFile)),resolutionIds:retained.intents.map(i=>i.resolutionId),originalHistory:history,finalHistory,lateCreationStatus:checks.status(),changedWorkspaceStatus:badScope.status(),anonymousStatus:401,generationIntercepts,overflow,console:consoleEvents});save('results.json',results);checkpoint('browser recovery and downloaded receipts passed');
 }catch(error){save(width+'-failure.json',{message:error.message,campaignId,requestId,sent,readStatuses,console:consoleEvents});await page.screenshot({path:path.join(prefix,width+'-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(prefix,width+'-failure.txt'),await page.locator('body').ariaSnapshot().catch(()=>''),{mode:0o600});throw error}
 finally{if(workerDone)await workerDone;await context.close()}
}
(async()=>{
 fs.writeFileSync(path.join(prefix,'identity.log'),execFileSync('bash',[path.join(app,'scripts/ops/which-openplan.sh'),base],{cwd:root,encoding:'utf8'}));
 expect(sql("select count(*)||':'||max(version) from supabase_migrations.schema_migrations")).toBe('338:20261014000019');expect(sql("select count(*) from engagement_translation_generation_fields where state in ('queued','reserved','running')")).toBe('0');
 const sources=['src/components/engagement/translation-resolution-panel.tsx','src/components/engagement/translation-generation-panel.tsx','src/lib/engagement/translation-resolution-recovery.ts','src/app/api/engagement/campaigns/[campaignId]/translations/generation/resolutions/route.ts','src/lib/engagement/translation-generation-worker.ts'];const digests=Object.fromEntries(sources.map(file=>[file,sha(fs.readFileSync(path.join(app,file)))]));save('source-sha256.json',digests);
 console.log('Resolution browser evidence',prefix);const browser=await chromium.launch({channel:'chrome',headless:true});try{for(const width of [1440,390])await journey(browser,width)}finally{await browser.close();for(const file of sources)expect(sha(fs.readFileSync(path.join(app,file)))).toBe(digests[file])}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
