/**
 * THE JARGON LEDGER — one vocabulary for every surface, in data.
 *
 * Nathaniel, after using OpenPlan as a human for the first time (2026-08-13):
 * "much of the copy/narrative/speaking style still seems like an agent talking
 * to another agent, but this needs to be for people who are planners and most
 * planners don't understand a lot of this stuff I'm packing in here." Asked
 * whether the copy should TEACH the vocabulary or HIDE it, he answered: "I
 * guess I'm just trying to say make it much more ELI5."
 *
 * So the rule this file encodes is: SAY THE PLAIN THING. Do not put a
 * definition next to the jargon — replace the jargon. A glossary is the
 * machine's word plus homework.
 *
 * WHAT THIS FILE IS FOR. Three lanes are rewriting copy in parallel. Without a
 * shared list they will produce three voices, which is worse than the one voice
 * we have. Import from here; do not re-decide a term in your lane. If a term is
 * missing, ADD IT HERE first, then use it.
 *
 * THE THREE LISTS, and the distinction between them is the whole point:
 *
 *   BANNED    — the machine's word for something a planner already has a word
 *               for. Replace it. Nothing is lost.
 *   KEPT      — the PROFESSION's word. "Obligation", "fiscal constraint",
 *               "horizon year" are not jargon to a planner; they are the job.
 *               ELI5 means removing the engineer's vocabulary, never the
 *               planner's. Simplifying these makes the product wrong AND
 *               patronising.
 *   PROTECTED — a claim boundary. It may be said more plainly. It may NOT be
 *               dropped, and its meaning may not be widened. Each entry carries
 *               MEANING TOKENS: the permission half and the prohibition half.
 *               A rewrite that keeps only one half is a weakened claim, and
 *               OpenPlan's figures go into grant applications and adopted
 *               plans. Plainer must never mean weaker.
 *
 * Every PROTECTED sentence has exactly one definition site. Change the wording
 * THERE — never at a call site, never inline. If you are retyping a caveat, you
 * are forking it.
 */

/** A term of art that should never reach a planner, and what to say instead. */
export type BannedTerm = {
  /** Matched case-insensitively against rendered copy, on word boundaries. */
  readonly term: string;
  /** What to say instead. Never "term (plain gloss)" — replace, don't annotate. */
  readonly say: string;
  /** Why it is here — the reader's problem with it, not a style opinion. */
  readonly because: string;
  /** A real occurrence found 2026-08-13, so a reader can check the claim. */
  readonly seen?: string;
};

