const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000});
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=require('node:path').resolve(__dirname,'../../..');
const evidence='/home/nathaniel/.local/state/openplan/response-write-probe-20260913';
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const base='http://127.0.0.1:3260',container='supabase_db_openplan-restore-target-2026091050';
const signature='public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)';
const sourceFiles=['openplan/src/components/engagement/campaign-translations-panel.tsx','openplan/src/components/engagement/translation-write-recovery.tsx',
 'openplan/src/lib/engagement/campaign-translations.ts','openplan/src/lib/engagement/pending-translation.ts','openplan/src/lib/engagement/translation-write.ts',
 'openplan/src/app/api/engagement/campaigns/[campaignId]/translations/commands/route.ts','openplan/src/app/api/engagement/campaigns/[campaignId]/translations/snapshot/route.ts'];
sourceFiles.push('openplan/src/components/engagement/translation-draft-recovery.tsx','openplan/src/lib/engagement/translation-drafts.ts','openplan/src/lib/engagement/translation-snapshot.ts','openplan/src/app/(app)/engagement/[campaignId]/page.tsx');
const handled=promise=>{promise.catch(()=>{});return promise;};
const responseFor=(page,predicate)=>handled(page.waitForResponse(predicate));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(p=>[p,sha(fs.readFileSync(root+'/'+p))]));
const sql=query=>execFileSync('docker',['exec',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
async function keyClick(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter');}
async function login(page){
 await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();
 await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('sign-in'));
 await keyClick(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');
}
const panelFor=page=>page.locator('article').filter({has:page.getByRole('heading',{name:/Publish this campaign in your community/})});
const titleRow=panel=>panel.getByRole('listitem').filter({hasText:'Campaign title'}).filter({has:panel.getByRole('textbox')});
async function setup(page){await page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}).click();
 const panel=panelFor(page);await keyClick(page,panel.getByRole('button',{name:/Español.*Spanish/}));
 const row=panel.getByRole('listitem').filter({has:page.getByText('Campaign title',{exact:true})});
 return {panel,row,input:row.getByRole('textbox'),reason:panel.getByRole('textbox',{name:'Reason for changing saved wording',exact:true})};}
async function journey(browser,width){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);
 const prefix=`${evidence}/translation-editor-${width}-${Date.now()}`;
 let otherContext,campaignId,lostReceipt,loseFirst=true;const commands=[],consoleEvents=[],network=[];
 const observe=p=>{p.on('console',m=>{if(['error','warning'].includes(m.type()))consoleEvents.push({type:m.type(),text:m.text()})});p.on('pageerror',e=>consoleEvents.push({type:'pageerror',text:e.message}));p.on('requestfailed',r=>network.push({url:r.url(),method:r.method(),error:r.failure()?.errorText}));};observe(page);
 try{
  console.log('Starting real navigation',width,prefix);await login(page);await page.getByRole('button',{name:'New campaign',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Next',exact:true}).click();const title=`SYNTHETIC translation command ${width} ${Date.now()}`;
  await dialog.getByLabel('Title',{exact:true}).fill(title);await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByRole('button',{name:'Create campaign',exact:true}).click();
  await page.waitForURL(u=>/^\/engagement\/[-a-f0-9]{36}$/.test(u.pathname));campaignId=new URL(page.url()).pathname.split('/').pop();
  const {panel,row,input,reason}=await setup(page);const path=`/api/engagement/campaigns/${campaignId}/translations/commands`;
  const original=`\u00a0SINTÉTICO original ${width}\ufeff`,corrected=`\u00a0SINTÉTICO corrección ${width}\ufeff`,reviewed=`\u00a0SINTÉTICO revisado ${width}\ufeff`,colleague=`SINTÉTICO otra corrección ${width}`;
  await page.route('**'+path,async route=>{commands.push(route.request().postDataJSON());if(loseFirst){loseFirst=false;const response=await route.fetch();expect(response.status()).toBe(200);lostReceipt=await response.json();await route.abort('failed');}else await route.continue();});
  await input.fill(original);await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));
  await expect(panel.getByRole('region',{name:'Pending translation change',exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeEnabled();
  await expect(input).toHaveValue(original);expect(lostReceipt.entries[0].entry.translated_text).toBe(original);
  expect(commands[0].entries[0].expectedSource).toEqual({text:title,sourceLocale:null,available:true});expect(commands[0].entries[0].expectedTranslation).toBeNull();
  await panel.getByRole('region',{name:'Translation save recovery',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-unconfirmed.png'});
  await page.reload();await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeVisible();
  const replayResponse=responseFor(page,r=>r.url().endsWith(path)&&r.request().method()==='POST');
  await keyClick(page,panel.getByRole('button',{name:'Retry same translation request',exact:true}));const replay=await (await replayResponse).json();
  expect(replay.replayed).toBe(true);expect(commands[1]).toEqual(commands[0]);expect(replay.entries).toEqual(lostReceipt.entries);
  await expect(panel.getByRole('region',{name:'Pending translation change',exact:true})).toHaveCount(0);await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);
  await expect(input).toHaveValue(original);await expect(input).toBeEditable();console.log('Original replay confirmed',width);
  const historyPath=`/api/engagement/campaigns/${campaignId}/translations/history`;
  const historyResponse=responseFor(page,r=>r.url().endsWith(historyPath)&&r.status()===200);
  await keyClick(page,panel.getByRole('button',{name:'Translation history',exact:true}));const firstHistory=(await (await historyResponse).json()).history;
  expect(firstHistory).toHaveLength(1);const retainedOriginal=firstHistory[0];expect(retainedOriginal.record.translated_text).toBe(original);
  await input.fill(corrected);const beforeMissingReason=commands.length;await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));
  await expect(panel.getByText(/No translation was sent. Enter nonblank wording/)).toBeVisible();expect(commands.length).toBe(beforeMissingReason);
  await reason.fill('\u00a0SYNTHETIC reason for correction\ufeff');const correctionResponse=responseFor(page,r=>r.url().endsWith(path)&&r.status()===200);
  await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));const correction=await (await correctionResponse).json();
  expect(correction.entries[0].revision).toBe(2);expect(correction.entries[0].entry.translated_text).toBe(corrected);expect(commands[2].reason).toBe('\u00a0SYNTHETIC reason for correction\ufeff');
  await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);await expect(input).toHaveValue(corrected);await expect(input).toBeEditable();
  await input.fill(reviewed);await page.reload();await expect(input).toHaveValue(reviewed);await expect(input).toBeEditable();console.log('Unsent draft survived reload',width);
  otherContext=await browser.newContext({viewport:{width,height:1000}});const other=await otherContext.newPage();other.setDefaultTimeout(60000);observe(other);
  await login(other);await keyClick(other,other.locator(`a[href="/engagement/${campaignId}"]`).first());await other.waitForURL(u=>u.pathname===`/engagement/${campaignId}`);
  const second=await setup(other);await second.input.fill(colleague);await second.reason.fill('SYNTHETIC second editor correction');
  const otherWrite=responseFor(other,r=>r.url().endsWith(path)&&r.status()===200);await keyClick(other,second.row.getByRole('button',{name:'Save as our wording',exact:true}));
  expect((await (await otherWrite).json()).entries[0].revision).toBe(3);await otherContext.close();otherContext=null;
  await page.bringToFront();await expect(input).toHaveValue(reviewed);console.log('Competing correction committed',width);await reason.fill('SYNTHETIC stale proposal');const refused=responseFor(page,r=>r.url().endsWith(path)&&r.status()===409);
  await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));await refused;
  await expect(panel.getByRole('button',{name:'Review current saved translations',exact:true})).toBeEnabled();
  const conflictCommand=commands.at(-1);expect(conflictCommand.entries[0].expectedTranslation.revision).toBe(2);
  await keyClick(page,panel.getByRole('button',{name:'Review current saved translations',exact:true}));
  const pending=panel.getByRole('region',{name:'Pending translation change',exact:true});await expect(pending.getByText(colleague,{exact:false})).toBeVisible();
  if(process.env.OPENPLAN_TRANSLATION_LAYOUT_CONTROL==='harmless')await page.addStyleTag({content:'[aria-label="Pending translation change"] {outline-color:transparent}'});
  if(process.env.OPENPLAN_TRANSLATION_LAYOUT_CONTROL==='overflow')await page.addStyleTag({content:'[aria-label="Pending translation change"] button {width:1000px!important;max-width:none!important}'});
  const controls=await pending.getByRole('button').evaluateAll(buttons=>buttons.map(button=>{const box=button.getBoundingClientRect(),parent=button.closest('section').getBoundingClientRect();return {label:button.textContent,left:box.left,right:box.right,parentLeft:parent.left,parentRight:parent.right}}));
  for(const control of controls)expect(control.left>=control.parentLeft-1&&control.right<=control.parentRight+1,'Recovery control is inside its panel: '+control.label).toBe(true);
  await pending.scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-conflict-review.png'});
  await keyClick(page,panel.getByRole('button',{name:'Keep this copy and reopen editor',exact:true}));await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);
  await expect(input).toHaveValue(reviewed);await expect(reason).toHaveValue('');await reason.fill('SYNTHETIC reviewed current version');
  const reviewedResponse=responseFor(page,r=>r.url().endsWith(path)&&r.status()===200);await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));
  const reviewedReceipt=await (await reviewedResponse).json();expect(reviewedReceipt.entries[0].revision).toBe(4);expect(commands.at(-1).requestId).not.toBe(conflictCommand.requestId);expect(commands.at(-1).entries[0].expectedTranslation.revision).toBe(3);
  await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);await reason.fill('SYNTHETIC withdrawal reason');
  await keyClick(page,row.getByRole('button',{name:'Withdraw',exact:true}));const withdrawalResponse=responseFor(page,r=>r.url().endsWith(path)&&r.status()===200);
  await keyClick(page,page.getByRole('alertdialog').getByRole('button',{name:'Withdraw this translation',exact:true}));const withdrawn=await (await withdrawalResponse).json();expect(withdrawn.entries[0].removed).toBe(true);expect(withdrawn.entries[0].revision).toBe(5);
  await expect(input).toHaveValue('');await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);
  const recreatedWords=`SINTÉTICO nueva copia ${width}`;await input.fill(recreatedWords);const recreationResponse=responseFor(page,r=>r.url().endsWith(path)&&r.status()===200);
  await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));const recreated=await (await recreationResponse).json();expect(recreated.entries[0].revision).toBe(1);expect(recreated.entries[0].entry.id).not.toBe(lostReceipt.entries[0].entry.id);
  await expect(panel.getByRole('button',{name:'Refresh saved translations',exact:true})).toHaveCount(0);
  await expect(input).toBeEditable();await keyClick(page,panel.getByRole('button',{name:'Translation history',exact:true}));
  const history=panel.getByRole('region',{name:'Translation history',exact:true});
  const chooser=history.getByRole('combobox',{name:'Translation, including withdrawn entries'});
  await chooser.selectOption(lostReceipt.entries[0].entry.id);await expect(history.getByText(original,{exact:true})).toBeVisible();console.log('Original visible after withdrawal and recreation',width);
  const finalHistory=await page.evaluate(async path=>{const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error('History read failed');return(await response.json()).history},historyPath);
  expect(finalHistory).toHaveLength(6);expect(finalHistory.find(row=>row.id===retainedOriginal.id)).toEqual(retainedOriginal);
  const archived=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('openplan:translation-archive:')).map(key=>localStorage.getItem(key)));
  expect(archived).toHaveLength(1);expect(JSON.parse(archived[0]).intent).toEqual(conflictCommand);
  await panel.getByText('Earlier translation requests (1)',{exact:true}).click();const downloadEvent=handled(page.waitForEvent('download'));
  await keyClick(page,panel.getByRole('button',{name:'Download earlier request 1',exact:true}));const download=await downloadEvent;const copy=prefix+'-retained-request.json';await download.saveAs(copy);expect(sha(fs.readFileSync(copy))).toBe(sha(archived[0]));
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-retained-history.png'});
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
  expect(consoleEvents.filter(row=>row.type==='pageerror')).toEqual([]);
  if(!/^[a-f0-9-]{36}$/.test(campaignId))throw Error('Invalid fixture id');
  const custody=JSON.parse(sql(`select jsonb_agg(jsonb_build_object('request',request_id,'reason',payload->'reason','resultHash',result_sha256)) from engagement_translation_write_receipts where campaign_id='${campaignId}'`));
  expect(custody.some(row=>row.reason==='SYNTHETIC withdrawal reason')).toBe(true);expect(custody.some(row=>row.reason==='\u00a0SYNTHETIC reason for correction\ufeff')).toBe(true);
  fs.writeFileSync(prefix+'-result.json',JSON.stringify({passed:true,width,campaignId,layoutControl:process.env.OPENPLAN_TRANSLATION_LAYOUT_CONTROL??'none',controls,commands,originalHistory:retainedOriginal,finalHistory,custody,downloadSha256:sha(fs.readFileSync(copy)),overflow,console:consoleEvents,network},null,2));console.log('Browser journey passed',width,prefix);
 }catch(error){fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot().catch(()=>''));await page.screenshot({path:prefix+'-failure.png'}).catch(()=>{});fs.writeFileSync(prefix+'-failure.json',JSON.stringify({campaignId,message:error.message,commands,console:consoleEvents,network},null,2));throw error;}
 finally{await Promise.allSettled([otherContext?.close(),context.close()]);}
}
(async()=>{
 const before=sourceHashes();const identity=execFileSync('bash',[root+'/openplan/scripts/ops/which-openplan.sh',base],{cwd:root,encoding:'utf8'});fs.writeFileSync(evidence+'/translation-editor-browser-identity.log',identity);
 expect(sql('select count(*)||\':\'||max(version) from supabase_migrations.schema_migrations')).toBe('330:20261014000011');
 expect(sql(`select has_function_privilege('authenticated','${signature}','EXECUTE')`)).toBe('t');
 if(process.env.OPENPLAN_TRANSLATION_CLEANUP_PROBE==='control')process.exit(0);
 if(process.env.OPENPLAN_TRANSLATION_CLEANUP_PROBE==='1')process.exit(23);
 let browser;
 try{browser=await chromium.launch({channel:'chrome',headless:true});for(const width of (process.env.OPENPLAN_TRANSLATION_LAYOUT_CONTROL==='overflow'?[390]:[1440,390]))await journey(browser,width);}
 finally{try{if(browser)await browser.close();}finally{expect(sourceHashes()).toEqual(before);fs.writeFileSync(evidence+'/translation-editor-browser-source.json',JSON.stringify({sourceHashes:before},null,2));}}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
