import { describe,expect,it } from 'vitest';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { buildCampaignReviewHtml,buildCampaignReviewWorkbook,parseReviewSnapshot,type EngagementReviewSnapshot } from '@/lib/engagement/review-export';
const snapshot:EngagementReviewSnapshot={schema:1,capturedAt:'2026-09-06T12:00:00Z',scope:'internal',filters:{},campaign:{id:'demo',title:'Demonstration only',summary:null,configurationVersionId:null},items:[{id:'one',status:'pending',body:'=HYPERLINK("https://invalid.test")',title:'<script>bad()</script>',configuration_version_id:null}],sessions:[{id:'session',status:'pending'}],answers:[{id:'answer1',session_id:'session',answer_text:'Repeated answer'},{id:'answer2',session_id:'session',answer_text:'Repeated answer'}],responses:[],definitions:[]};
describe('campaign review records',()=>{
 it('refuses corrupt snapshots and private records in public snapshots',()=>{
  const raw=JSON.stringify(snapshot),hash=createHash('sha256').update(raw).digest('hex');
  expect(parseReviewSnapshot(raw,hash).items).toHaveLength(1);
  expect(()=>parseReviewSnapshot(raw+' ',hash)).toThrow('checksum');
  const bad=JSON.stringify({...snapshot,scope:'public'});
  expect(()=>parseReviewSnapshot(bad,createHash('sha256').update(bad).digest('hex'))).toThrow('Private records');
 });
 it('keeps literal spreadsheet text, repeated answers and complete multilingual long values',async()=>{
  const long='🙂'.repeat(599)+'日本語 فارسی '+ 'long narrative\n'.repeat(2400);
  const source={...snapshot,items:[...snapshot.items,{id:'long',status:'pending',body:long}]};
  const bytes=await buildCampaignReviewWorkbook(source,'checksum');
  const workbook=XLSX.read(bytes,{type:'buffer',cellFormula:true});
  const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets.Contributions);
  expect(rows[0].body).toBe(snapshot.items[0].body);
  expect(workbook.Sheets.Contributions.G2.t).toBe('s');expect(workbook.Sheets.Contributions.G2.f).toBeUndefined();
  expect(XLSX.utils.sheet_to_json(workbook.Sheets.Answers)).toHaveLength(2);
  const parts=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets['Long text']).filter(row=>row['Record ID']==='long'&&row.Field==='body');
  expect(parts.map(row=>row.Text).join('')).toBe(long);
  expect(workbook.Sheets.Summary.B2.f).toBe("COUNTA('Contributions'!A2:A3)");
  expect(workbook.Sheets.Summary.B2.v).toBe(2);
 });
 it('renders historical absence and escapes participant markup',()=>{
  const html=buildCampaignReviewHtml(snapshot,'checksum');
  expect(html).toContain('Historical definition unavailable');
  expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>bad()');
  expect(html.match(/Repeated answer/g)).toHaveLength(2);
 });
});