export const BANNED_TERMS: readonly BannedTerm[] = [
  {
    term: "posture",
    say: "Name the state: “Where this stands”, “Ready to send”, “Not set up yet”. Usually the word can simply be deleted.",
    because:
      "It means nothing to a reader and it is doing the job of a real status word. 49 occurrences.",
    seen: "“Portfolio posture” and “Engagement posture” as headings on the RTP document page.",
  },
  {
    term: "packet",
    say: "report — or the specific thing: “reimbursement claim”, “grant application”.",
    because: "A packet is a report OpenPlan generated. Planners call that a report. 198 occurrences.",
    seen: "“Packet release review”, “Report packets to generate or refresh”.",
  },
  {
    term: "artifact",
    say: "the file OpenPlan generated — or just “the report”, “the document”.",
    because: "Build vocabulary. The reader sees a PDF, not an artifact. 78 occurrences.",
    seen: "“A rendered artifact exists, but the RTP source changed after generation.”",
  },
  {
    term: "surface",
    say: "page, or screen. As a verb: “show”.",
    because:
      "“Related surfaces”, “workspace surface”, “the surface that shows it” — a page is a page. Keep the word only where it means a physical surface model in the aerial module.",
    seen: "not-found.tsx: “That page isn’t part of OpenPlan… workspace surface”.",
  },
  {
    term: "registry",
    say: "list — “Your RTP cycles”, “All projects”.",
    because: "Nobody outside this codebase calls a list of projects a registry. 70 occurrences.",
    seen: "“Tracked RTP cycles” inside a component named rtp-cycle-registry-table.",
  },
  {
    term: "record",
    say: "the thing itself: project, report, invoice, comment.",
    because:
      "“Report records”, “invoice records”, “packet record” — the noun adds nothing and pushes the real noun into an adjective. 500 occurrences in rendered prose; the single most common tic in the product.",
    seen: "“No overdue award-linked invoice records are visible in this workspace right now.”",
  },
  {
    term: "spine",
    say: "Name the actual relationship: “How this project connects to plans, programs, and funding”.",
    because: "An internal name for a join. It reaches the screen as a heading.",
    seen: "project-spine-board.tsx; “Shared scenario spine schema was still pending”.",
  },
  {
    term: "basis",
    say: "what this is based on — “the records this number came from”.",
    because: "Reads as legal or mathematical; it means “the rows we read”.",
    seen: "“part of this plan’s basis could not be read”.",
  },
  {
    term: "intake",
    say: "what people sent in — comments.",
    because: "An administrator’s word for a resident’s words.",
    seen: "“Add a few categories so intake can be classified before downstream reports rely on it.”",
  },
  {
    term: "ingest",
    say: "import, bring in, upload.",
    because: "Machine vocabulary for a file the planner is uploading. 114 occurrences.",
  },
  {
    term: "payload",
    say: "Do not render it at all. Say what the reader must fix: “That change could not be saved — a required field was missing.”",
    because:
      "83 occurrences, most of them in API error messages that surface in a toast. “Invalid scenario set update payload” tells a planner nothing they can act on.",
  },
  {
    term: "scaffold",
    say: "set up, or create the starting structure.",
    because: "Build vocabulary on an action button.",
    seen: "“Scaffold plan horizon periods” in the assistant activity ledger.",
  },
  {
    term: "bootstrap",
    say: "set up, start.",
    because: "Same class.",
    seen: "“Workspace bootstrap failed.”",
  },
  {
    term: "provenance",
    say: "where it came from.",
    because: "A real archival term, but not one most planners use. 31 occurrences.",
  },
  {
    term: "claim tier",
    say: "how strong the evidence is.",
    because:
      "The CONCEPT is load-bearing; the phrase is ours. The tier LABELS themselves are protected — see PROTECTED_CLAIMS.",
  },
  {
    term: "study area",
    say: "the area you are planning for — or, to a resident, “this project’s area”.",
    because: "Nathaniel named this one directly: an administrator's word.",
  },
  {
    term: "campaign",
    say: "To staff: “public input project”. To a resident: “this project”.",
    because:
      "1,786 occurrences in code, and it reaches residents in 22 languages. A resident is not in a campaign.",
    seen: "“Approved community items currently visible on this campaign page.”",
  },
  {
    term: "submission",
    say: "what you sent — “your comment”, “comments received”.",
    because: "The resident’s own words, described as paperwork.",
    seen: "portal-i18n: “Submission status”, “Submissions open”.",
  },
  {
    term: "input",
    say: "comment — “what people said”, “share your thoughts”.",
    because:
      "Nathaniel named this one directly. “Input” is what an administrator calls what a resident wrote. Keep it only for a literal form field a person types into.",
    seen: "portal-i18n: “This input supports”.",
  },
  {
    term: "basemap",
    say: "map style — or “background map”.",
    because: "Nathaniel named this one. GIS vocabulary on a resident-facing picker.",
  },
  {
    term: "lane",
    say: "Name the thing. “Crash-risk lane” is “crash risk”.",
    because: "An internal word for a workstream, rendered as a section title.",
  },
  {
    term: "cadence",
    say: "how often.",
    because: "16 occurrences; “how often” is shorter and clearer.",
  },
  {
    term: "downstream",
    say: "later — or name it: “reports that use this”.",
    because: "Pipeline vocabulary. A planner has readers, not a downstream.",
  },
  {
    term: "upstream",
    say: "earlier — or name the source.",
    because: "Same class.",
  },
  {
    term: "entity",
    say: "the thing’s own name: project, plan, program.",
    because: "Database vocabulary.",
  },
  {
    term: "attribute",
    say: "field — or “column in your file”.",
    because: "GIS-adjacent but reads as schema talk in upload copy.",
  },
  {
    term: "geometry",
    say: "shape, boundary, or the line you drew.",
    because: "53 occurrences in rendered copy; “geometry attachments” is not a thing a planner attaches.",
  },
  {
    term: "durable",
    say: "Delete it. If it means “saved”, say saved.",
    because: "It is a promise about the database, made to somebody who cannot check it.",
    seen: "“Project-linked scenario registry with durable reopening.”",
  },
  {
    term: "legible",
    say: "Delete it, or say what the reader will be able to do later.",
    because: "“decision-legible” is not English anybody speaks.",
    seen: "“Add one so this entry stays decision-legible later.”",
  },
  {
    term: "trace",
    say: "history — “what happened, in order”.",
    because: "“queue-action trace”, “traceability” — say that you can see where a number came from.",
  },
  {
    term: "deterministic",
    say: "written by OpenPlan, not by AI.",
    because:
      "The distinction matters and the word hides it. This one is close to a claim boundary — say the plain thing, never nothing.",
    seen: "“Operator-facing summary of the current run using deterministic fallback logic rather than AI narrative output.”",
  },
  {
    term: "preset",
    say: "starting settings.",
    because: "Product vocabulary; “starting settings” says what happens.",
  },
  {
    term: "compose",
    say: "write, or new — “New invoice”.",
    because: "A verb from the codebase’s component names.",
  },
  {
    term: "resolve",
    say: "show, finish, or work out — “each row will show either evidence, a gap, or a next step”.",
    because: "Programmer’s “resolve”. A planner resolves a dispute, not a row.",
  },
  {
    term: "populate",
    say: "fill in, add.",
    because: "Database verb.",
    seen: "“Attach projects in the cycle workspace to populate the portfolio section.”",
  },
  {
    term: "operator",
    say: "whoever installed OpenPlan for your agency / whoever runs this deployment.",
    because:
      "Correct in operator copy, opaque in planner copy. The long phrase is already used in the best pages — standardise on it.",
  },
  {
    term: "migration",
    say: "In planner copy: “this part is not set up yet — whoever installed OpenPlan needs to finish the setup.” Keep the migration name behind the operator disclosure.",
    because:
      "40 occurrences. “Apply the Lane C migration to track funder draws” is an instruction to somebody who is not reading it.",
  },
  {
    term: "schema",
    say: "Do not render it. Say what is missing and who fixes it.",
    because: "“Data Hub schema still pending in this database” is the same defect as above.",
  },
  {
    term: "mode",
    say: "Say what it lets people do: “How people can take part”.",
    because: "“Mode: {mode}” renders to a resident in 22 languages.",
  },
  {
    term: "moderation queue",
    say: "comments waiting for review.",
    because: "The queue is ours; the wait is theirs.",
  },
  {
    term: "governance hold",
    say: "waiting for sign-off.",
    because: "Two abstract nouns where one plain verb works.",
  },
  {
    term: "readiness",
    say: "Turn it into a sentence: “Ready to send”, “Not ready — three things missing”.",
    because: "A noun that hides both the verdict and the reason.",
  },
  {
    term: "signal",
    say: "what people said — or the actual measure.",
    because: "“intake signal”, “engagement signal”: abstraction over the public’s words.",
  },
  {
    term: "workspace",
    say: "your agency’s OpenPlan. Keep the word ONLY for accounts and membership (“invite someone to your workspace”); never as a modifier on a data noun.",
    because:
      "783 occurrences. “Workspace geography” is “where you work”. “Visible in this workspace” is “here”. This one cannot be banned outright — it is a real object with real permissions — so the rule is positional, not lexical.",
  },
];

