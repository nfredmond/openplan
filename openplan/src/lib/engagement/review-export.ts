import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { renderReportPdf } from "@/lib/reports/pdf";
import { escapeCsvField } from "@/lib/export/csv";
import { readStoredEngagementGeometry } from "./geometry";

type RecordData = Record<string, unknown>;
export type EngagementReviewSnapshot = {
  schema: 1; capturedAt: string; scope: "public" | "internal"; filters: RecordData;
  campaign: { id: string; title: string; summary: string | null; configurationVersionId: string | null };
  items: RecordData[]; sessions: RecordData[]; answers: RecordData[]; responses: RecordData[];
  definitions: Array<{ id: string; sha256: string; definition: { campaign: RecordData; categories: RecordData[]; questions: RecordData[]; layers: RecordData[]; translations?: RecordData[] } }>;
};
export type EngagementReviewFile = { format: "pdf" | "xlsx" | "zip"; contentType: string; bytes: Buffer; checksum: string };
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const text = (value: unknown) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

/** Legacy coordinate-only contributions must agree across maps and portable geometry. */
function contributionGeometry(row: RecordData) {
  return readStoredEngagementGeometry(row.geometry ?? (typeof row.longitude === "number" && typeof row.latitude === "number" ? { type: "Point", coordinates: [row.longitude, row.latitude] } : null));
}

export function parseReviewSnapshot(snapshotText: string, checksum: string): EngagementReviewSnapshot {
  if (createHash("sha256").update(snapshotText).digest("hex") !== checksum) throw new Error("Campaign snapshot checksum mismatch");
  const value = JSON.parse(snapshotText) as EngagementReviewSnapshot;
  if (value.schema !== 1 || !["public", "internal"].includes(value.scope) || !value.campaign?.id || ![value.items, value.sessions, value.answers, value.responses, value.definitions].every(Array.isArray)) throw new Error("Unsupported campaign snapshot");
  if (value.scope === "public" && (value.items.some((row) => row.status !== "approved" || "moderation_notes" in row || "metadata_json" in row || row.review_reason != null || row.review_expected_updated_at != null) || value.sessions.some((row) => row.status !== "approved" || "respondent_fingerprint" in row))) throw new Error("Private records found in a public snapshot");
  const ids = new Set(value.items.map((row) => row.id));
  if (ids.size !== value.items.length || new Set(value.answers.map((row) => row.id)).size !== value.answers.length) throw new Error("Duplicate snapshot identifiers");
  return value;
}

function historicalCategory(snapshot: EngagementReviewSnapshot, item: RecordData): string {
  const version = snapshot.definitions.find((row) => row.id === item.configuration_version_id);
  if (!version) return "Historical definition unavailable";
  if (!item.category_id) return "No category selected";
  return text(version.definition.categories.find((row) => row.id === item.category_id)?.label) || "Category absent from retained definition";
}

