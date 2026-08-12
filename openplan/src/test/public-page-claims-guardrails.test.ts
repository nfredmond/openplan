import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "./helpers/source-text";

/**
 * Public-page claim guard.
 *
 * ============================================================================
 * THE FILE LIST IS DERIVED, BECAUSE A HAND-LISTED ONE MISSES THE NEXT PAGE
 * ============================================================================
 *
 * It used to be six paths typed into a const. `src/app/(public)` has since
 * grown five more surfaces — the engagement portal, two plan pages, and the
 * measure oversight record — and none of them were ever added, so none of them
 * was guarded. On 2026-08-12 a reviewer rewrote the measure page's standing
 * note to say the figures "are the agency's audited financial statement and its
 * official accounting… complete and final", and 10,280 tests passed. That is
 * the whole class: not a missing pattern, a missing FILE.
 *
 * So the list is walked out of the route directory. A new page under
 * `src/app/(public)` is covered the day it is created, by nobody remembering
 * anything.
 *
 * ============================================================================
 * AND IT FOLLOWS THE COPY OFF THE PAGE
 * ============================================================================
 *
 * Deriving the pages alone would still have missed that overclaim, because the
 * measure page renders `MEASURE_OVERSIGHT_COPY.preparedNote` and the words live
 * in `src/lib/measures/oversight.ts`. Copy constants in a separate module are
 * good practice — the whole point is that the words a member of the public
 * reads are reviewable in one place — and a guard that reads only the page file
 * cannot see them.
 *
 * So each public page's own first-party imports are scanned too, one level
 * deep. One level rather than transitively: it reaches the copy module a page
 * imports for its words, which is the real pattern, without dragging in the
 * whole dependency graph and every engineering paragraph in it.
 *
 * COMMENTS ARE STRIPPED FIRST, by the shared tested stripper. Following imports
 * pulls in modules whose HEADERS argue at length about calibration, validated
 * forecasting and audited figures — because arguing about them is how this
 * repository records why it refuses to claim them. A guard that matched those
 * would fail on the very paragraphs that keep it honest. `stripSourceComments`
 * exists for this exact failure, in both directions (`prose-is-not-the-artifact`).
 *
 * WHAT THIS STILL CANNOT SEE, stated rather than implied: copy assembled at
 * runtime, and copy two modules away. The live-surface guard for the measure
 * page is `measure-oversight-public-page.test.tsx`, which renders the real page
 * and applies these same patterns to the HTML a reader actually gets. This file
 * is the cheap net that covers every public page; that one is the deep net over
 * the page whose figures are money.
 *
 * POSTURE FLIP (2026-07-23). OpenPlan is self-serve, free, and open source. The
 * earlier "request-access / founder fit-review / not self-serve" posture was
 * introduced unintentionally and is reversed (see CLAUDE.md). This guard was
 * rewritten in step with the public pages — per the sequencing rule, the
 * capability landed first (sign-up + auto-provisioned workspace, teammate
 * invites, password recovery), then the claims changed, then this guard was
 * rewritten to assert the NEW truth. It was NOT deleted: a module with no claim
 * guard is how overclaiming comes back, now pointing the other way.
 *
 * Two things this still guards, because they remain true and must not be
 * overclaimed:
 *   1. The modeling is screening-grade. No calibrated/validated forecasting,
 *      no grant-award prediction, no autonomous planning.
 *   2. The product is FREE. There is no paid tier and no checkout, so a
 *      subscription/checkout CTA is still prohibited — not because access is
 *      gated, but because nothing charges the user.
 *
 * `sales-proof-claim-boundaries.test.ts` is deliberately untouched: it guards
 * DATED proof documents in docs/, which were accurate as of their date. Editing
 * a dated record to match today's posture would falsify it.
 */

const PUBLIC_ROUTE_DIR = "src/app/(public)";
const API_ROUTE_DIR = "src/app/api";

/** Every `page.tsx` and `layout.tsx` under the public route group. */
function derivePublicRouteFiles(relativeDir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(process.cwd(), relativeDir), { withFileTypes: true })) {
    const relative = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) found.push(...derivePublicRouteFiles(relative));
    else if (entry.name === "page.tsx" || entry.name === "layout.tsx") found.push(relative);
  }
  return found.sort();
}

