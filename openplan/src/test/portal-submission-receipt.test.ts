import { beforeEach,describe,expect,it,vi } from 'vitest';
import { submitPortalInput } from '@/lib/engagement/submit-portal-input';
const fetchMock=vi.fn();
beforeEach(()=>{vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();localStorage.clear();});
describe('participant receipts and retry identity',()=>{
 const input={shareToken:'example-share-token',requestId:'10000000-0000-4000-8000-000000000001',body:'Demonstration feedback',website:''};
 it('does not announce receipt without a saved identifier',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({success:true}),{status:201}));
  expect((await submitPortalInput(input)).ok).toBe(false);
 });
 it('keeps the request identifier after interruption and exposes the retained receipt',async()=>{
  fetchMock.mockRejectedValueOnce(new Error('Interrupted')).mockResolvedValueOnce(new Response(JSON.stringify({success:true,submissionId:'retained-id',receivedAt:'2026-09-06T12:00:00Z'}),{status:200}));
  expect((await submitPortalInput(input)).ok).toBe(false);
  expect(await submitPortalInput(input)).toEqual({ok:true,submissionId:'retained-id',receivedAt:'2026-09-06T12:00:00Z'});
  expect(fetchMock.mock.calls.map(call=>JSON.parse(call[1].body).requestId)).toEqual([input.requestId,input.requestId]);
 });
});