/** Offline WGS84 overview, using only frozen contribution geometry and reviewed context. */
export function campaignReviewMap(snapshot: EngagementReviewSnapshot, includeContext = true): string {
  const features: Array<{ id: string; positions: number[][]; closed: boolean; context: boolean }> = [];
  const append = (id: string, raw: unknown, context: boolean) => {
    if (raw && typeof raw === "object") {
      const multi = raw as { type?: string; coordinates?: unknown[]; geometries?: unknown[]; geometry?: unknown; features?: unknown[] };
      if (multi.type === 'Feature') { append(id, multi.geometry, context); return; }
      if (multi.type === 'FeatureCollection' && Array.isArray(multi.features)) { multi.features.forEach(feature=>append(id,feature,context)); return; }
      const memberType: string | undefined = ({ MultiPoint: "Point", MultiLineString: "LineString", MultiPolygon: "Polygon" } as Record<string,string>)[multi.type ?? ""];
      if (memberType && Array.isArray(multi.coordinates)) { multi.coordinates.forEach(coordinates => append(id, { type: memberType, coordinates }, context)); return; }
      if (multi.type === "GeometryCollection" && Array.isArray(multi.geometries)) { multi.geometries.forEach(geometry => append(id, geometry, context)); return; }
    }
    const geometry = readStoredEngagementGeometry(raw);
    if (!geometry && context && raw && typeof raw === 'object') {
      const large=raw as {type?:string;coordinates?:unknown};
      const positions=large.type==='Polygon' && Array.isArray(large.coordinates)?large.coordinates[0]:large.type==='LineString'?large.coordinates:null;
      if(Array.isArray(positions)&&positions.length>1&&positions.every(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90))features.push({id,positions:positions as number[][],closed:large.type==='Polygon',context:true});
      return;
    }
    if (!geometry) return;
    features.push({ id, positions: geometry.type === "Point" ? [geometry.coordinates] : geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates[0], closed: geometry.type === "Polygon", context });
  };
  snapshot.items.forEach((row) => append(text(row.id), contributionGeometry(row), false));
  const current = snapshot.definitions.find((row) => row.id === snapshot.campaign.configurationVersionId);
  if(includeContext) append('Retained study area', current?.definition.campaign.place_geometry_geojson, true);
  for (const layer of includeContext ? current?.definition.layers ?? [] : []) {
    const collection = layer.features as { features?: Array<{ geometry?: unknown }> } | undefined;
    for (const feature of collection?.features ?? []) append(text(layer.name), feature.geometry, true);
  }
  const positions = features.flatMap((feature) => feature.positions);
  if (!positions.length) return '<p>No mapped locations in this selection. Written location descriptions remain in the contribution register.</p>';
  // Unwrap the date line around the first location. No country's extent is assumed.
  const origin = positions[0][0];
  const unwrap = (lon: number) => origin + ((lon - origin + 540) % 360) - 180;
  const xs = positions.map((p) => unwrap(p[0])), ys = positions.map((p) => p[1]);
  const west = xs.reduce((a,b)=>Math.min(a,b)), east = xs.reduce((a,b)=>Math.max(a,b)), south = ys.reduce((a,b)=>Math.min(a,b)), north = ys.reduce((a,b)=>Math.max(a,b));
  const dx = Math.max(east-west,0.002), dy = Math.max(north-south,0.002);
  const scale = Math.min(650/dx,320/dy);
  const point = (p: number[]) => [35+(unwrap(p[0])-west)*scale,355-(p[1]-south)*scale];
  const marks = features.map((feature) => {
    const pts = feature.positions.map(point);
    const attrs = `stroke="${feature.context ? '#84949b' : '#136b73'}" stroke-width="${feature.context ? 1 : 2}"`;
    const shape = pts.length === 1 ? `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="4" fill="#136b73"><title>${escape(feature.id)}</title></circle>` : `<${feature.closed ? 'polygon' : 'polyline'} points="${pts.map((p)=>p.join(',')).join(' ')}" ${attrs} fill="${feature.closed ? '#136b7322' : 'none'}"><title>${escape(feature.id)}</title></${feature.closed ? 'polygon' : 'polyline'}>`;
    const number = snapshot.items.findIndex(row => text(row.id) === feature.id) + 1;
    const labelPoint = feature.closed ? pts.slice(0,-1).reduce((sum,p)=>[sum[0]+p[0]/(pts.length-1),sum[1]+p[1]/(pts.length-1)],[0,0]) : pts[pts.length-1];
    const label = feature.context ? "" : `<text x="${labelPoint[0]+7}" y="${labelPoint[1]-7}" font-size="12" font-weight="bold" fill="#073e44" stroke="white" stroke-width="3" paint-order="stroke">${number}</text>`;
    return shape + label;
  }).join('');
  const detail = includeContext && features.some(feature=>feature.context) && features.some(feature=>!feature.context) ? `<section class="map-detail"><h3>Contribution location detail</h3><p>This second view fits the selected contributions. The overview above shows their wider study context.</p>${campaignReviewMap(snapshot,false)}</section>` : "";
  return `<figure><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Selected contributions and reviewed context in longitude and latitude" viewBox="0 0 720 400"><rect x="1" y="1" width="718" height="398" fill="#f7faf9" stroke="#c6d2d4"/>${marks}<text x="660" y="25" font-size="14">N ↑</text><text x="20" y="385" font-size="12">Longitude ${west.toFixed(4)} to ${east.toFixed(4)}; latitude ${south.toFixed(4)} to ${north.toFixed(4)}</text></svg><figcaption>${features.filter((f)=>!f.context).length} mapped contributions. Teal: selected contributions. Gray: reviewed context. WGS84 longitude/latitude overview, north up. Geographic degrees are not a distance scale. No external basemap. Numbers match the contribution register. Labels can overlap in dense selections; full geometry and IDs are in contributions.geojson. Non-map descriptions remain in the register.</figcaption></figure>${detail}`;
}