/**
 * EVERY API ROUTE THAT ANSWERS WITH A WHOLE HTML DOCUMENT.
 *
 * ============================================================================
 * THE SAME MISSING-FILE CLASS, ONE DIRECTORY OVER
 * ============================================================================
 *
 * Deriving `src/app/(public)` fixed the pages. It did nothing for the DOCUMENTS
 * this product publishes, and on 2026-08-12 the measure fund's annual statement
 * — a document a citizens' oversight committee downloads, prints and files —
 * was found outside the corpus entirely, along with the module its every word
 * comes from. Same reader, same money, no net. A document is if anything the
 * more dangerous surface: a page can be reloaded and corrected, and a statement
 * in a committee packet cannot.
 *
 * The rule is mechanical rather than remembered: a route that sets a
 * `text/html` content type is serving a document to a person, and a new one is
 * covered the day it is written. Routes that answer JSON are not scanned — a
 * client renders those and the client is a page, which is already in the list.
 */
function deriveHtmlDocumentRoutes(relativeDir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(process.cwd(), relativeDir), { withFileTypes: true })) {
    const relative = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...deriveHtmlDocumentRoutes(relative));
    } else if (entry.name === "route.ts") {
      const source = readFileSync(path.join(process.cwd(), relative), "utf8");
      // Both spellings a header can take. Comments are NOT stripped first on
      // purpose: this decides membership, and a route that only discusses HTML
      // costs one extra scanned file, while a missed one costs the whole class
      // above.
      if (/["']content-type["']\s*[:,]\s*["']text\/html/i.test(source)) found.push(relative);
    }
  }
  return found.sort();
}

/**
 * The first-party modules a file imports, resolved to real paths.
 *
 * `@/…` only. A package from `node_modules` is not this repository's claim to
 * make, and following one would scan a dependency's changelog.
 */
function firstPartyImportsOf(relativeFile: string): string[] {
  const source = readFileSync(path.join(process.cwd(), relativeFile), "utf8");
  const resolved: string[] = [];
  for (const match of source.matchAll(/from\s+"(@\/[^"]+)"/g)) {
    const base = path.join(process.cwd(), "src", match[1].slice("@/".length));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (existsSync(candidate)) {
        resolved.push(path.relative(process.cwd(), candidate).split(path.sep).join("/"));
        break;
      }
    }
  }
  return resolved;
}

const PUBLIC_PAGE_FILES = derivePublicRouteFiles(PUBLIC_ROUTE_DIR);
const PUBLIC_DOCUMENT_ROUTES = deriveHtmlDocumentRoutes(API_ROUTE_DIR);

/** Every surface a person reads directly: the public pages and the HTML documents. */
const PUBLIC_SURFACE_FILES = [...PUBLIC_PAGE_FILES, ...PUBLIC_DOCUMENT_ROUTES];

/** Those, plus one level deep, the modules they get their words from. */
const PUBLIC_COPY_SOURCES = [
  ...new Set([...PUBLIC_SURFACE_FILES, ...PUBLIC_SURFACE_FILES.flatMap(firstPartyImportsOf)]),
].sort();

/** The front door: hero + header CTAs must lead with self-serve sign-up. */
const LANDING_PAGE = "src/app/(public)/page.tsx";
const PUBLIC_LAYOUT = "src/app/(public)/layout.tsx";

