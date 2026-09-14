const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000}),fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const evidenceDir='/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const base='http://127.0.0.1:3262',width=Number(process.env.PROBE_WIDTH||1440),suffix=Date.now(),prefix=evidenceDir+`/report-history-controls-${process.env.PROBE_LEGACY?"legacy-":""}${width}-${suffix}`;
const observed={width,base,console:[],network:[],commands:[],downloads:[],completed:false};
const redact=s=>String(s).replaceAll(account.email,'[test-account]').replaceAll(account.password,'[redacted]');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
async function click(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter');}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});const page=await context.newPage();
page.on('console',m=>{if(['error','warning'].includes(m.type()))observed.console.push({type:m.type(),text:m.text()})});page.on('pageerror',e=>observed.console.push({type:'pageerror',text:e.message}));
try{
 observed.identity=await(await page.request.get(base+'/api/health')).json();assert.equal(observed.identity.deployment.commit,process.env.PROBE_COMMIT);
 const legacy=process.env.PROBE_LEGACY==='1';const previous=JSON.parse(fs.readFileSync(evidenceDir+'/'+(legacy?(width===390?'public-privacy-390-1789393604792':'public-privacy-1440-1789393515387'):(width===390?'report-history-390-1789405897743':'report-history-1440-1789405863570'))+'.json')),campaignId=previous.campaignId;if(legacy)previous.reportJobs=previous.jobs.filter(j=>j.label==='internal');
 const fileSection=page.locator('#campaign-review-files'),JSZip=require('/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13/openplan/node_modules/jszip');
 await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
 await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');await click(page,page.locator(`a[href="/engagement/${campaignId}"]`).first());await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`);await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Record',exact:true}));await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`&&u.searchParams.get('tab')==='record');
  async function files(job,label){
   const downloaded=[];let archive;
   await click(page,fileSection.locator(`a[href="/reports/${job.report_id}"]`).first());await page.waitForURL(u=>u.pathname===`/reports/${job.report_id}`);
   if(legacy)await expect(fileSection.getByText(/This earlier saved format does not contain decision history/)).toBeVisible();else await expect(fileSection.getByText(/Includes the entire consultation decision history/)).toHaveCount(job.scope==='internal'?1:0);
   for(const file of job.artifacts_json){
    const pending=page.waitForEvent('download');await click(page,fileSection.getByRole('link',{name:'Download '+file.format.toUpperCase(),exact:true}));
    const download=await pending,path=prefix+`-${label}.${file.format}`;await download.saveAs(path);const bytes=fs.readFileSync(path);assert.equal(sha(bytes),file.checksum);assert.equal(bytes.length,file.byteLength);
    downloaded.push({format:file.format,sha256:sha(bytes),bytes:bytes.length});
    if(file.format==='zip'){const zip=await JSZip.loadAsync(bytes),raw=await zip.file('snapshot.json').async('string');assert.equal(sha(raw),job.snapshot_sha256);archive=JSON.parse(raw);const manifest=JSON.parse(await zip.file('manifest.json').async('string'));for(const entry of manifest.files)assert.equal(sha(await zip.file(entry.name).async('nodebuffer')),entry.checksum);}
   }
   assert(archive);const downloadControl=fileSection.getByRole('link',{name:'Download ZIP',exact:true});await downloadControl.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));await expect.poll(async()=>{const r=await downloadControl.boundingBox();return !!r&&r.y>=160&&r.y+r.height<850;}).toBe(true);await page.screenshot({path:prefix+`-${label}-download-controls.png`});await fileSection.getByRole('heading',{name:'Engagement review files',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:prefix+`-${label}-files.png`});
   const layout=await page.locator('main').last().evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth}));assert(layout.scrollWidth<=layout.width+1,'Report overflows narrow layout');
   await click(page,page.getByRole('link',{name:'Open consultation',exact:true}));await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`&&u.searchParams.get('tab')==='record');
   return {downloaded,archive,layout};
  }
for(const job of previous.reportJobs){const result=await files(job,job.label);observed.downloads.push({label:job.label,files:result.downloaded,layout:result.layout});}assert.deepEqual(observed.console,[]);observed.completed=true;console.log(prefix);
}catch(e){observed.error=e.stack;await page.screenshot({path:prefix+'-failure.png'});fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot());throw e}finally{fs.writeFileSync(prefix+'.json',JSON.stringify(observed,null,2));await browser.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
