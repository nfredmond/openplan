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
sourceFiles.push('openplan/src/lib/engagement/translation-history.ts','openplan/src/lib/engagement/translation-history-server.ts','openplan/src/components/engagement/translation-history.tsx','openplan/supabase/migrations/20261014000012_engagement_translation_history_receipts.sql','openplan/supabase/migrations/20261014000017_engagement_translation_command_activation.sql','openplan/supabase/migrations/20261014000018_engagement_translation_shared_reads.sql','openplan/supabase/migrations/20261014000019_engagement_translation_generation_resolution.sql');
sourceFiles.push('openplan/src/lib/engagement/translation-publication.ts','openplan/src/lib/engagement/translation-publication-reference.ts','openplan/src/lib/engagement/translation-generation-request.ts','openplan/src/lib/engagement/translation-publication-server.ts','openplan/src/lib/engagement/translation-generation-read.ts');
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
 await page.waitForURL(u=>u.pathname.startsWith('/engagement/')&&u.searchParams.get('tab')==='setup');
 const panel=panelFor(page);await keyClick(page,panel.getByRole('button',{name:/Español.*Spanish/}));
 const row=panel.getByRole('listitem').filter({has:page.getByText('Campaign title',{exact:true})});
 return {panel,row,input:row.getByRole('textbox'),reason:panel.getByRole('textbox',{name:'Reason for changing saved wording',exact:true})};}
