/**
 * The features that stop working without the workspace's Anthropic key.
 *
 * One list for the Help page and the dashboard checklist's AI step. They used
 * to keep separate copies, and Help said "everything else works without a
 * key" while reading figures from an earlier RTP also needed one
 * (`api/rtp-cycles/[rtpCycleId]/extraction-runs/route.ts`). Each entry names
 * the route or library that checks `hasAnthropicAccess()` and refuses without
 * it. Features that fall back to a plain result without a key (comment
 * screening, the corridor result summary, report-back drafts) are not here.
 *
 * Map packages and suggested comment themes need AI set up another way, not
 * this key; Help states those two separately.
 */
export type AiKeyFeature = {
  /** A full line for the Help list. */
  help: string;
  /** A short name for the checklist sentence. */
  short: string;
  /** Where the key check lives, so a reader can confirm the entry. */
  checkedIn: string;
};

export const AI_KEY_FEATURES: readonly AiKeyFeature[] = [
  {
    help: "The Planner Agent, the in-app assistant.",
    short: "the Planner Agent",
    checkedIn: "src/app/api/assistant/chat/route.ts",
  },
  {
    help: "Drafting text for reports, RTP chapters and grant applications.",
    short: "drafting text",
    checkedIn:
      "src/app/api/reports/[reportId]/narrative-draft/route.ts, src/app/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/draft/route.ts, src/app/api/funding-opportunities/[opportunityId]/narrative-draft/route.ts",
  },
  {
    help: "Comment translation on public engagement pages.",
    short: "comment translation",
    checkedIn: "src/lib/engagement/translation.ts",
  },
  {
    help: "Reading figures from an earlier plan document into an RTP.",
    short: "reading figures from an earlier plan",
    checkedIn: "src/app/api/rtp-cycles/[rtpCycleId]/extraction-runs/route.ts",
  },
];

/** "a, b, c and d", for one sentence. */
export function aiKeyFeatureSentenceList(): string {
  const names = AI_KEY_FEATURES.map((feature) => feature.short);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
