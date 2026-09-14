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
 if(fixed){await expect(page.getByText(/Part of this report could not be read/)).toHaveCount(0);await expect(page.getByRole('link',{name:'Open consultation',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:/Grant readiness|Release review/})).toHaveCount(0);}
 else await expect(page.getByText(/Part of this report could not be read/)).toBeVisible();
 if(fixed){
  await expect(page.getByRole('heading',{name:'Edit report details',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Generate|Regenerate/})).toHaveCount(0);
  const original={title:await page.getByLabel('Title',{exact:true}).inputValue(),summary:await page.getByLabel('Summary',{exact:true}).inputValue(),status:await page.getByLabel('Status',{exact:true}).inputValue()};
  const edited={title:original.title+' - filing check',summary:'SYNTHETIC metadata recovery check. Saved review files must remain unchanged.',status:original.status};
  const routePath=base+`/api/reports/${job.report_id}`;
  const requests=[];page.on('request',r=>{if(r.url()===routePath&&r.method()==='PATCH')requests.push(r.postDataJSON());assert(!r.url().endsWith(`/reports/${job.report_id}/generate`),'Metadata edit requested generation');});
  await page.getByLabel('Title',{exact:true}).fill(edited.title);await page.getByLabel('Summary',{exact:true}).fill(edited.summary);
  let committedBeforeLoss=false;
  await page.route(routePath,async route=>{assert.equal(route.request().method(),'PATCH');const response=await route.fetch();assert.equal(response.status(),200);committedBeforeLoss=true;await route.abort('failed');});
  await click(page,page.getByRole('button',{name:'Save metadata',exact:true}));
  await expect(page.getByText('Failed to fetch',{exact:true})).toBeVisible();assert(committedBeforeLoss);
  await expect(page.getByLabel('Title',{exact:true})).toHaveValue(edited.title);
  await page.unroute(routePath);
  const saved=page.waitForResponse(r=>r.url()===routePath&&r.request().method()==='PATCH');
  await click(page,page.getByRole('button',{name:'Save metadata',exact:true}));assert.equal((await saved).status(),200);
  await page.reload();await expect(page.getByRole('heading',{name:edited.title,exact:true})).toBeVisible();
  await expect(page.getByLabel('Title',{exact:true})).toHaveValue(edited.title);await expect(page.getByLabel('Summary',{exact:true})).toHaveValue(edited.summary);await expect(page.getByLabel('Status',{exact:true})).toHaveValue(edited.status);
  assert.deepEqual(requests,[edited,edited]);
  await page.getByRole('heading',{name:'Edit report details',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-metadata.png'});
  await page.getByLabel('Title',{exact:true}).fill(original.title);await page.getByLabel('Summary',{exact:true}).fill(original.summary);
  const restored=page.waitForResponse(r=>r.url()===routePath&&r.request().method()==='PATCH');await click(page,page.getByRole('button',{name:'Save metadata',exact:true}));assert.equal((await restored).status(),200);
  await page.reload();await expect(page.getByLabel('Title',{exact:true})).toHaveValue(original.title);await expect(page.getByLabel('Summary',{exact:true})).toHaveValue(original.summary);
  observed.metadata={committedBeforeLoss,retrySaved:true,reloaded:true,restored:true,patchCount:requests.length,generationRequests:0};
  observed.expectedInterruptedConsole=observed.console.filter(m=>m.includes('net::ERR_FAILED'));assert.equal(observed.expectedInterruptedConsole.length,1);observed.console=observed.console.filter(m=>!m.includes('net::ERR_FAILED'));
 }
 await (fixed?page.getByRole('heading',{level:1}):page.getByText(/Part of this report could not be read/)).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-context.png'});
 for(const file of job.artifacts_json){const pending=page.waitForEvent('download');await click(page,page.locator('#campaign-review-files').getByRole('link',{name:'Download '+file.format.toUpperCase(),exact:true}));const download=await pending;const path=prefix+'.'+file.format;await download.saveAs(path);const bytes=fs.readFileSync(path);const checksum=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(checksum,file.checksum);assert.equal(bytes.length,file.byteLength);observed.downloads.push({format:file.format,checksum,byteLength:bytes.length});}
 if(fixed){const anonymous=await browser.newContext();const denied=await anonymous.request.get(base+`/reports/${job.report_id}`,{maxRedirects:0});assert.equal(denied.status(),307);assert(denied.headers().location.includes('sign-in'));observed.anonymousReportStatus=denied.status();observed.anonymousFiles=[];for(const file of job.artifacts_json){const response=await anonymous.request.get(base+`/api/engagement/campaigns/${previous.campaignId}/reports/${job.id}/download?format=${file.format}`);assert.equal(response.status(),401);observed.anonymousFiles.push({format:file.format,status:response.status()});}await anonymous.close();}
 observed.layout=await page.locator('main').last().evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth}));assert(observed.layout.scrollWidth<=observed.layout.width+1,'Report content overflows its narrow layout');
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:prefix+'.png',fullPage:true});fs.writeFileSync(prefix+'.txt',await page.locator('body').ariaSnapshot());if(fixed){await click(page,page.getByRole('link',{name:'Open consultation',exact:true}));await page.waitForURL(u=>u.pathname===`/engagement/${previous.campaignId}`&&u.searchParams.get('tab')==='record');await expect(page.getByRole('heading',{name:'Engagement review files',exact:true})).toBeVisible();observed.returnedToCampaign=true;}
 assert.deepEqual(observed.console,[]);observed.completed=true;console.log(prefix);
}catch(e){observed.error=e.stack;await page.screenshot({path:prefix+'-failure.png'});fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot());throw e}finally{fs.writeFileSync(prefix+'.json',JSON.stringify(observed,null,2));await browser.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
