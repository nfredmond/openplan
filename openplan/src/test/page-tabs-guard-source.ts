import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import type { PageTabDefinition } from "@/lib/ui/page-tabs";
import { stripSourceComments } from "./helpers/source-text";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";
import { buildCampaignTabs } from "@/app/(app)/engagement/[campaignId]/_tabs";
import { buildRtpCycleTabs } from "@/app/(app)/rtp/[rtpCycleId]/_tabs";

/**
 * SHARED SOURCE READING FOR THE `page-tabs-guard-*` FILES.
 *
 * Not a test — vitest only collects `*.test.ts`, so this is a library the three
 * guards import. It exists because all three need the same two things and a
 * third copy of either would drift: the four tabbed pages as one list, and a
 * walk from a tab's PANEL to the element ids that panel can actually render.
 *
 * WHY A WALK AND NOT A TABLE. The sibling `page-tabs-anchors-have-elements`
 * proves a declared anchor's id exists SOMEWHERE in `src`. That is the weaker
 * half: an anchor declared on the Funding tab whose element is rendered by the
 * Delivery panel passes it, and a planner following the link arrives on Funding
 * looking at nothing. Answering "which panel renders this id" needs the import
 * graph, because a panel renders a component which renders a component which
 * carries the id. So the walk starts at the JSX inside one `<PageTabPanel>`,
 * follows every imported component tag it finds, and collects ids as it goes.
 *
 * WHAT THE WALK CANNOT SEE, stated because a guard whose limits are unwritten
 * gets trusted past them:
 *   - a component reached through a prop (`postureHeader={{…}}`) rather than a
 *     JSX tag, and one rendered by a `children` slot passed in from elsewhere;
 *   - an id built from a variable that is not a template literal;
 *   - anything past `WALK_DEPTH` levels of nesting.
 * All three fail SAFE in the same direction — the walk under-collects, so a
 * miss is reported as "this tab cannot reach its anchor" and a human looks.
 * The one thing it must never do is over-collect, which is why an unresolved
 * import is skipped rather than guessed at.
 */

const SRC = path.join(process.cwd(), "src");

/** Deep enough for page → tab component → panel → row card, which is the
 * deepest arrangement these four pages use today. */
const WALK_DEPTH = 8;

const NO_PROJECT_FAILURES = {
  overview: { reports: false, stageGates: false },
  delivery: { milestones: false, submittals: false },
  funding: { profile: false, awards: false, opportunities: false, invoices: false },
  evidence: { datasets: false, runs: false, aerial: false },
  record: { risks: false, issues: false, decisions: false, meetings: false },
};

const NO_CAMPAIGN_FAILURES = {
  categoriesUnreadable: false,
  itemsUnreadable: false,
  projectUnreadable: false,
  reportsUnreadable: false,
  reportSectionLinksUnreadable: false,
  rtpCycleUnreadable: false,
  rtpChapterUnreadable: false,
};

const NO_CYCLE_FAILURES = {
  overview: { packetReports: false, packetArtifacts: false },
  projects: { links: false },
  financial: { horizonBands: false, assumptions: false, measures: false },
  document: { chapters: false },
  comments: { campaigns: false, items: false },
};

export const REPORT_DETAIL_FILE = "app/(app)/reports/[reportId]/_components/report-standard-detail.tsx";

/** A source file's text with every comment blanked. Prose must never reach a
 * matcher; the shared stripper is where that decision lives. */
export function pageSource(relativePath: string): string {
  return stripSourceComments(readFileSync(path.join(SRC, relativePath), "utf8"));
}

/**
 * The strings inside the `[ … ]` that follows `opener`, in source order.
 *
 * `opener` is the literal text preceding the bracket — `anchors:` in a tab
 * entry, `const REPORT_HEADER_ANCHORS =` at the top level. Returns null when
 * the opener is absent, which a caller must treat as a BROKEN DERIVATION and
 * not as an empty list: this function's first version built the opener itself
 * and so looked for `anchors: = [`, found nothing, and handed back an empty
 * array that made two guards pass without reading a single anchor.
 */