/**
 * The profession's own vocabulary. NOT jargon. Simplifying these is a defect.
 *
 * This list exists so a lane doing an ELI5 pass does not "fix" the words that
 * make OpenPlan credible to the person using it. A planner who reads
 * "obligation" knows exactly what it means and would not recognise
 * "money promised".
 */
export const KEPT_TERMS: readonly string[] = [
  "obligation",
  "encumbrance",
  "fiscal constraint",
  "horizon year",
  "programming",
  "stage gate",
  "milestone",
  "scope",
  "corridor",
  "scenario",
  "baseline",
  "tract",
  "right-of-way",
  "coordinate system",
  "reimbursement",
  "award",
  "grant",
  "invoice",
  "RTP",
  "Title VI",
  "CEQA",
  "NEPA",
  "VMT",
  "level of service",
  "transit feed",
];

/**
 * A claim boundary: the sentence that keeps a number honest.
 *
 * `permission` and `prohibition` are MEANING TOKENS, not the sentence. A lane
 * may rewrite the sentence into plainer words; both halves must survive the
 * rewrite. A caveat that keeps only its permission half has been widened, and a
 * widened caveat is how a screening number ends up in an adopted plan.
 *
 * `definedAt` is the ONLY place the wording may change.
 */
export type ProtectedClaim = {
  readonly id: string;
  readonly definedAt: string;
  /**
   * The exported constant/function, or the quoted catalog key, whose OWN text
   * carries this claim.
   *
   * Not optional decoration. A file-level check was written first and it passed
   * a mutation that stripped the prohibition half clean out of
   * `SCREENING_GRADE_SUMMARY` — because four other sentences elsewhere in the
   * same file still matched a prohibition token. A guard that green-lights the
   * widened sentence is worse than none. The claim has to be read at the
   * symbol that ships it.
   */
  readonly symbols: readonly string[];
  readonly whatItProtects: string;
  /** What the reader IS allowed to conclude. At least one token must survive. */
  readonly permission: readonly string[];
  /** What they are NOT. At least one token must survive. */
  readonly prohibition: readonly string[];
};

