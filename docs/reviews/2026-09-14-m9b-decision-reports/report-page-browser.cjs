const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:30000}),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base='http://127.0.0.1:3262',width=Number(process.env.PROBE_WIDTH||1440),fixed=process.env.PROBE_FIXED==='1';
const dir='/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const previous=JSON.parse(fs.readFileSync(dir+'/'+(width===390?'public-privacy-390-1789393604792':'public-privacy-1440-1789393515387')+'.json'));
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prefix=dir+`/report-page-${fixed?'after':'before'}-${width}-${Date.now()}`,observed={width,fixed,completed:false,console:[],downloads:[]};
async function click(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter')}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true}),page=await context.newPage();
page.on('console',m=>{if(m.type()==='error')observed.console.push(m.text())});page.on('pageerror',e=>observed.console.push(e.message));
try{
 observed.identity=await(await page.request.get(base+'/api/health')).json();assert.equal(observed.identity.deployment.commit,process.env.PROBE_COMMIT);
 await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
 await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');await click(page,page.locator(`a[href="/engagement/${previous.campaignId}"]`).first());await page.waitForURL(u=>u.pathname===`/engagement/${previous.campaignId}`);
 await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Record',exact:true}));await page.waitForURL(u=>u.searchParams.get('tab')==='record');
 const job=previous.jobs.find(j=>j.label==='internal');assert(job);observed.reportId=job.report_id;
 await click(page,page.locator(`a[href="/reports/${job.report_id}"]`).first());await page.waitForURL(u=>u.pathname===`/reports/${job.report_id}`);
 await expect(page.getByRole('heading',{name:'Engagement review files',exact:true})).toBeVisible();
 if(fixed){await expect(page.getByText(/Part of this report could not be read/)).toHaveCount(0);await expect(page.getByRole('link',{name:'Open campaign',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:/Grant readiness|Release review/})).toHaveCount(0);}
 else await expect(page.getByText(/Part of this report could not be read/)).toBeVisible();
 await (fixed?page.getByRole('heading',{level:1}):page.getByText(/Part of this report could not be read/)).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-context.png'});
 for(const file of job.artifacts_json){const pending=page.waitForEvent('download');await click(page,page.locator('#campaign-review-files').getByRole('link',{name:'Download '+file.format.toUpperCase(),exact:true}));const download=await pending;const path=prefix+'.'+file.format;await download.saveAs(path);const bytes=fs.readFileSync(path);const checksum=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(checksum,file.checksum);assert.equal(bytes.length,file.byteLength);observed.downloads.push({format:file.format,checksum,byteLength:bytes.length});}
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:prefix+'.png',fullPage:true});fs.writeFileSync(prefix+'.txt',await page.locator('body').ariaSnapshot());assert.deepEqual(observed.console,[]);observed.completed=true;console.log(prefix);
}catch(e){observed.error=e.stack;await page.screenshot({path:prefix+'-failure.png'});fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot());throw e}finally{fs.writeFileSync(prefix+'.json',JSON.stringify(observed,null,2));await browser.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
