const {chromium,expect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root='/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12',app='/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10/openplan';
const account=JSON.parse(fs.readFileSync(`${root}/api-settings-account.json`)),base='http://127.0.0.1:3255',width=Number(process.env.WIDTH||1440),title=`SYNTHETIC snapshot response recovery ${width} ${Date.now()}`;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
(async()=>{
 const browser=await chromium.launch({channel:'chrome'}),context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(45000);
 const errors=[];page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push({type:m.type(),text:m.text()})});page.on('pageerror',e=>errors.push({type:'pageerror',text:e.message}));
 let campaignId;
 const control=async fail=>{const r=await context.request.post('http://127.0.0.1:3218/__control',{data:{campaignId,fail}});expect(r.status()).toBe(200);return r.json()};
 try{
  await page.goto(base);if(!page.url().includes('/sign-in'))await page.getByRole('link',{name:/Sign in/i}).first().click();
  await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('sign-in'));
  await page.getByRole('link',{name:'Engagement',exact:true}).first().focus();await page.keyboard.press('Enter');await page.waitForURL('**/engagement');
  await page.getByRole('button',{name:'New campaign',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).fill(title);await dialog.getByRole('button',{name:'Next',exact:true}).click();
  await dialog.getByRole('button',{name:'Create campaign',exact:true}).click();await page.waitForURL(u=>/^\/engagement\/[-a-f0-9]{36}$/.test(u.pathname));campaignId=new URL(page.url()).pathname.split('/').pop();
  const panel=page.getByRole('article').filter({has:page.getByRole('heading',{name:'You said / We did',exact:true})});
  await expect(panel.getByText(/No entries yet/)).toBeVisible();expect(await panel.getByRole('button',{name:'Generate drafts',exact:true}).isEnabled()).toBe(true);
  await panel.getByLabel('Theme',{exact:true}).fill('SYNTHETIC retained crossing response');await panel.getByLabel('You said',{exact:true}).fill('SYNTHETIC request for a safer crossing.');await panel.getByLabel('We did',{exact:true}).fill('SYNTHETIC draft response; not published.');
  const saving=page.waitForResponse(r=>r.url().endsWith(`/campaigns/${campaignId}/closeloop`)&&r.request().method()==='POST');await panel.getByRole('button',{name:'Add entry',exact:true}).focus();await page.keyboard.press('Enter');expect((await saving).status()).toBe(201);await expect(panel.getByText('SYNTHETIC retained crossing response',{exact:true})).toBeVisible();
  const api=`${base}/api/engagement/campaigns/${campaignId}/closeloop`;const initialResponse=await context.request.get(api);expect(initialResponse.status()).toBe(200);const original=await initialResponse.json();expect(original.entries).toHaveLength(1);expect(original.entries[0].status).toBe('draft');
  const beforeFault=await control(true);
  await page.getByRole('link',{name:'Engagement',exact:true}).first().click();await page.waitForURL('**/engagement');await page.locator(`a[href="/engagement/${campaignId}"]`).first().click();await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`);
  const retry=panel.getByRole('button',{name:'Retry loading responses',exact:true});await expect(retry).toBeVisible();await expect(panel.getByRole('alert')).toContainText('Saved staff responses could not be loaded');await expect(panel.getByText(/No entries yet/)).toHaveCount(0);await expect(panel.getByText(/0 published, 0 total/)).toHaveCount(0);await expect(panel.getByRole('button',{name:'Generate drafts',exact:true})).toBeDisabled();
  await retry.scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/m9b-snapshot-${width}-unavailable.png`});
  const failed=page.waitForResponse(r=>r.url()===api&&r.request().method()==='GET');await retry.focus();await page.keyboard.press('Enter');const failedResponse=await failed;expect(failedResponse.status()).toBe(500);expect(await failedResponse.json()).not.toHaveProperty('entries');await expect(retry).toBeEnabled();
  const fault=await control(false);expect(fault.refused-beforeFault.refused).toBeGreaterThanOrEqual(2);
  const recovered=page.waitForResponse(r=>r.url()===api&&r.request().method()==='GET');await retry.focus();await page.keyboard.press('Enter');expect((await recovered).status()).toBe(200);await expect(panel.getByText('SYNTHETIC retained crossing response',{exact:true})).toBeVisible();await expect(panel.getByRole('alert')).toHaveCount(0);await expect(panel.getByRole('button',{name:'Publish',exact:true})).toBeEnabled();
  const retained=await (await context.request.get(api)).json();expect(retained).toEqual(original);await panel.getByText('SYNTHETIC retained crossing response',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/m9b-snapshot-${width}-recovered.png`});fs.writeFileSync(`${root}/m9b-snapshot-${width}-aria.txt`,await panel.ariaSnapshot());
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);expect(errors.filter(e=>e.type==='pageerror')).toEqual([]);
  const anon=await browser.newContext();const denied=await anon.request.get(api);expect(denied.status()).toBe(401);await anon.close();
  fs.writeFileSync(`${root}/m9b-snapshot-${width}-browser.json`,JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),width,passed:true,campaignId,originalHash:hash(original),retainedHash:hash(retained),refusedReads:fault.refused-beforeFault.refused,failedRetryStatus:failedResponse.status(),anonymousStatus:denied.status(),overflow,console:errors},null,2));console.log(JSON.stringify({width,passed:true,consoleEvents:errors.length,campaignId}));
 }catch(e){await page.screenshot({path:`${root}/m9b-snapshot-${width}-failure.png`,fullPage:true});fs.writeFileSync(`${root}/m9b-snapshot-${width}-failure.json`,JSON.stringify({url:page.url(),campaignId,message:e.message,errors},null,2));throw e;}
 finally{if(campaignId)await control(false).catch(()=>{});await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