export const PROTECTED_CLAIMS: readonly ProtectedClaim[] = [
  {
    id: "screening-grade",
    symbols: ["SCREENING_GRADE_SUMMARY"],
    definedAt: "src/lib/help/screening-grade.ts",
    whatItProtects:
      "Every modeled figure in the product. The phrase appears on 20+ surfaces and is explained in exactly one.",
    permission: ["compare", "priorit", "rank"],
    prohibition: ["not good enough", "design", "permit", "certif"],
  },
  {
    id: "not-a-forecast",
    symbols: ["SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE"],
    definedAt: "src/lib/help/screening-grade.ts (SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE)",
    whatItProtects: "The gap between “what the model shows” and “what will happen”.",
    permission: ["describes the modeled", "modeled situation"],
    prohibition: ["not a forecast", "not what will happen"],
  },
  {
    id: "not-comparable-across-areas",
    symbols: ["SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE"],
    definedAt: "src/lib/help/screening-grade.ts",
    whatItProtects:
      "Two screening runs over different places. The difference between them is not a finding.",
    permission: ["different inputs", "different resolutions"],
    prohibition: ["not comparable", "is not a finding"],
  },
  {
    id: "not-calibrated-unless-said",
    symbols: ["SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE"],
    definedAt: "src/lib/help/screening-grade.ts (with the tier labels in src/lib/models/evidence-backbone.ts)",
    whatItProtects: "Calibration is a separate, labelled step — never assumed.",
    permission: ["separate", "labeled", "labelled"],
    prohibition: ["not calibrated", "unless"],
  },
  {
    id: "not-a-ceqa-determination",
    symbols: ["SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE"],
    definedAt: "src/lib/help/screening-grade.ts",
    whatItProtects: "A screening VMT figure informs the analysis; a qualified reviewer makes the finding.",
    permission: ["informs"],
    prohibition: ["not a CEQA determination", "not a substitute"],
  },
  {
    id: "claim-tier-labels",
    symbols: ["modelingClaimStatusLabel"],
    definedAt: "src/lib/models/evidence-backbone.ts (modelingClaimStatusLabel)",
    whatItProtects:
      "The four tiers and the fifth, honest, absence: “Claim tier not recorded” is never rounded up to a tier. One labeler only — guarded by one-claim-tier-labeler.test.ts.",
    permission: ["Claim-grade passed", "Calibrated to counts"],
    prohibition: ["Screening-grade", "Prototype-only", "not recorded"],
  },
  {
    id: "screening-grade-held-back",
    symbols: ["describeScreeningGradeRefusal"],
    definedAt: "src/lib/models/caveat-gate.ts (describeScreeningGradeRefusal)",
    whatItProtects: "Sources held back are held back until the reader chooses to include them.",
    permission: ["until you choose", "include them"],
    prohibition: ["held back"],
  },
  {
    id: "crash-data-coverage",
    symbols: ["SAFETY_CRASH_DATA_CAVEAT"],
    definedAt: "src/lib/safety/caveats.ts (SAFETY_CRASH_DATA_CAVEAT)",
    whatItProtects: "Observed is not the same as complete.",
    permission: ["reported collisions", "retrieved from the source agency"],
    prohibition: ["not modeled", "vary by source", "may be incomplete", "review the coverage"],
  },
  {
    id: "crash-geocoding-shortfall",
    symbols: ["SAFETY_GEOCODING_CAVEAT"],
    definedAt: "src/lib/safety/caveats.ts (SAFETY_GEOCODING_CAVEAT, describeGeocodingShortfall)",
    whatItProtects:
      "The map is a subset of what was reported. The percentage is computed from the reader's own extract, never a constant.",
    permission: ["counted in the totals", "can be mapped"],
    prohibition: ["do not appear on the map", "did not geolocate"],
  },
  {
    id: "unclassified-severity",
    symbols: ["SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT"],
    definedAt: "src/lib/safety/caveats.ts (SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT)",
    whatItProtects:
      "A missing casualty count is missing information, not a mild outcome. It is counted in the total and in NO severity band.",
    permission: ["counted in the total"],
    prohibition: ["no severity band", "missing information", "not a mild outcome"],
  },
  {
    id: "machine-translation",
    symbols: ["\"provenance.machine.caveat\""],
    definedAt: "src/lib/engagement/portal-i18n/messages.ts (provenance.machine.*)",
    whatItProtects:
      "A resident reading a translated commitment must see that a machine wrote it, without scrolling.",
    permission: ["convenience"],
    prohibition: ["Machine translation", "original", "official version"],
  },
  {
    id: "untranslated-disclosure",
    symbols: ["\"language.partialNotice\""],
    definedAt: "src/lib/engagement/portal-i18n/messages.ts (language.partialNotice, provenance.untranslated.*)",
    whatItProtects:
      "An English sentence inside a Spanish page is labelled, not read as something the agency chose to write in English.",
    permission: ["shown in"],
    prohibition: ["not yet translated", "has not published"],
  },
  {
    id: "navajo-human-only",
    symbols: ["MACHINE_TRANSLATION_UNAVAILABLE"],
    definedAt: "src/lib/engagement/translation-languages.ts",
    whatItProtects:
      "OpenPlan does not machine-translate into Diné Bizaad. Written by people, or not at all.",
    permission: ["written by people"],
    prohibition: ["does not machine-translate", "not dependable"],
  },
  {
    id: "moderated-before-public",
    symbols: ["\"page.submissionStatusDetail\""],
    definedAt: "src/lib/engagement/portal-i18n/messages.ts (page.submissionStatusDetail, page.defaultDescription)",
    whatItProtects:
      "A resident is told their words are reviewed before they appear. Reworded plainly is fine; dropped is a broken promise.",
    permission: ["appear", "used"],
    prohibition: ["reviewed before", "before they are", "reviews submissions"],
  },
  {
    id: "draft-not-adopted",
    symbols: [],
    definedAt: "src/app/(public)/legal/page.tsx + RTP packet state copy",
    whatItProtects:
      "Drafts, preset packets and preview pages are not substitutes for adopted records.",
    permission: ["adopted"],
    prohibition: ["not a substitute", "not before", "draft"],
  },
  {
    id: "unknown-is-not-zero",
    symbols: [],
    definedAt: "src/lib/**/read-failures.ts and every page that renders it",
    whatItProtects:
      "The distinction between “we could not read this” and “there is none”. Withheld, not zero.",
    permission: ["could not be read", "unavailable"],
    prohibition: ["not zero", "withheld", "not a statement that"],
  },
  {
    id: "ai-not-verified",
    symbols: [],
    definedAt: "src/app/(public)/legal/page.tsx",
    whatItProtects: "AI-drafted content is never presented as independently verified analysis.",
    permission: ["AI-drafted"],
    prohibition: ["must not be misrepresented", "not independently verified"],
  },
  {
    id: "agent-is-not-the-person",
    symbols: [],
    definedAt: "src/lib/assistant/agent-principal.ts + assistant-activity ledger copy",
    whatItProtects:
      "The planning agent is a distinct author, never the signed-in person. Copy may not blur who did a thing.",
    permission: ["proposed", "approved"],
    prohibition: ["assistant", "agent"],
  },
];

/**
 * Terms that MUST NOT be softened, as flat strings, for a quick membership
 * check. Every entry appears in a PROTECTED_CLAIMS token above; this is a
 * convenience view, not a second source.
 */
export const MUST_NOT_SOFTEN: readonly string[] = [
  "screening-grade",
  "not a forecast",
  "not comparable",
  "not calibrated",
  "not a CEQA determination",
  "Prototype-only",
  "Claim tier not recorded",
  "held back",
  "machine translation",
  "not yet translated",
  "reviewed before",
  "draft",
  "could not be read",
  "withheld",
  "AI-drafted",
];
