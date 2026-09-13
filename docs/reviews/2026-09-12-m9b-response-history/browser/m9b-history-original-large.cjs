const {chromium,expect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root='/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12',app='/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10/openplan';
const account=JSON.parse(fs.readFileSync(`${root}/api-settings-account.json`)),base='http://127.0.0.1:3255',width=Number(process.env.WIDTH||1440),title=`SYNTHETIC response history ${width} ${Date.now()}`;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
(async()=>{for(const w of [1440,390]){
 const browser=await chromium.launch({channel:'chrome'}),context=await browser.newContext({viewport:{width:w,height:1000}}),page=await context.newPage();page.setDefaultTimeout(45000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base);if(!page.url().includes('/sign-in'))await page.getByRole('link',{name:/Sign in/i}).first().click();
  await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('sign-in'));
  const campaign=JSON.parse(fs.readFileSync(`${root}/m9b-history-${w}-browser.json`)).campaignId;
  await page.getByRole('link',{name:'Engagement',exact:true}).first().click();await page.waitForURL('**/engagement');await page.locator(`a[href="/engagement/${campaign}"]`).first().click();
  await page.getByRole('button',{name:'Response history',exact:true}).click();const history=page.getByRole('region',{name:'Response history',exact:true});
  const original=history.getByRole('listitem').filter({has:page.getByRole('heading',{name:'Revision 1: Created',exact:true})});await expect(original).toContainText('SYNTHETIC draft response; not published.');await original.screenshot({path:`${root}/m9b-history-${w}-original.png`});
  await page.getByRole('link',{name:'Engagement',exact:true}).first().click();await page.waitForURL('**/engagement');await page.locator('a[href="/engagement/a3c41566-bfd4-40f2-b467-96ee79054ec6"]').first().click();
  await page.getByRole('button',{name:'Response history',exact:true}).click();await expect(history.getByRole('combobox')).toBeVisible();await expect(history.getByRole('option')).toHaveCount(1005);
  const options=await history.getByRole('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent})));await history.getByRole('combobox').focus();await page.keyboard.press('End');await page.keyboard.press('Enter');
  expect(await history.getByRole('combobox').inputValue()).toBe(options.at(-1).value);await expect(history.getByText('This is the copy present when history retention began. Earlier changes are unknown.')).toBeVisible();await history.getByRole('listitem').screenshot({path:`${root}/m9b-history-${w}-large-baseline.png`});
  expect(errors).toEqual([]);fs.writeFileSync(`${root}/m9b-history-${w}-original-large.json`,JSON.stringify({width:w,passed:true,source:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),originalCampaign:campaign,largeCampaign:'a3c41566-bfd4-40f2-b467-96ee79054ec6',options:options.length,lastSelected:options.at(-1).value,pageErrors:errors},null,2));console.log(JSON.stringify({width:w,passed:true,options:options.length}));
 }finally{await browser.close()}
}})().catch(e=>{console.error(e.message);process.exit(1)});
