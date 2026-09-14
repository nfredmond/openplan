const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:30000}),fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const evidenceDir='/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const width=Number(process.env.PROBE_WIDTH||1440),base='http://127.0.0.1:3262';
const prior=JSON.parse(fs.readFileSync(process.env.PROBE_PRIOR));
const prefix=evidenceDir+`/damaged-resolution-${width}-${Date.now()}`, observed={width,completed:false,console:[],network:[],focus:[]};
const redact=s=>String(s).replaceAll(account.email,'[test-account]').replaceAll(account.password,'[redacted]');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function click(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter');}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});const page=await context.newPage();
page.on('console',m=>{if(['warning','error'].includes(m.type()))observed.console.push({type:m.type(),text:redact(m.text())})});page.on('pageerror',e=>observed.console.push({type:'pageerror',text:redact(e.message)}));page.on('requestfailed',r=>observed.network.push({url:r.url(),error:r.failure()?.errorText}));
try{
observed.identity=await(await page.request.get(base+'/api/health')).json();assert.equal(observed.identity.deployment.commit,process.env.PROBE_COMMIT);
await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL(u=>u.pathname==='/engagement');await click(page,page.getByRole('link').filter({has:page.getByRole('heading',{name:prior.campaignTitle,exact:true})}));await page.waitForURL(u=>u.pathname==='/engagement/'+prior.campaignId);await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));
const builder=page.locator('article').filter({has:page.getByRole('heading',{name:'You said / We did',exact:true})});
const panel=page.getByRole('region',{name:'Decision link editor',exact:true});
await click(page,builder.getByRole('button',{name:'Connect responses to decisions',exact:true}));await expect(panel.getByText('Retained decision history',{exact:true})).toBeVisible();
const path=base+`/api/engagement/campaigns/${prior.campaignId}/decision-links`;
async function snapshot(){const res=await page.request.get(path);assert.equal(res.status(),200);return(await res.json()).snapshot;}
const original=await snapshot();assert.equal(original.entryCount,1);assert.equal(original.entries[0].context_text,prior.snapshot.entries[0].context_text);observed.original=original;
const recovery=page.getByRole('region',{name:'Decision request recovery',exact:true});observed.requests=[];observed.resolutions=[];
await click(page,panel.getByRole('button',{name:'Select this link',exact:true}));await click(page,panel.getByRole('button',{name:'Review current sources',exact:true}));await panel.getByLabel('Reason for this link or change',{exact:true}).fill('SYNTHETIC refresh cancelled before arrival.');
let unsaved;await page.route(path,async route=>{if(route.request().method()!=='POST')return await route.continue();unsaved=route.request().postDataJSON();observed.requests.push(unsaved);await route.abort('connectionreset');});
await click(page,panel.getByRole('button',{name:'Save reviewed correction',exact:true}));await expect(panel.getByText(/The save is unconfirmed/)).toBeVisible();assert(unsaved);assert.deepEqual(await snapshot(),original);
async function downloadJson(button,label){const event=page.waitForEvent('download');await click(page,button);const download=await event;const file=prefix+'-'+label+'.json';await download.saveAs(file);const raw=fs.readFileSync(file);(observed.downloads??=[]).push({file,sha256:sha(raw)});return JSON.parse(raw);}
const request=await downloadJson(panel.getByRole('button',{name:'Download retained request',exact:true}),'unsaved-request');
const sourceKey=await page.evaluate(id=>Object.keys(localStorage).find(k=>k.startsWith('openplan:decision-link:')&&k.endsWith(id)),unsaved.requestId);assert(sourceKey);
await click(page,panel.getByRole('button',{name:'Review request recovery',exact:true}));
const proposed=await downloadJson(recovery.getByRole('button',{name:'Download proposed resolution',exact:true}),'proposed');assert.equal(proposed.intents.length,1);
const resolutionPath=path+'/resolutions';let resolutionFailure;
await page.route(resolutionPath,async route=>{try{observed.resolutions.push(route.request().postDataJSON());await route.continue();}catch(e){resolutionFailure=e;await route.abort();}});
// Refuse durable intent storage, then refuse only archive storage on the exact retry.
await page.evaluate(()=>{window.recoverySetItem=Storage.prototype.setItem;window.recoveryFault='intent';Storage.prototype.setItem=function(key,value){if(window.recoveryFault==='intent'&&key.startsWith('openplan:decision-resolution:')||window.recoveryFault==='archive'&&key.startsWith('openplan:decision-resolution-archive:'))throw new DOMException('SYNTHETIC quota failure','QuotaExceededError');return window.recoverySetItem.call(this,key,value)};});
await click(page,recovery.getByRole('button',{name:'Confirm resolution and preserve copies',exact:true}));await expect(recovery.getByText(/Resolution is unconfirmed or its archive could not be saved/)).toBeVisible();assert.equal(observed.resolutions.length,0);assert(await page.evaluate(k=>localStorage.getItem(k),sourceKey));
await page.evaluate(()=>window.recoveryFault='archive');
const resolutionReply=page.waitForResponse(r=>r.url()===resolutionPath&&r.request().method()==='POST');
await click(page,recovery.getByRole('button',{name:'Confirm resolution and preserve copies',exact:true}));const initialReply=await resolutionReply;assert.equal(initialReply.status(),201,await initialReply.text());await expect(recovery.getByRole('button',{name:'Retry same resolution',exact:true})).toBeVisible();await expect(recovery.getByText(/Resolution is unconfirmed or its archive could not be saved/)).toBeVisible();assert.equal(observed.resolutions.length,1);assert(await page.evaluate(k=>localStorage.getItem(k),sourceKey));
await page.evaluate(()=>{Storage.prototype.setItem=window.recoverySetItem;delete window.recoverySetItem;delete window.recoveryFault;});
const pendingResolutionKey=await page.evaluate(id=>Object.keys(localStorage).find(k=>k.startsWith('openplan:decision-resolution:')&&k.endsWith(id)),proposed.intents[0].resolutionId);assert(pendingResolutionKey);
const damaged='SYNTHETIC damaged resolution envelope\u0000\ud800';
await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:pendingResolutionKey,raw:damaged});
await page.reload();await click(page,page.getByRole('button',{name:'Connect responses to decisions',exact:true}));
await click(page,recovery.getByRole('button',{name:'Review resolution recovery',exact:true}));
const replacement=await downloadJson(recovery.getByRole('button',{name:'Download proposed resolution',exact:true}),'damaged-resolution-proposed');assert.equal(replacement.intents.length,1);assert.equal(JSON.parse(replacement.intents[0].copyJson),damaged);assert.equal(replacement.intents[0].requestId,unsaved.requestId);
await click(page,recovery.getByRole('button',{name:'Confirm resolution and preserve copies',exact:true}));await expect(recovery.getByText(/Recovery confirmed and copies archived/)).toBeVisible();
await expect(panel.getByRole('button',{name:'Review request recovery',exact:true})).toBeEnabled();
assert.equal(await page.evaluate(k=>localStorage.getItem(k),pendingResolutionKey),null);assert(await page.evaluate(k=>localStorage.getItem(k),sourceKey),'Original request stays available after archiving its damaged resolution');
await click(page,recovery.getByText('Archived decision recoveries (1)',{exact:true}));const damagedArchive=await downloadJson(recovery.getByRole('button',{name:'Download archived resolution 1',exact:true}),'damaged-resolution-archive');assert.deepEqual(damagedArchive.request,replacement);assert.equal(JSON.parse(damagedArchive.receipts[0].resultText).state,'cancelled');
await click(page,panel.getByRole('button',{name:'Review request recovery',exact:true}));const originalProposal=await downloadJson(recovery.getByRole('button',{name:'Download proposed resolution',exact:true}),'original-proposed');
await click(page,recovery.getByRole('button',{name:'Confirm resolution and preserve copies',exact:true}));await expect(panel.getByLabel('Staff response',{exact:true})).toBeEnabled();await expect(panel.getByRole('button',{name:'Review request recovery',exact:true})).toHaveCount(0);
await click(page,recovery.getByText('Archived decision recoveries (2)',{exact:true}));const archivedCopies=[];for(const index of [1,2])archivedCopies.push(await downloadJson(recovery.getByRole('button',{name:'Download archived resolution '+index,exact:true}),'complete-archive-'+index));const archive=archivedCopies.find(copy=>copy.request.intents[0].resolutionId===originalProposal.intents[0].resolutionId);assert(archive);assert.deepEqual(archive.request,originalProposal);assert.equal(JSON.parse(archive.request.intents[0].copyJson),JSON.stringify(request));
for(const retained of [damagedArchive,archive])for(const packet of retained.receipts){assert.equal(sha(packet.payloadText),packet.payloadSha256);assert.equal(sha(packet.resultText),packet.resultSha256);const result=JSON.parse(packet.resultText);assert.equal(result.state,'cancelled');assert.equal(result.link,null);}
assert.equal(await page.evaluate(k=>localStorage.getItem(k),sourceKey),null);observed.damagedArchive=damagedArchive;
// Replay the browser's original write against the real route after cancellation.
await page.unroute(path);const late=await page.request.post(path,{headers:{origin:base,'x-openplan-expected-user':request.actorId,'x-openplan-expected-workspace':request.workspaceId},data:unsaved});observed.late={status:late.status(),body:await late.json()};assert.equal(late.status(),409);assert.deepEqual(await snapshot(),original);
await expect(panel.getByText(/The save is unconfirmed/)).toHaveCount(0);await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'.png'});fs.writeFileSync(prefix+'.txt',await page.locator('body').ariaSnapshot());observed.archive=archive;observed.completed=true;console.log('Recovered a damaged resolution and original request without a late save',width,prefix);
}catch(error){observed.error=redact(error.stack||error.message);await page.screenshot({path:prefix+'-failure.png'});fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot());throw error;}finally{fs.writeFileSync(prefix+'.json',JSON.stringify(observed,null,2));await browser.close();}})().catch(e=>{console.error(redact(e.message));process.exitCode=1;});