export function stringArrayLiteral(source: string, opener: string): string[] | null {
  const at = source.indexOf(opener);
  if (at === -1) return null;
  const open = source.indexOf("[", at);
  const close = source.indexOf("]", open);
  if (open === -1 || close === -1) return null;
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * The report page's tabs, read out of the component that ships them.
 *
 * The other three pages export a `build*Tabs` function a test can call. This
 * one declares its tabs inline, and the two sibling suites each RESTATE the
 * list — a hand-written copy of the thing under test, which is exactly the
 * drift this lane was asked to close. Parsing it means renaming an anchor there
 * moves the guards with it instead of leaving them asserting last month's page.
 */
export function reportDetailTabsFromSource(): PageTabDefinition<string>[] {
  const source = pageSource(REPORT_DETAIL_FILE);
  const start = source.indexOf("const tabs: PageTabDefinition");
  if (start === -1) throw new Error("report-standard-detail no longer declares a `tabs` array");
  const end = source.indexOf("\n  ];", start);
  const block = source.slice(start, end === -1 ? undefined : end);

  const tabs: PageTabDefinition<string>[] = [];
  for (const match of block.matchAll(/key:\s*"([a-z-]+)"/g)) {
    const from = match.index ?? 0;
    const nextKey = block.slice(from + 1).search(/key:\s*"/);
    const entry = block.slice(from, nextKey === -1 ? undefined : from + 1 + nextKey);
    tabs.push({
      key: match[1],
      label: entry.match(/label:\s*"([^"]+)"/)?.[1] ?? match[1],
      anchors: stringArrayLiteral(entry, "anchors: [") ?? [],
      anchorPrefixes: stringArrayLiteral(entry, "anchorPrefixes: [") ?? [],
    });
  }
  return tabs;
}

/** The report header's anchors, read from the same component rather than
 * restated. See `REPORT_HEADER_ANCHORS` there for why they belong to no tab. */
export function reportHeaderAnchorsFromSource(): string[] {
  const anchors = stringArrayLiteral(pageSource(REPORT_DETAIL_FILE), "const REPORT_HEADER_ANCHORS = [");
  if (!anchors) throw new Error("report-standard-detail no longer declares REPORT_HEADER_ANCHORS");
  return anchors;
}

export type TabbedPage = {
  label: string;
  /** The route segment a deep link must start with to mean this page. */
  linkPrefix: string;
  /** The file that RENDERS the strip and the panels. */
  file: string;
  tabs: readonly PageTabDefinition<string>[];
  /** Anchors on chrome ABOVE the strip: on screen whichever tab is open. */
  pageAnchors: readonly string[];
};

/** The four URL-tabbed detail pages, with their real shipped tab definitions. */
export function tabbedPages(): TabbedPage[] {
  return [
    {
      label: "project detail",
      linkPrefix: "projects",
      file: "app/(app)/projects/[projectId]/page.tsx",
      tabs: buildProjectTabs(NO_PROJECT_FAILURES),
      pageAnchors: [],
    },
    {
      label: "engagement console",
      linkPrefix: "engagement",
      file: "app/(app)/engagement/[campaignId]/page.tsx",
      tabs: buildCampaignTabs(NO_CAMPAIGN_FAILURES),
      pageAnchors: [],
    },
    {
      label: "RTP cycle",
      linkPrefix: "rtp",
      file: "app/(app)/rtp/[rtpCycleId]/page.tsx",
      tabs: buildRtpCycleTabs(NO_CYCLE_FAILURES),
      pageAnchors: [],
    },
    {
      label: "report detail",
      linkPrefix: "reports",
      file: REPORT_DETAIL_FILE,
      tabs: reportDetailTabsFromSource(),
      pageAnchors: reportHeaderAnchorsFromSource(),
    },
  ];
}

/** Every `.ts`/`.tsx` under `src`, tests excluded — a fixture URL is not a link
 * a planner can follow, and several tests use deliberately made-up ids. */
export function shippedSourceFiles(dir: string = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test") continue;
      shippedSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

export type AnchorLink = {
  /** The file that emits it, relative to `src`. */
  file: string;
  /** The whole matched href, for a failure message someone can act on. */
  href: string;
  /** The route segment the link opens: `projects`, `reports`, … */
  linkPrefix: string;
  /** The literal part of the fragment, up to any interpolation. */
  head: string;
  /** True when the fragment runs on into `${…}` — a per-row id. */
  interpolated: boolean;
};

/**
 * Every `/<linkPrefix>/…#anchor` link the product emits.
 *
 * Template literals matter as much as plain strings — `/projects/${id}#project-invoices`
 * is the common spelling here, and a pattern that stopped at `{` would walk
 * past nearly all of them. A fragment whose tail is itself interpolated
 * (`#artifact-${artifact.id}`) is returned with `interpolated: true` and its
 * literal head, because the two are claimed differently: a head by a tab's
 * `anchorPrefixes`, a whole id by its `anchors`.
 */
export function anchorLinks(linkPrefix: string): AnchorLink[] {
  const pattern = new RegExp("/" + linkPrefix + "/[^\\s\"'`]*?#([a-z][a-z0-9-]*)(\\$\\{)?", "g");
  const found: AnchorLink[] = [];

  for (const file of shippedSourceFiles()) {
    // Comments first, always. A route file DOCUMENTS the shape
    // `/reports/{id}#artifact-{id}` in its header, and prose reaching a matcher
    // is a defect this repo has shipped in both directions.
    const text = stripSourceComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(pattern)) {
      found.push({
        file: path.relative(SRC, file),
        href: match[0],
        linkPrefix,
        head: match[1],
        interpolated: Boolean(match[2]),
      });
    }
  }
  return found;
}

export type PanelSource = { tabKey: string; openTag: string; body: string };

/**
 * Every `<PageTabPanel …>…</PageTabPanel>` in a page, in source order.
 *
 * The panels do not nest, so the matching close tag is simply the next one.
 */
export function panelsOf(source: string): PanelSource[] {
  const panels: PanelSource[] = [];
  const opening = /<PageTabPanel\s+tabKey="([a-z-]+)"([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(source))) {
    const bodyStart = opening.lastIndex;
    const bodyEnd = source.indexOf("</PageTabPanel>", bodyStart);
    panels.push({
      tabKey: match[1],
      openTag: match[0],
      body: source.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd),
    });
  }
  return panels;
}

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Component name → the file it comes from, for one file's own imports. Type
 * imports are skipped: a type renders nothing. */