const PROHIBITED_PUBLIC_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  // Still prohibited — the product is free, so there is nothing to buy. This
  // enforces "no payment step", not "no self-serve".
  {
    label: "paid subscription or checkout CTA (product is free)",
    pattern: /\b(?:subscribe now|start(?: your)? subscription|start(?: your)? free trial|buy now|checkout now|launch checkout|create (?:starter|professional|paid) account|activate(?: your)? subscription|enter (?:card|payment)|billing required)\b/i,
  },
  // The modeling honesty boundary is unchanged: screening-grade only.
  {
    label: "autonomous grant, legal, or compliance work",
    pattern: /\bautonomous\b.{0,80}\b(?:grant|legal|lapm|compliance|permitting|approval|decision|award|application)\b/i,
  },
  {
    label: "legal-grade or compliance-grade automation",
    pattern: /\b(?:legal|lapm|compliance|regulatory)[- ]grade\b.{0,80}\b(?:automation|approval|certification|review|sign[- ]off|determination)\b/i,
  },
  {
    label: "guaranteed grant award or funding outcome",
    pattern: /\b(?:guarantee(?:d|s)?|ensure(?:s|d)?|promise(?:s|d)?|will win|win more)\b.{0,80}\b(?:grant|award|funding|reimbursement|allocation)\b/i,
  },
  {
    label: "validated award or ridership prediction claim",
    pattern: /\b(?:predict(?:s|ed|ion)?|forecast(?:s|ed)?|score(?:s|d)?)\b.{0,80}\b(?:award likelihood|grant success|funding outcome|reimbursement approval|ridership|traffic volume|vmt)\b/i,
  },
  {
    label: "calibrated or validated forecasting availability",
    pattern: /\b(?:calibrated|validated|certified|planning[- ]grade)\b.{0,80}\b(?:forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)\b.{0,80}\b(?:ready|available|supported|provided|included|delivered|built in|built-in)\b/i,
  },
  {
    label: "forecasting accuracy or calibration proof",
    pattern: /\b(?:proves?|guarantees?|certifies?|validates?)\b.{0,80}\b(?:forecast(?:ing)? accuracy|model calibration|traffic volume forecast|ridership forecast|vmt forecast)\b/i,
  },
  /*
   * ==========================================================================
   * THE MONEY SURFACES — added 2026-08-12 with the measure oversight page
   * ==========================================================================
   *
   * A public measure page shows what a voter-approved tax received and where it
   * went, and its reader is a citizens' oversight committee with no account and
   * no other copy of the figures. The dangerous claim there is not about
   * modeling: it is about STATUS. "These are the audited figures" and "this is
   * the agency's official accounting" say a licensed auditor and the finance
   * department stand behind numbers that in fact came out of whatever staff
   * typed into OpenPlan, and "complete and final" says a committee may stop
   * asking what is missing — on a page whose own coverage sentences exist to
   * say what is missing.
   *
   * The page's real standing note says the opposite of all three, in as many
   * words, which is why the negation stripper below has to learn this
   * vocabulary at the same time. A guard that fired on the caveat would be
   * deleted within a week, and the caveat with it.
   */
  {
    label: "an audit, or an official accounting, that this is not",
    pattern: /\b(?:is|are|as)\b[^.\n]{0,40}\b(?:audited|official)\b[^.\n]{0,40}\b(?:financial statement|accounting|record of account|books)\b/i,
  },
  {
    label: "figures presented as certified or independently verified",
    pattern: /\b(?:these|the|this)\b[^.\n]{0,30}\b(?:figures?|amounts?|totals?|numbers?)\b[^.\n]{0,40}\b(?:are|is|have been|has been)\b[^.\n]{0,30}\b(?:certified|audited|independently verified|reconciled|attested)\b/i,
  },
  {
    label: "a public money record presented as complete and final",
    pattern: /\b(?:complete and final|final and complete|a complete (?:and (?:final|accurate) )?(?:record|accounting|statement)|the full and final)\b/i,
  },
  {
    label: "a guarantee of accuracy on public figures",
    pattern: /\b(?:guarantee(?:d|s)?|warrant(?:ed|s)?)\b[^.\n]{0,50}\b(?:accura(?:te|cy)|correct(?:ness)?|complete(?:ness)?)\b/i,
  },
];

/**
 * The part of a source file that can reach a reader.
 *
 * Comments are not the artifact. Following imports reaches modules whose
 * headers argue at length about audited figures and calibrated models —
 * arguing about them is how this repository records why it refuses to claim
 * them — and a guard that matched those paragraphs would fail on the very
 * prose that keeps it honest.
 *
 * NO FILE IN THE CORPUS NEEDS THIS TODAY: with the stripping removed, every
 * case below still passes, so it is protection against a case that has not
 * arrived rather than a fix for one that has. It is a named function with its
 * own test for exactly that reason — an unexercised mechanism nobody can see is
 * how the next reader deletes it as dead weight.
 */
