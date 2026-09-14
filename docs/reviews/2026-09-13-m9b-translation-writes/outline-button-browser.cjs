const {chromium,expect:baseExpect}=require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const expect=baseExpect.configure({timeout:45000});
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=require('node:path').resolve(__dirname,'../../..');
const base='http://127.0.0.1:3260',evidence='/home/nathaniel/.local/state/openplan/response-write-probe-20260913';
const account=JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prior=JSON.parse(fs.readFileSync(evidence+'/translation-editor-1440-1789345214844-result.json'));
const campaignId=prior.campaignId;
if(!/^[a-f0-9-]{36}$/.test(campaignId)||!prior.originalHistory.record.translated_text.includes('1440'))throw Error('Expected retained synthetic UI campaign');
const label=process.env.OPENPLAN_OUTLINE_CONTROL??'baseline';
const prefix=evidence+'/outline-button-'+label+'-'+Date.now();
const files=['openplan/src/components/ui/button.tsx','openplan/src/app/globals.css','openplan/src/app/cartographic.css','openplan/src/lib/theme/palettes.ts','openplan/src/components/theme-controls.tsx','openplan/src/components/engagement/translation-history.tsx'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(root+'/'+file)).digest('hex')]));
const results=[],events=[];let lastMeasurement=null;
async function keyClick(page,locator){await expect(locator).toBeEnabled();await locator.focus();await page.keyboard.press('Enter');}
async function measure(button){
 return button.evaluate(el=>{
  const css=getComputedStyle(el),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);};
  const luminance=rgb=>rgb.slice(0,3).map(channel=>{const value=channel/255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
  const ratio=(a,b)=>{const first=luminance(a),second=luminance(b);return (Math.max(first,second)+0.05)/(Math.min(first,second)+0.05);};
  const foreground=rgba(css.color),background=rgba(css.backgroundColor);
  return {color:css.color,backgroundColor:css.backgroundColor,foreground,background,ratio:ratio(foreground,background),
   controls:{blackWhite:ratio([0,0,0],[255,255,255]),sameColor:ratio([100,100,100],[100,100,100])},
   hovered:el.matches(':hover'),focused:document.activeElement===el,focusVisible:el.matches(':focus-visible'),boxShadow:css.boxShadow,
   outlineStyle:css.outlineStyle,opacity:css.opacity,disabled:el.disabled,variant:el.dataset.variant};
 });
}
async function record(page,button,width,mode,palette,state){
 let value;
 if(state==='hover')await expect(async()=>{await button.hover();await page.waitForTimeout(300);value=await measure(button);expect(value.hovered).toBe(true);await expect(button).toBeInViewport();}).toPass({timeout:10000});
 else {await page.waitForTimeout(300);value=await measure(button);lastMeasurement={width,mode,palette,state,...value};await expect(button).toBeInViewport();}
 expect(value.controls.blackWhite).toBe(21);expect(value.controls.sameColor).toBe(1);expect(value.foreground[3]).toBe(255);expect(value.background[3]).toBe(255);
 expect(value.disabled).toBe(false);expect(value.opacity).toBe('1');expect(value.variant).toBe('outline');
 if(state==='hover')expect(value.hovered).toBe(true);
 if(state==='keyboard'){expect(value.focused).toBe(true);expect(value.focusVisible).toBe(true);expect(value.boxShadow).not.toBe('none');}
 const screenshot=state==='hover'||palette==='cartographic'&&state==='keyboard'?`${prefix}-${width}-${mode}-${palette}-${state}.png`:null;
 if(screenshot)await page.screenshot({path:screenshot});
 results.push({width,mode,palette,state,...value,screenshot});
}
(async()=>{
 const before=hashes();fs.writeFileSync(prefix+'-identity.log',execFileSync('bash',[root+'/openplan/scripts/ops/which-openplan.sh',base],{cwd:root,encoding:'utf8'}));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();page.setDefaultTimeout(45000);
   page.on('pageerror',e=>events.push({width,type:'pageerror',text:e.message}));page.on('console',m=>{if(['warning','error'].includes(m.type()))events.push({width,type:m.type(),text:m.text()});});
   try{
    await page.addInitScript(()=>{
     window.__outlineTrace=[];
     for(const type of ['scroll','focusin','keydown'])document.addEventListener(type,event=>{
      const target=event.target,active=document.activeElement;
      window.__outlineTrace.push({type,key:event.key,time:performance.now(),target:target?.id||target?.className||target?.tagName||'document',top:target?.scrollTop,active:active?.getAttribute('aria-label')||active?.textContent?.slice(0,80),activeTop:active?.getBoundingClientRect().top});
      if(window.__outlineTrace.length>80)window.__outlineTrace.shift();
     },true);
    });
    await page.goto(base);await page.getByRole('link',{name:/Sign in/i}).first().click();await page.getByLabel('Work email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);
    await keyClick(page,page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL(u=>!u.pathname.includes('sign-in'));
    await keyClick(page,page.getByRole('link',{name:'Engagement',exact:true}).first());await page.waitForURL('**/engagement');
    await keyClick(page,page.locator(`a[href="/engagement/${campaignId}"]`).first());await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`);
    await keyClick(page,page.getByTestId('page-tabs-nav').getByRole('link',{name:'Setup',exact:true}));
    await page.waitForURL(u=>u.pathname===`/engagement/${campaignId}`&&u.searchParams.get('tab')==='setup');
    const panel=page.locator('article').filter({has:page.getByRole('heading',{name:/Publish this campaign in your community/})});
    const button=panel.getByRole('button',{name:/^(Close translation history|Translation history)$/});
    for(const mode of ['dark','light']){
     await keyClick(page,page.getByTestId('theme-mode-'+mode));await expect(page.locator('html')).toHaveClass(mode==='dark'?/dark/:/^(?!.*\bdark\b).*$/);
     for(const palette of ['cartographic','slate','harbor','meadow','plum']){
      await keyClick(page,page.getByTestId('theme-palette-trigger'));await keyClick(page,page.getByTestId('theme-palette-'+palette));await expect(page.locator('html')).toHaveAttribute('data-palette',palette);
      if(label==='harmless')await page.addStyleTag({content:'button[data-variant="outline"] { outline-offset: 3px; }'});
      await button.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await record(page,button,width,mode,palette,'idle');
      await record(page,button,width,mode,palette,'hover');
      await page.mouse.move(0,0);await button.focus();await expect(button).toBeFocused();await expect(button).toBeInViewport();
      await page.keyboard.press('Tab');await expect(page.locator(':focus')).toBeInViewport();
      console.log('Tab destination',width,mode,palette,await page.locator(':focus').evaluate(el=>({tag:el.tagName,name:el.getAttribute('aria-label')||el.textContent?.slice(0,80)})));
      await page.keyboard.press('Shift+Tab');await expect(button).toBeFocused();await record(page,button,width,mode,palette,'keyboard');
      await page.keyboard.press('Enter');await expect(button).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Enter');await expect(button).toHaveAttribute('aria-expanded','false');
     }
    }
    const overflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(width);
    console.log('Measured outline states',width,results.filter(r=>r.width===width).length);
   }catch(error){fs.writeFileSync(prefix+'-'+width+'-trace.json',JSON.stringify({lastMeasurement,trace:await page.evaluate(()=>window.__outlineTrace)},null,2));await page.screenshot({path:prefix+'-'+width+'-failure.png'});throw error;}finally{await context.close();}
  }
  const failures=results.filter(row=>row.ratio<4.5);expect(results).toHaveLength(60);expect(events.filter(e=>e.type==='pageerror')).toEqual([]);
  fs.writeFileSync(prefix+'-result.json',JSON.stringify({label,campaignId,sourceHashes:before,results,events,failures,limits:'Shared outline button on actual Engagement history control, five palettes, two modes, two widths. Text contrast and keyboard activation only; does not prove every component override, focus-ring contrast or the unfinished publication producer.'},null,2));
  console.log('Contrast failures',failures.map(({width,mode,palette,state,ratio})=>({width,mode,palette,state,ratio})));
  expect(failures,'Rendered outline text contrast must be at least 4.5:1').toEqual([]);
 }finally{await browser.close();expect(hashes()).toEqual(before);}
})().catch(error=>{fs.writeFileSync(prefix+'-failure.json',JSON.stringify({message:error.message,results,events},null,2));console.error(error.stack);process.exitCode=1});
