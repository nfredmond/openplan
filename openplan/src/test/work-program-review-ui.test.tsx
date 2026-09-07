// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkProgramWorkflow } from '@/components/programs/work-program/workflow';
import { emptyWorkflow } from '@/lib/programs/work-program/workflow';
import type { WorkProgramPreparation, WorkProgramRevision } from '@/lib/programs/work-program/types';
const one={id:'11111111-1111-4111-8111-111111111111',revision:1,created_by:'33333333-3333-4333-8333-333333333333',content_sha256:'a'.repeat(64)} as WorkProgramRevision;
const two={...one,id:'22222222-2222-4222-8222-222222222222',revision:2,content_sha256:'b'.repeat(64)};
vi.mock('@/components/programs/work-program/exports',()=>({WorkProgramExports:({packet}:{packet:{publicReviewed:boolean}})=><div data-testid="disclosure">{String(packet.publicReviewed)}</div>}));
let sequence=0;
const response=()=>({state:{...emptyWorkflow,sequence},events:[],assignments:[],members:[]});
const props=(latest=one)=>({programId:'program',userId:'user',preparation:{latest,revisions:[two,one],sources:[]} as WorkProgramPreparation,dirty:false,canWrite:true,documents:[],onAmendment:vi.fn()});
beforeEach(()=>{sequence=0;sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>response()})));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('exact version review form',()=>{
 it('requires a new public disclosure acknowledgement after selecting another revision or history version',async()=>{
  render(<WorkProgramWorkflow {...props()} />);
  await screen.findByText(/Review status: draft/);
  fireEvent.change(screen.getByRole('combobox',{name:'Review file audience'}),{target:{value:'public'}});
  const consent=screen.getByRole('checkbox');fireEvent.click(consent);
  expect(screen.getByTestId('disclosure')).toHaveTextContent('true');
  fireEvent.change(screen.getByRole('combobox',{name:'Selected review revision'}),{target:{value:two.id}});
  expect(screen.getByTestId('disclosure')).toHaveTextContent('false');
  fireEvent.click(consent);expect(screen.getByTestId('disclosure')).toHaveTextContent('true');
  sequence=1;fireEvent.click(screen.getByRole('button',{name:'Reload review history'}));
  await waitFor(()=>expect(screen.getByTestId('disclosure')).toHaveTextContent('false'));
 });
 it('recovers unfinished notes against their original revision when a newer one appears',async()=>{
  const view=render(<WorkProgramWorkflow {...props()} />);await screen.findByText(/Review status: draft/);
  fireEvent.change(screen.getByRole('combobox',{name:'Review action'}),{target:{value:'comment'}});
  fireEvent.change(screen.getByLabelText('Review note or requested changes'),{target:{value:'Comment about revision one'}});
  await waitFor(()=>expect(sessionStorage.getItem('owp-review:user:program:draft')).toContain(one.id));
  view.unmount();render(<WorkProgramWorkflow {...props(two)} />);
  await waitFor(()=>expect(screen.getByLabelText('Review note or requested changes')).toHaveValue('Comment about revision one'));
  expect(screen.getByRole('combobox',{name:'Selected review revision'})).toHaveValue(one.id);
 });
 it('retains an unconfirmed exact request and retries it without creating a different request id',async()=>{
  const postBodies:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
   if(init?.method==='POST'){postBodies.push(String(init.body));if(postBodies.length===1)throw new Error('Synthetic lost response');return {ok:true,json:async()=>({event:{id:'event'}})};}
   return {ok:true,json:async()=>response()};
  }));
  render(<WorkProgramWorkflow {...props()} />);await screen.findByText(/Review status: draft/);
  fireEvent.change(screen.getByRole('combobox',{name:'Review action'}),{target:{value:'comment'}});
  fireEvent.change(screen.getByLabelText('Review note or requested changes'),{target:{value:'Exact retry'}});
  fireEvent.click(screen.getByRole('button',{name:'Save selected action'}));
  await screen.findByText('Synthetic lost response');
  fireEvent.click(screen.getByRole('button',{name:'Retry unconfirmed review request'}));
  await waitFor(()=>expect(postBodies).toHaveLength(2));expect(postBodies[1]).toBe(postBodies[0]);
 });
 it('sends only visible authority fields after switching to a comment',async()=>{
  let sent:Record<string,unknown>|undefined;
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
   if(init?.method==='POST'){sent=JSON.parse(String(init.body));return {ok:true,json:async()=>({event:{id:'event'}})};}
   return {ok:true,json:async()=>response()};
  }));
  render(<WorkProgramWorkflow {...props()} />);await screen.findByText(/Review status: draft/);
  fireEvent.change(screen.getByRole('combobox',{name:'Review action'}),{target:{value:'adoption'}});
  fireEvent.change(screen.getByLabelText('Actual deciding authority'),{target:{value:'Prior authority'}});
  fireEvent.change(screen.getByLabelText('Applicable scope, conditions and unresolved requirements'),{target:{value:'Prior scope'}});
  fireEvent.change(screen.getByLabelText('Decision or authorization date'),{target:{value:'2026-09-07'}});
  fireEvent.change(screen.getByRole('combobox',{name:'Review action'}),{target:{value:'comment'}});
  fireEvent.change(screen.getByLabelText('Review note or requested changes'),{target:{value:'Independent comment'}});
  fireEvent.click(screen.getByRole('button',{name:'Save selected action'}));
  await waitFor(()=>expect(sent).toBeDefined());
  expect(sent).toMatchObject({kind:'comment',authority:'',scope:'',evidenceDate:null,reviewerIds:[],dueOn:null,targetEventId:null});
 });

 it.each(['{broken', JSON.stringify({revisionId:one.id,revisionHash:'wrong',form:{kind:'comment',note:'Retain me',visibility:'internal'}})])('preserves unreadable or mismatched recovered draft text: %s',async raw=>{
  sessionStorage.setItem('owp-review:user:program:draft',raw);
  render(<WorkProgramWorkflow {...props(two)} />);
  await waitFor(()=>expect(sessionStorage.getItem('owp-review:user:program:unreadable')).toBe(raw));
  expect(screen.getByRole('combobox',{name:'Selected review revision'})).toHaveValue(two.id);
  expect(screen.getByLabelText('Review note or requested changes')).toHaveValue('');
  expect(screen.getByDisplayValue(raw)).toBeInTheDocument();
 });

});
