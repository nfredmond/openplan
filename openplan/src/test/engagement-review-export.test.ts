import { describe,expect,it,vi } from 'vitest';
import JSZip from 'jszip';
vi.mock('@/lib/reports/pdf',()=>({renderReportPdf:async()=>({engine:'chrome',bytes:new Uint8Array([37,80,68,70])})}));
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { buildCampaignReviewHtml,buildCampaignReviewWorkbook,parseReviewSnapshot,renderCampaignReviewFiles,campaignQuestionSummary,campaignReviewMap,type EngagementReviewSnapshot } from '@/lib/engagement/review-export';
const snapshot:EngagementReviewSnapshot={schema:1,capturedAt:'2026-09-06T12:00:00Z',scope:'internal',filters:{},campaign:{id:'demo',title:'Demonstration only',summary:null,configurationVersionId:null},items:[{id:'one',status:'pending',body:'=HYPERLINK("https://invalid.test")',title:'<script>bad()</script>',configuration_version_id:null}],sessions:[{id:'session',status:'pending'}],answers:[{id:'answer1',session_id:'session',answer_text:'Repeated answer'},{id:'answer2',session_id:'session',answer_text:'Repeated answer'}],responses:[],definitions:[]};
describe('campaign review records',()=>{
 it('refuses corrupt snapshots and private records in public snapshots',()=>{
  const raw=JSON.stringify(snapshot),hash=createHash('sha256').update(raw).digest('hex');
  expect(parseReviewSnapshot(raw,hash).items).toHaveLength(1);
  expect(()=>parseReviewSnapshot(raw+' ',hash)).toThrow('checksum');
  const bad=JSON.stringify({...snapshot,scope:'public'});
  expect(()=>parseReviewSnapshot(bad,createHash('sha256').update(bad).digest('hex'))).toThrow('Private records');
 });
 it('refuses private review intent embedded in an otherwise public snapshot',()=>{
  const raw=JSON.stringify({...snapshot,scope:'public',items:[{id:'public',status:'approved',review_reason:'Private reviewer input'}],sessions:[],answers:[]});
  expect(()=>parseReviewSnapshot(raw,createHash('sha256').update(raw).digest('hex'))).toThrow('Private records');
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
 it('retains coordinate-only legacy locations in the portable GeoJSON alongside drawn features',async()=>{
  const source={...snapshot,items:[{id:'legacy',status:'pending',longitude:179.9,latitude:10,body:'Legacy location'},{id:'drawn',status:'pending',geometry:{type:'Point',coordinates:[-179.9,11]},body:'Drawn location'},{id:'words',status:'pending',body:'At the library'}]};
  const raw=JSON.stringify(source),files=await renderCampaignReviewFiles(raw,createHash('sha256').update(raw).digest('hex'));
  const zip=await JSZip.loadAsync(files.find(file=>file.format==='zip')!.bytes),geo=JSON.parse(await zip.file('contributions.geojson')!.async('string'));
  expect(geo.features.map((feature:{id:string})=>feature.id)).toEqual(['legacy','drawn']);
  expect(geo.features[0].geometry).toEqual({type:'Point',coordinates:[179.9,10]});
 });
 it('reconciles repeated, redacted and unanswered sessions using the original definitions',()=>{
  const source:EngagementReviewSnapshot={...snapshot,definitions:[{id:'v',sha256:'hash',definition:{campaign:{},categories:[],layers:[],questions:[{id:'q',prompt:'Original prompt'}]}}],sessions:['s1','s2','s3','s4'].map(id=>({id,configuration_version_id:'v'})),answers:[{session_id:'s1',question_id:'q',answer_text:'Same'},{session_id:'s2',question_id:'q',answer_text:'Same'},{session_id:'s3',question_id:'q',answer_json:{reviewed_redaction:'Removed'}}]};
  expect(campaignQuestionSummary(source)).toEqual([{version:'v',question:'q',prompt:'Original prompt',sessions:4,answered:2,redacted:1,unanswered:1,repeated:1}]);
 });
 it('labels every long narrative continuation without losing its contents',()=>{
  const body='Japanese 日本語 and Farsi فارسی\n'.repeat(70),html=buildCampaignReviewHtml({...snapshot,items:[{id:'long-id',status:'pending',body}]},'checksum');
  expect(html).toContain('Record long-id · part 1 of 4');expect(html).toContain('Record long-id · part 4 of 4');
  expect(html.match(/Japanese 日本語 and Farsi فارسی/g)).toHaveLength(70);
 });

 it('shows a contribution detail inset when broad study context hides small routes',()=>{
  const source:EngagementReviewSnapshot={...snapshot,campaign:{...snapshot.campaign,configurationVersionId:'v'},items:[{id:'line',status:'pending',geometry:{type:'LineString',coordinates:[[1,1],[1.01,1.01]]}}],definitions:[{id:'v',sha256:'hash',definition:{campaign:{place_geometry_geojson:{type:'Polygon',coordinates:[[[0,0],[20,0],[20,20],[0,0]]]}},categories:[],questions:[],layers:[]}}]};
  expect(campaignReviewMap(source)).toContain('paint-order="stroke">1</text>');
  const html=campaignReviewMap(source),lines=[...html.matchAll(/<polyline points="([^"]+)"/g)].map(match=>match[1].split(' ').map(point=>point.split(',').map(Number)));
  expect(lines).toHaveLength(2);
  expect(Math.abs(lines[0][1][0]-lines[0][0][0])).toBeLessThan(1);
  expect(Math.abs(lines[1][1][0]-lines[1][0][0])).toBeGreaterThan(100);
  expect(campaignReviewMap({...source,items:[]})).not.toContain('Contribution location detail');
 });

 it('keeps the exact UTF-8 snapshot bytes across ZIP chunk boundaries',async()=>{
  const source={...snapshot,items:[{id:'unicode',status:'pending',body:'日本語 فارسی 🙂\n'.repeat(6000)}]},raw=JSON.stringify(source),hash=createHash('sha256').update(raw).digest('hex');
  const files=await renderCampaignReviewFiles(raw,hash),zip=await JSZip.loadAsync(files.find(file=>file.format==='zip')!.bytes);
  const recovered=await zip.file('snapshot.json')!.async('nodebuffer');
  expect(recovered.equals(Buffer.from(raw,'utf8'))).toBe(true);expect(createHash('sha256').update(recovered).digest('hex')).toBe(hash);
 });

});