export function scannablePublicText(source: string): string {
  return stripSourceComments(source);
}

function publicPageSource(file: string) {
  return scannablePublicText(readFileSync(path.join(process.cwd(), file), "utf8"));
}

/**
 * Sentences that state the boundary are removed before the patterns run.
 *
 * A caveat and an overclaim share their vocabulary and differ by a negation, so
 * a guard that cannot tell them apart forces the caveat off the page. The two
 * vocabularies are kept in step here: the modeling one, and the money one added
 * with the measure oversight record.
 */
const MODELING_VOCABULARY =
  "calibrated|validated|certified|planning[- ]grade|forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt";
const MONEY_STATUS_VOCABULARY =
  "audited|official accounting|complete and final|certified|guaranteed|attested|independently verified";
/**
 * Added 2026-08-12 with the HTML documents, and for the reason the header
 * gives: the corpus widened and the very first new file it reached,
 * `src/lib/rtp/export-input.ts`, tripped the "autonomous … approval" pattern on
 * a constant named `FUNDING_SOURCE_CONTEXT_OPERATOR_CAVEAT` whose whole content
 * is "it is not legal compliance automation, award prediction, or autonomous
 * approval." A guard that makes somebody delete THAT sentence to go green has
 * inverted itself. The vocabularies move together with the corpus, always.
 */
const AUTONOMY_VOCABULARY =
  "autonomous(?:ly)?|compliance automation|award prediction|unsupervised|without (?:human|operator) review";
const NEGATIONS = "no|not|never|without|do not|does not|cannot|isn[’']t|aren[’']t|neither|nor|rather than|instead of";

function sourceWithoutExplicitCaveats(source: string) {
  return source
    .replace(new RegExp(`[^.\\n]*(?:${NEGATIONS})[^.\\n]*\\b(?:${MODELING_VOCABULARY})\\b[^.\\n]*`, "gi"), "")
    .replace(
      new RegExp(
        `[^.\\n]*\\b(?:screening[- ]grade|prototype[- ]only|internal prototype only|caveat|supervised review|qualified reviewer)[^.\\n]*\\b(?:${MODELING_VOCABULARY})\\b[^.\\n]*`,
        "gi"
      ),
      ""
    )
    .replace(new RegExp(`[^.\\n]*(?:${NEGATIONS})[^.\\n]*\\b(?:${MONEY_STATUS_VOCABULARY})\\b[^.\\n]*`, "gi"), "")
    .replace(new RegExp(`[^.\\n]*(?:${NEGATIONS})[^.\\n]*\\b(?:${AUTONOMY_VOCABULARY})\\b[^.\\n]*`, "gi"), "");
}

/** Exported so the live-surface guards apply the same patterns to rendered HTML. */
export { PROHIBITED_PUBLIC_CLAIMS, sourceWithoutExplicitCaveats };

