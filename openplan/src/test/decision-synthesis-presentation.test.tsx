import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { DecisionLinksPanel } from "@/components/engagement/decision-links-panel";
import { DecisionSynthesisEvidence } from "@/components/engagement/decision-synthesis-evidence";
import { decisionSynthesisDetails, decisionSynthesisLegacyNotice, decisionSynthesisEmptyNotice, decisionSynthesisAuthorityNotice } from "@/lib/engagement/decision-synthesis-display";
import { decisionSynthesisExportRows } from "@/lib/engagement/decision-synthesis-export";
import { parseReviewSnapshot, buildCampaignReviewHtml, buildCampaignReviewWorkbook, renderCampaignReviewFiles } from "@/lib/engagement/review-export";
import { readDecisionContext } from "@/lib/engagement/decision-links";
import { address, makeContext, packet, row, withReviewWords } from "./fixtures/engagement/decision-synthesis";
import native from "./fixtures/decision-link-native.json";
import nativeReview from "./fixtures/engagement-review-decision-history-native.json";
const pdf = vi.hoisted(() => vi.fn(async (_html: string) => ({ engine: "chrome", bytes: new Uint8Array([37, 80, 68, 70]) })));
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: pdf }));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function rawReview(context = withReviewWords()) {
  const snapshot = JSON.parse(nativeReview.snapshotText);
  snapshot.campaign.id = address.campaignId; snapshot.workspaceId = address.workspaceId;
  snapshot.decisionLinks = [row(context)]; snapshot.decisionLinkCount = 1;
  return JSON.stringify(snapshot);
}
async function snapshot(context = withReviewWords()) { const raw = rawReview(context); return parseReviewSnapshot(raw, hash(raw)); }
afterEach(() => { cleanup(); pdf.mockClear(); vi.restoreAllMocks(); localStorage.clear(); });

