/**
 * THE ENGAGEMENT REVIEW PDF READS IN PLANNER WORDS (KI-2026-11-14-390).
 *
 * Found on 2026-11-14 by an agent running the second proven job on a local
 * build. The public review copy, which goes to residents, printed stored
 * times ("2026-11-14T16:08:47.763819+00:00"), record ids on every
 * contribution and response, "Filters {"status":"approved"}" as JSON, and
 * stored codes such as "approved", "not_assessed" and "proposed". The internal
 * copy's decision history printed action, actor, review and hash values
 * inline.
 *
 * The rule: before the closing "Record identifiers" heading there is no uuid,
 * no 64-character hash, no stored time with a "T", no "{" and no stored code
 * printed as a value. After it, every identifier and hash the report used to
 * print is listed against the number or name the body gives it.
 *
 * The first block reads the HTML the PDF is printed from, for both scopes and
 * for decision history with and without synthesis evidence. The second prints
 * the real PDF through Chrome and reads it back with Poppler, page by page; it
 * is skipped where Chrome or Poppler is missing.
 *
 * WHAT THIS FILE CANNOT PROVE. That every wording is the clearest one, how a
 * reader at 390 px meets the page, a stored code this file does not list, or
 * an identifier shape other than a uuid or a 64-character hash (a short
 * custom id in the body would pass).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decisionSynthesisDetails } from "@/lib/engagement/decision-synthesis-display";
import { buildCampaignReviewHtml, parseReviewSnapshot, renderCampaignReviewFiles, type EngagementReviewSnapshot } from "@/lib/engagement/review-export";
import { REVIEW_PDF_STORED_CODES } from "@/lib/engagement/review-pdf-words";
import { internalReviewCountSnapshot, publicReviewCountSnapshot } from "./fixtures/engagement/review-counts";
import { decisionHistoryReviewSnapshots, fullerInternalReviewSnapshot, fullerPublicReviewSnapshot } from "./fixtures/engagement/review-wording";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const text = (value: unknown) => value == null ? "" : String(value);

const CASES: Array<{ name: string; snapshot: unknown }> = [
  { name: "public copy, count fixture", snapshot: publicReviewCountSnapshot() },
  { name: "internal copy, count fixture", snapshot: internalReviewCountSnapshot() },
  { name: "public copy, every record kind", snapshot: fullerPublicReviewSnapshot() },
  { name: "internal copy, every record kind", snapshot: fullerInternalReviewSnapshot() },
  ...decisionHistoryReviewSnapshots().map(({ name, snapshot }) => ({ name: `internal copy, ${name}`, snapshot })),
];

async function saved(snapshot: unknown) {
  const raw = JSON.stringify(snapshot), checksum = hash(raw);
  return { raw, checksum, parsed: await parseReviewSnapshot(raw, checksum) };
}

/** Every identifier and hash the review PDF printed in its body before 2026-11-14, read from the snapshot. */
function expectedIdentifiers(snapshot: EngagementReviewSnapshot, checksum: string): string[] {
  const ids: unknown[] = [snapshot.campaign.id, checksum];
  const filters = snapshot.filters as { categoryIds?: unknown[] };
  ids.push(...(filters.categoryIds ?? []));
  const settings = new Set(snapshot.definitions.map((row) => row.id));
  for (const item of snapshot.items) {
    ids.push(item.id, item.parent_item_id);
    if (item.configuration_version_id && !settings.has(text(item.configuration_version_id))) ids.push(item.configuration_version_id);
    if (item.photo_path) ids.push(`photos/${text(item.id)}.${text(item.photo_path).split(".").pop()}`);
  }
  for (const session of snapshot.sessions) ids.push(session.id);
  for (const answer of snapshot.answers) ids.push(answer.id, answer.question_id);
  for (const response of snapshot.responses) ids.push(response.id, ...(Array.isArray(response.source_item_ids) ? response.source_item_ids : []));
  for (const version of snapshot.definitions) {
    ids.push(version.id, version.sha256, ...version.definition.categories.map((row) => row.id));
    for (const question of version.definition.questions) for (const option of Array.isArray(question.options) ? question.options as Array<{ id?: unknown }> : []) ids.push(option?.id);
  }
  for (const row of snapshot.decisionLinks ?? []) {
    ids.push(row.id, row.predecessor_id, row.actor_id, row.response_id, row.decision_id, row.project_id, row.payload_sha256, row.context_sha256);
    ids.push(...row.context.sources.map((source) => source.itemId));
    ids.push(...row.context.configurations.flatMap((definition) => [definition.id, definition.definitionSha256]));
    for (const history of decisionSynthesisDetails(row.context) ?? []) {
      ids.push(history.reviewId, history.groupId);
      for (const event of history.events) {
        ids.push(event.intent.requestId, event.intent.actorId, event.eventSha256, event.approval.intent.requestId, event.approval.intent.actorId, event.retained.approval.eventSha256, event.retained.sourceId, event.retained.sourceSha256);
        for (const member of event.members) ids.push(member.key, member.configurationId, member.definition?.sha256);
      }
    }
  }
  return [...new Set(ids.map(text).filter(Boolean))];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HASH = /\b[0-9a-f]{64}\b/i;
const STORED_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UNDERSCORE_CODE = /\b[a-z]+_[a-z_]+\b/;

/**
 * Every way the body breaks the rule, named. A stored code counts when it is a
 * whole value between separators ("| approved |", "Staff sentiment:
 * not_assessed", "Retained decision status: proposed."), so prose such as
 * "Withheld, pending and flagged contributions are left out" is not a finding.
 */
function bodyFindings(body: string, attributes = ""): string[] {
  const findings: string[] = [];
  for (const [name, pattern] of [["record id", UUID], ["64-character hash", HASH], ["stored time", STORED_TIME]] as const) {
    const match = pattern.exec(body) ?? pattern.exec(attributes);
    if (match) findings.push(`${name}: ${match[0]}`);
  }
  if (body.includes("{")) findings.push(`JSON: ${body.slice(body.indexOf("{"), body.indexOf("{") + 40)}`);
  const underscore = UNDERSCORE_CODE.exec(body);
  if (underscore) findings.push(`stored code: ${underscore[0]}`);
  const codes = new Set(REVIEW_PDF_STORED_CODES);
  for (const segment of body.split(/[|·:().\n]/).map((part) => part.trim())) {
    if (codes.has(segment)) findings.push(`stored code: ${segment}`);
  }
  return [...new Set(findings)];
}

/** The body before the appendix, as text and as attribute values (alt, title, href), and the appendix text. */
function splitReview(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const appendix = document.querySelector("section.identifiers");
  if (!appendix || appendix.querySelector("h2")?.textContent !== "Record identifiers") throw new Error("The review has no Record identifiers appendix");
  if (document.body.lastElementChild !== appendix) throw new Error("The Record identifiers appendix is not the last thing in the review");
  const appendixText = appendix.textContent ?? "";
  appendix.remove();
  const attributes = [...document.body.querySelectorAll("*")].flatMap((node) => [...node.attributes].filter((attribute) => attribute.name !== "src").map((attribute) => attribute.value)).join("\n");
  // Text nodes joined with line breaks, so adjacent elements cannot run two values together.
  const walker = document.createTreeWalker(document.body, 4);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? "");
  return { body: parts.join("\n"), attributes, appendix: appendixText };
}

