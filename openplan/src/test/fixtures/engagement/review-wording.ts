/**
 * Review snapshots that exercise every place the review PDF used to print a
 * stored identifier, time, JSON value or code: two campaign settings sets with
 * categories, questions and a machine translation; a reply; a photograph; a
 * survey session with a structured answer and a deleted question; a response
 * that answers a contribution outside the selection; category and date
 * filters; and private decision history with synthesis evidence. Built on the
 * review count fixture. Labeled test data that represents no place or person.
 */
import nativeReview from "../engagement-review-decision-history-native.json";
import { address, row, withReviewWords } from "./decision-synthesis";
import { internalReviewCountSnapshot, type ReviewCountSnapshot } from "./review-counts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const REVIEW_WORDING_IDS = {
  earlierSettings: id(300),
  currentSettings: id(301),
  crossing: id(310),
  lighting: id(311),
  whichCrossing: id(320),
  anythingElse: id(321),
  session: id(400),
  structuredAnswer: id(410),
  textAnswer: id(411),
  outsideSelection: id(999),
} as const;

function definition(instructions: string) {
  const ids = REVIEW_WORDING_IDS;
  return {
    campaign: { instructions, place_label: "TEST corridor", participation_starts_at: "2026-11-01T08:00:00Z", participation_ends_at: "2026-12-01T08:00:00.123456+00:00" },
    categories: [
      { id: ids.crossing, label: "Crossing safety", description: "TEST crossings." },
      { id: ids.lighting, label: "Lighting", description: "TEST lighting." },
    ],
    questions: [
      { id: ids.whichCrossing, prompt: "Which crossing?", help_text: "Pick one.", question_type: "single_choice", required: true, options: [{ id: id(330), label: "Fifth Street" }, { id: id(331), label: "Main Street" }] },
      { id: ids.anythingElse, prompt: "Anything else?", help_text: "", question_type: "free_text", required: false, options: null },
    ],
    layers: [],
    translations: [{ locale: "es", entity_type: "category", field: "label", source: "machine", translated_text: "Seguridad en cruces" }],
  };
}

/** The internal copy, with every kind of record the register prints. */
export function fullerInternalReviewSnapshot(): ReviewCountSnapshot {
  const ids = REVIEW_WORDING_IDS;
  const base = internalReviewCountSnapshot();
  return {
    ...base,
    capturedAt: "2026-11-14T16:16:46.741788+00:00",
    filters: { categoryIds: [ids.crossing], from: "2026-11-01T00:00:00Z", to: "2026-11-15T00:00:00.000000+00:00" },
    campaign: { ...base.campaign, summary: "TEST campaign summary.", configurationVersionId: ids.currentSettings },
    items: base.items.map((item, index) => ({
      ...item,
      configuration_version_id: index === 0 ? ids.earlierSettings : ids.currentSettings,
      category_id: ids.crossing,
      created_at: `2026-11-14T16:0${index}:47.763819+00:00`,
      ...(index === 1 ? { parent_item_id: base.items[0].id } : {}),
      ...(index === 2 ? { photo_path: `${base.campaign.id}/test-photo.jpg` } : {}),
    })),
    sessions: [{ id: ids.session, status: "approved", created_at: "2026-11-14T16:20:00.5+00:00", configuration_version_id: ids.currentSettings }],
    answers: [
      { id: ids.structuredAnswer, session_id: ids.session, question_id: ids.whichCrossing, question_prompt_snapshot: "Which crossing?", question_type: "single_choice", answer_text: null, answer_json: { option_id: id(330) } },
      { id: ids.textAnswer, session_id: ids.session, question_id: null, question_prompt_snapshot: "Anything else?", question_type: "free_text", answer_text: "TEST more lighting.", answer_json: { text: "TEST more lighting." } },
    ],
    definitions: [
      { id: ids.earlierSettings, sha256: "a".repeat(64), definition: definition("TEST earlier instructions.") },
      { id: ids.currentSettings, sha256: "b".repeat(64), definition: definition("TEST current instructions.") },
    ],
    responses: base.responses.map((response, index) => index === 1 ? { ...response, source_item_ids: [...(response.source_item_ids as string[]), ids.outsideSelection] } : response),
  };
}

/** The public copy of the same records, selected the way the snapshot function selects it. */
export function fullerPublicReviewSnapshot(): ReviewCountSnapshot {
  const internal = fullerInternalReviewSnapshot();
  const items = internal.items.filter((item) => item.status === "approved");
  const kept = new Set(items.map((item) => item.id));
  return {
    ...internal, scope: "public", filters: { status: "approved" }, items,
    responses: internal.responses.filter((response) => response.published_at && (response.source_item_ids as string[]).every((source) => kept.has(source))),
  };
}

/** Saved internal snapshots with private decision history: the native three-action chain, and one action carrying synthesis evidence. */
export function decisionHistoryReviewSnapshots(): Array<{ name: string; snapshot: Record<string, unknown> }> {
  const chain = JSON.parse(nativeReview.snapshotText) as Record<string, unknown>;
  const synthesis = JSON.parse(nativeReview.snapshotText) as Record<string, unknown>;
  synthesis.campaign = { ...(synthesis.campaign as object), id: address.campaignId };
  synthesis.workspaceId = address.workspaceId;
  synthesis.decisionLinks = [row(withReviewWords())];
  synthesis.decisionLinkCount = 1;
  return [{ name: "the native link, refresh and withdrawal chain", snapshot: chain }, { name: "a link with synthesis evidence", snapshot: synthesis }];
}
