const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:30000}),fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const evidenceDir='/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const width=Number(process.env.PROBE_WIDTH||1440),base='http://127.0.0.1:3262';
const prior=JSON.parse(fs.readFileSync(evidenceDir+(width===390?'/basic-390-1789383913908.json':'/basic-1440-1789383801102.json')));
const prefix=evidenceDir+`/history-controls-${width}-${Date.now()}`, observed={width,completed:false,console:[],network:[],focus:[]};
const redact=s=>String(s).replaceAll(account.email,'[test-account]').replaceAll(account.password,'[redacted]');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function click(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter');}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});const page=await context.newPage();
page.on('console',m=>{if(['warning','error'].includes(m.type()))observed.console.push({type:m.type(),text:redact(m.text())})});page.on('pageerror',e=>observed.console.push({type:'pageerror',text:redact(e.message)}));page.on('requestfailed',r=>observed.network.push({url:r.url(),error:r.failure()?.errorText}));
try{
observed.identity=await(await page.request.get(base+'/api/health')).json();assert.equal(observed.identity.deployment.commit,'ea474256c932');
await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL(u=>u.pathname==='/engagement');await click(page,page.getByRole('link').filter({has:page.getByRole('heading',{name:prior.campaignTitle,exact:true})}));await page.waitForURL(u=>u.pathname==='/engagement/'+prior.campaignId);await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));
const builder=page.locator('article').filter({has:page.getByRole('heading',{name:'You said / We did',exact:true})});
const panel=page.getByRole('region',{name:'Decision link editor',exact:true});
await click(page,builder.getByRole('button',{name:'Connect responses to decisions',exact:true}));await expect(panel.getByText('Retained decision history',{exact:true})).toBeVisible();
const path=base+`/api/engagement/campaigns/${prior.campaignId}/decision-links`;
async function snapshot(){const res=await page.request.get(path);assert.equal(res.status(),200);return(await res.json()).snapshot;}
const original=await snapshot();assert.equal(original.entryCount,3);observed.original=original;
const failureText='Decision history could not be loaded. Its absence has not been established.';
const verifyVisible=async()=>{await expect(panel.locator('article')).toHaveCount(original.entryCount);await expect(panel.getByText(original.entries[0].reason,{exact:true})).toBeVisible();await expect(panel.getByText(failureText,{exact:true})).toHaveCount(0);};
await verifyVisible();observed.baseline=true;
let mode='harmless',intercepts=0;
await page.route('**/api/engagement/campaigns/'+prior.campaignId+'/decision-links',async route=>{
 if(route.request().method()!=='GET')return route.continue();
 const response=await route.fetch();assert.equal(response.status(),200);intercepts++;
 if(mode==='harmless')return route.fulfill({response,headers:{...response.headers(),'x-synthetic-harmless-control':'unchanged-bytes'}});
 const body=await response.json();body.snapshot.entries[0].context_text+=' ';await route.fulfill({response,json:body});
});
await click(page,panel.getByRole('button',{name:'Reload decision links',exact:true}));await expect.poll(()=>intercepts).toBe(1);await verifyVisible();observed.harmlessSurvived=true;
mode='corrupt-retained-context';await click(page,panel.getByRole('button',{name:'Reload decision links',exact:true}));await expect.poll(()=>intercepts).toBe(2);await expect(panel.getByText(failureText,{exact:true})).toBeVisible();await expect(panel.locator('article')).toHaveCount(0);
let rejected=false;try{await expect(panel.locator('article')).toHaveCount(original.entryCount,{timeout:1000});}catch(error){assert(String(error.message).includes('Expected: 3'));assert(String(error.message).includes('Received: 0'));rejected=true;observed.targetFailure=redact(error.message);}
assert(rejected,'History visibility check must reject corrupt retained context');observed.targetKilled=true;
await panel.scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-rejected.png'});
await page.unroute('**/api/engagement/campaigns/'+prior.campaignId+'/decision-links');await click(page,panel.getByRole('button',{name:'Reload decision links',exact:true}));await verifyVisible();assert.deepEqual(await snapshot(),original);observed.restored=true;observed.completed=true;console.log('History baseline, harmless control and corrupt context refusal passed',width,prefix);
}catch(error){observed.error=redact(error.stack||error.message);await page.screenshot({path:prefix+'-failure.png'});fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot());throw error;}finally{fs.writeFileSync(prefix+'.json',JSON.stringify(observed,null,2));await browser.close();}})().catch(e=>{console.error(redact(e.message));process.exitCode=1;});
