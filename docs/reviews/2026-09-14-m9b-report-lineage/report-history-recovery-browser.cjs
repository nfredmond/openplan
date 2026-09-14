const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000}),fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const evidenceDir='/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const base='http://127.0.0.1:3262',width=Number(process.env.PROBE_WIDTH||1440),suffix=Date.now(),prefix=evidenceDir+`/report-history-recovery-${width}-${suffix}`;
const observed={width,base,console:[],network:[],commands:[],downloads:[],completed:false};
const redact=s=>String(s).replaceAll(account.email,'[test-account]').replaceAll(account.password,'[redacted]');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
async function click(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter');}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});const page=await context.newPage();
page.on('console',m=>{if(['error','warning'].includes(m.type()))observed.console.push({type:m.type(),text:m.text()})});page.on('pageerror',e=>observed.console.push({type:'pageerror',text:e.message}));
try{
 observed.identity=await(await page.request.get(base+'/api/health')).json();assert.equal(observed.identity.deployment.commit,process.env.PROBE_COMMIT);
 const campaignId='6611198f-3743-4a70-a5c7-295eb727566b',failedId='e0de5cb6-7773-46a6-9721-7b00996074e2',originalId='951b3d6a-d0f3-46f8-ac3d-27255c0eff7b';
 const reportsPath=base+`/api/engagement/campaigns/${campaignId}/reports`,fileSection=page.locator('#campaign-review-files');
 const JSZip=require('/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13/openplan/node_modules/jszip');
 await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await click(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
 await click(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');await click(page,page.locator(`a[href="/engagement/${campaignId}"]`).first());await click(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Record',exact:true}));
 const getJobs=async()=>{const res=await page.request.get(reportsPath);assert.equal(res.status(),200);return(await res.json()).jobs;};
 const before=await getJobs(),failed=before.find(j=>j.id===failedId),original=before.find(j=>j.id===originalId);assert.equal(failed.status,'failed');assert.equal(failed.failure_detail,'Unsupported campaign snapshot');assert.equal(failed.snapshot_sha256,'80d1c5e1e1f8136d98d39c5fda973ec3da04a6008927da932d537065dab777ec');
 observed.before={id:failedId,status:failed.status,snapshotSha256:failed.snapshot_sha256,error:failed.failure_detail};
 const failedCard=fileSection.locator('article').filter({has:page.locator(`a[href="/reports/${failed.report_id}"]`)});await expect(failedCard.getByRole('alert')).toHaveText(failed.failure_detail);await failedCard.scrollIntoViewIfNeeded();await page.screenshot({path:prefix+'-before.png'});
 const request=page.waitForResponse(r=>r.url()===reportsPath+'/'+failedId&&r.request().method()==='PATCH');await click(page,failedCard.getByRole('button',{name:'Retry saved snapshot',exact:true}));const res=await request;assert.equal(res.status(),200);assert.deepEqual(res.request().postDataJSON(),{action:'retry'});
 let recovered;await expect.poll(async()=>{recovered=(await getJobs()).find(j=>j.id===failedId);if(recovered.status==='failed')throw Error(recovered.failure_detail);return recovered.status;},{timeout:120000,intervals:[1000,2000,3000]}).toBe('complete');assert.equal(recovered.snapshot_sha256,failed.snapshot_sha256);assert.equal(recovered.report_id,failed.report_id);
  async function files(job,label){
   const downloaded=[];let archive;
   await click(page,fileSection.locator(`a[href="/reports/${job.report_id}"]`).first());await page.waitForURL(u=>u.pathname===`/reports/${job.report_id}`);
   await expect(fileSection.getByText(/Includes the entire consultation decision history/)).toHaveCount(job.scope==='internal'?1:0);
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
 const repaired=await files(recovered,'corrected-recovered');assert.equal(repaired.archive.decisionLinkCount,2);assert.deepEqual(repaired.archive.decisionLinks.map(r=>r.operation),['link','refresh']);
 const retained=await files(original,'original-preserved');assert.equal(retained.archive.decisionLinkCount,1);assert.equal(retained.archive.decisionLinks[0].context_text,repaired.archive.decisionLinks[0].context_text);
 observed.recovered={id:recovered.id,snapshotSha256:recovered.snapshot_sha256,files:repaired.downloaded};observed.originalPreserved=retained.downloaded;assert.deepEqual(observed.console,[]);observed.completed=true;console.log(prefix);
}catch(e){observed.error=redact(e.stack||e.message);await page.screenshot({path:prefix+'-failure.png'});throw e}finally{fs.writeFileSync(prefix+'.json',JSON.stringify(observed,null,2));await browser.close()}})().catch(e=>{console.error(redact(e.message));process.exitCode=1});
