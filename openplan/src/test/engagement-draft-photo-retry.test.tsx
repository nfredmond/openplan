import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PublicMapSidebar} from '@/components/engagement/public-map-sidebar';
import {createPortalTranslator} from '@/lib/engagement/portal-i18n/translator';
import {buildPortalMessageBundle} from '@/lib/engagement/portal-i18n/messages';
import {resolvePortalLocale} from '@/lib/engagement/portal-i18n/locales';
const translator=createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({requested:'en',acceptLanguage:null})));
function setup(){render(<PublicMapSidebar shareToken="retry-photo-test" acceptingSubmissions categories={[]} demographicsEnabled={false} translator={translator} geometry={null} onClearGeometry={()=>{}} drawMode="point" onDrawModeChange={()=>{}} mapAvailable={false}/>);}
const next=()=>fireEvent.click(screen.getByRole('button',{name:'Next'}));
beforeEach(()=>{localStorage.clear();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:photo'),revokeObjectURL:vi.fn()}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('photograph choices after an interrupted submission',()=>{
 for(const action of ['remove','replace'])it(`honors ${action} after the first upload succeeds but submission fails`,async()=>{
  const bodies:Record<string,unknown>[]=[],uploads:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
   if(url.endsWith('/photo-upload')){uploads.push((init.body as File).name);return new Response(JSON.stringify({photoPath:`campaign/photo-${uploads.length}.png`}),{status:201});}
   bodies.push(JSON.parse(init.body as string));return new Response(JSON.stringify(bodies.length===1?{error:'Interrupted'}:{success:true,submissionId:'received-id'}),{status:bodies.length===1?503:201});
  }));
  setup();await waitFor(()=>expect(localStorage.length).toBeGreaterThan(0));next();fireEvent.change(document.querySelector('#portal-body')!,{target:{value:'A demonstration photo report'}});next();
  fireEvent.change(document.querySelector('#portal-photo')!,{target:{files:[new File(['first'],'first.png',{type:'image/png'})]}});next();next();fireEvent.click(screen.getByRole('button',{name:'Send what I wrote'}));await waitFor(()=>expect(bodies).toHaveLength(1));
  fireEvent.click(screen.getByRole('button',{name:/3Add a photo/}));
  if(action==='remove')fireEvent.click(screen.getByRole('button',{name:/Remove photo/i}));else fireEvent.change(document.querySelector('#portal-photo')!,{target:{files:[new File(['second'],'second.png',{type:'image/png'})]}});
  next();next();fireEvent.click(screen.getByRole('button',{name:'Send what I wrote'}));await waitFor(()=>expect(bodies).toHaveLength(2));
  expect(bodies[1].requestId).toBe(bodies[0].requestId);expect(bodies[1].photoPath).toBe(action==='remove'?undefined:'campaign/photo-2.png');expect(uploads).toEqual(action==='remove'?['first.png']:['first.png','second.png']);
 });
 it('keeps participation available when browser storage cannot be read',async()=>{vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Storage disabled');});setup();await screen.findByText(/Browser storage is unavailable/);next();expect(document.querySelector('#portal-body')).toBeTruthy();});
});

describe('retained receipt and edited draft have separate meaning',()=>{
 it('keeps the earlier receipt free of the edited text and uses a new identifier only after the participant chooses it',async()=>{
  const bodies:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{bodies.push(JSON.parse(init.body as string));return new Response(JSON.stringify(bodies.length===1?{error:'Already received',previousReceipt:{submissionId:'earlier-id',receivedAt:'2026-09-01'}}:{success:true,submissionId:'new-id'}),{status:bodies.length===1?409:201});}));
  setup();await waitFor(()=>expect(localStorage.length).toBeGreaterThan(0));next();fireEvent.change(document.querySelector('#portal-body')!,{target:{value:'Edited and still unsent'}});next();next();next();fireEvent.click(screen.getByRole('button',{name:'Send what I wrote'}));
  await screen.findByText(/An earlier version was received/);const href=screen.getByRole('link',{name:'Save receipt'}).getAttribute('href')!;expect(decodeURIComponent(href)).toContain('earlier-id');expect(decodeURIComponent(href)).not.toContain('Edited and still unsent');
  fireEvent.click(screen.getByRole('button',{name:'Keep this edited draft as a new contribution'}));fireEvent.click(screen.getByRole('button',{name:'Send what I wrote'}));await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[1].requestId).not.toBe(bodies[0].requestId);expect(bodies[1].body).toBe('Edited and still unsent');await screen.findByTestId('portal-sidebar-received');
 });
 it('restores optional participant details and keeps an existing receipt accessible after closing',async()=>{
  localStorage.setItem('openplan-engagement-draft:retry-photo-test:new',JSON.stringify({version:1,body:'Original',requestId:'11111111-1111-4111-8111-111111111111',ageBand:'35_44',zip5:'95945',primaryLanguage:'en',raceEthnicity:['white'],householdTenure:'rent',receipt:{submissionId:'saved-id',receivedAt:'2026-09-01'}}));
  render(<PublicMapSidebar shareToken="retry-photo-test" acceptingSubmissions={false} categories={[]} demographicsEnabled translator={translator} geometry={null} onClearGeometry={()=>{}} drawMode="point" onDrawModeChange={()=>{}} mapAvailable={false}/>);
  await screen.findByTestId('portal-sidebar-received');await waitFor(()=>{const saved=JSON.parse(localStorage.getItem('openplan-engagement-draft:retry-photo-test:new')!);expect(saved).toMatchObject({ageBand:'35_44',zip5:'95945',primaryLanguage:'en',raceEthnicity:['white'],householdTenure:'rent'});});
 });
});