/** Keep continuation pieces identifiable without changing the exact portable record. */
function reportNarrative(value: unknown, record: unknown): string {
  const raw = text(value);
  if (raw.length <= 1800 && raw.split("\n").length <= 25) return `<p dir="auto">${escape(raw)}</p>`;
  const parts: string[] = []; let chunk = "", lines = 0;
  for (const character of Array.from(raw)) {
    chunk += character; if (character === "\n") lines++;
    if (chunk.length >= 1200 || lines >= 18) { parts.push(chunk); chunk = ""; lines = 0; }
  }
  if (chunk) parts.push(chunk);
  return parts.map((part, index) => `<section class="narrative-part"><p class="meta">Record ${escape(record)} · part ${index + 1} of ${parts.length}</p><p dir="auto">${escape(part)}</p></section>`).join("");
}

/** Denominators use the definitions available to each selected session, including unanswered questions. */
export function campaignQuestionSummary(snapshot: EngagementReviewSnapshot) {
  const rows: Array<{ version: string; question: string; prompt: string; sessions: number; answered: number; redacted: number; unanswered: number; repeated: number }> = [];
  for (const version of snapshot.definitions) {
    const sessions = snapshot.sessions.filter(session => session.configuration_version_id === version.id);
    if (!sessions.length) continue;
    const sessionIds = new Set(sessions.map(session => session.id));
    for (const question of version.definition.questions) {
      const answers = snapshot.answers.filter(answer => sessionIds.has(answer.session_id) && answer.question_id === question.id);
      const reviewed = answers.filter(answer => !(answer.answer_json && typeof answer.answer_json === "object" && "reviewed_redaction" in answer.answer_json));
      const answerKeys = reviewed.map(answer => JSON.stringify([answer.answer_text, answer.answer_json]));
      rows.push({ version: version.id, question: text(question.id), prompt: text(question.prompt), sessions: sessions.length,
        answered: reviewed.length, redacted: answers.length - reviewed.length, unanswered: sessions.length - new Set(answers.map(answer => answer.session_id)).size,
        repeated: answerKeys.length - new Set(answerKeys).size });
    }
  }
  return rows;
}

