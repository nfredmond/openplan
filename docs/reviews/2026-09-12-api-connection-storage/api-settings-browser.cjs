const {chromium,expect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs=require('node:fs'),crypto=require('node:crypto'),http=require('node:http');
const out='/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12';
const account=JSON.parse(fs.readFileSync(`${out}/api-settings-account.json`));
const width=Number(process.env.WIDTH||1440),base='http://127.0.0.1:3248';
const name=`Settings fixture ${width} ${Date.now()}`,corrected=`${name} corrected`;
const sha=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
(async()=>{
 let providerCalls=0;const provider=http.createServer((req,res)=>{providerCalls++;res.writeHead(500).end('No model request was expected');});
 await new Promise((resolve,reject)=>{provider.once('error',reject);provider.listen(3217,'127.0.0.1',resolve)});
 const browser=await chromium.launch({channel:'chrome'});const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();
 const consoleEvents=[],requests=[];page.on('console',msg=>{if(['warning','error'].includes(msg.type()))consoleEvents.push({type:msg.type(),text:msg.text()});});page.on('pageerror',e=>consoleEvents.push({type:'pageerror',text:e.message}));
 let savedId,firstRevision;const writes=[];
 page.on('request',request=>{if(request.url().includes('/api/workspaces/provider-api-connections')&&['PUT','DELETE'].includes(request.method())){const body=JSON.parse(request.postData());writes.push({method:request.method(),sha:sha(request.postData()),connectionId:body.connectionId,revisionId:body.revisionId||body.expectedRevisionId});}});
 try{
  await page.goto(base);await page.screenshot({path:`${out}/settings-${width}-entry.png`});
  if(!page.url().includes('/sign-in')) await page.getByRole('link',{name:/Sign in/i}).first().click();
  await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(url=>!url.pathname.includes('sign-in'));
  const setup=page.getByRole('link',{name:'Workspace setup & health',exact:true});
  if(!await setup.isVisible()) {await page.screenshot({path:`${out}/settings-${width}-nav.png`});throw Error('Workspace setup link hidden; inspect navigation');}
  await setup.focus();await page.keyboard.press('Enter');await page.waitForURL('**/workspace');
  const panel=page.getByRole('region',{name:'AI API connections'});await expect(panel.getByRole('button',{name:'Refresh connections'})).toBeEnabled();
  await panel.getByLabel('Connection name',{exact:true}).fill(name);
  await panel.getByLabel(/API base URL/).fill('http://127.0.0.1:3217/v1/');
  await panel.getByLabel('Model IDs, one per line',{exact:true}).fill('fixture-model');
  await panel.getByRole('combobox',{name:'Authentication',exact:true}).selectOption('none');
  let intercepted=false;
  await page.route('**/api/workspaces/provider-api-connections',async route=>{
   if(route.request().method()==='PUT'&&!intercepted){intercepted=true;const res=await route.fetch();expect(res.status()).toBe(201);const value=await res.json();savedId=value.connection.id;firstRevision=value.revision;await route.abort('failed');return;}
   await route.continue();
  });
  await panel.getByRole('button',{name:'Save configuration',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(panel.getByText(/change could not be confirmed/)).toBeVisible();
  await expect(panel.getByLabel('Connection name',{exact:true})).toBeDisabled();
  await panel.screenshot({path:`${out}/settings-${width}-interrupted.png`});
  await panel.getByRole('button',{name:'Retry same change'}).click();await expect(panel.getByText(/Revision saved/)).toBeVisible();
  await expect(panel.getByRole('button',{name:'Save configuration',exact:true})).toBeEnabled();
  expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
  const api=`${base}/api/workspaces/provider-api-connections?workspaceId=${account.workspaceId}&connectionId=${savedId}`;
  let original=await (await context.request.get(api)).json();expect(original.total).toBe(1);expect(original.revisions[0]).toEqual(firstRevision);
  await panel.getByRole('button',{name:`Edit ${name}`,exact:true}).click();
  await panel.getByLabel('Connection name',{exact:true}).fill(corrected);await panel.getByLabel('Model IDs, one per line',{exact:true}).fill('fixture-model\nsecond-fixture-model');
  await panel.getByRole('combobox',{name:'Authentication',exact:true}).selectOption('api_key');
  await panel.getByLabel(/API key for this revision/).fill('SYNTHETIC-BROWSER-KEY');
  await panel.getByRole('button',{name:'Save configuration',exact:true}).click();await expect(panel.getByText(/Revision saved/)).toBeVisible();await expect(panel.getByRole('button',{name:'Save configuration',exact:true})).toBeEnabled();
  let changed=await (await context.request.get(api)).json();expect(changed.total).toBe(2);expect(changed.revisions.find(row=>row.id===firstRevision.id)).toEqual(firstRevision);expect(changed.revisions[0].previous_revision_id).toBe(firstRevision.id);
  expect(JSON.stringify(changed)).not.toContain('SYNTHETIC-BROWSER-KEY');expect(await panel.locator('input[type=password]').inputValue()).toBe('');
  await page.route('**/api/workspaces/provider-api-connections?*', route=>route.abort('failed'));
  await panel.getByRole('button',{name:'Refresh connections',exact:true}).click();
  await expect(panel.getByText(/Could not refresh API connections/)).toBeVisible();
  await expect(panel.getByRole('heading',{name:corrected,exact:true})).toBeVisible();
  await page.unroute('**/api/workspaces/provider-api-connections?*');
  await panel.getByRole('button',{name:'Refresh connections',exact:true}).click();await expect(panel.getByText(/Could not refresh API connections/)).toHaveCount(0);
  await panel.getByRole('button',{name:`History for ${corrected}`,exact:true}).focus();await page.keyboard.press('Enter');
  await expect(panel.getByRole('region',{name:'Revision history'})).toBeVisible();
  await panel.screenshot({path:`${out}/settings-${width}-history.png`});
  await panel.getByRole('button',{name:`Revoke ${corrected}`,exact:true}).click();
  const dialog=page.getByRole('alertdialog');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Revoke connection',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(panel.getByText(/Connection revoked/)).toBeVisible();
  await expect(panel.getByRole('button',{name:`Revoke ${corrected}`,exact:true})).toHaveCount(0);
  const final=await (await context.request.get(api)).json();expect(final.revisions).toEqual(changed.revisions);
  const list=await (await context.request.get(`${base}/api/workspaces/provider-api-connections?workspaceId=${account.workspaceId}`)).json();expect(list.connections.find(row=>row.id===savedId).revoked_at).toBeTruthy();
  await panel.screenshot({path:`${out}/settings-${width}-revoked.png`});
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));expect(stored).not.toContain('SYNTHETIC-BROWSER-KEY');
  expect(providerCalls).toBe(0);expect(consoleEvents.filter(row=>row.type==='pageerror')).toEqual([]);
  const tokenResponse=await context.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},data:{email:account.email,password:account.password}});
  expect(tokenResponse.status()).toBe(200);const token=(await tokenResponse.json()).access_token;
  const credentials=await context.request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/workspace_provider_api_credentials?select=*&workspace_id=eq.${account.workspaceId}`,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`}});
  expect(credentials.status()).toBe(403);
  const foreign=await context.request.get(`${base}/api/workspaces/provider-api-connections?workspaceId=${crypto.randomUUID()}&connectionId=${savedId}`);expect(foreign.status()).toBe(404);
  const report={width,credentialReadStatus:credentials.status(),foreignHistoryStatus:foreign.status(),source:process.env.SOURCE_COMMIT,workspaceId:account.workspaceId,connectionId:savedId,originalRevisionId:firstRevision.id,originalSha:sha(firstRevision),correctedHistorySha:sha(changed.revisions),revokedHistorySha:sha(final.revisions),providerCalls,overflow,writes,consoleEvents,passed:true};
  fs.writeFileSync(`${out}/settings-${width}-browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({width,passed:true,providerCalls,consoleEvents:consoleEvents.length}));
 }catch(error){await page.screenshot({path:`${out}/settings-${width}-failure.png`,fullPage:true});fs.writeFileSync(`${out}/settings-${width}-failure.json`,JSON.stringify({url:page.url(),error:error.message,consoleEvents},null,2));throw error;}
 finally{await browser.close();await new Promise(resolve=>provider.close(resolve));}
})().catch(error=>{console.error(error.message);process.exit(1)});