// These checks use a synthetic renderer; real Chrome pagination and browser downloads have separate acceptance.
describe("retained decision synthesis presentation", () => {
  it.each([false, true])("shows originals, corrections, withdrawals and complete source wording with harmless formatting %s", async formatted => {
    const context = withReviewWords(); const raw = packet(context);
    if (formatted) { raw.contextText = JSON.stringify(context, null, 2); raw.contextSha256 = hash(raw.contextText); }
    const verified = await readDecisionContext(raw, address);
    render(<DecisionSynthesisEvidence context={verified.context} />);
    expect(screen.getByText("1 review-group histories, 3 saved response-link actions.")).toBeVisible();
    expect(screen.getByText(decisionSynthesisAuthorityNotice)).toBeVisible();
    const history = screen.getByText(/last recorded action: withdraw/); fireEvent.click(history);
    expect(screen.getByText("Action 1: link · review revision 1")).toBeInTheDocument();
    expect(screen.getByText("Action 2: refresh · review revision 1")).toBeInTheDocument();
    expect(screen.getByText("Action 3: withdraw · review revision 1")).toBeInTheDocument();
    expect(screen.getAllByText(/Agency response: SYNTHETIC staff explanation é/)).toHaveLength(1);
    expect(screen.getAllByText("Agency response: SYNTHETIC corrected response")).toHaveLength(2);
    expect(screen.getAllByText("Approval reason: SYNTHETIC exact private approval")).toHaveLength(3);
    expect(screen.getAllByText(/SYNTHETIC retained staff interpretation of the issue/)).toHaveLength(6);
    expect(screen.getAllByText("Review notes: SYNTHETIC retained review notes and unresolved concern")).toHaveLength(3);
    expect(screen.getAllByText(/FINAL SOURCE TAIL$/)).toHaveLength(3);
    expect(screen.getAllByText(/Survey answer: SYNTHETIC original question/)).toHaveLength(3);
    expect(screen.getAllByText(/SYNTHETIC distinct survey concern/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Exact retained action packet")).toHaveLength(3);
  });
  it("connects verified synthesis to real decision previews and retained history", async () => {
    localStorage.clear();
    const context = makeContext(), saved = row(context), actorId = saved.actor_id;
    const snapshot = { ...native.initial, campaignId: address.campaignId, workspaceId: address.workspaceId, entries: [saved],
      current: [{ linkId: saved.id, sourceState: "unchanged", currentContextSha256: saved.context_sha256, unavailableReason: null }] };
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input), body = url.includes("/context?") ? { actorId, packet: packet(context) } : { actorId, snapshot };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<DecisionLinksPanel {...address} actorId={actorId} responses={[context.response]} responsesUnavailable={false} revision={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
    await screen.findByText(/Current preview: unchanged/);
    await waitFor(() => expect(screen.getByLabelText("Staff response")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Staff response"), { target: { value: address.responseId } });
    fireEvent.change(screen.getByLabelText("Project decision"), { target: { value: address.decisionId } });
    fireEvent.click(screen.getByRole("button", { name: "Review current sources" }));
    await waitFor(() => expect(screen.getAllByText("1 review-group histories, 3 saved response-link actions.")).toHaveLength(2));
    expect(within(screen.getByRole("group", { name: "Review a response and decision" })).getByRole("region", { name: "Retained synthesis evidence" })).toBeVisible();
  });
  it("distinguishes legacy uncaptured history and an observed empty history", async () => {
    const old = JSON.parse(native.initial.entries[0].context_text);
    const view = render(<DecisionSynthesisEvidence context={old} />);
    expect(screen.getByText(decisionSynthesisLegacyNotice)).toBeVisible();
    const empty = makeContext(); empty.synthesisHistory = { observation: "retained_at_link_preview", historyCount: 0, eventCount: 0, histories: [] };
    view.rerender(<DecisionSynthesisEvidence context={empty} />);
    expect(screen.getByText(decisionSynthesisEmptyNotice)).toBeVisible(); expect(screen.queryByText(decisionSynthesisLegacyNotice)).toBeNull();
    const archived = await snapshot(empty);
    expect(buildCampaignReviewHtml(archived, "test")).toContain(decisionSynthesisEmptyNotice);
    expect(decisionSynthesisExportRows(archived.decisionLinks!).coverage[0]).toMatchObject({ history_count: 0, event_count: 0 });
    const legacy = await parseReviewSnapshot(nativeReview.snapshotText, nativeReview.snapshotSha256);
    const coverage = decisionSynthesisExportRows(legacy.decisionLinks!).coverage;
    expect(coverage.every(row => row.history_count === "" && row.event_count === "")).toBe(true);
  });
  it("renders exact membership with a deduplicated source appendix and escaped words", async () => {
    const context = withReviewWords(), saved = await snapshot(context), html = buildCampaignReviewHtml(saved, "test");
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelectorAll('[id^="synthesis-source-"]')).toHaveLength(2);
    expect(document.querySelectorAll('a[href^="#synthesis-source-"]')).toHaveLength(6);
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href^="#synthesis-source-"]')) {
      expect(document.getElementById(anchor.hash.slice(1))).not.toBeNull();
      expect(anchor.hash.length).toBeLessThanOrEqual(100);
    }
    expect(html).toContain("Response-link action 1: link"); expect(html).toContain("Response-link action 3: withdraw");
    expect(html).toContain("SYNTHETIC retained staff interpretation of the issue"); expect(html).toContain("SYNTHETIC retained review notes and unresolved concern");
    expect(html).toContain("SYNTHETIC corrected response"); expect(html).toContain("FINAL SOURCE TAIL");
    expect(html).toContain("SYNTHETIC distinct survey concern"); expect(html).toContain(decisionSynthesisAuthorityNotice);
    expect(html).toContain("No direct contribution references");
    // Escaping is exercised in the display serializer independently of custody parsing.
    const unsafe = structuredClone(saved); unsafe.decisionLinks![0].context.decision.title = '<img src=x onerror="alert(1)">';
    expect(buildCampaignReviewHtml(unsafe, "test")).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(buildCampaignReviewHtml(unsafe, "test")).not.toContain('<img src=x');
    const entry = unsafe.decisionLinks![0].context;
    if (entry.schema !== 2) throw new Error("Expected new capture");
    for (const captured of entry.synthesisHistory.histories[0].entries) {
      const action = JSON.parse(captured.eventText), evidence = JSON.parse(action.context.contextText);
      const content = JSON.parse(evidence.revision.contentText); content.groups[0].label = '<img src=x onerror="alert(2)">';
      evidence.revision.contentText = JSON.stringify(content);
      const source = JSON.parse(evidence.source.snapshotText); source.items[0].title = "<script>unsafe()</script>";
      source.items[0].body = "<svg onload=unsafe()>"; evidence.source.snapshotText = JSON.stringify(source);
      action.context.contextText = JSON.stringify(evidence); captured.eventText = JSON.stringify(action);
    }
    const escaped = buildCampaignReviewHtml(unsafe, "test");
    expect(escaped).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(escaped).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
    expect(escaped).toContain("&lt;svg onload=unsafe()&gt;");
    expect(escaped).not.toContain("<script>unsafe"); expect(escaped).not.toContain("<img src=x");
  });
  it("exports complete action and member registers with exact continuation text", async () => {
    const saved = await snapshot(), book = XLSX.read(await buildCampaignReviewWorkbook(saved, "test"), { type: "buffer" });
    const events = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Synthesis actions"]);
    const members = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Synthesis sources"]);
    const coverage = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Synthesis coverage"]);
    expect(events.map(row => row.operation)).toEqual(["link", "refresh", "withdraw"]); expect(members).toHaveLength(6);
    expect(coverage[0]).toMatchObject({ history_count: 1, event_count: 3 });
    expect(events[0]).toMatchObject({ review_revision: 1, response_revision: 1, agency_response: "SYNTHETIC staff explanation é", approval_reason: "SYNTHETIC exact private approval" });
    expect(events[1]).toMatchObject({ response_revision: 2, agency_response: "SYNTHETIC corrected response" });
    expect(events.every(row => row.group_summary === "SYNTHETIC retained staff interpretation of the issue" && row.review_notes === "SYNTHETIC retained review notes and unresolved concern")).toBe(true);
    const long = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Long text"]);
    const context = withReviewWords();
    for (const [index, entry] of context.synthesisHistory.histories[0].entries.entries()) {
      const parts = long.filter(value => value["Record ID"] === `${saved.decisionLinks![0].id}/${index + 1}` && value.Field === "exact_event_text");
      expect(parts.map(value => value.Text).join("")).toBe(entry.eventText);
      expect(parts.map(value => value.Part)).toEqual(parts.map((_, i) => i + 1));
    }
    expect(members.filter(row => row.source_kind === "answer")).toHaveLength(3);
    expect(members.every(row => row.configuration_availability === "available")).toBe(true);
  });
  it("retains new registers and the original immutable snapshot in the portable review", async () => {
    const raw = rawReview(), checksum = hash(raw), files = await renderCampaignReviewFiles(raw, checksum);
    expect(pdf).toHaveBeenCalledOnce(); expect(pdf.mock.calls[0][0]).toContain("Retained synthesis source appendix");
    const zip = await JSZip.loadAsync(files.find(row => row.format === "zip")!.bytes);
    expect(await zip.file("snapshot.json")!.async("string")).toBe(raw);
    expect(await zip.file("decision-synthesis-coverage.csv")!.async("string")).toContain("captured_at_decision_preview");
    const actions = await zip.file("decision-synthesis-actions.csv")!.async("string");
    expect(actions).toContain("SYNTHETIC staff explanation é"); expect(actions).toContain("SYNTHETIC corrected response");
    const sources = await zip.file("decision-synthesis-sources.csv")!.async("string");
    expect(sources).toContain("FINAL SOURCE TAIL"); expect(sources).toContain("SYNTHETIC distinct survey concern");
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    for (const name of ["decision-synthesis-actions.csv", "decision-synthesis-sources.csv", "decision-synthesis-coverage.csv"]) {
      const bytes = await zip.file(name)!.async("nodebuffer");
      expect(manifest.files.find((row: { name: string }) => row.name === name)).toMatchObject({ checksum: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length });
    }
  });
  it("keeps private synthesis out of public HTML, workbooks and ZIP files", async () => {
    const value = JSON.parse(rawReview()); value.schema = 1; value.scope = "public";
    for (const field of ["workspaceId", "decisionLinkHistoryScope", "decisionLinkCount", "decisionLinks"]) delete value[field];
    const raw = JSON.stringify(value), saved = await parseReviewSnapshot(raw, hash(raw));
    expect(buildCampaignReviewHtml(saved, "test")).not.toContain("synthesis");
    const book = XLSX.read(await buildCampaignReviewWorkbook(saved, "test"), { type: "buffer" });
    expect(book.SheetNames.some(name => name.startsWith("Synthesis"))).toBe(false);
    const files = await renderCampaignReviewFiles(raw, hash(raw)), zip = await JSZip.loadAsync(files.find(row => row.format === "zip")!.bytes);
    expect(Object.keys(zip.files).some(name => name.includes("synthesis"))).toBe(false);
  });
  it.each(["group", "member", "session"])("refuses unavailable retained %s during presentation", kind => {
    const context = makeContext(), packet = context.synthesisHistory.histories[0].entries[0], value = JSON.parse(packet.eventText), retained = JSON.parse(value.context.contextText);
    if (kind === "group") {
      const content = JSON.parse(retained.revision.contentText); content.groups = []; retained.revision.contentText = JSON.stringify(content);
    } else {
      const source = JSON.parse(retained.source.snapshotText); if (kind === "member") source.items = []; else source.sessions = [];
      retained.source.snapshotText = JSON.stringify(source);
    }
    value.context.contextText = JSON.stringify(retained); packet.eventText = JSON.stringify(value);
    expect(() => decisionSynthesisDetails(context)).toThrow(`Retained decision synthesis ${kind} is unavailable`);
  });
});