async function exerciseDraftStorage(page,panel,input,campaignId,prefix){
 const first='\u00a0SYNTHETIC unsent draft\ufeff',latest=first+' latest',proposed=first+' proposal';
 const damaged='\u00a0{SYNTHETIC damaged browser copy\ufeff';
 const captures=[];
 const download=async(label,suffix)=>{
  const pending=handled(page.waitForEvent('download'));await keyClick(page,panel.getByRole('button',{name:label,exact:true}));
  const result=await pending;const filename=prefix+suffix;await result.saveAs(filename);const bytes=fs.readFileSync(filename);
  captures.push({filename,sha256:sha(bytes)});return bytes.toString('utf8');
 };
 const restore=()=>page.evaluate(()=>{window.__translationStorageProbeRestore?.();delete window.__translationStorageProbeRestore;});
 try{
  await input.fill(first);
  const observed=await page.evaluate(campaign=>{const key=Object.keys(sessionStorage).find(key=>key.startsWith('openplan:translation-drafts:')&&key.endsWith(':'+campaign));if(!key)throw Error('Draft was not retained');return{key,raw:sessionStorage.getItem(key)}},campaignId);
  expect(JSON.parse(observed.raw).entries[0].text).toBe(first);
  await page.evaluate(key=>{const original=Storage.prototype.setItem;window.__translationStorageProbeRestore=()=>{Storage.prototype.setItem=original};Storage.prototype.setItem=function(name,value){if(this===sessionStorage&&name===key)throw new DOMException('SYNTHETIC quota full','QuotaExceededError');return original.call(this,name,value)}},observed.key);
  await input.fill(latest);await expect(panel.getByText(/could not retain the latest draft/)).toBeVisible();
  await keyClick(page,panel.getByRole('button',{name:'Retry retaining latest draft',exact:true}));await expect(input).toHaveValue(latest);
  await panel.getByText('Unsaved translation drafts',{exact:true}).click();
  const pageDraft=JSON.parse(await download('Download unsaved drafts','-quota-page-draft.json'));expect(pageDraft.entries[0].text).toBe(latest);
  await panel.getByText('Unsaved translation drafts',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-quota-draft.png'});
  await restore();await keyClick(page,panel.getByRole('button',{name:'Retry retaining latest draft',exact:true}));
  expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).entries[0].text,observed.key)).toBe(latest);
  await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key:observed.key,raw:damaged});
  await input.fill(proposed);await expect(panel.getByRole('button',{name:'Retry retaining latest draft',exact:true})).toBeVisible();
  await keyClick(page,panel.getByRole('button',{name:'Retry retaining latest draft',exact:true}));
  expect(await page.evaluate(key=>sessionStorage.getItem(key),observed.key)).toBe(damaged);await expect(input).toHaveValue(proposed);
  expect(await download('Download stored draft copy','-damaged-stored-copy.json')).toBe(damaged);
  await page.evaluate(key=>{const original=Storage.prototype.setItem;let count=0;window.__translationStorageProbeRestore=()=>{Storage.prototype.setItem=original};Storage.prototype.setItem=function(name,value){if(this===sessionStorage&&name.startsWith(key+':archive:')&&++count===2)throw new DOMException('SYNTHETIC second archive quota failure','QuotaExceededError');return original.call(this,name,value)}},observed.key);
  await keyClick(page,panel.getByRole('button',{name:'Preserve these drafts and start fresh',exact:true}));
  await expect(panel.getByText(/draft copy could not be preserved/)).toBeVisible();await expect(input).toHaveValue(proposed);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),observed.key)).toBe(damaged);
  await panel.getByText('Unsaved translation drafts',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-interrupted-archive.png'});
  await restore();await keyClick(page,panel.getByRole('button',{name:'Preserve these drafts and start fresh',exact:true}));await expect(input).toHaveValue('');await expect(input).toBeEditable();
  const copies=await page.evaluate(key=>Object.keys(sessionStorage).filter(name=>name.startsWith(key+':archive:')).map(name=>sessionStorage.getItem(name)),observed.key);
  expect(copies).toHaveLength(3);expect(copies.filter(raw=>raw===damaged)).toHaveLength(2);
  expect(copies.some(raw=>raw!==damaged&&JSON.parse(raw).entries[0].text===proposed)).toBe(true);
  await panel.getByText('Earlier unsaved draft copies (3)',{exact:true}).click();
  for(let i=0;i<copies.length;i++)expect(sha(await download(`Download earlier draft copy ${i+1}`,`-archive-${i+1}.json`))).toBe(sha(copies[i]));
  const unreadable=damaged+' after reload';await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key:observed.key,raw:unreadable});await page.reload();
  await expect(input).toHaveAttribute('readonly','');await expect(panel.getByRole('button',{name:'Retry unsaved draft recovery',exact:true})).toBeVisible();
  await keyClick(page,panel.getByRole('button',{name:'Retry unsaved draft recovery',exact:true}));await expect(input).toHaveAttribute('readonly','');
  await panel.getByText('Unsaved translation drafts',{exact:true}).click();expect(await download('Download unsaved drafts','-unreadable-after-reload.json')).toBe(unreadable);
  await panel.getByText('Unsaved translation drafts',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-unreadable-draft.png'});
  await keyClick(page,panel.getByRole('button',{name:'Preserve these drafts and start fresh',exact:true}));await expect(input).toBeEditable();await expect(input).toHaveValue('');
  const final=await page.evaluate(key=>Object.keys(sessionStorage).filter(name=>name.startsWith(key+':archive:')).map(name=>sessionStorage.getItem(name)),observed.key);
  expect(final).toHaveLength(4);expect([...final].sort()).toEqual([...copies,unreadable].sort());
  console.log('Quota, differing copies and interrupted archival recovered',prefix);
  return {captures,archiveCount:final.length,storedDamagedSha256:sha(damaged),unreadableSha256:sha(unreadable)};
 }finally{await restore().catch(()=>{});}
}

