const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),app=path.join(root,'openplan');
const base='http://127.0.0.1:3260',container='supabase_db_openplan-restore-target-2026091050';
const privateRoot='/home/nathaniel/.local/state/openplan/response-write-probe-20260913';
const prefix=path.join(privateRoot,'translation-generation-browser-'+Date.now());fs.mkdirSync(prefix,{mode:0o700});
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(prefix,name),JSON.stringify(value,null,2),{mode:0o600});
const sql=query=>execFileSync('docker',['exec',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
const handled=p=>{p.catch(()=>{});return p};
async function keyClick(page,button){await expect(button).toBeEnabled();await button.focus();await page.keyboard.press('Enter')}
const results=[];
async function journey(browser,width){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);
 const consoleEvents=[],requests=[],commands=[];let campaignId,requestId,fieldId,originalHistory,routeError;let generationLoss=true,publicationLoss=true;
 page.on('console',m=>{if(['error','warning'].includes(m.type()))consoleEvents.push({type:m.type(),text:m.text()})});page.on('pageerror',e=>consoleEvents.push({type:'pageerror',text:e.message}));
 const checkpoint=step=>{save(width+'-checkpoint.json',{step,campaignId,requestId,fieldId,requests,commands,originalHistory});console.log(width,step)};
 try{
  await page.goto(base);await keyClick(page,page.getByRole('link',{name:/Sign in/i}).first());await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await keyClick(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
  await keyClick(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');
  await keyClick(page,page.getByRole('button',{name:'New campaign',exact:true}));const dialog=page.getByRole('dialog');await keyClick(page,dialog.getByRole('button',{name:'Next',exact:true}));
  const title=`SYNTHETIC generation browser ${width} ${Date.now()}`;await dialog.getByLabel('Title',{exact:true}).fill(title);await keyClick(page,dialog.getByRole('button',{name:'Next',exact:true}));await keyClick(page,dialog.getByRole('button',{name:'Create campaign',exact:true}));
  await page.waitForURL(u=>/^\/engagement\/[-a-f0-9]{36}$/.test(u.pathname));campaignId=new URL(page.url()).pathname.split('/').pop();
  await keyClick(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));await page.waitForURL(u=>u.searchParams.get('tab')==='setup');
  const panel=page.locator('article').filter({has:page.getByRole('heading',{name:/Publish this campaign in your community/})});await keyClick(page,panel.getByRole('button',{name:/Español.*Spanish/}));
  const row=panel.getByRole('listitem').filter({has:page.getByText('Campaign title',{exact:true})}),input=row.getByRole('textbox'),reason=panel.getByRole('textbox',{name:'Reason for changing saved wording',exact:true});
  const commandPath=`/api/engagement/campaigns/${campaignId}/translations/commands`,generationPath=`/api/engagement/campaigns/${campaignId}/translations/generation`,historyPath=`/api/engagement/campaigns/${campaignId}/translations/history`;
  const baselineWords=`SINTÉTICO original manual ${width}`,outputText=`\u00a0SINTÉTICO resultado retenido ${width}\ufeff`;
  await page.route('**'+commandPath,async route=>{try{const intent=route.request().postDataJSON();commands.push(intent);if(intent.operation==='publish_generated'&&publicationLoss){publicationLoss=false;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');return}await route.continue()}catch(e){routeError=e;await route.abort('failed').catch(()=>{})}});
  await input.fill(baselineWords);const baselineResponse=handled(page.waitForResponse(r=>r.url().endsWith(commandPath)&&r.status()===200));await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));const saved=await(await baselineResponse).json();
  await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);await expect(input).toBeEditable();
  originalHistory=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Original history unavailable');return(await r.json()).history},historyPath);expect(originalHistory).toHaveLength(1);
  checkpoint('manual baseline saved');
  await page.route('**'+generationPath,async route=>{if(route.request().method()!=='POST')return route.continue();try{const intent=route.request().postDataJSON();requests.push(intent);if(generationLoss){generationLoss=false;const response=await route.fetch();expect(response.status()).toBe(202);await route.abort('failed');return}await route.continue()}catch(e){routeError=e;await route.abort('failed').catch(()=>{})}});
  await keyClick(page,row.getByRole('button',{name:'Generate translation for review',exact:true}));await expect(panel.getByRole('button',{name:'Retry same generation request',exact:true})).toBeEnabled();
  expect(requests).toHaveLength(1);requestId=requests[0].requestId;fieldId=requests[0].fields[0].id;expect(requests[0].fields).toHaveLength(1);expect(requests[0].fields[0].address.expectedTranslation).toEqual({id:saved.entries[0].entry.id,revision:1});
  for(const value of [requestId,fieldId])if(!/^[a-f0-9-]{36}$/.test(value))throw Error('Invalid synthetic queue identity');
  checkpoint('generation acknowledgement lost');
  const downloadPending=handled(page.waitForEvent('download'));await keyClick(page,panel.getByRole('button',{name:'Download generation request',exact:true}));const download=await downloadPending;const retainedPath=path.join(prefix,width+'-generation-request.json');await download.saveAs(retainedPath);expect(JSON.parse(fs.readFileSync(retainedPath)).intent).toEqual(requests[0]);
  await keyClick(page,panel.getByRole('button',{name:'Retry same generation request',exact:true}));const outputPanel=panel.getByRole('region',{name:'Retained machine output',exact:true});await expect(outputPanel).toBeVisible();expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  expect(sql(`select count(*) from engagement_translation_generation_requests where id='${requestId}'`)).toBe('1');
  expect(sql(`select string_agg(id::text,',') from engagement_translation_generation_fields where state in ('queued','reserved','running')`)).toBe(fieldId);
  expect(await outputPanel.getByRole('button',{name:'Publish this retained output with a machine label',exact:true}).count()).toBe(0);
  const directory=path.join(prefix,width+'-worker');fs.mkdirSync(directory,{mode:0o700});const configPath=path.join(prefix,width+'-worker-config.json');fs.writeFileSync(configPath,JSON.stringify({requestId,fieldId,sourceText:title,outputText}),{mode:0o600});
  checkpoint('exact generation retry recovered queued request');
  const workerResults=[];
  for(const [mode,exit] of [['output-loss',1],['resume',0]]){
   const run=spawnSync('node',['--env-file-if-exists=.env.local','--conditions=react-server','--import','tsx',path.join(__dirname,'translation-generation-browser-worker.ts'),configPath,directory,mode],{cwd:app,env:{...process.env,ANTHROPIC_API_KEY:'SYNTHETIC-TRANSLATION-BROWSER-KEY',OPENPLAN_ENGAGEMENT_TRANSLATION_MODEL:'synthetic-browser-model'},encoding:'utf8',timeout:45000});
   fs.writeFileSync(path.join(prefix,width+'-worker-'+mode+'.log'),run.stdout+run.stderr,{mode:0o600});expect(run.status,'worker '+mode).toBe(exit);workerResults.push({mode,exit:run.status,output:run.stdout.trim()});
   const journal=JSON.parse(fs.readFileSync(path.join(directory,'pending.json')));expect(journal.phase).toBe(mode==='output-loss'?'completed':'delivered');
  }
  expect(fs.readFileSync(path.join(directory,'provider-events.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
  checkpoint('worker output recovered without another provider call');
  await keyClick(page,outputPanel.getByRole('button',{name:'Refresh request status',exact:true}));await expect(outputPanel.getByText(outputText,{exact:true})).toBeVisible();
  await outputPanel.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(prefix,width+'-retained-output.png')});
  await reason.fill('SYNTHETIC reviewed publication reason');await keyClick(page,outputPanel.getByRole('button',{name:'Publish this retained output with a machine label',exact:true}));
  await keyClick(page,page.getByRole('alertdialog',{name:'Publish this retained output to the public portal?',exact:true}).getByRole('button',{name:'Publish as a machine translation',exact:true}));
  await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeEnabled();const firstPublication=commands.at(-1);expect(firstPublication.operation).toBe('publish_generated');
  await keyClick(page,panel.getByRole('button',{name:'Retry same translation request',exact:true}));await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toHaveCount(0);expect(commands.at(-1)).toEqual(firstPublication);
  await expect(input).toHaveValue(outputText);await expect(row.getByRole('button',{name:'Accept as our wording',exact:true})).toBeEnabled();checkpoint('retained publication recovered');
  await reason.fill('SYNTHETIC acceptance after reviewing retained output');await keyClick(page,row.getByRole('button',{name:'Accept as our wording',exact:true}));await keyClick(page,page.getByRole('alertdialog').getByRole('button',{name:'Accept this wording',exact:true}));await expect(row.getByRole('button',{name:'Accept as our wording',exact:true})).toHaveCount(0);await expect(input).toHaveValue(outputText);
  await keyClick(page,panel.getByRole('button',{name:'Translation history',exact:true}));const history=panel.getByRole('region',{name:'Translation history',exact:true});await expect(history).toBeVisible();
  const finalHistory=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Final history unavailable');return(await r.json()).history},historyPath);
  expect(finalHistory).toHaveLength(3);expect(finalHistory.find(r=>r.id===originalHistory[0].id)).toEqual(originalHistory[0]);expect(JSON.stringify(finalHistory)).toContain(fieldId);expect(JSON.stringify(finalHistory)).toContain('SYNTHETIC reviewed publication reason');
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(prefix,width+'-history.png')});
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(width);expect(consoleEvents.filter(e=>e.type==='pageerror')).toEqual([]);if(routeError)throw routeError;
  results.push({width,campaignId,requestId,fieldId,passed:true,workerResults,providerCalls:1,requestDownloadSha256:sha(fs.readFileSync(retainedPath)),originalHistory,finalHistory,overflow,console:consoleEvents});save('results.json',results);checkpoint('generation review publication and acceptance passed');
 }catch(error){save(width+'-failure.json',{message:error.message,campaignId,requestId,fieldId,requests,commands,console:consoleEvents});await page.screenshot({path:path.join(prefix,width+'-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(prefix,width+'-failure.txt'),await page.locator('body').ariaSnapshot().catch(()=>''),{mode:0o600});throw error}
 finally{await context.close()}
}
(async()=>{
 fs.writeFileSync(path.join(prefix,'identity.log'),execFileSync('bash',[path.join(app,'scripts/ops/which-openplan.sh'),base],{cwd:root,encoding:'utf8'}));
 expect(sql("select count(*)||':'||max(version) from supabase_migrations.schema_migrations")).toBe('336:20261014000017');
 expect(sql("select count(*) from engagement_translation_generation_fields where state in ('queued','reserved','running')")).toBe('0');
 console.log('Generation browser evidence',prefix);
 const browser=await chromium.launch({channel:'chrome',headless:true});try{for(const width of [1440,390])await journey(browser,width)}finally{await browser.close()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