function componentImports(file: string, source: string): Map<string, string> {
  const imports = new Map<string, string>();

  for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    if (match[1]) continue;
    const target = resolveImport(file, match[3]);
    if (!target) continue;
    for (const clause of match[2].split(",")) {
      const trimmed = clause.trim();
      if (!trimmed || trimmed.startsWith("type ")) continue;
      const name = trimmed.split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Z]/.test(name)) imports.set(name, target);
    }
  }
  for (const match of source.matchAll(/import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+"([^"]+)"/g)) {
    const target = resolveImport(file, match[2]);
    if (target) imports.set(match[1], target);
  }
  return imports;
}

export type RenderedIds = { exact: Set<string>; templatePrefixes: Set<string> };

/**
 * The element ids written in one chunk of JSX.
 *
 * `id="x"` is an anchor. `id={`x-${row.id}`}` contributes the literal head `x-`,
 * which is what a tab's `anchorPrefixes` claims. An attribute merely ENDING in
 * `id` counts too (`anchorId="x"`), because a component that takes its anchor
 * as a prop spells the id only at its call site. `data-testid` deliberately
 * does not count — it is not an anchor, and treating one as an anchor is the
 * defect `page-tabs-anchors-have-elements` was written for.
 */
function idsIn(text: string, into: RenderedIds): void {
  for (const match of text.matchAll(/\sid="([a-z][a-z0-9-]*)"/g)) into.exact.add(match[1]);
  for (const match of text.matchAll(/\s[A-Za-z]*[iI]d=\{`([a-z][a-z0-9-]*)\$\{/g)) {
    into.templatePrefixes.add(match[1]);
  }
  for (const match of text.matchAll(/\s[A-Za-z]+[iI]d=\{?"([a-z][a-z0-9-]*)"\}?/g)) {
    into.exact.add(match[1]);
  }
}

function walkFile(file: string, into: RenderedIds, seen: Set<string>, depth: number): void {
  if (depth > WALK_DEPTH || seen.has(file)) return;
  seen.add(file);

  const source = stripSourceComments(readFileSync(file, "utf8"));
  idsIn(source, into);

  const imports = componentImports(file, source);
  for (const match of source.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) {
    const target = imports.get(match[1]);
    if (target) walkFile(target, into, seen, depth + 1);
  }
}

/**
 * Every element id reachable from one tab's panel: the ids written inside the
 * panel itself, plus those of every component the panel renders, transitively.
 *
 * Call it with the panel's own body and the page file it lives in.
 */
export function idsReachableFromPanel(pageFile: string, panel: PanelSource): RenderedIds {
  const absolute = path.join(SRC, pageFile);
  const pageText = stripSourceComments(readFileSync(absolute, "utf8"));
  const imports = componentImports(absolute, pageText);

  const found: RenderedIds = { exact: new Set(), templatePrefixes: new Set() };
  idsIn(panel.body, found);

  // The page file itself is marked seen so a sibling panel's ids are not swept
  // in: the whole point is to tell one panel's ids from another's.
  const seen = new Set<string>([absolute]);
  for (const match of panel.body.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) {
    const target = imports.get(match[1]);
    if (target) walkFile(target, found, seen, 1);
  }
  return found;
}

/** True when some id this panel can render would match `prefix`. */
export function prefixReachable(found: RenderedIds, prefix: string): boolean {
  if ([...found.templatePrefixes].some((head) => head.startsWith(prefix))) return true;
  return [...found.exact].some((id) => id.startsWith(prefix) && id.length > prefix.length);
}