describe("the review PDF's HTML, before and after the Record identifiers heading", () => {
  it.each(CASES)("$name: the body prints no record id, raw time, JSON or stored code", async ({ snapshot }) => {
    const { parsed, checksum } = await saved(snapshot);
    const { body, attributes } = splitReview(buildCampaignReviewHtml(parsed, checksum));
    expect(bodyFindings(body, attributes)).toEqual([]);
  });

  it.each(CASES)("$name: the appendix lists every identifier the body used to print", async ({ snapshot }) => {
    const { parsed, checksum } = await saved(snapshot);
    const { appendix } = splitReview(buildCampaignReviewHtml(parsed, checksum));
    const expected = expectedIdentifiers(parsed, checksum);
    expect(expected.length).toBeGreaterThan(2);
    expect(expected.filter((id) => !appendix.includes(id))).toEqual([]);
  });

  it("names times with their zone, entries by number and the selection in words", async () => {
    const { parsed, checksum } = await saved(fullerInternalReviewSnapshot());
    const { body } = splitReview(buildCampaignReviewHtml(parsed, checksum));
    expect(body).toContain("Campaign snapshot saved Nov 14, 2026, 16:16 UTC.");
    expect(body).toContain("Selection: every contribution, in the category Crossing safety, received on or after Nov 1, 2026, 00:00 UTC and before Nov 15, 2026, 00:00 UTC.");
    expect(body).toContain("Received Nov 14, 2026, 16:04 UTC · Withheld · Crossing safety");
    expect(body).toContain("Answers contributions 2 and 3, and 1 contribution not in this selection");
    expect(body).toContain("Reply to contribution 1");
    const publicCopy = await saved(fullerPublicReviewSnapshot());
    expect(splitReview(buildCampaignReviewHtml(publicCopy.parsed, publicCopy.checksum)).body).toContain("Selection: approved contributions only.");
  });

  it("keeps the scope badge and the count sentences the proven job's checker reads", async () => {
    for (const [snapshot, badge] of [[publicReviewCountSnapshot(), "PUBLIC REVIEW COPY"], [internalReviewCountSnapshot(), "INTERNAL REVIEW COPY"]] as const) {
      const { parsed, checksum } = await saved(snapshot);
      const { body } = splitReview(buildCampaignReviewHtml(parsed, checksum));
      expect(body).toContain(badge);
      expect(body).toContain("Approved 4 contributions.");
      expect(body).toContain("Answered 3 contributions with a published staff response.");
    }
  });
});

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
/** Poppler's folder: another pdftotext (xpdf) can come first on PATH on Windows. */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const tool = (name: "pdftotext" | "pdfinfo") => path.join(POPPLER!, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-review-words-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!PDF_TOOLS)("the printed review PDF, read back with Poppler page by page", () => {
  it.each(CASES.filter(({ name }) => /every record kind|synthesis/.test(name)))("$name", async ({ name, snapshot }) => {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    const { raw, checksum, parsed } = await saved(snapshot);
    const files = await renderCampaignReviewFiles(raw, checksum);
    const file = path.join(workDir, `${name.replace(/\W+/g, "-")}.pdf`);
    writeFileSync(file, files.find((entry) => entry.format === "pdf")!.bytes);
    const count = Number(/Pages:\s+(\d+)/.exec(execFileSync(tool("pdfinfo"), [file]).toString())![1]);
    const pages = Array.from({ length: count }, (_, index) => execFileSync(tool("pdftotext"), ["-layout", "-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString());
    // The appendix starts on its own page, so every page before it is body.
    const first = pages.findIndex((page) => page.trimStart().startsWith("Record identifiers"));
    expect(first).toBeGreaterThan(0);
    // The page footer keeps the snapshot hash's first 12 characters; that is not a record id or a full hash.
    const body = pages.slice(0, first).map((page, index) => bodyFindings(page.replace(/[0-9a-f]{12} · Page \d+ of \d+/g, "")).map((finding) => `page ${index + 1}: ${finding}`)).flat();
    expect(body).toEqual([]);
    const appendix = pages.slice(first).join("\n");
    expect(expectedIdentifiers(parsed, checksum).filter((id) => !appendix.includes(id))).toEqual([]);
  }, 120_000);
});
