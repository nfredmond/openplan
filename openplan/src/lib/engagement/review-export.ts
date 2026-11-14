import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { formatReviewWorkbook } from "@/lib/export/review-workbook-layout";
import { renderReportPdf } from "@/lib/reports/pdf";
import { escapeCsvField } from "@/lib/export/csv";
import { readStoredEngagementGeometry } from "./geometry";
import { ENGAGEMENT_REVIEW_STATES, countEngagementReview, engagementReviewStateLabel, type EngagementReviewCounts, type EngagementReviewState } from "./review-counts";
import { readDecisionLinkHistory, type VerifiedDecisionLink } from "./decision-links";
import { verifyDecisionSynthesisSources } from "./decision-synthesis-history-server";
import { decisionSynthesisReport, decisionSynthesisExportRows, decisionSynthesisCoverageFields, decisionSynthesisEventFields, decisionSynthesisMemberFields } from "./decision-synthesis-export";
import { fieldWord, localeWord, numberedList, optionsWords, questionTypeWord, recordIdentifiers, reviewTime, reviewWord, staffMemberNumbers } from "./review-pdf-words";
import { SURVEY_QUESTION_TYPES, type SurveyQuestionType } from "./survey";
import { flattenSurveyAnswerForExport } from "./survey-responses";

type RecordData = Record<string, unknown>;
export type EngagementReviewSnapshot = {
  capturedAt: string; scope: "public" | "internal"; filters: RecordData;
  campaign: { id: string; title: string; summary: string | null; configurationVersionId: string | null };
  items: RecordData[]; sessions: RecordData[]; answers: RecordData[]; responses: RecordData[];
  definitions: Array<{ id: string; sha256: string; definition: { campaign: RecordData; categories: RecordData[]; questions: RecordData[]; layers: RecordData[]; translations?: RecordData[] } }>;
} & ({ schema: 1; decisionLinks?: never } | {
  schema: 2; scope: "internal"; workspaceId: string; decisionLinkHistoryScope: "campaign";
  decisionLinkCount: number; decisionLinks: VerifiedDecisionLink[];
});
export type EngagementReviewFile = { format: "pdf" | "xlsx" | "zip"; contentType: string; bytes: Buffer; checksum: string };
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const text = (value: unknown) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

/** Intake method identifies the retained record; approval does not turn staff notes into resident input. */
function contributionSourceLabel(value: unknown): string {
  switch (value) {
    case "internal": return "Staff-authored note";
    case "public": return "Public portal";
    case "meeting": return "Meeting or workshop";
    case "email": return "Email or letter";
    case undefined: case null: case "": return "Source not recorded";
    default: return `Unrecognized source (${text(value)})`;
  }
}

function contributionSourceCounts(snapshot: EngagementReviewSnapshot): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of snapshot.items) {
    const label = contributionSourceLabel(row.source_type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts];
}

/** Legacy coordinate-only contributions must agree across maps and portable geometry. */
function contributionGeometry(row: RecordData) {
  return readStoredEngagementGeometry(row.geometry ?? (typeof row.longitude === "number" && typeof row.latitude === "number" ? { type: "Point", coordinates: [row.longitude, row.latitude] } : null));
}

export async function parseReviewSnapshot(snapshotText: string, checksum: string, expected?: { campaignId: string; workspaceId: string; scope: string }): Promise<EngagementReviewSnapshot> {
  if (createHash("sha256").update(snapshotText).digest("hex") !== checksum) throw new Error("Campaign snapshot checksum mismatch");
  const value = JSON.parse(snapshotText) as EngagementReviewSnapshot;
  if (!value || ![1, 2].includes(value.schema) || !["public", "internal"].includes(value.scope) || !value.campaign?.id || ![value.items, value.sessions, value.answers, value.responses, value.definitions].every(Array.isArray)) throw new Error("Unsupported campaign snapshot");
  if (value.scope === "public" && (value.items.some((row) => row.status !== "approved" || "moderation_notes" in row || "metadata_json" in row || row.review_reason != null || row.review_expected_updated_at != null) || value.sessions.some((row) => row.status !== "approved" || "respondent_fingerprint" in row))) throw new Error("Private records found in a public snapshot");
  const historyFields = ["workspaceId", "decisionLinkHistoryScope", "decisionLinkCount", "decisionLinks"];
  if (value.schema === 1 && historyFields.some(field => field in value)) throw new Error("Private decision history found in a legacy or public snapshot");
  if (expected && (value.campaign.id !== expected.campaignId || value.scope !== expected.scope)) throw new Error("Campaign snapshot scope differs");
  if (value.schema === 2) {
    if (value.scope !== "internal" || value.decisionLinkHistoryScope !== "campaign" || typeof value.workspaceId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.workspaceId)
      || (expected && value.workspaceId !== expected.workspaceId)) throw new Error("Private decision history scope differs");
    const history = await readDecisionLinkHistory({ entryCount: value.decisionLinkCount, entries: value.decisionLinks },
      { campaignId: value.campaign.id, workspaceId: value.workspaceId });
    value.decisionLinks = history.entries;
    for (const row of history.entries) await verifyDecisionSynthesisSources(row.context);
  }
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
    const number = snapshot.items.findIndex(row => text(row.id) === feature.id) + 1;
    // A contribution is named by its register number; its id is in Record identifiers and contributions.geojson.
    const name = feature.context ? feature.id : `Contribution ${number}`;
    const shape = pts.length === 1 ? `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="4" fill="#136b73"><title>${escape(name)}</title></circle>` : `<${feature.closed ? 'polygon' : 'polyline'} points="${pts.map((p)=>p.join(',')).join(' ')}" ${attrs} fill="${feature.closed ? '#136b7322' : 'none'}"><title>${escape(name)}</title></${feature.closed ? 'polygon' : 'polyline'}>`;
    const labelPoint = feature.closed ? pts.slice(0,-1).reduce((sum,p)=>[sum[0]+p[0]/(pts.length-1),sum[1]+p[1]/(pts.length-1)],[0,0]) : pts[pts.length-1];
    const label = feature.context ? "" : `<text x="${labelPoint[0]+7}" y="${labelPoint[1]-7}" font-size="12" font-weight="bold" fill="#073e44" stroke="white" stroke-width="3" paint-order="stroke">${number}</text>`;
    return shape + label;
  }).join('');
  const detail = includeContext && features.some(feature=>feature.context) && features.some(feature=>!feature.context) ? `<section class="map-detail"><h3>Contribution location detail</h3><p>This second view fits the selected contributions. The overview above shows their wider study context.</p>${campaignReviewMap(snapshot,false)}</section>` : "";
  return `<figure><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Selected contributions and reviewed context in longitude and latitude" viewBox="0 0 720 400"><rect x="1" y="1" width="718" height="398" fill="#f7faf9" stroke="#c6d2d4"/>${marks}<text x="660" y="25" font-size="14">N ↑</text><text x="20" y="385" font-size="12">Longitude ${west.toFixed(4)} to ${east.toFixed(4)}; latitude ${south.toFixed(4)} to ${north.toFixed(4)}</text></svg><figcaption>${features.filter((f)=>!f.context).length} mapped contributions. Teal: selected contributions. Gray: reviewed context. WGS84 longitude/latitude overview, north up. Geographic degrees are not a distance scale. No external basemap. Numbers match the contribution register. Labels can overlap in dense selections; full geometry and IDs are in contributions.geojson. Non-map descriptions remain in the register.</figcaption></figure>${detail}`;
}