describe("public page claims guardrails", () => {
  /**
   * The derivation itself is asserted, because a walk that silently returned
   * nothing would make every case below vacuously green — the failure mode of
   * every list-driven guard. The floor is the six pages this file was written
   * for plus the four surfaces it had never heard of.
   */
  it("derives the public surfaces from the route directory rather than a hand-kept list", () => {
    expect(PUBLIC_PAGE_FILES).toContain("src/app/(public)/page.tsx");
    // The four that a hand-kept list had missed for months.
    expect(PUBLIC_PAGE_FILES).toContain("src/app/(public)/measure/[shareToken]/page.tsx");
    expect(PUBLIC_PAGE_FILES).toContain("src/app/(public)/engage/[shareToken]/page.tsx");
    expect(PUBLIC_PAGE_FILES).toContain("src/app/(public)/plan/[shareToken]/page.tsx");
    expect(PUBLIC_PAGE_FILES).toContain("src/app/(public)/plan/[shareToken]/document/page.tsx");
    expect(PUBLIC_PAGE_FILES.length).toBeGreaterThanOrEqual(10);

    // And the copy modules the pages import, which is where the words actually
    // are: the measure page renders MEASURE_OVERSIGHT_COPY from this module.
    expect(PUBLIC_COPY_SOURCES).toContain("src/lib/measures/oversight.ts");
    expect(PUBLIC_COPY_SOURCES).toContain("src/lib/engagement/portal-i18n/messages.ts");
  });

  /**
   * The documents, derived the same way. The measure fund's annual statement is
   * the one that proved this was missing: a committee-facing document served
   * from `src/app/api`, whose every word lives in a module no public page
   * imports, and therefore in nothing this file scanned.
   */
  it("derives the HTML documents it serves as well as the pages it renders", () => {
    expect(PUBLIC_DOCUMENT_ROUTES).toContain("src/app/api/measures/[measureId]/statement/route.ts");
    expect(PUBLIC_DOCUMENT_ROUTES.length).toBeGreaterThanOrEqual(4);
    // The words themselves, one level in — the file the statement's copy is in.
    expect(PUBLIC_COPY_SOURCES).toContain("src/lib/measures/oversight-statement.ts");
  });

  it.each(PUBLIC_COPY_SOURCES)("keeps %s out of paid-checkout, modeling and audit-status overclaim", (file) => {
    const source = sourceWithoutExplicitCaveats(publicPageSource(file));

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(source, `${file} contains prohibited public claim: ${label}`).not.toMatch(pattern);
    }
  });

  /**
   * THE CAVEAT MUST SURVIVE ITS OWN GUARD. The measure page's standing note
   * says, in as many words, that the page is not an audited financial statement
   * and not the agency's official accounting. If a future pattern were written
   * without the negation stripper, that sentence would be the first casualty —
   * and deleting a caveat to make a claim guard pass is the exact inversion the
   * guard exists to prevent.
   */
  /**
   * A paragraph ABOUT a claim is not the claim. The two lines below are the
   * shape every module header in this corpus is written in, and both would trip
   * a pattern if they reached the matcher.
   */
  it("reads what a page renders, not what its author wrote about it", () => {
    const source = [
      "/** These figures are the agency's audited financial statement. NEVER say this. */",
      'const copy = "These figures come from the records the agency has entered.";',
      "// A guarantee of accuracy is prohibited on this surface.",
    ].join("\n");
    const scanned = sourceWithoutExplicitCaveats(scannablePublicText(source));

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(scanned, `a comment reached the matcher: ${label}`).not.toMatch(pattern);
    }
    // And the code itself survived the stripping — a stripper that blanked
    // everything would pass the loop above for the wrong reason.
    expect(scanned).toContain("These figures come from the records the agency has entered.");
  });

  it("does not fire on the sentence that states the boundary", () => {
    const boundary =
      "This page is not an audited financial statement and it is not the agency's official " +
      "accounting — it is a running view of what has been recorded, shown so it can be checked.";
    const stripped = sourceWithoutExplicitCaveats(boundary);

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(stripped, `the boundary sentence tripped: ${label}`).not.toMatch(pattern);
    }
  });

  /**
   * THE SAME PROPERTY FOR THE VOCABULARY THE DOCUMENTS BROUGHT IN. This exact
   * sentence is what the RTP export packet prints beside its funding scan, and
   * it is the sentence a widened corpus would otherwise have got deleted.
   */
  it("does not fire on the sentence that refuses autonomy", () => {
    const boundary =
      "Operator review required. This funding/source-context scan supports planning packet review only; " +
      "it is not legal compliance automation, award prediction, or autonomous approval.";
    const stripped = sourceWithoutExplicitCaveats(boundary);

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(stripped, `the autonomy boundary sentence tripped: ${label}`).not.toMatch(pattern);
    }
    // And the claim itself, without the negation, still trips — otherwise the
    // stripper above has simply switched the pattern off.
    expect(sourceWithoutExplicitCaveats("OpenPlan performs autonomous grant approval.")).toMatch(
      PROHIBITED_PUBLIC_CLAIMS.find((claim) => claim.label.startsWith("autonomous"))!.pattern
    );
  });

  it("leads the front door with self-serve sign-up, not a founder access queue", () => {
    const landing = publicPageSource(LANDING_PAGE);
    const layout = publicPageSource(PUBLIC_LAYOUT);

    // The hero and header must offer real sign-up.
    expect(landing).toMatch(/\/sign-up/);
    expect(layout).toMatch(/\/sign-up/);
    // And state the posture plainly: free, immediate, no gate.
    expect(landing).toMatch(/free/i);
    expect(landing).toMatch(/immediately|no access queue|no founder|ready immediately/i);

    // The front door must NOT route software access through the request-access
    // queue. (The /request-access page may still exist for services inquiries —
    // this asserts the LANDING hero and header do not lead with it.)
    expect(landing).not.toMatch(/href="\/request-access[^"]*"\s+className="public-primary-link"/);
    expect(layout).not.toMatch(/href="\/request-access"/);
  });

  it("does not reinstate a founder gate as the way to reach the software", () => {
    // The reversed overclaim to guard against now: telling a visitor they must
    // be reviewed or approved before they can use OpenPlan. Services fit-review
    // language is fine; gating the SOFTWARE behind approval is not.
    const combined = PUBLIC_COPY_SOURCES.map(publicPageSource).join("\n");
    expect(combined).not.toMatch(/\b(?:request|apply for|wait for)\b[^.\n]{0,60}\baccess\b[^.\n]{0,60}\b(?:before you can|to use|to sign in|to get into)\b[^.\n]{0,40}\b(?:openplan|the (?:app|software|workspace))\b/i);
    expect(combined).not.toMatch(/\bfounder\b[^.\n]{0,40}\b(?:approval|review|fit)\b[^.\n]{0,40}\b(?:required|before)\b/i);
  });

  it("keeps public modeling language inside screening-grade and supervised-review boundaries", () => {
    const combinedPublicSource = PUBLIC_COPY_SOURCES.map(publicPageSource).join("\n");
    const caveatStrippedSource = sourceWithoutExplicitCaveats(combinedPublicSource);

    expect(combinedPublicSource).toMatch(/screening[- ]grade/i);
    expect(caveatStrippedSource).not.toMatch(/\b(?:calibrated|validated|certified|planning[- ]grade)\b.{0,120}\b(?:forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)\b/i);
  });

  it("keeps the free/open-source posture explicit on the landing page", () => {
    const landing = publicPageSource(LANDING_PAGE);
    expect(landing).toMatch(/open[- ]source/i);
    expect(landing).toMatch(/no payment|free and open source|free/i);
  });
});