async function exerciseRequestStorage(page,panel,row,campaignId,prefix){
 const captures=[];
 const download=async(label,suffix)=>{
  const pending=handled(page.waitForEvent('download'));await keyClick(page,panel.getByRole('button',{name:label,exact:true}));
  const result=await pending,filename=prefix+suffix;await result.saveAs(filename);const bytes=fs.readFileSync(filename);
  captures.push({filename,sha256:sha(bytes)});return bytes.toString('utf8');
 };
 let other;
 const restore=()=>page.evaluate(()=>{if(window.__translationRequestPut){Storage.prototype.setItem=window.__translationRequestPut;delete window.__translationRequestPut;}});
 try{
  await page.evaluate(()=>{window.__translationRequestPut=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){
   if(this===localStorage&&key.startsWith('openplan:translation-write:'))throw new DOMException('SYNTHETIC request quota','QuotaExceededError');
   return window.__translationRequestPut.call(this,key,value);
  };});
  await keyClick(page,row.getByRole('button',{name:'Save as our wording',exact:true}));
  await expect(panel.getByText(/could not retain the request, so no save was sent/)).toBeVisible();
  await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeEnabled();
  const original=JSON.parse(await download('Download retained request','-volatile-request.json'));await restore();
  const differing=structuredClone(original);differing.intent.entries[0].text='SYNTHETIC differing retained request';
  const raw=JSON.stringify(differing),key=`openplan:translation-write:${encodeURIComponent(original.userId)}:${encodeURIComponent(campaignId)}:${original.intent.requestId}`;
  other=await page.context().newPage();await other.goto(base);
  await other.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw});await page.bringToFront();
  await expect(panel.getByText(/A stored translation request could not be read or differs/)).toBeVisible();
  expect(JSON.parse(await download('Download retained request','-volatile-request-after-storage-event.json'))).toEqual(original);
  expect(await download('Download stored recovery copy','-differing-stored-request.json')).toBe(raw);
  await keyClick(page,panel.getByRole('button',{name:'Retry same translation request',exact:true}));
  await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeEnabled();
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw);
  await panel.getByRole('button',{name:'Download stored recovery copy',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-request-storage-conflict.png'});
  await keyClick(page,panel.getByRole('button',{name:'Review current saved translations',exact:true}));
  await keyClick(page,panel.getByRole('button',{name:'Preserve stored copy and reopen editor',exact:true}));
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
  expect(await download('Download retained request','-volatile-request-after-archive.json')).toBe(JSON.stringify(original,null,2));
  await panel.getByText('Earlier translation requests (1)',{exact:true}).click();
  expect(await download('Download earlier request 1','-differing-request-archive.json')).toBe(raw);
  await expect(row.getByRole('button',{name:'Save as our wording',exact:true})).toBeDisabled();
  console.log('Volatile request and differing stored copy recovered',prefix);
  return {captures,requestId:original.intent.requestId,differingSha256:sha(raw)};
 }finally{await restore().catch(()=>{});if(other)await other.close();}
}

