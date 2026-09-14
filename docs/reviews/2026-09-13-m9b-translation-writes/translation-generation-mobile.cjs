const {chromium}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs=require('node:fs');
const root=require('node:path').resolve(__dirname,'../../..');
require('node:child_process').execFileSync('bash',[root+'/openplan/scripts/ops/which-openplan.sh','http://127.0.0.1:3260'],{cwd:root});
const directory='/home/nathaniel/.local/state/openplan/response-write-probe-20260913', campaign='8e2b0137-5fc8-4506-88eb-2850508a0563';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
const page=await browser.newPage({viewport:{width:390,height:1000}});const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
await page.goto('http://127.0.0.1:3260');await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('sign-in'));await page.getByRole('link',{name:'Engagement',exact:true}).first().click();await page.waitForURL('**/engagement');await page.locator(`a[href="/engagement/${campaign}"]`).first().click();await page.waitForURL(u=>u.pathname===`/engagement/${campaign}`);await page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('tab')==='setup');
const panel=page.getByRole('region',{name:'Machine translation requests',exact:true});
await panel.getByRole('button',{name:'Machine translation requests',exact:true}).click();
const refresh=panel.getByRole('button',{name:'Refresh saved generation requests',exact:true});await refresh.waitFor();await refresh.scrollIntoViewIfNeeded();
if(process.env.OPENPLAN_CLIP_CONTROL==='harmless')await refresh.evaluate(el=>el.style.borderColor='rgb(123, 123, 123)');
if(process.env.OPENPLAN_CLIP_CONTROL==='broken')await refresh.evaluate(el=>{el.style.setProperty('white-space','nowrap','important');el.style.setProperty('max-width','none','important')});
const geometry=await panel.getByRole('button').evaluateAll(buttons=>buttons.filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect(),parent=b.parentElement.getBoundingClientRect();return {label:b.textContent,width:r.width,parentWidth:parent.width,fits:r.left>=parent.left-1&&r.right<=parent.right+1&&b.scrollWidth<=b.clientWidth+1}}));
await page.screenshot({path:directory+'/translation-generation-mobile-'+(process.env.OPENPLAN_CLIP_CONTROL||'baseline')+'.png'});
fs.writeFileSync(directory+'/translation-generation-mobile-'+(process.env.OPENPLAN_CLIP_CONTROL||'baseline')+'.json',JSON.stringify(geometry,null,2));
require('node:assert/strict').deepEqual(geometry.filter(b=>!b.fits),[],'Generation buttons fit inside their panel');console.log('Generation buttons fit inside their panel');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