/** Keep continuation pieces identifiable, by the entry's name in this report, without changing the exact portable record. */
function reportNarrative(value: unknown, record: string): string {
  const raw = text(value);
  if (raw.length <= 1800 && raw.split("\n").length <= 25) return `<p dir="auto">${escape(raw)}</p>`;
  const parts: string[] = []; let chunk = "", lines = 0;
  for (const character of Array.from(raw)) {
    chunk += character; if (character === "\n") lines++;
    if (chunk.length >= 1200 || lines >= 18) { parts.push(chunk); chunk = ""; lines = 0; }
  }
  if (chunk) parts.push(chunk);
  return parts.map((part, index) => `<section class="narrative-part"><p class="meta">${escape(record)} · part ${index + 1} of ${parts.length}</p><p dir="auto">${escape(part)}</p></section>`).join("");
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

/**
 * The numbers and names the review PDF gives each record, and the appendix
 * that pairs each name with its stored identifier. Contributions, staff
 * responses, survey sessions and answers are numbered in register order;
 * campaign settings in the order the snapshot keeps them (oldest first).
 */
const SETTINGS_NOT_KEPT = "Campaign settings not kept in this file";

function reviewNames(snapshot: EngagementReviewSnapshot) {
  const identifiers = recordIdentifiers();
  const numbered = (rows: ReadonlyArray<{ id?: unknown }>) => new Map(rows.map((row, index) => [text(row.id), index + 1]));
  const items = numbered(snapshot.items), answers = numbered(snapshot.answers), settingsSets = numbered(snapshot.definitions);
  const staffNumber = staffMemberNumbers();
  return {
    identifiers,
    contributionNumber: (id: unknown) => items.get(text(id)) ?? null,
    contribution: (id: unknown) => items.has(text(id)) ? `Contribution ${items.get(text(id))}` : "A contribution not in this selection",
    answer: (id: unknown) => answers.has(text(id)) ? `Survey answer ${answers.get(text(id))}` : "A survey answer not in this selection",
    settings: (id: unknown) => !id ? "Campaign settings unavailable for this record" : settingsSets.has(text(id)) ? `Campaign settings ${settingsSets.get(text(id))}` : SETTINGS_NOT_KEPT,
    staff: (actorId: unknown) => {
      const label = staffNumber(actorId);
      identifiers.add("Staff members", label.charAt(0).toUpperCase() + label.slice(1), actorId);
      return label;
    },
  };
}
type ReviewNames = ReturnType<typeof reviewNames>;

/** When a contribution or survey session arrived, with its zone. */
function receivedText(value: unknown): string {
  return typeof value === "string" && value.trim() ? `Received ${reviewTime(value)}` : "Received time not recorded";
}

/** A stored review state in the review status picker's words. */
function reviewStateWord(value: unknown): string {
  return (ENGAGEMENT_REVIEW_STATES as readonly unknown[]).includes(value) ? engagementReviewStateLabel(value as EngagementReviewState) : `Unrecognized review state (${text(value)})`;
}

const DECISION_OPERATION_TITLE: Record<string, string> = { link: "Original link", refresh: "Refreshed evidence", withdraw: "Withdrawn link" };

/** Historical evidence is private and campaign-wide, independent of participation filters. */
function decisionHistoryHtml(snapshot: EngagementReviewSnapshot, names: ReviewNames): string {
  if (snapshot.scope !== "internal") return "";
  if (snapshot.schema === 1) return '<h2 id="decision-history">Decision history unavailable in this saved format</h2><p>This earlier internal snapshot did not retain decision-link history. This is missing evidence, not a count of zero. Prepare a new internal review to capture the history now available; the earlier files remain unchanged.</p>';
  const { identifiers } = names;
  const actionNumber = new Map(snapshot.decisionLinks.map((row, index) => [row.id, index + 1]));
  const responseNumber = new Map(snapshot.responses.map((row, index) => [text(row.id), index + 1]));
  // Number the decision actions' identifiers and staff before the synthesis evidence inside them, in reading order.
  snapshot.decisionLinks.forEach((row, index) => {
    const action = `Decision action ${index + 1}`;
    names.staff(row.actor_id);
    identifiers.add("Decision history", action, row.id);
    identifiers.add("Decision history", `${action}, previous action`, row.predecessor_id);
    identifiers.add("Decision history", `${action}, staff response`, row.response_id);
    identifiers.add("Decision history", `${action}, decision`, row.decision_id);
    identifiers.add("Decision history", `${action}, project`, row.project_id);
    identifiers.add("Decision history", `${action}, payload SHA-256`, row.payload_sha256);
    identifiers.add("Decision history", `${action}, context SHA-256`, row.context_sha256);
    row.context.sources.forEach((source) => identifiers.add("Decision history", `${action}, source ${source.position}`, source.itemId));
    row.context.configurations.forEach((definition, position) => {
      identifiers.add("Decision history", `${action}, original campaign settings ${position + 1}`, definition.id);
      identifiers.add("Decision history", `${action}, original campaign settings ${position + 1} SHA-256`, definition.definitionSha256);
    });
  });
  const synthesis = decisionSynthesisReport(snapshot.decisionLinks, { escape, narrative: reportNarrative, contribution: names.contribution, answer: names.answer, staff: names.staff, identifiers });
  return `<h2 id="decision-history">Private decision history</h2><p>${snapshot.decisionLinks.length} saved actions across the entire consultation, including original links, refreshed evidence and withdrawals. The contribution status, category and date filters above do not filter this history. These are the exact versions reviewed at each action, not current project or response content. A recorded link does not establish approval, implementation or representative public support. Full original context and definitions remain in the workbook and portable snapshot.</p>${snapshot.decisionLinks.map((row, index) => {
    const context = row.context;
    const action = `Decision action ${index + 1}`;
    const previous = row.predecessor_id == null ? "No earlier action" : actionNumber.has(row.predecessor_id) ? `Follows decision action ${actionNumber.get(row.predecessor_id)}` : "Follows an action not in this file";
    const response = responseNumber.has(row.response_id) ? `Staff response ${responseNumber.get(row.response_id)}` : "A staff response not in this selection";
    return `<article class="entry"><h3>${action} · ${escape(DECISION_OPERATION_TITLE[row.operation] ?? `Unrecognized operation (${row.operation})`)} · ${escape(context.decision.title)}</h3>
    <p class="meta">${previous}<br>Saved ${escape(reviewTime(row.created_at))} by ${escape(names.staff(row.actor_id))}<br>${response}, ${escape(context.response.theme_title)} | Project: ${escape(context.project.name)}</p>
    <h4>Reason for this action</h4>${reportNarrative(row.reason, `${action}, reason`)}
    <p>Retained project: ${escape(context.project.name)}. Retained decision status: ${escape(reviewWord("decisionStatus", context.decision.status, "decision status"))}.</p>
    <h4>Retained decision rationale</h4>${reportNarrative(context.decision.rationale, `${action}, decision rationale`)}
    <h4>Retained staff response</h4><p>${escape(context.response.theme_title)} · ${escape(reviewWord("responseStatus", context.response.status, "response status"))} · revision ${context.responseHistory.revision}</p>
    <h4>You said</h4>${reportNarrative(context.response.you_said, `${action}, you said`)}<h4>Agency response</h4>${reportNarrative(context.response.we_did, `${action}, agency response`)}
    <h4>Direct contribution references</h4>${context.sources.map(source=>`<section><p class="meta">Source ${source.position}: ${escape(names.contribution(source.itemId))} · ${escape(reviewWord("availability", source.availability, "availability"))} · original campaign settings ${escape(reviewWord("availability", source.configurationAvailability, "availability").toLowerCase())}</p>${source.record ? `<h4>${escape(source.record.title)}</h4>${reportNarrative(source.record.body, `${action}, source ${source.position}`)}` : '<p>Source content was unavailable when this evidence was saved.</p>'}</section>`).join('') || '<p>No direct contribution references were linked to this retained response.</p>'}
    <p class="meta">Original campaign settings definitions: ${context.configurations.length ? `${context.configurations.length} retained, listed under Record identifiers` : 'None retained'}.</p>${synthesis.sections.get(row.id) ?? ''}</article>`;
  }).join('')}${synthesis.appendix}`;
}

/**
 * A staff response's sources, named by their number in this file's register:
 * "contributions 1 and 3". A source outside this file's selection (another
 * status or date range) is counted here and listed under Record identifiers.
 */
function campaignResponseSourcesText(names: ReviewNames, label: string, ids: unknown): string {
  if (!Array.isArray(ids) || ids.length === 0) return "No contributions recorded";
  const inside: number[] = [];
  let outside = 0;
  for (const id of ids) {
    const number = names.contributionNumber(id);
    if (number === null) {
      outside += 1;
      names.identifiers.add("Staff responses", `${label}, source not in this selection`, id);
    } else inside.push(number);
  }
  const listed = numberedList("contribution", "contributions", inside);
  const notHere = outside ? `${outside} ${outside === 1 ? "contribution" : "contributions"} not in this selection` : "";
  return [listed, notHere].filter(Boolean).join(", and ");
}

/** A survey answer in words. The exact stored value stays in the workbook, the answers CSV and the snapshot. */
function surveyAnswerWords(snapshot: EngagementReviewSnapshot, answer: RecordData): string {
  if (typeof answer.answer_text === "string" && answer.answer_text.trim()) return answer.answer_text;
  if (answer.answer_json == null) return "No answer recorded.";
  if (typeof answer.question_type !== "string" || !Object.hasOwn(SURVEY_QUESTION_TYPES, answer.question_type)) return "Structured answer. Its exact value is in the workbook and portable snapshot.";
  const optionLabels = new Map<string, string>();
  for (const version of snapshot.definitions) for (const question of version.definition.questions) {
    for (const option of Array.isArray(question.options) ? question.options as RecordData[] : []) {
      if (option && typeof option.id === "string" && typeof option.label === "string") optionLabels.set(option.id, option.label);
    }
  }
  return flattenSurveyAnswerForExport({ question_type: answer.question_type as SurveyQuestionType, answer_json: answer.answer_json, answer_text: null }, optionLabels).text || "No answer recorded.";
}

/**
 * The cover's selection line in words, in place of the stored filter JSON. A
 * public copy holds approved contributions only, whatever its filters say.
 */
function reviewSelectionText(snapshot: EngagementReviewSnapshot, identifiers: ReviewNames["identifiers"]): string {
  const filters = snapshot.filters;
  const status = snapshot.scope === "public" ? "approved" : ENGAGEMENT_REVIEW_STATES.find((state) => state === filters.status);
  const parts = [status ? `${engagementReviewStateLabel(status).toLowerCase()} contributions only` : "every contribution"];
  const categoryIds = Array.isArray(filters.categoryIds) ? filters.categoryIds.map(text) : [];
  if (categoryIds.length) {
    const labels = categoryIds.map((id) => {
      const label = snapshot.definitions.flatMap((version) => version.definition.categories).find((row) => text(row.id) === id)?.label;
      identifiers.add("Campaign and snapshot", `Selection category, ${text(label) || "not in the retained settings"}`, id);
      return text(label) || "a category not in the retained settings";
    });
    parts.push(`in ${labels.length === 1 ? "the category" : "the categories"} ${labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`}`);
  }
  const dates = [
    ...(typeof filters.from === "string" && filters.from ? [`on or after ${reviewTime(filters.from)}`] : []),
    ...(typeof filters.to === "string" && filters.to ? [`before ${reviewTime(filters.to)}`] : []),
  ];
  if (dates.length) parts.push(`received ${dates.join(" and ")}`);
  return `Selection: ${parts.join(", ")}.`;
}

/** A saved snapshot's review counts. A response counts as published when it has a publication time. */
function reviewSnapshotCounts(snapshot: EngagementReviewSnapshot): EngagementReviewCounts {
  return countEngagementReview({
    items: snapshot.items,
    responses: snapshot.responses.map((row) => ({ sourceItemIds: row.source_item_ids, published: row.published_at != null && row.published_at !== "" })),
  });
}

/** The order a reader meets the review states in the PDF, the workbook and the manifest. */
const REVIEW_STATE_READING_ORDER: readonly EngagementReviewState[] = ["approved", "rejected", "pending", "flagged"];
const REVIEW_STATE_MANIFEST_KEY: Record<EngagementReviewState, string> = { approved: "approved", rejected: "withheld", pending: "pending", flagged: "flaggedForReview" };

/**
 * Which counts one review file states, and what it leaves out. A public copy
 * holds approved contributions only, and a status filter holds one state, so
 * those files say what they leave out instead of printing a zero for it.
 */
function reviewFileCounts(snapshot: EngagementReviewSnapshot) {
  const counts = reviewSnapshotCounts(snapshot);
  const chosen = snapshot.scope === "public" ? "approved" : ENGAGEMENT_REVIEW_STATES.find((state) => state === snapshot.filters.status);
  const states = chosen ? [chosen] : REVIEW_STATE_READING_ORDER;
  const leftOut = snapshot.scope === "public"
    ? "This public copy holds approved contributions only. Withheld, pending and flagged contributions are left out, so it does not count them."
    : chosen ? `This selection holds ${engagementReviewStateLabel(chosen).toLowerCase()} contributions only. Contributions in other review states are left out, so it does not count them.` : null;
  return {
    counts,
    /** Null when the file holds only some review states: the received total would be one of them. */
    received: chosen ? null : counts.received,
    states: states.map((state) => ({ state, label: engagementReviewStateLabel(state), count: counts.byState[state], manifestKey: REVIEW_STATE_MANIFEST_KEY[state] })),
    leftOut,
  };
}

const contributionNoun = (count: number) => count === 1 ? "contribution" : "contributions";

/**
 * The review counts as sentences, each led by the state's word and its number
 * ("Approved 3 contributions."), so a reader and a text search of the PDF find
 * the same phrase. A table set the label and its number a column apart.
 */
function reviewCountSentences(snapshot: EngagementReviewSnapshot): string[] {
  const file = reviewFileCounts(snapshot);
  const { counts } = file;
  return [
    ...(file.leftOut ? [file.leftOut] : []),
    ...(file.received === null ? [] : [`Received ${file.received} ${contributionNoun(file.received)}.`]),
    ...file.states.map(({ label, count }) => `${label} ${count} ${contributionNoun(count)}.`),
    `Published ${counts.publishedResponses} staff ${counts.publishedResponses === 1 ? "response" : "responses"}.`,
    `Answered ${counts.answered} ${contributionNoun(counts.answered)} with a published staff response. A contribution that two responses answer counts once.`,
  ];
}

const placeLabel = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * The study area line. A campaign with no area of its own opens its public map
 * on its project's place, or else the workspace's home area. The retained
 * definition records both as they stood when the campaign's settings were
 * saved, so the line names that place instead of saying none was supplied.
 */
export function campaignStudyAreaText(context: RecordData | undefined): string {
  if (!context) return "Study area: unavailable in this saved snapshot.";
  const own = placeLabel(context.place_label);
  if (own) return `Study area: ${own}.`;
  const project = placeLabel((context.project_frame as RecordData | null | undefined)?.label);
  if (project) return `Study area: ${project} (the project's place, as recorded with the campaign's saved settings). The campaign has no study area of its own.`;
  const home = placeLabel((context.workspace_frame as RecordData | null | undefined)?.label);
  if (home) return `Study area: ${home} (the workspace's home area, as recorded with the campaign's saved settings). Neither the campaign nor its project had a study area of its own.`;
  return "Study area: Not supplied.";
}

export function buildCampaignReviewHtml(snapshot: EngagementReviewSnapshot, checksum: string, photos: Map<string,Buffer> = new Map()): string {
  const questionSummary = campaignQuestionSummary(snapshot);
  const missing = snapshot.items.filter((row) => !row.configuration_version_id).length;
  const counts = reviewCountSentences(snapshot).map((sentence) => `<li>${escape(sentence)}</li>`).join('');
  const context = snapshot.definitions.find((row) => row.id === snapshot.campaign.configurationVersionId)?.definition.campaign;
  const names = reviewNames(snapshot);
  const { identifiers } = names;
  identifiers.add("Campaign and snapshot", "Campaign", snapshot.campaign.id);
  identifiers.add("Campaign and snapshot", "Snapshot SHA-256", checksum);
  const selection = reviewSelectionText(snapshot, identifiers);
  const photoFile = (row: RecordData) => `photos/${text(row.id)}.${text(row.photo_path).split('.').pop()}`;
  const contributions = snapshot.items.map((row, index) => {
    const label = `Contribution ${index + 1}`;
    identifiers.add("Contributions", label, row.id);
    if (row.parent_item_id) identifiers.add("Contributions", `${label}, replies to`, row.parent_item_id);
    if (row.configuration_version_id && names.settings(row.configuration_version_id) === SETTINGS_NOT_KEPT) identifiers.add("Contributions", `${label}, campaign settings`, row.configuration_version_id);
    if (row.photo_path) identifiers.add("Contributions", `${label}, photograph file`, photoFile(row));
    const reply = row.parent_item_id ? `<br>Reply to ${names.contributionNumber(row.parent_item_id) === null ? "a contribution not in this selection" : `contribution ${names.contributionNumber(row.parent_item_id)}`}` : '';
    const photo = row.photo_path && photos.has(photoFile(row)) ? `<img alt="Reviewed photograph for contribution ${index + 1}" src="data:image/${text(row.photo_path).endsWith('.jpg') ? 'jpeg' : text(row.photo_path).split('.').pop()};base64,${photos.get(photoFile(row))!.toString('base64')}"/>` : '';
    return `<article class="entry"><h3>${index+1}. ${escape(row.title || 'Untitled contribution')}</h3><p class="meta">${escape(receivedText(row.created_at))} · ${escape(reviewStateWord(row.status))} · ${escape(historicalCategory(snapshot,row))}<br>Source: ${escape(contributionSourceLabel(row.source_type))}<br>${escape(names.settings(row.configuration_version_id))}${reply}</p>${reportNarrative(row.body,label)}${row.geometry && !contributionGeometry(row) ? '<p>The retained drawing is invalid or degenerate. Its exact coordinates remain in snapshot.json; it is omitted from the map and GeoJSON.</p>' : ''}${row.submitted_by ? `<p>Submitted name: ${escape(row.submitted_by)}</p>`:''}${snapshot.scope==='internal' && row.moderation_notes ? `<p>Review reason: ${escape(row.moderation_notes)}</p>`:''}${photo}${row.photo_path ? '<p>Reviewed photograph included in the portable package. Its file name is listed under Record identifiers.</p>':''}</article>`;
  }).join('');
  const sessions = snapshot.sessions.map((session, index) => {
    const label = `Survey session ${index + 1}`;
    identifiers.add("Survey sessions and answers", label, session.id);
    if (session.configuration_version_id && names.settings(session.configuration_version_id) === SETTINGS_NOT_KEPT) identifiers.add("Survey sessions and answers", `${label}, campaign settings`, session.configuration_version_id);
    const answers = snapshot.answers.filter((answer)=>answer.session_id===session.id).map((answer) => {
      const answerLabel = names.answer(answer.id);
      identifiers.add("Survey sessions and answers", answerLabel, answer.id);
      identifiers.add("Survey sessions and answers", `${answerLabel}, question`, answer.question_id);
      const files = photos.size ? (answer.answer_json as { files?: Array<{path:string}> }|null)?.files ?? [] : [];
      files.forEach((file, fileIndex) => identifiers.add("Survey sessions and answers", `${answerLabel}, attachment ${fileIndex + 1}`, `attachments/${text(answer.id)}-${fileIndex+1}.${file.path.split('.').pop()}`));
      return `<p><strong>${escape(answer.question_prompt_snapshot || 'Historical question prompt unavailable')}</strong><br><span dir="auto">${escape(surveyAnswerWords(snapshot, answer))}</span>${files.length ? `<br>Attachments: ${files.length} ${files.length === 1 ? 'file' : 'files'} in the portable package, listed under Record identifiers` : ''}<br><span class="meta">${escape(answerLabel)}${answer.question_id ? '' : ' · question deleted from the settings'}</span></p>`;
    }).join('');
    return `<article class="entry"><h3>${label}</h3><p class="meta">${escape(receivedText(session.created_at))} · ${escape(reviewStateWord(session.status))} · ${escape(names.settings(session.configuration_version_id))}</p>${answers || '<p>No answers included for this session under these filters.</p>'}</article>`;
  }).join('');
  const responses = snapshot.responses.map((row, index) => {
    const label = `Staff response ${index + 1}`;
    identifiers.add("Staff responses", label, row.id);
    return `<article class="entry"><h3>${index + 1}. ${escape(row.theme_title)}</h3><p>You said: ${escape(row.you_said)}</p><p>Agency response: ${escape(row.we_did)}</p><p class="meta">${row.published_at ? `Published ${escape(reviewTime(row.published_at))}` : "Not published"}<br>Answers ${escape(campaignResponseSourcesText(names, label, row.source_item_ids))}</p></article>`;
  }).join('');
  const decisionHistory = decisionHistoryHtml(snapshot, names);
  const definitions = snapshot.definitions.map((version, index) => {
    const label = `Campaign settings ${index + 1}`;
    identifiers.add("Campaign settings and categories", label, version.id);
    identifiers.add("Campaign settings and categories", `${label}, definition SHA-256`, version.sha256);
    version.definition.categories.forEach((row) => identifiers.add("Campaign settings and categories", `${label}, category ${text(row.label) || "without a label"}`, row.id));
    version.definition.questions.forEach((question, questionIndex) => {
      for (const option of Array.isArray(question.options) ? question.options as RecordData[] : []) {
        if (option && typeof option === "object") identifiers.add("Campaign settings and categories", `${label}, question ${questionIndex + 1} option ${text(option.label) || "without a label"}`, option.id);
      }
    });
    return `<section class="version"><h3>${label}${version.id === snapshot.campaign.configurationVersionId ? ' (in use when the snapshot was saved)' : ''}</h3><p>${escape(version.definition.campaign.instructions)}</p><h3>Categories</h3>${version.definition.categories.map((row)=>`<p>${escape(row.label)}: ${escape(row.description)}</p>`).join('')}<h3>Questions</h3>${version.definition.questions.map((row)=>`<p>${escape(row.prompt)}<br>${escape(row.help_text)}<br>${escape(questionTypeWord(row.question_type))}; ${row.required ? 'required' : 'optional'}. Options: ${escape(optionsWords(row.options))}.</p>`).join('')}<h3>Retained translations</h3>${(version.definition.translations??[]).map(row=>`<p>${escape(localeWord(row.locale))} · ${escape(reviewWord("translationEntity", row.entity_type, "translated item"))} · ${escape(fieldWord(row.field))} · ${escape(reviewWord("translationSource", row.source, "translation source"))}<br>${escape(row.translated_text)}</p>`).join('')||'<p>No translations in this definition.</p>'}</section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(snapshot.campaign.title)} engagement review</title><style>
  @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:"Noto Sans",Arial,sans-serif;font-size:10pt;line-height:1.5;color:#182f36}h1{font-size:27pt;line-height:1.15}h2{font-size:17pt;border-bottom:2px solid #136b73;padding-bottom:6px;margin-top:24px}h3{font-size:12pt}h1,h2,h3,h4,li{overflow-wrap:anywhere}p,td,th{overflow-wrap:anywhere;white-space:pre-wrap}table{width:100%;border-collapse:collapse}th,td{padding:6px;border-bottom:1px solid #ccd6d8;text-align:left}thead{display:table-header-group}svg{width:100%;height:auto}figure{break-inside:avoid;margin:16px 0}figcaption,.meta{font-size:8pt;color:#4a626a}.map-detail{break-inside:avoid}.entry>.meta{break-after:avoid}.entry>p.meta:last-child{break-before:avoid}.entry{border-top:1px solid #ccd6d8;padding:12px 0}h2,h3,h4{break-after:avoid}.narrative-part{break-inside:avoid}.definitions{break-before:page}.version{break-before:page}.version:first-of-type{break-before:auto}.question-summary{table-layout:fixed;font-size:8pt}.question-summary th{overflow-wrap:normal;white-space:normal}.question-summary th:first-child{width:35%}.badge{color:#136b73;font-weight:bold}.review-counts{break-inside:avoid}img{max-width:100%;max-height:220px;object-fit:contain}.identifiers{break-before:page}.identifier{margin:2px 0;font-size:8pt;break-inside:avoid}.identifier code{font-family:"Noto Sans Mono",Consolas,monospace;white-space:nowrap}.identifier-group h3{break-after:avoid}</style></head><body>
  <p class="badge">${snapshot.scope.toUpperCase()} REVIEW COPY</p><h1>${escape(snapshot.campaign.title)}</h1><p>${escape(snapshot.campaign.summary)}</p>
  <p>Campaign snapshot saved ${escape(reviewTime(snapshot.capturedAt))}. This report describes retained consultation records. Publication and a reviewed staff response are separate facts. Participation is not a representative survey of the population.</p>
  <p class="meta">${escape(selection)}<br>Record identifiers for the campaign, this snapshot and each numbered entry are listed at the end of this report.</p>
  <nav><a href="#summary">Record summary</a> · <a href="#questions">Question summary</a> · <a href="#contributions">Contribution register</a> · <a href="#answers">Survey answers</a> · <a href="#responses">Staff responses</a> · <a href="#definitions">Historical definitions</a>${snapshot.scope === "internal" ? ' · <a href="#decision-history">Decision history</a>' : ""} · <a href="#record-identifiers">Record identifiers</a></nav>
  <h2>Campaign context</h2><p>${escape(context?.instructions ?? 'Historical campaign instructions unavailable.')}</p><p>${escape(campaignStudyAreaText(context))} Participation opens: ${escape(context?.participation_starts_at ? reviewTime(context.participation_starts_at) : 'No scheduled start')}. Closes: ${escape(context?.participation_ends_at ? reviewTime(context.participation_ends_at) : 'No scheduled end')}.</p>
  <h2 id="summary">Selected records</h2><p>${snapshot.items.length} contributions, ${snapshot.sessions.length} survey sessions, ${snapshot.answers.length} recorded answers and ${snapshot.responses.length} reviewed staff response entries. Category filters apply to contributions and answers; survey sessions retain their own scope and dates. Missing answers are not zero answers.</p><h3>Review counts</h3><ul class="review-counts">${counts}</ul><p>${missing} contributions have unavailable historical configuration. No current question or category has been substituted for their original definition.</p>
  <h3>Contribution sources</h3><p>Counts are records, not people. Staff-authored notes are not resident submissions. Intake method does not establish identity or representative support.</p><table aria-label="Contribution sources"><thead><tr><th>Source</th><th>Records</th></tr></thead><tbody>${contributionSourceCounts(snapshot).map(([label,count])=>`<tr><td>${escape(label)}</td><td>${count}</td></tr>`).join('')}</tbody></table>
  <h2 id="questions">Question summary</h2><p>Each row uses the questions available to that session's retained configuration. Unanswered includes questions not shown by branching and answers outside the export filters; it does not establish refusal or noncompliance. Repeated counts are additional identical answers, retained as separate records.</p>
  <table class="question-summary"><thead><tr><th>Question and configuration</th><th>Sessions</th><th>Answered</th><th>Redacted</th><th>Unanswered</th><th>Repeated</th></tr></thead><tbody>${questionSummary.map(row=>`<tr><td>${escape(row.prompt)}<br><span class="meta">${escape(names.settings(row.version))}</span></td><td>${row.sessions}</td><td>${row.answered}</td><td>${row.redacted}</td><td>${row.unanswered}</td><td>${row.repeated}</td></tr>`).join('')}</tbody></table><p>${snapshot.sessions.filter(session=>!snapshot.definitions.some(version=>version.id===session.configuration_version_id)).length} sessions have unavailable historical definitions and are excluded from question denominators. Their recorded answers remain in the register.</p>
  ${campaignReviewMap(snapshot)}
  <h2 id="contributions">Contributions</h2>${contributions}
  <h2 id="answers">Survey answer register</h2>${sessions}
  <h2 id="responses">Reviewed staff responses</h2>${responses || '<p>No reviewed staff responses are available for this selection.</p>'}
  ${decisionHistory}
  <section class="definitions"><h2 id="definitions">Historical definitions</h2>${definitions}
  </section><h2>Portable record</h2><p>Download the engagement companion ZIP for this snapshot from its Reports record. A project evidence bundle containing this PDF alone does not include every engagement companion. The engagement ZIP contains this PDF, the XLSX workbook, exact snapshot JSON, complete contribution CSV/GeoJSON, answer CSV and reviewed photographs. Workbook long text is split into ordered companion rows. Concatenate parts by record ID, field and part number to recover it exactly. Formula-like participant text remains literal text in XLSX and JSON; CSV protects spreadsheet users by prefixing dangerous formulas.</p>${identifiers.html()}</body></html>`;
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
  add('Read me',[["Field","Value"],["Campaign",snapshot.campaign.title],["Scope",snapshot.scope],["Captured at",snapshot.capturedAt],["Snapshot SHA-256",checksum],["Filters",JSON.stringify(snapshot.filters)],["Meaning","Received, awaiting review, approved, publicly released and answered are distinct. Approval does not establish public release. Participation is not a representative population sample."], ["Source counts","Counts are records, not people. Staff-authored notes are not resident submissions. Intake method does not establish identity or representative support."],["Historical definitions","Missing configuration remains unavailable. Never substitute current wording."],["Long text","Long or multiline values use ordered rows in Long text. Join by record ID, field and part. The JSON companion retains exact full records."],["Review counts","Summary counts contributions by review state with the PDF's words. The Contributions status column keeps the stored value (rejected for a withheld contribution); its Review state column gives the PDF's word."],["Category filters","Apply to contributions and answer categories. Sessions keep their own date/status scope. Missing answers are not zero." ]]);
  const itemFields=['id','parent_item_id','configuration_version_id','status','created_at','title','body','submitted_by','source_type','latitude','longitude','geometry','photo_path',...(snapshot.scope==='internal'?['moderation_notes']:[])];
  add('Contributions',[ [...itemFields,'Historical category','Source label','Review state'],...snapshot.items.map(row=>[...itemFields.map(field=>cell('contribution',row.id,field,row[field])),historicalCategory(snapshot,row),cell('contribution',row.id,'source_label',contributionSourceLabel(row.source_type)),(ENGAGEMENT_REVIEW_STATES as readonly unknown[]).includes(row.status) ? engagementReviewStateLabel(row.status as EngagementReviewState) : cell('contribution',row.id,'review_state',row.status)])]);
  add('Contribution sources', [['Source','Records'],...contributionSourceCounts(snapshot)]);
  for(const [name,kind,rows,fields] of [
    ['Survey sessions','session',snapshot.sessions,['id','configuration_version_id','status','created_at']],
    ['Answers','answer',snapshot.answers,['id','session_id','question_id','question_prompt_snapshot','question_type','answer_text','answer_json']],
    ['Staff responses','response',snapshot.responses,['id','theme_title','you_said','we_did','source_item_ids','published_at']],
  ] as const) add(name,[ [...fields],...rows.map(row=>fields.map(field=>cell(kind,row.id,field,row[field])))]);
  add('Question summary',[["Configuration","Question ID","Prompt","Sessions","Answered","Redacted","Unanswered or not shown","Repeated additional answers"],...campaignQuestionSummary(snapshot).map(row=>[row.version,row.question,cell('question',row.question,'prompt',row.prompt),row.sessions,row.answered,row.redacted,row.unanswered,row.repeated])]);
  add('Definitions',[["Version ID","SHA-256","Definition JSON"],...snapshot.definitions.map(row=>[row.id,row.sha256,cell('definition',row.id,'definition',row.definition)])]);
  if (snapshot.scope === 'internal') {
    add('Decision history scope', [['Field','Value'],['Availability',snapshot.schema === 2 ? 'Retained in this snapshot' : 'Unavailable in this earlier saved format; not zero'],['Selection','Entire consultation history; contribution date, status and category filters do not filter decision history.'],['Meaning','Exact evidence retained at each original link, refresh or withdrawal. Does not establish approval, implementation or representative support.']]);
    if (snapshot.schema === 2) {
      const fields = ['id','predecessor_id','operation','created_at','actor_id','response_id','decision_id','project_id','reason','payload_sha256','context_sha256'] as const;
      add('Decision history', [[...fields,'Retained project','Retained decision','Retained decision status','Retained rationale','Response revision','You said','Agency response'],...snapshot.decisionLinks.map(row=>[...fields.map(field=>cell('decision action',row.id,field,row[field])),cell('decision action',row.id,'project_name',row.context.project.name),cell('decision action',row.id,'decision_title',row.context.decision.title),row.context.decision.status,cell('decision action',row.id,'decision_rationale',row.context.decision.rationale),row.context.responseHistory.revision,cell('decision action',row.id,'you_said',row.context.response.you_said),cell('decision action',row.id,'we_did',row.context.response.we_did)])]);
      add('Decision sources', [['Action ID','Source ID','Position','Availability','Original configuration availability','Original source JSON'],...snapshot.decisionLinks.flatMap(row=>row.context.sources.map(source=>[row.id,source.itemId,source.position,source.availability,source.configurationAvailability,cell('decision source',`${row.id}/${source.position}/${source.itemId}`,'source',source.record)]))]);
      add('Decision exact context', [['Action ID','Payload SHA-256','Exact payload text','Context SHA-256','Exact context text'],...snapshot.decisionLinks.map(row=>[row.id,row.payload_sha256,cell('decision action',row.id,'payload_text',row.payload_text),row.context_sha256,cell('decision action',row.id,'context_text',row.context_text)])]);
      const synthesis = decisionSynthesisExportRows(snapshot.decisionLinks);
      for (const [name, records, fields] of [
        ['Synthesis coverage', synthesis.coverage, decisionSynthesisCoverageFields],
        ['Synthesis actions', synthesis.events, decisionSynthesisEventFields],
        ['Synthesis sources', synthesis.members, decisionSynthesisMemberFields],
      ] as const) add(name, [[...fields], ...records.map((row, index) => fields.map(field => cell(name, `${row.decision_action_id}/${index + 1}`, field, row[field])))]);

    }
  }
  add('Long text',longText);
  const totals: Array<Array<string | number>> = [["Record set","Count"],["Contributions",snapshot.items.length],["Survey sessions",snapshot.sessions.length],["Answers",snapshot.answers.length],["Staff responses",snapshot.responses.length]];
  if(snapshot.schema===2)totals.push(["Decision history actions",snapshot.decisionLinkCount]);
  const review = reviewFileCounts(snapshot);
  if(review.received!==null)totals.push(["Received",review.received]);
  for(const {label,count} of review.states)totals.push([label,count]);
  if(review.leftOut)totals.push([snapshot.scope==='public'?'Withheld, pending and flagged':'Other review states',snapshot.scope==='public'?'Not in the public copy':'Not in this selection']);
  totals.push(["Published staff responses",review.counts.publishedResponses],["Answered by a published staff response",review.counts.answered]);
  add('Summary',totals);
  if(snapshot.schema===2)workbook.Sheets.Summary.B6={t:'n',v:snapshot.decisionLinkCount,f:snapshot.decisionLinkCount?`COUNTA('Decision history'!A2:A${snapshot.decisionLinkCount+1})`:'0'};
  for(const [index,name,count] of [[2,'Contributions',snapshot.items.length],[3,'Survey sessions',snapshot.sessions.length],[4,'Answers',snapshot.answers.length],[5,'Staff responses',snapshot.responses.length]] as const) {
    workbook.Sheets.Summary[`B${index}`]={t:'n',v:count,f:count?`COUNTA('${name}'!A2:A${count+1})`:'0'};
  }
  const zip=await JSZip.loadAsync(XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true}) as Buffer);
  await formatReviewWorkbook(zip, { recalculate: true, worksheets: workbook.SheetNames.map(() => ({})) });
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

/** The manifest's review counts, from the same reading as the PDF and the workbook. */
function manifestReviewCounts(snapshot: EngagementReviewSnapshot): Record<string, number> {
  const review = reviewFileCounts(snapshot);
  return {
    ...(review.received === null ? {} : { received: review.received }),
    ...Object.fromEntries(review.states.map(({ manifestKey, count }) => [manifestKey, count])),
    publishedResponses: review.counts.publishedResponses,
    answered: review.counts.answered,
  };
}

function manifestCountsLeftOut(snapshot: EngagementReviewSnapshot): { countsLeftOut?: string } {
  const { leftOut } = reviewFileCounts(snapshot);
  return leftOut ? { countsLeftOut: leftOut } : {};
}

export async function renderCampaignReviewFiles(snapshotText:string,checksum:string,photos:Map<string,Buffer> = new Map()):Promise<EngagementReviewFile[]> {
  const snapshot=await parseReviewSnapshot(snapshotText,checksum);
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
  if(snapshot.schema===2)addText('decision-history.csv',csv(snapshot.decisionLinks,['id','predecessor_id','operation','created_at','actor_id','response_id','decision_id','project_id','reason','payload_sha256','context_sha256']));
  if (snapshot.schema === 2) {
    const synthesis = decisionSynthesisExportRows(snapshot.decisionLinks);
    addText('decision-synthesis-coverage.csv', csv(synthesis.coverage, decisionSynthesisCoverageFields));
    addText('decision-synthesis-actions.csv', csv(synthesis.events, decisionSynthesisEventFields));
    addText('decision-synthesis-sources.csv', csv(synthesis.members, decisionSynthesisMemberFields));
  }
  addText('contributions.geojson',JSON.stringify({type:'FeatureCollection',features:snapshot.items.filter(row=>contributionGeometry(row)).map(row=>({type:'Feature',id:row.id,geometry:contributionGeometry(row),properties:{id:row.id,title:row.title,category:historicalCategory(snapshot,row),configurationVersionId:row.configuration_version_id}}))},null,2));
  for(const [path,bytes] of photos) zip.file(path,bytes);
  const manifestFiles = await Promise.all(Object.values(zip.files).filter(file=>!file.dir).map(async file=>{
    const bytes=await file.async('nodebuffer');return {name:file.name,checksum:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length};
  }));
  addText('manifest.json',JSON.stringify({schema:1,snapshotSha256:checksum,scope:snapshot.scope,counts:{contributions:snapshot.items.length,sessions:snapshot.sessions.length,answers:snapshot.answers.length,responses:snapshot.responses.length,...manifestReviewCounts(snapshot)},...manifestCountsLeftOut(snapshot),files:manifestFiles},null,2));
  const portable = await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await verifyCampaignReviewZip(portable,checksum);
  add('zip','application/zip',portable);
  return files;
}