export function buildCampaignReviewHtml(snapshot: EngagementReviewSnapshot, checksum: string, photos: Map<string,Buffer> = new Map()): string {
  const questionSummary = campaignQuestionSummary(snapshot);
  const missing = snapshot.items.filter((row) => !row.configuration_version_id).length;
  const counts = ["pending","flagged","approved","rejected"].map((state) => `<tr><th>${state === 'approved' ? 'Published' : state === 'rejected' ? 'Withheld' : state}</th><td>${snapshot.items.filter((row)=>row.status===state).length}</td></tr>`).join('');
  const context = snapshot.definitions.find((row) => row.id === snapshot.campaign.configurationVersionId)?.definition.campaign;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(snapshot.campaign.title)} engagement review</title><style>
  @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:"Noto Sans",Arial,sans-serif;font-size:10pt;line-height:1.5;color:#182f36}h1{font-size:27pt;line-height:1.15}h2{font-size:17pt;border-bottom:2px solid #136b73;padding-bottom:6px;margin-top:24px}h3{font-size:12pt}p,td,th{overflow-wrap:anywhere;white-space:pre-wrap}table{width:100%;border-collapse:collapse}th,td{padding:6px;border-bottom:1px solid #ccd6d8;text-align:left}thead{display:table-header-group}svg{width:100%;height:auto}figure{break-inside:avoid;margin:16px 0}figcaption,.meta{font-size:8pt;color:#4a626a}.map-detail{break-inside:avoid}.entry>.meta{break-after:avoid}.entry{border-top:1px solid #ccd6d8;padding:12px 0}h2,h3{break-after:avoid}.narrative-part{break-inside:avoid}.definitions{break-before:page}.version{break-before:page}.version:first-of-type{break-before:auto}.question-summary{table-layout:fixed;font-size:8pt}.question-summary th{overflow-wrap:normal;white-space:normal}.question-summary th:first-child{width:35%}.badge{color:#136b73;font-weight:bold}img{max-width:100%;max-height:220px;object-fit:contain}</style></head><body>
  <p class="badge">${snapshot.scope.toUpperCase()} REVIEW COPY</p><h1>${escape(snapshot.campaign.title)}</h1><p>${escape(snapshot.campaign.summary)}</p>
  <p>Campaign snapshot ${escape(snapshot.capturedAt)}. This report describes received participation. Publication and a reviewed staff response are separate facts. Participation is not a representative survey of the population.</p>
  <p class="meta">Campaign ${escape(snapshot.campaign.id)}<br>Snapshot SHA-256 ${checksum}<br>Filters ${escape(JSON.stringify(snapshot.filters))}</p>
  <nav><a href="#summary">Participation summary</a> · <a href="#questions">Question summary</a> · <a href="#contributions">Contribution register</a> · <a href="#answers">Survey answers</a> · <a href="#responses">Staff responses</a> · <a href="#definitions">Historical definitions</a></nav>
  <h2>Campaign context</h2><p>${escape(context?.instructions ?? 'Historical campaign instructions unavailable.')}</p><p>Study area: ${escape(context?.place_label ?? 'Not supplied')}. Participation opens: ${escape(context?.participation_starts_at ?? 'No scheduled start')}. Closes: ${escape(context?.participation_ends_at ?? 'No scheduled end')}.</p>
  <h2 id="summary">Selected participation</h2><p>${snapshot.items.length} contributions, ${snapshot.sessions.length} survey sessions, ${snapshot.answers.length} recorded answers and ${snapshot.responses.length} reviewed staff response entries. Category filters apply to contributions and answers; survey sessions retain their own scope and dates. Missing answers are not zero answers.</p><table><tbody>${counts}</tbody></table><p>${missing} contributions have unavailable historical configuration. No current question or category has been substituted for their original definition.</p>
  <h2 id="questions">Question summary</h2><p>Each row uses the questions available to that session's retained configuration. Unanswered includes questions not shown by branching and answers outside the export filters; it does not establish refusal or noncompliance. Repeated counts are additional identical answers, retained as separate records.</p>
  <table class="question-summary"><thead><tr><th>Question and configuration</th><th>Sessions</th><th>Answered</th><th>Redacted</th><th>Unanswered</th><th>Repeated</th></tr></thead><tbody>${questionSummary.map(row=>`<tr><td>${escape(row.prompt)}<br><span class="meta">${escape(row.version)}</span></td><td>${row.sessions}</td><td>${row.answered}</td><td>${row.redacted}</td><td>${row.unanswered}</td><td>${row.repeated}</td></tr>`).join('')}</tbody></table><p>${snapshot.sessions.filter(session=>!snapshot.definitions.some(version=>version.id===session.configuration_version_id)).length} sessions have unavailable historical definitions and are excluded from question denominators. Their recorded answers remain in the register.</p>
  ${campaignReviewMap(snapshot)}
  <h2 id="contributions">Contributions</h2>${snapshot.items.map((row,index)=>`<article class="entry"><h3>${index+1}. ${escape(row.title || 'Untitled contribution')}</h3><p class="meta">${escape(row.id)} | ${escape(row.created_at)} | ${escape(row.status)} | ${escape(historicalCategory(snapshot,row))}<br>Configuration: ${escape(row.configuration_version_id || 'Historical definition unavailable')}${row.parent_item_id ? `<br>Reply to ${escape(row.parent_item_id)}` : ''}</p>${reportNarrative(row.body,row.id)}${row.geometry && !contributionGeometry(row) ? '<p>The retained drawing is invalid or degenerate. Its exact coordinates remain in snapshot.json; it is omitted from the map and GeoJSON.</p>' : ''}${row.submitted_by ? `<p>Submitted name: ${escape(row.submitted_by)}</p>`:''}${snapshot.scope==='internal' && row.moderation_notes ? `<p>Review reason: ${escape(row.moderation_notes)}</p>`:''}${row.photo_path && photos.has(`photos/${row.id}.${text(row.photo_path).split('.').pop()}`) ? `<img alt="Reviewed photograph for contribution ${escape(row.id)}" src="data:image/${text(row.photo_path).endsWith('.jpg') ? 'jpeg' : text(row.photo_path).split('.').pop()};base64,${photos.get(`photos/${row.id}.${text(row.photo_path).split('.').pop()}`)!.toString('base64')}"/>` : ''}${row.photo_path ? `<p>Reviewed photograph: photos/${escape(row.id)}.${escape(text(row.photo_path).split('.').pop())}. Included in the portable package.</p>`:''}</article>`).join('')}
  <h2 id="answers">Survey answer register</h2>${snapshot.sessions.map((session)=>`<article class="entry"><h3>Session ${escape(session.id)}</h3><p class="meta">${escape(session.created_at)} | ${escape(session.status)} | Configuration ${escape(session.configuration_version_id || 'Historical definition unavailable')}</p>${snapshot.answers.filter((answer)=>answer.session_id===session.id).map((answer)=>`<p><strong>${escape(answer.question_prompt_snapshot || 'Historical question prompt unavailable')}</strong><br><span dir="auto">${escape(answer.answer_text || text(answer.answer_json))}</span>${photos.size && (answer.answer_json as { files?: unknown[] }|null)?.files ? `<br>Attachments: ${(answer.answer_json as {files:Array<{path:string}>}).files.map((file,index)=>`attachments/${escape(answer.id)}-${index+1}.${escape(file.path.split('.').pop())}`).join(', ')}` : ''}<br><span class="meta">Answer ${escape(answer.id)} | Question ${escape(answer.question_id || 'Deleted question')}</span></p>`).join('') || '<p>No answers included for this session under these filters.</p>'}</article>`).join('')}
  <h2 id="responses">Reviewed staff responses</h2>${snapshot.responses.map((row)=>`<article class="entry"><h3>${escape(row.theme_title)}</h3><p>You said: ${escape(row.you_said)}</p><p>Agency response: ${escape(row.we_did)}</p><p class="meta">Response ${escape(row.id)} | Sources ${escape(text(row.source_item_ids))}</p></article>`).join('') || '<p>No reviewed staff responses are available for this selection.</p>'}
  <section class="definitions"><h2 id="definitions">Historical definitions</h2>${snapshot.definitions.map((version)=>`<section class="version"><h3>Configuration ${escape(version.id)}</h3><p class="meta">Definition SHA-256 ${escape(version.sha256)}</p><p>${escape(version.definition.campaign.instructions)}</p><h3>Categories</h3>${version.definition.categories.map((row)=>`<p>${escape(row.label)}: ${escape(row.description)}<br><span class="meta">${escape(row.id)}</span></p>`).join('')}<h3>Questions</h3>${version.definition.questions.map((row)=>`<p>${escape(row.prompt)}<br>${escape(row.help_text)}<br>Type ${escape(row.question_type)}; ${row.required ? 'required' : 'optional'}. Options ${escape(text(row.options))}</p>`).join('')}<h3>Retained translations</h3>${(version.definition.translations??[]).map(row=>`<p>${escape(row.locale)} · ${escape(row.entity_type)} · ${escape(row.field)} · ${escape(row.source)}<br>${escape(row.translated_text)}</p>`).join('')||'<p>No translations in this definition.</p>'}</section>`).join('')}
  </section><h2>Portable record</h2><p>Download the engagement companion ZIP for this snapshot from its Reports record. A project evidence bundle containing this PDF alone does not include every engagement companion. The engagement ZIP contains this PDF, the XLSX workbook, exact snapshot JSON, complete contribution CSV/GeoJSON, answer CSV and reviewed photographs. Workbook long text is split into ordered companion rows. Concatenate parts by record ID, field and part number to recover it exactly. Formula-like participant text remains literal text in XLSX and JSON; CSV protects spreadsheet users by prefixing dangerous formulas.</p></body></html>`;
}

/** Estimate wrapped rows conservatively, accounting for explicit line breaks and wide glyphs. */
function workbookTextLines(value: string): number {
  return value.split("\n").reduce((sum,line)=>sum+Math.max(1,Math.ceil(Array.from(line).reduce((width,char)=>width+(char.codePointAt(0)!>=0x2e80?2:1),0)/45)),0);
}

export async function buildCampaignReviewWorkbook(snapshot: EngagementReviewSnapshot, checksum: string): Promise<Buffer> {
  const workbook = XLSX.utils.book_new();
  const longText: Array<Array<string | number>> = [["Record type","Record ID","Field","Part","Text"]];
  const cell = (kind: string,id: unknown,field: string,value: unknown): string | number => {
    if(typeof value==='number') return value;
    const raw=text(value);
    if(raw.length<=500 && workbookTextLines(raw)<=12) return raw;
    let part = "", partNumber = 1;
    for (const character of Array.from(raw)) {
      if (part && (part.length + character.length > 500 || workbookTextLines(part + character) > 12)) {
        longText.push([kind,text(id),field,partNumber++,part]); part = "";
      }
      part += character;
    }
    if (part) longText.push([kind,text(id),field,partNumber,part]);
    return `${raw.slice(0,180).split("\n").slice(0,3).join("\n")}\n[Full value: Long text / ${text(id)} / ${field}]`;
  };
  const add = (name:string, data:Array<Array<string|number>>) => {
    if(data.length>1_048_576) throw new Error('Workbook row limit exceeded; use the portable snapshot with a narrower selection.');
    const sheet=XLSX.utils.aoa_to_sheet(data);
    sheet['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:data.length-1,c:data[0].length-1}})};
    sheet['!cols']=data[0].map((_,index)=>({wch:index===0?39:55}));
    sheet['!rows']=data.map((row,index)=>({hpt:index===0?30:Math.min(220,Math.max(30,...row.map(value=>(workbookTextLines(text(value))+1)*13)))}));
    XLSX.utils.book_append_sheet(workbook,sheet,name);
  };
  add('Read me',[["Field","Value"],["Campaign",snapshot.campaign.title],["Scope",snapshot.scope],["Captured at",snapshot.capturedAt],["Snapshot SHA-256",checksum],["Filters",JSON.stringify(snapshot.filters)],["Meaning","Received, awaiting review, published and answered are distinct. Participation is not a representative population sample."],["Historical definitions","Missing configuration remains unavailable. Never substitute current wording."],["Long text","Long or multiline values use ordered rows in Long text. Join by record ID, field and part. The JSON companion retains exact full records."],["Category filters","Apply to contributions and answer categories. Sessions keep their own date/status scope. Missing answers are not zero." ]]);
  const itemFields=['id','parent_item_id','configuration_version_id','status','created_at','title','body','submitted_by','source_type','latitude','longitude','geometry','photo_path',...(snapshot.scope==='internal'?['moderation_notes']:[])];
  add('Contributions',[ [...itemFields,'Historical category'],...snapshot.items.map(row=>[...itemFields.map(field=>cell('contribution',row.id,field,row[field])),historicalCategory(snapshot,row)])]);
  for(const [name,kind,rows,fields] of [
    ['Survey sessions','session',snapshot.sessions,['id','configuration_version_id','status','created_at']],
    ['Answers','answer',snapshot.answers,['id','session_id','question_id','question_prompt_snapshot','question_type','answer_text','answer_json']],
    ['Staff responses','response',snapshot.responses,['id','theme_title','you_said','we_did','source_item_ids','published_at']],
  ] as const) add(name,[ [...fields],...rows.map(row=>fields.map(field=>cell(kind,row.id,field,row[field])))]);
  add('Question summary',[["Configuration","Question ID","Prompt","Sessions","Answered","Redacted","Unanswered or not shown","Repeated additional answers"],...campaignQuestionSummary(snapshot).map(row=>[row.version,row.question,cell('question',row.question,'prompt',row.prompt),row.sessions,row.answered,row.redacted,row.unanswered,row.repeated])]);
  add('Definitions',[["Version ID","SHA-256","Definition JSON"],...snapshot.definitions.map(row=>[row.id,row.sha256,cell('definition',row.id,'definition',row.definition)])]);
  add('Long text',longText);
  add('Summary',[["Record set","Count"],["Contributions",snapshot.items.length],["Survey sessions",snapshot.sessions.length],["Answers",snapshot.answers.length],["Staff responses",snapshot.responses.length]]);
  for(const [index,name,count] of [[2,'Contributions',snapshot.items.length],[3,'Survey sessions',snapshot.sessions.length],[4,'Answers',snapshot.answers.length],[5,'Staff responses',snapshot.responses.length]] as const) {
    workbook.Sheets.Summary[`B${index}`]={t:'n',v:count,f:count?`COUNTA('${name}'!A2:A${count+1})`:'0'};
  }
  const zip=await JSZip.loadAsync(XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true}) as Buffer);
  const book=await zip.file('xl/workbook.xml')!.async('string');
  zip.file('xl/workbook.xml',book.replace('</workbook>','<calcPr calcId="0" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'));
  // SheetJS CE retains values/types; this small OpenXML style pass supplies readable wrapping and headers.
  zip.file('xl/styles.xml',`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF136B73"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  for(const path of Object.keys(zip.files).filter(path=>/^xl\/worksheets\/sheet\d+\.xml$/.test(path))) {
    let xml=await zip.file(path)!.async('string');
    xml=xml.replace(/<c\b([^>]*)>/g,(_all,attrs:string)=>`<c${attrs.replace(/\s+s="\d+"/,'')} s="2">`);
    xml=xml.replace(/<c\b([^>]*\br="[A-Z]+1"[^>]*)>/g,(_all,attrs:string)=>`<c${attrs.replace(/\s+s="\d+"/,'')} s="1">`);
    xml=xml.replace(/<sheetView([^>]*)\/>/,'<sheetView$1><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>');
    zip.file(path,xml);
  }
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

