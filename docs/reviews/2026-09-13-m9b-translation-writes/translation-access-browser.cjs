const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000});
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=require('node:path').resolve(__dirname,'../../..');
const evidence='/home/nathaniel/.local/state/openplan/response-write-probe-20260913',base='http://127.0.0.1:3260';
const owner=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const viewer=JSON.parse(fs.readFileSync(evidence+'/history-viewer-account.json'));
const prior=JSON.parse(fs.readFileSync(evidence+'/translation-editor-1440-1789326191255-result.json'));
const campaignId=prior.campaignId,request=prior.commands[0],original=request.entries[0].text,title=request.entries[0].expectedSource.text;
if(!/^[a-f0-9-]{36}$/.test(campaignId)||!title.startsWith('SYNTHETIC '))throw Error('Expected retained synthetic UI fixture');
const control=process.env.OPENPLAN_TRANSLATION_ACCESS_CONTROL??'baseline';
const prefix=evidence+'/translation-access-'+control+'-'+Date.now();
const outsider={email:`translation-outsider-${crypto.randomUUID()}@openplan.test`,password:crypto.randomBytes(24).toString('base64url'),organization:'SYNTHETIC outsider workspace'};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['openplan/src/app/cartographic.css','openplan/src/components/workspaces/workspace-switcher.tsx','openplan/src/components/cartographic/cartographic-header.tsx','openplan/src/components/engagement/campaign-translations-panel.tsx','openplan/src/components/engagement/translation-write-recovery.tsx','openplan/src/components/engagement/translation-history.tsx','openplan/src/lib/engagement/api.ts','openplan/src/lib/engagement/translation-snapshot.ts','openplan/src/lib/engagement/translation-history-server.ts','openplan/src/app/(app)/engagement/[campaignId]/page.tsx',...['commands','snapshot','history'].map(name=>`openplan/src/app/api/engagement/campaigns/[campaignId]/translations/${name}/route.ts`)];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,sha(fs.readFileSync(root+'/'+file))]));
const sql=query=>execFileSync('docker',['exec','supabase_db_openplan-restore-target-2026091050','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
const workspaceName=sql("SELECT name FROM workspaces WHERE id='"+prior.originalHistory.record.workspace_id+"'");
async function keyClick(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter');}
async function credentials(page,account){await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);}
async function login(page,account){await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await credentials(page,account);await keyClick(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));}
async function engagement(page){await keyClick(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');}
async function campaign(page){await engagement(page);await keyClick(page,page.locator(`a[href="/engagement/${campaignId}"]`).first());await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`);await keyClick(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));return page.locator('article').filter({has:page.getByRole('heading',{name:/Publish this campaign in your community/})});}
async function api(page,endpoint,body){return page.evaluate(async({campaignId,endpoint,body})=>{const response=await fetch(`/api/engagement/campaigns/${campaignId}/translations/${endpoint}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};},{campaignId,endpoint,body});}
const consoleEvents=[],network=[],results=[];
(async()=>{
 const before=sourceHashes();fs.writeFileSync(prefix+'-identity.log',execFileSync('bash',[root+'/openplan/scripts/ops/which-openplan.sh',base],{cwd:root,encoding:'utf8'}));
 expect(sql("select count(*)||':'||max(version) from supabase_migrations.schema_migrations")).toBe('331:20261014000012');
 expect(sql("select has_function_privilege('authenticated','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE')")).toBe('t');
 if(process.env.OPENPLAN_TRANSLATION_CLEANUP_PROBE==='control')process.exit(0);
 if(process.env.OPENPLAN_TRANSLATION_CLEANUP_PROBE==='1')process.exit(23);
 const browser=await chromium.launch({channel:'chrome',headless:true});const contexts=[];let active;
 async function pageFor(role,width){const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(60000);page.on('console',m=>{if(['error','warning'].includes(m.type()))consoleEvents.push({role,width,type:m.type(),text:m.text()})});page.on('pageerror',e=>consoleEvents.push({role,width,type:'pageerror',text:e.message}));page.on('requestfailed',r=>network.push({role,width,url:r.url(),error:r.failure()?.errorText}));active=page;return page;}
 try{
  const registration=await pageFor('outsider-signup',1440);await registration.goto(base);await registration.getByRole('link',{name:/Sign in/i}).first().click();await registration.getByRole('link',{name:/Create.*account/i}).click();
  await registration.getByLabel('Organization',{exact:true}).fill(outsider.organization);await credentials(registration,outsider);await keyClick(registration,registration.getByRole('button',{name:'Create account',exact:true}));await registration.waitForURL(u=>u.pathname==='/sign-in');
  fs.writeFileSync(prefix+'-outsider-account.json',JSON.stringify(outsider),{mode:0o600});await registration.context().close();
  for(const width of (control.endsWith('-leak')?[1440]:[1440,390])){
   console.log('Checking translation access',width,prefix);
   const staff=await pageFor('staff',width);await login(staff,owner);const staffPanel=await campaign(staff);
   const beforeHistory=await api(staff,'history');expect(beforeHistory.status).toBe(200);expect(beforeHistory.body.history).toHaveLength(6);
   const first=beforeHistory.body.history.find(row=>row.id===prior.originalHistory.id);expect(first).toEqual(prior.originalHistory);
   await keyClick(staff,staffPanel.getByRole('button',{name:'Translation history',exact:true}));
   const history=staffPanel.getByRole('region',{name:'Translation history',exact:true});await history.getByRole('combobox',{name:'Translation, including withdrawn entries'}).selectOption(prior.originalHistory.translation_id);await expect(history.getByText(original,{exact:true})).toBeVisible();await history.scrollIntoViewIfNeeded();await staff.screenshot({path:prefix+`-staff-${width}.png`});
   const replay=await api(staff,'commands',request);expect(replay.status).toBe(200);expect(replay.body.replayed).toBe(true);expect(replay.body.requestId).toBe(request.requestId);
   const reader=await pageFor('viewer',width);await login(reader,viewer);await keyClick(reader,reader.getByRole('banner').getByRole('button',{name:'SYNTHETIC history viewer acceptance',exact:true}));await keyClick(reader,reader.getByRole('listbox',{name:'Switch workspace'}).getByRole('button',{name:workspaceName,exact:true}));await expect(reader.getByRole('listbox',{name:'Switch workspace'})).toHaveCount(0);const panel=await campaign(reader);await expect(panel.getByText(/Your workspace role can read/)).toBeVisible();expect(await panel.getByRole('button',{name:'Translation history',exact:true}).count()).toBe(0);expect(await panel.getByRole('button',{name:'Save as our wording',exact:true}).count()).toBe(0);
   const snapshot=await api(reader,'snapshot');expect(snapshot.status).toBe(200);expect(snapshot.body.snapshot.translations).toHaveLength(1);expect(snapshot.body.snapshot.translations[0].translated_text).toBe('SINTÉTICO nueva copia 1440');expect(JSON.stringify(snapshot.body)).not.toContain(original);
   if(control==='harmless')await reader.route('**/translations/history',route=>route.continue());
   if(control==='viewer-history-leak')await reader.route('**/translations/history',route=>route.fulfill({status:403,headers:{'cache-control':'private, no-store'},json:{error:'SYNTHETIC denied but leaking',history:[prior.originalHistory]}}));
   const deniedHistory=await api(reader,'history'),deniedWrite=await api(reader,'commands',request);expect(deniedHistory.status).toBe(403);expect(deniedWrite.status).toBe(403);
   for(const denied of [deniedHistory,deniedWrite]){expect(denied.cache).toBe('private, no-store');assert.equal(denied.body.history,undefined,'Viewer refusal contains no private history');expect(JSON.stringify(denied.body)).not.toContain(original);expect(denied.body.entries).toBeUndefined();}
   await expect(reader.locator('body')).not.toContainText(original);await panel.getByText(/Your workspace role can read/).scrollIntoViewIfNeeded();await reader.screenshot({path:prefix+`-viewer-${width}.png`});
   const other=await pageFor('outsider',width);await login(other,outsider);await engagement(other);expect(await other.locator(`a[href="/engagement/${campaignId}"]`).count()).toBe(0);await expect(other.locator('body')).not.toContainText(title);await other.screenshot({path:prefix+`-outsider-list-${width}.png`});
   if(control==='outsider-snapshot-leak')await other.route('**/translations/snapshot',route=>route.fulfill({status:404,headers:{'cache-control':'private, no-store'},json:{error:'SYNTHETIC denied but leaking',snapshot:{campaignId,title}}}));
   const denied=[];for(const endpoint of ['snapshot','history','commands']){const result=await api(other,endpoint,endpoint==='commands'?request:undefined);expect(result.status).toBe(404);expect(result.cache).toBe('private, no-store');expect(JSON.stringify(result.body)).not.toContain(original);expect(result.body.history).toBeUndefined();assert.equal(result.body.snapshot,undefined,'Outsider refusal contains no campaign snapshot');expect(result.body.entries).toBeUndefined();denied.push({endpoint,status:result.status});}
   const target=await other.goto(base+`/engagement/${campaignId}`);await expect(other.getByRole('heading',{name:/Publish this campaign in your community/})).toHaveCount(0);await expect(other.locator('body')).not.toContainText(title);await expect(other.locator('body')).not.toContainText(original);await other.screenshot({path:prefix+`-outsider-direct-${width}.png`});
   const anonymous=await pageFor('anonymous',width);await anonymous.goto(base);const anonymousStatuses=[];for(const endpoint of ['snapshot','history','commands']){const result=await api(anonymous,endpoint,endpoint==='commands'?request:undefined);expect(result.status).toBe(401);expect(JSON.stringify(result.body)).not.toContain(original);anonymousStatuses.push({endpoint,status:result.status});}
   const afterHistory=await api(staff,'history');expect(afterHistory.body).toEqual(beforeHistory.body);
   const overflow=[];for(const page of [staff,reader,other]){const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(dimensions.document).toBeLessThanOrEqual(width);overflow.push(dimensions);}
   results.push({width,staffReplay:replay.status,historyUnchanged:true,viewerSnapshot:snapshot.status,viewerHistory:deniedHistory.status,viewerWrite:deniedWrite.status,outsider:denied,outsiderPageStatus:target?.status(),anonymous:anonymousStatuses,overflow});
   for(const page of [staff,reader,other,anonymous])await page.context().close();console.log('Staff, viewer, outsider and anonymous checks passed',width);
  }
  expect(consoleEvents.filter(row=>row.type==='pageerror')).toEqual([]);expect(sourceHashes()).toEqual(before);
  fs.writeFileSync(prefix+'-result.json',JSON.stringify({passed:true,control,source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:before,campaignId,fixture:'Retained campaign and viewer originated through real UI; new outsider signed up through UI in this run.',results,console:consoleEvents,network},null,2));
 }catch(error){if(active&&!active.isClosed()){await active.screenshot({path:prefix+'-failure.png'}).catch(()=>{});fs.writeFileSync(prefix+'-failure-aria.txt',await active.locator('body').ariaSnapshot().catch(()=>''));}fs.writeFileSync(prefix+'-failure.json',JSON.stringify({control,message:error.message,results,console:consoleEvents,network},null,2));throw error;}
 finally{await browser.close();}
})().catch(error=>{let message=error.message;for(const account of [owner,viewer,outsider])message=message.replaceAll(account.password,'[redacted]');console.error(message);process.exitCode=1});