async function journey(browser,width){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);
 const prefix=`${evidence}/translation-editor-${width}-${Date.now()}`;
 let otherContext,campaignId,lostReceipt,storageDeletion,lossesRemaining=2;
 let routeFailure,deletionResolve,deletionReject;const deletionFinished=handled(new Promise((resolve,reject)=>{deletionResolve=resolve;deletionReject=reject}));const commands=[],consoleEvents=[],network=[];
 const observe=p=>{p.on('console',m=>{if(['error','warning'].includes(m.type()))consoleEvents.push({type:m.type(),text:m.text()})});p.on('pageerror',e=>consoleEvents.push({type:'pageerror',text:e.message}));p.on('requestfailed',r=>network.push({url:r.url(),method:r.method(),error:r.failure()?.errorText}));};observe(page);
 try{
  console.log('Starting real navigation',width,prefix);await login(page);await page.getByRole('button',{name:'New campaign',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Next',exact:true}).click();const title=`SYNTHETIC translation command ${width} ${Date.now()}`;
  await dialog.getByLabel('Title',{exact:true}).fill(title);await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByRole('button',{name:'Create campaign',exact:true}).click();
  await page.waitForURL(u=>/^\/engagement\/[-a-f0-9]{36}$/.test(u.pathname));campaignId=new URL(page.url()).pathname.split('/').pop();
  const {panel,row,input,reason}=await setup(page);const path=`/api/engagement/campaigns/${campaignId}/translations/commands`;
  const original=`\u00a0SINTÉTICO original ${width}\ufeff`,corrected=`\u00a0SINTÉTICO corrección ${width}\ufeff`,reviewed=`\u00a0SINTÉTICO revisado ${width}\ufeff`,colleague=`SINTÉTICO otra corrección ${width}`;
  await page.route('**'+path,async route=>{
   try {
   commands.push(route.request().postDataJSON());
   if(lossesRemaining>0){
    lossesRemaining--;const response=await route.fetch();expect(response.status()).toBe(200);const receipt=await response.json();
    if(!lostReceipt){
     lostReceipt=receipt;const storageTab=await context.newPage();await storageTab.goto(base);
     try{
      const deleted=await storageTab.evaluate(requestId=>{const key=Object.keys(localStorage).find(key=>key.startsWith('openplan:translation-write:')&&key.endsWith(requestId));if(!key)throw Error('Missing real pending request');const raw=localStorage.getItem(key);localStorage.removeItem(key);return {key,raw};},commands[0].requestId);
      await page.bringToFront();await page.screenshot({path:prefix+'-storage-deletion-observed.png'});
      fs.writeFileSync(prefix+'-storage-deletion-observed.txt',await page.locator('body').ariaSnapshot());
      await expect(panel.getByText(/This page still has the request, but could not confirm its retention/)).toBeVisible({timeout:10000});
      const pendingDownload=handled(page.waitForEvent('download'));await keyClick(page,panel.getByRole('button',{name:'Download retained request',exact:true}));
      const download=await pendingDownload,copy=prefix+'-deleted-inflight-request.json';await download.saveAs(copy);
      expect(JSON.parse(fs.readFileSync(copy,'utf8'))).toEqual(JSON.parse(deleted.raw));
      await page.screenshot({path:prefix+'-deleted-inflight-request.png'});
      storageDeletion={key:deleted.key,requestId:commands[0].requestId,deletedSha256:sha(deleted.raw),downloadSha256:sha(fs.readFileSync(copy)),nativeStorageEvent:true};
     }finally{await storageTab.close();}
    }else{expect(receipt.replayed).toBe(true);expect(receipt.entries).toEqual(lostReceipt.entries);if(process.env.OPENPLAN_TRANSLATION_ROUTE_CONTROL==='error')throw Error('SYNTHETIC later route callback failure');}
    await route.abort('failed');if(storageDeletion)deletionResolve();
   }else await route.continue();
   }catch(error){routeFailure=error;deletionReject(error);await route.abort('failed').catch(()=>{});}
  });
  const draftRecovery=await exerciseDraftStorage(page,panel,input,campaignId,prefix);expect(commands).toHaveLength(0);
  await input.fill(original);const requestStorageRecovery=await exerciseRequestStorage(page,panel,row,campaignId,prefix);expect(commands).toHaveLength(0);
  await keyClick(page,panel.getByRole('button',{name:'Retry same translation request',exact:true}));
  await deletionFinished;
  await expect(panel.getByRole('region',{name:'Pending translation change',exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeEnabled();
  await expect(input).toHaveValue(original);expect(lostReceipt.entries[0].entry.translated_text).toBe(original);
  expect(commands[0].entries[0].expectedSource).toEqual({text:title,sourceLocale:null,available:true});expect(commands[0].entries[0].expectedTranslation).toBeNull();
  await panel.getByRole('region',{name:'Translation save recovery',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-unconfirmed.png'});
  await keyClick(page,panel.getByRole('button',{name:'Retry same translation request',exact:true}));
  await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeEnabled();
  expect(commands[1]).toEqual(commands[0]);
  const retainedAgain=await page.evaluate(key=>localStorage.getItem(key),storageDeletion.key);expect(JSON.parse(retainedAgain).intent).toEqual(commands[0]);
  await page.reload();await expect(panel.getByRole('button',{name:'Retry same translation request',exact:true})).toBeVisible();
  const replayResponse=responseFor(page,r=>r.url().endsWith(path)&&r.request().method()==='POST');
  await keyClick(page,panel.getByRole('button',{name:'Retry same translation request',exact:true}));const replay=await (await replayResponse).json();
  expect(replay.replayed).toBe(true);expect(commands[2]).toEqual(commands[0]);expect(replay.entries).toEqual(lostReceipt.entries);
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
  expect(correction.entries[0].revision).toBe(2);expect(correction.entries[0].entry.translated_text).toBe(corrected);expect(commands[3].reason).toBe('\u00a0SYNTHETIC reason for correction\ufeff');
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
  expect(retainedOriginal.change.source).toEqual({text:title,sourceLocale:null,available:true});
  await expect(history.getByText('SYNTHETIC reason for correction',{exact:false})).toBeVisible();
  await expect(history.getByText(title,{exact:true})).toHaveCount(5);
  expect(finalHistory.find(row=>row.revision===2).change.reason).toBe('\u00a0SYNTHETIC reason for correction\ufeff');
  console.log('Receipt reason and exact source visible in history',width);
  const archived=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('openplan:translation-archive:')).map(key=>localStorage.getItem(key)));
  expect(archived).toHaveLength(2);
  const conflictIndex=archived.findIndex(raw=>JSON.parse(raw).intent.requestId===conflictCommand.requestId);expect(conflictIndex).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(archived[conflictIndex]).intent).toEqual(conflictCommand);expect(sha(archived[1-conflictIndex])).toBe(requestStorageRecovery.differingSha256);
  const earlier=panel.locator('details').filter({hasText:'Earlier translation requests (2)'});
  if(await earlier.getAttribute('open')===null)await earlier.locator('summary').click();const downloadEvent=handled(page.waitForEvent('download'));
  await keyClick(page,panel.getByRole('button',{name:`Download earlier request ${conflictIndex+1}`,exact:true}));const download=await downloadEvent;const copy=prefix+'-retained-request.json';await download.saveAs(copy);expect(sha(fs.readFileSync(copy))).toBe(sha(archived[conflictIndex]));
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-retained-history.png'});
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
  if(routeFailure)throw routeFailure;
  expect(consoleEvents.filter(row=>row.type==='pageerror')).toEqual([]);
  if(!/^[a-f0-9-]{36}$/.test(campaignId))throw Error('Invalid fixture id');
  const custody=JSON.parse(sql(`select jsonb_agg(jsonb_build_object('request',request_id,'reason',payload->'reason','resultHash',result_sha256)) from engagement_translation_write_receipts where campaign_id='${campaignId}'`));
  expect(custody.some(row=>row.reason==='SYNTHETIC withdrawal reason')).toBe(true);expect(custody.some(row=>row.reason==='\u00a0SYNTHETIC reason for correction\ufeff')).toBe(true);
  fs.writeFileSync(prefix+'-result.json',JSON.stringify({passed:true,width,campaignId,layoutControl:process.env.OPENPLAN_TRANSLATION_LAYOUT_CONTROL??'none',controls,draftRecovery,requestStorageRecovery,storageDeletion,commands,originalHistory:retainedOriginal,finalHistory,custody,downloadSha256:sha(fs.readFileSync(copy)),overflow,console:consoleEvents,network},null,2));console.log('Browser journey passed',width,prefix);
 }catch(error){fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot().catch(()=>''));await page.screenshot({path:prefix+'-failure.png'}).catch(()=>{});fs.writeFileSync(prefix+'-failure.json',JSON.stringify({campaignId,message:error.message,commands,console:consoleEvents,network},null,2));throw error;}
 finally{await Promise.allSettled([otherContext?.close(),context.close()]);}
}
(async()=>{
 const before=sourceHashes();const identity=execFileSync('bash',[root+'/openplan/scripts/ops/which-openplan.sh',base],{cwd:root,encoding:'utf8'});fs.writeFileSync(evidence+'/translation-editor-browser-identity.log',identity);
 expect(sql('select count(*)||\':\'||max(version) from supabase_migrations.schema_migrations')).toBe('338:20261014000019');
 expect(sql(`select has_function_privilege('authenticated','${signature}','EXECUTE')`)).toBe('t');
 if(process.env.OPENPLAN_TRANSLATION_CLEANUP_PROBE==='control')process.exit(0);
 if(process.env.OPENPLAN_TRANSLATION_CLEANUP_PROBE==='1')process.exit(23);
 let browser;
 try{browser=await chromium.launch({channel:'chrome',headless:true});for(const width of (process.env.OPENPLAN_TRANSLATION_ROUTE_CONTROL==='error'?[1440]:process.env.OPENPLAN_TRANSLATION_LAYOUT_CONTROL==='overflow'?[390]:[1440,390]))await journey(browser,width);}
 finally{try{if(browser)await browser.close();}finally{expect(sourceHashes()).toEqual(before);fs.writeFileSync(evidence+'/translation-editor-browser-source.json',JSON.stringify({sourceHashes:before},null,2));}}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