/** Validate extracted bytes, including the snapshot's external custody hash. */
export async function verifyCampaignReviewZip(bytes: Buffer, snapshotChecksum: string): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const snapshot = zip.file("snapshot.json"), manifestFile = zip.file("manifest.json");
  if (!snapshot || !manifestFile) throw new Error("Portable review is missing its snapshot or manifest");
  const raw = await snapshot.async("nodebuffer");
  if (createHash("sha256").update(raw).digest("hex") !== snapshotChecksum) throw new Error("Portable snapshot checksum mismatch");
  const manifest = JSON.parse(await manifestFile.async("string")) as { snapshotSha256?: string; files?: Array<{name?:string;path?:string;checksum:string;byteLength?:number}> };
  if (manifest.snapshotSha256 !== snapshotChecksum || !Array.isArray(manifest.files)) throw new Error("Portable manifest custody mismatch");
  for (const entry of manifest.files) {
    const file = zip.file(entry.name ?? entry.path ?? "");
    if (!file) throw new Error("Portable file missing");
    const content = await file.async("nodebuffer");
    if (createHash("sha256").update(content).digest("hex") !== entry.checksum || (entry.byteLength !== undefined && entry.byteLength !== content.length)) throw new Error("Portable file checksum mismatch");
  }
}

export async function renderCampaignReviewFiles(snapshotText:string,checksum:string,photos:Map<string,Buffer> = new Map()):Promise<EngagementReviewFile[]> {
  const snapshot=parseReviewSnapshot(snapshotText,checksum);
  const html=buildCampaignReviewHtml(snapshot,checksum,photos);
  const pdf=await renderReportPdf(html,{title:snapshot.campaign.title,generatedAt:snapshot.capturedAt,footerLabel:`${snapshot.scope} engagement review | ${checksum.slice(0,12)}`});
  if(pdf.engine!=='chrome') throw new Error('The installed Chrome renderer is required to retain multilingual text and maps in this campaign PDF. Install it and retry this saved snapshot.');
  const files:EngagementReviewFile[]=[];
  const add=(format:EngagementReviewFile['format'],contentType:string,bytes:Buffer)=>files.push({format,contentType,bytes,checksum:createHash('sha256').update(bytes).digest('hex')});
  add('pdf','application/pdf',Buffer.from(pdf.bytes));
  add('xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',await buildCampaignReviewWorkbook(snapshot,checksum));
  const zip=new JSZip();
  // Encode once before JSZip streams chunks; UTF-16 chunk boundaries can split emoji.
  const addText = (name: string, value: string) => zip.file(name, Buffer.from(value, 'utf8'));
  addText('snapshot.json',snapshotText);addText('review.html',html);
  files.forEach(file=>zip.file(`review.${file.format}`,file.bytes));
  const csv=(rows:RecordData[],fields:string[])=>[fields,...rows.map(row=>fields.map(field=>text(row[field])))].map(row=>row.map(escapeCsvField).join(',')).join('\r\n');
  addText('contributions.csv',csv(snapshot.items,['id','parent_item_id','configuration_version_id','category_id','title','body','status','created_at']));
  addText('answers.csv',csv(snapshot.answers,['id','session_id','question_id','question_prompt_snapshot','question_type','answer_text','answer_json']));
  addText('contributions.geojson',JSON.stringify({type:'FeatureCollection',features:snapshot.items.filter(row=>contributionGeometry(row)).map(row=>({type:'Feature',id:row.id,geometry:contributionGeometry(row),properties:{id:row.id,title:row.title,category:historicalCategory(snapshot,row),configurationVersionId:row.configuration_version_id}}))},null,2));
  for(const [path,bytes] of photos) zip.file(path,bytes);
  const manifestFiles = await Promise.all(Object.values(zip.files).filter(file=>!file.dir).map(async file=>{
    const bytes=await file.async('nodebuffer');return {name:file.name,checksum:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length};
  }));
  addText('manifest.json',JSON.stringify({schema:1,snapshotSha256:checksum,scope:snapshot.scope,counts:{contributions:snapshot.items.length,sessions:snapshot.sessions.length,answers:snapshot.answers.length,responses:snapshot.responses.length},files:manifestFiles},null,2));
  const portable = await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await verifyCampaignReviewZip(portable,checksum);
  add('zip','application/zip',portable);
  return files;
}
