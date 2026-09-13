const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000});
const fs=require('node:fs'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const app='/home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12/openplan';
const privateRoot='/home/nathaniel/.local/state/openplan/response-write-probe-20260913';
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const base='http://localhost:3260',width=Number(process.env.WIDTH||1440),prefix=`${privateRoot}/response-source-${width}`;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const navigationRetries=[];
async function reloadObserved(target){
 const url=target.url();
 try{return await target.reload()}
 catch(error){
  if(!/ERR_NETWORK_CHANGED|ERR_ABORTED/.test(error.message))throw error;
  navigationRetries.push({url,error:error.message});
  return target.goto(url);
 }
}

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();page.setDefaultTimeout(60000);
 const errors=[],requests=[],patchRequests=[],networkFailures=[];let campaignId,worker,workerExit,original,committedStatus,publicContext,publicPage;
 page.on('request',r=>{if(r.method()==='PATCH'&&/\/closeloop\/[-a-f0-9]{36}$/.test(new URL(r.url()).pathname))patchRequests.push(r.postDataJSON())});
 page.on('requestfailed',r=>networkFailures.push({url:r.url(),error:r.failure()?.errorText,method:r.method()}));
 page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push({type:m.type(),text:m.text()})});page.on('pageerror',e=>errors.push({type:'pageerror',text:e.message}));
 try{
  await page.goto(base);if(!page.url().includes('/sign-in'))await page.getByRole('link',{name:/Sign in/i}).first().click();
  await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('sign-in'));
  await page.getByRole('link',{name:'Engagement',exact:true}).first().focus();await page.keyboard.press('Enter');await page.waitForURL('**/engagement');
  await page.getByRole('button',{name:'New campaign',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).fill(`SYNTHETIC retained response ${width} ${Date.now()}`);await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByRole('button',{name:'Create campaign',exact:true}).click();await page.waitForURL(u=>/^\/engagement\/[-a-f0-9]{36}$/.test(u.pathname));campaignId=new URL(page.url()).pathname.split('/').pop();
  console.log('Campaign created through navigation',width);
  const generate=page.getByTestId('publish-step-share_token').getByRole('button',{name:'Generate link',exact:true});await generate.click();await expect(generate).toHaveCount(0);
  const description=page.getByLabel('Public-facing description',{exact:true});await description.fill('SYNTHETIC local acceptance. No outreach or real email delivery.');await page.getByRole('button',{name:'Save description',exact:true}).click();await expect(description).toHaveCount(0);
  const accept=page.getByTestId('publish-step-submission_mode').getByRole('button',{name:'Accept public submissions',exact:true});if(await accept.count()){await accept.click();await expect(accept).toHaveCount(0)}
  const activate=page.getByTestId('publish-step-active_status').getByRole('button',{name:'Set the campaign to Active',exact:true});await activate.click();await expect(activate).toHaveCount(0);
  const tabs=page.getByTestId('page-tabs-nav');await tabs.getByRole('link',{name:'Setup',exact:true}).click();
  const publicHref=await page.getByRole('link',{name:'Open',exact:true}).first().getAttribute('href');expect(publicHref).toMatch(/^\/engage\//);
  publicContext=await browser.newContext({viewport:{width,height:1000}});publicPage=await publicContext.newPage();publicPage.setDefaultTimeout(45000);
  publicPage.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push({page:'public',type:m.type(),text:m.text()})});publicPage.on('pageerror',e=>errors.push({page:'public',type:'pageerror',text:e.message}));
  await publicPage.goto(new URL(publicHref,base).href);
  const submit=async(title,body)=>{
   await publicPage.getByRole('button',{name:'Next',exact:true}).click();await publicPage.getByLabel('What you want to tell us (we need this part)',{exact:true}).fill(body);
   await publicPage.getByRole('button',{name:'Next',exact:true}).click();await publicPage.locator('#portal-title').fill(title);await publicPage.getByRole('button',{name:'Next',exact:true}).click();await publicPage.getByRole('button',{name:'Next',exact:true}).click();
   const saved=publicPage.waitForResponse(r=>r.url().includes('/api/engage/')&&r.url().endsWith('/submit')&&r.request().method()==='POST');await publicPage.getByRole('button',{name:'Send what I wrote',exact:true}).focus();await publicPage.keyboard.press('Enter');const r=await saved;expect(r.ok()).toBe(true);const data=await r.json();expect(data.success).toBe(true);expect(data.submissionId).toBeTruthy();return data.submissionId;
  };
  const parent=await submit('SYNTHETIC parent input','SYNTHETIC parent wording before correction');
  const selectItem=async(id,title)=>{await tabs.getByRole('link',{name:'Responses',exact:true}).click();const list=page.getByRole('navigation',{name:'Contributions on this page',exact:true});await list.getByRole('button',{name:new RegExp(title)}).click();return page.locator(`#contribution-${id}`)};
  const moderate=async(id,title,button,reason,body)=>{await reloadObserved(page);const row=await selectItem(id,title);await row.getByLabel('Moderation notes',{exact:true}).fill(reason);if(body!==undefined)await row.getByLabel('Body',{exact:true}).fill(body);const saved=page.waitForResponse(r=>r.url().endsWith(`/items/${id}`)&&r.request().method()==='PATCH');await row.getByRole('button',{name:button,exact:true}).focus();await page.keyboard.press('Enter');expect((await saved).status()).toBe(200)};
  await moderate(parent,'SYNTHETIC parent input','Approve','SYNTHETIC public approval after review');
  await publicPage.getByRole('link',{name:/^See (what other people said|more about this project)$/}).click();await publicPage.getByRole('button',{name:/^Community feedback/}).click();await publicPage.getByRole('button',{name:'Reply',exact:true}).click();await expect(publicPage.getByTestId('portal-replying-to')).toContainText('SYNTHETIC parent input');
  const child=await submit('SYNTHETIC reply input','SYNTHETIC reply requesting a crossing response');await moderate(child,'SYNTHETIC reply input','Approve','SYNTHETIC reply reviewed');
  await tabs.getByRole('link',{name:'Setup',exact:true}).click();const panel=page.getByRole('article').filter({has:page.getByRole('heading',{name:'You said / We did',exact:true})});
  await panel.getByLabel('Theme',{exact:true}).fill('SYNTHETIC source-linked response');await panel.getByLabel('You said',{exact:true}).fill('SYNTHETIC public source summary');await panel.getByLabel('We did',{exact:true}).fill('SYNTHETIC proposed crossing follow-up');await panel.getByLabel('Contributions addressed',{exact:true}).selectOption(child);
  const api=`${base}/api/engagement/campaigns/${campaignId}/closeloop`;
  const created=page.waitForResponse(r=>r.url()===api&&r.request().method()==='POST');await panel.getByRole('button',{name:'Add entry',exact:true}).click();expect((await created).status()).toBe(201);await expect(panel.getByText('Response saved.',{exact:true})).toBeVisible();
  original=(await(await context.request.get(api)).json()).entries[0];expect(original.source_item_ids).toEqual([child]);
  const history=async()=>{const r=await context.request.get(api+'/history');expect(r.status()).toBe(200);return(await r.json()).history};const before=await history();expect(before).toHaveLength(1);
  const publish=async()=>{await panel.getByLabel('Reason for this change',{exact:true}).fill('SYNTHETIC response checked against current public input');const saved=page.waitForResponse(r=>r.url()===api+'/'+original.id&&r.request().method()==='PATCH');await panel.getByRole('button',{name:'Publish',exact:true}).click();expect((await saved).status()).toBe(200);await expect(panel.getByRole('button',{name:'Unpublish',exact:true})).toBeVisible()};
  await publish();await reloadObserved(publicPage);await publicPage.getByRole('button',{name:/^You said \/ We did/}).click();await expect(publicPage.getByText('SYNTHETIC proposed crossing follow-up',{exact:true})).toBeVisible();await publicPage.screenshot({path:prefix+'-published.png'});
  const anonHistory=await publicContext.request.get(api+'/history');expect([401,403]).toContain(anonHistory.status());expect(await anonHistory.text()).not.toContain(before[0].record_sha256);
  await moderate(parent,'SYNTHETIC parent input','Save item','SYNTHETIC harmless notes update');expect((await(await context.request.get(api)).json()).entries[0].status).toBe('published');
  await moderate(parent,'SYNTHETIC parent input','Save item','SYNTHETIC wording correction','SYNTHETIC changed parent wording');expect((await(await context.request.get(api)).json()).entries[0].status).toBe('draft');
  await reloadObserved(publicPage);await expect(publicPage.getByText('SYNTHETIC proposed crossing follow-up',{exact:true})).toHaveCount(0);await publicPage.screenshot({path:prefix+'-withdrawn.png'});
  await reloadObserved(page);await tabs.getByRole('link',{name:'Setup',exact:true}).click();await publish();
  await moderate(parent,'SYNTHETIC parent input','Flag','SYNTHETIC withhold parent pending another review');expect((await(await context.request.get(api)).json()).entries[0].status).toBe('draft');
  await reloadObserved(publicPage);await publicPage.getByRole('button',{name:/^Community feedback/}).click();await expect(publicPage.getByText('SYNTHETIC reply requesting a crossing response',{exact:true})).toHaveCount(0);await expect(publicPage.getByText('SYNTHETIC proposed crossing follow-up',{exact:true})).toHaveCount(0);
  await reloadObserved(page);await tabs.getByRole('link',{name:'Setup',exact:true}).click();await panel.getByRole('button',{name:'Response history',exact:true}).focus();await page.keyboard.press('Enter');const retained=panel.getByRole('region',{name:'Response history',exact:true});await expect(retained.getByText(/5 retained revisions/)).toBeVisible();await retained.scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-history.png'});
  const revisions=await history();expect(revisions).toHaveLength(5);expect(revisions[0].record_sha256).toBe(before[0].record_sha256);expect(revisions[0].record).toEqual(before[0].record);expect(revisions.filter(r=>r.change_origin==='source_withdrawal')).toHaveLength(2);
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(width);expect(errors.filter(e=>e.type==='pageerror')).toEqual([]);
  fs.writeFileSync(prefix+'-browser.json',JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),width,passed:true,campaignId,parent,child,response:original.id,harmlessNotesPreservedPublication:true,parentWordingWithdrewReplyResponse:true,parentWithholdingHidReplyAndResponse:true,anonymousHistoryDenied:true,originalChecksum:before[0].record_sha256,historyRevisions:5,navigationRetries,overflow,console:errors},null,2));console.log('Source withdrawal browser journey passed',width);
 }catch(e){console.error('Browser failure:',e.message);fs.writeFileSync(prefix+'-failure-aria.txt',await page.locator('body').ariaSnapshot());if(publicPage)fs.writeFileSync(prefix+'-public-failure-aria.txt',await publicPage.locator('body').ariaSnapshot());await page.screenshot({path:prefix+'-failure.png',fullPage:true});fs.writeFileSync(prefix+'-failure.json',JSON.stringify({campaignId,message:e.message,console:errors},null,2));throw e}
 finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
