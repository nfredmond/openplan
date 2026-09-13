const {chromium,expect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root='/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12',app='/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10/openplan';
const account=JSON.parse(fs.readFileSync(`${root}/api-settings-account.json`)),base='http://127.0.0.1:3255',width=Number(process.env.WIDTH||1440),title=`SYNTHETIC large snapshot recovery ${width} ${Date.now()}`;
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
  campaignId=JSON.parse(fs.readFileSync(`${root}/m9b-snapshot-large-1440-setup.json`)).campaignId;
  await page.locator(`a[href="/engagement/${campaignId}"]`).first().click();await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`);

  const before=await (await context.request.get(`${base}/api/engagement/campaigns/${campaignId}/closeloop`)).json();expect(before.entries).toHaveLength(1005);
  const preview=page.getByRole('link',{name:'Preview the resident view',exact:true});await preview.focus();await page.keyboard.press('Enter');await page.waitForURL(`**/engagement/${campaignId}/preview`);await page.getByTestId('portal-details-link').focus();await page.keyboard.press('Enter');await page.waitForURL(`**/engagement/${campaignId}/preview/about`);
  const tab=page.getByRole('button',{name:/You said.*We did/i});
  const openResponses=async()=>{await expect(tab).toBeEnabled({timeout:30000});await tab.scrollIntoViewIfNeeded();await tab.focus();await expect(tab).toBeFocused();await page.keyboard.press('Enter')};
  await openResponses();await expect(page.getByText('SYNTHETIC bulk response 1001',{exact:true})).toBeVisible({timeout:30000});
  const priorFault=await control(true);await page.reload();await openResponses();
  const unavailable=page.getByText('Part of this page could not be loaded. Anything that looks empty below may not be empty.',{exact:true});await expect(unavailable.last()).toBeVisible();await expect(tab).not.toContainText('(0)');await expect(page.getByText('SYNTHETIC bulk response 1001',{exact:true})).toHaveCount(0);await unavailable.last().scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/m9b-snapshot-preview-${width}-unavailable.png`});
  const fault=await control(false);expect(fault.refused-priorFault.refused).toBeGreaterThan(0);await page.reload();await openResponses();await expect(page.getByText('SYNTHETIC bulk response 1001',{exact:true})).toBeVisible({timeout:30000});await expect(unavailable).toHaveCount(0);await expect(page.getByText('SYNTHETIC bulk response 1004',{exact:true})).toHaveCount(0);await page.getByText('SYNTHETIC bulk response 1001',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/m9b-snapshot-preview-${width}-recovered.png`});
  const after=await (await context.request.get(`${base}/api/engagement/campaigns/${campaignId}/closeloop`)).json();expect(after).toEqual(before);expect(errors.filter(e=>e.type==='pageerror')).toEqual([]);
  fs.writeFileSync(`${root}/m9b-snapshot-preview-${width}-browser.json`,JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),width,passed:true,campaignId,refusedReads:fault.refused-priorFault.refused,originalHash:hash(before),retainedHash:hash(after),console:errors},null,2));console.log(JSON.stringify({width,passed:true,previewFaultRecovery:true}));
 }catch(e){await page.screenshot({path:`${root}/m9b-snapshot-preview-${width}-failure.png`});fs.writeFileSync(`${root}/m9b-snapshot-preview-${width}-failure.json`,JSON.stringify({message:e.message,campaignId,url:page.url(),errors}));throw e}
 finally{if(campaignId)await control(false).catch(()=>{});await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