/**
 * ============================================================================
 * MUTATION LOG for the document corpus — 2026-08-12
 * ============================================================================
 *
 * BASELINE 392 passed across this file and the three measure-oversight suites.
 * NEGATIVE CONTROL: a throwaway failing assertion in
 * `measure-oversight-routes.test.ts` exited 1, and removing it exited 0.
 *
 *  G1 `deriveHtmlDocumentRoutes` replaced with an empty array — the vacuous
 *     failure mode every list-driven guard has, and the one that let a whole
 *     committee-facing document sit outside this corpus. The derivation test
 *     fails. Note what happens to the corpus at the same time: 72 scanned files
 *     back down to 47, i.e. 25 fewer `it.each` cases, all of them green by
 *     absence. That is the shape of the original defect — fewer tests, nothing
 *     red, nobody the wiser.
 *  G2 the `AUTONOMY_VOCABULARY` strip removed. 2 fail — `src/lib/rtp/
 *     export-input.ts` trips the autonomy pattern on a constant literally named
 *     `FUNDING_SOURCE_CONTEXT_OPERATOR_CAVEAT`, and the boundary test fails
 *     with it. That is the guard-eats-its-own-caveat failure, caught the day
 *     the corpus widened rather than a week later when somebody deleted the
 *     sentence to go green.
 *
 * 2 mutations, 2 killed.
 */
