/**
 * A PLANNER MAY NOT BE HANDED A DATABASE ERROR OR AN ENV VAR THEY CANNOT SET.
 *
 * `read-failures.ts` has always been explicit that `messages()` is the
 * DATABASE'S OWN TEXT, addressed to whoever operates the deployment. The public
 * plan pages honour that. Ten internal pages did not: they rendered
 * `${reads.describe()} ${reads.messages().join(" · ")}` — so the sentence a
 * planner reads ended in `column projects.assignee_user_id does not exist`. The
 * same defect wore other clothes elsewhere: CRON_SECRET, a migration number, a
 * Supabase service-role key and NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN all appeared in
 * copy written for a planner.
 *
 * The fix moves detail; it deletes nothing. So this file asserts BOTH halves
 * on every surface, because either one alone is satisfiable by the wrong fix:
 *
 *   1. the operator's text is still on the page and reachable — inside a
 *      `<details>` whose summary names who it is for (deleting the fact would
 *      pass a test that only checked the planner's line was clean);
 *   2. the planner's line carries no plumbing AND names something a planner can
 *      actually do (hiding everything would pass a test that only checked the
 *      operator's copy survived).
 *
 * `plannerText` deliberately strips `<details>` subtrees rather than trusting
 * `toHaveTextContent`, which sees hidden content: the whole claim here is about
 * what is in front of the reader before they open anything.
 *
 * MUTATION-VERIFIED 2026-08-12 — each reverted after; see the report for which
 * mutation produced which failure.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/my-work",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("mapbox-gl", () => {
  const instance = {
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    addControl: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    isStyleLoaded: vi.fn(() => false),
    getLayer: vi.fn(() => null),
    getSource: vi.fn(() => null),
    getStyle: vi.fn(() => ({ layers: [] })),
    setLayoutProperty: vi.fn(),
    fitBounds: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
  };
  const Map = vi.fn(function MockMap() {
    return instance;
  });
  const ctl = vi.fn(function MockControl() {
    const self = {
      setLngLat: vi.fn(() => self),
      setPopup: vi.fn(() => self),
      setDOMContent: vi.fn(() => self),
      addTo: vi.fn(() => self),
      extend: vi.fn(() => self),
      isEmpty: vi.fn(() => false),
      remove: vi.fn(),
    };
    return self;
  });
  return {
    default: {
      Map,
      NavigationControl: ctl,
      FullscreenControl: ctl,
      ScaleControl: ctl,
      Popup: ctl,
      Marker: ctl,
      LngLatBounds: ctl,
      accessToken: "",
    },
    Map,
    NavigationControl: ctl,
    FullscreenControl: ctl,
    ScaleControl: ctl,
    Popup: ctl,
    Marker: ctl,
    LngLatBounds: ctl,
  };
});

import {
  ReadFailureNotice,
  OPERATOR_DETAIL_SUMMARY,
  READ_FAILURE_PLANNER_ACTION,
} from "@/components/ui/read-failure-notice";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { MyWorkBoard } from "@/components/my-work/my-work-board";
import { WorkNotificationInboxPanel } from "@/components/my-work/notification-inbox";
import { loadWorkNotifications, type WorkNotificationInbox } from "@/lib/notifications/work";
import { FakeWorkDb } from "./helpers/fake-work-notification-tables";
import { loadSeededMyWork, ROSTER } from "./helpers/fake-my-work-tables";

const APP_ROOT = path.join(process.cwd(), "src");

/**
 * Everything the reader sees WITHOUT opening a disclosure. The `<details>`
 * subtrees are removed from a clone, because jsdom keeps their text in
 * `textContent` and an assertion that misses that would pass on the very
 * concatenation this file exists to forbid.
 */
function plannerText(root: HTMLElement = document.body): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const details of Array.from(clone.querySelectorAll("details"))) {
    details.remove();
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Everything folded away for whoever runs the deployment. */
function operatorText(root: HTMLElement = document.body): string {
  return Array.from(root.querySelectorAll("details"))
    .map((details) => (details.textContent ?? "").replace(/\s+/g, " ").trim())
    .join(" ");
}

/**
 * The disclosure has to be closed (otherwise "folded away" is a lie), and its
 * summary has to say who it is for (otherwise a planner has no way to know the
 * contents are not addressed to them).
 */
function expectClosedAndLabelled(root: HTMLElement = document.body) {
  const disclosures = Array.from(root.querySelectorAll("details"));
  expect(disclosures.length).toBeGreaterThan(0);
  for (const details of disclosures) {
    expect(details.hasAttribute("open")).toBe(false);
    const summary = details.querySelector("summary");
    expect(summary?.textContent ?? "").toMatch(/whoever runs this deployment/i);
  }
}

/**
 * A planner-facing sentence that only says something is broken is a dead end.
 * Each of these surfaces has to name a move: reload it, or ask the person who
 * runs the deployment.
 */
const PLANNER_CAN_ACT = /whoever runs this (?:openplan|deployment)|reload|ask whoever/i;

const ALICE = "aaaaaaaa-0000-4000-8000-00000000000a";

async function inboxFrom(rows: Array<Record<string, unknown>>, error?: { message: string }) {
  const db = new FakeWorkDb({
    tables: { work_notifications: rows },
    errors: error ? { work_notifications: error } : {},
  });
  return loadWorkNotifications(db, ALICE);
}

function renderInbox(inbox: WorkNotificationInbox, sweepConfigured = true) {
  return render(<WorkNotificationInboxPanel inbox={inbox} sweepConfigured={sweepConfigured} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── The shared notice ────────────────────────────────────────────────────────

describe("ReadFailureNotice", () => {
  function failedLog() {
    const reads = new ReadFailureLog();
    reads.check("linked plans", { error: { message: 'column "plan_links.title" does not exist' } });
    reads.check("scenario options", { error: { message: "permission denied for table scenarios" } });
    return reads;
  }

  it("renders nothing when every read succeeded", () => {
    const reads = new ReadFailureLog();
    reads.check("linked plans", { data: [] });
    const { container } = render(<ReadFailureNotice reads={reads} />);
    expect(container.innerHTML).toBe("");
  });

  it("puts describe() in front of the planner and messages() behind the disclosure", () => {
    const reads = failedLog();
    render(<ReadFailureNotice reads={reads} />);

    const planner = plannerText();
    // The whole point: the planner is told which parts of the page to
    // disbelieve, in the words `describe()` chose.
    expect(planner).toContain("could not read linked plans and scenario options");
    expect(planner).toContain("would not mean the records are absent");

    // RULE #2 APPLIES TO THE DEFAULT, not only to the surfaces that pass their
    // own sentence. `describe()` names what to disbelieve and stops there, and
    // every other assertion in this file would have stayed green on a notice
    // that left its reader with nothing to try.
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).toContain(READ_FAILURE_PLANNER_ACTION);

    // And is not handed the database's own text.
    expect(planner).not.toContain("does not exist");
    expect(planner).not.toContain("permission denied");

    // Which is still on the page, in full, for the person who can act on it.
    const operator = operatorText();
    for (const message of reads.messages()) {
      expect(operator).toContain(message);
    }
    expectClosedAndLabelled();
  });

  it("exports the summary it labels the disclosure with", () => {
    render(<ReadFailureNotice reads={failedLog()} />);
    expect(screen.getByText(OPERATOR_DETAIL_SUMMARY)).toBeInTheDocument();
  });

  it("lets a panel narrow the planner sentence without losing the operator text", () => {
    const reads = failedLog();
    render(
      <ReadFailureNotice
        reads={reads}
        title="Evidence packages could not be read"
        description="An empty list here would not mean this mission has no packages."
      />
    );

    const planner = plannerText();
    expect(planner).toContain("An empty list here would not mean this mission has no packages.");
    // The page-wide sentence is the one thing an override replaces…
    expect(planner).not.toContain("Anything below that depends on it");
    // …the move is NOT: a narrower disclosure is still a dead end without it.
    expect(planner).toMatch(PLANNER_CAN_ACT);
    // …and the operator half is not what an override touches.
    expect(operatorText()).toContain("permission denied for table scenarios");
  });
});

// ── The ten swept pages ──────────────────────────────────────────────────────

/**
 * These ten are server components behind Supabase reads, so this is a source
 * assertion rather than a render. The BEHAVIOUR the sweep produces is proven
 * above, once, against the component all ten now render.
 *
 * WHAT THIS SCAN CATCHES, STATED HONESTLY. It matches the concatenation written
 * inline (`${reads.messages()}`, `>{reads.messages()}`) and the same thing moved
 * ONE HOP behind a local name in the same file — the shape a reviewer proved an
 * earlier version of this scan slept through:
 *
 *   const detail = reads.messages().join(" · ");
 *   <ReadFailureNotice reads={reads} description={`${reads.describe()} ${detail}`} />
 *
 * It does NOT catch two hops, a helper imported from another module, or a string
 * assembled at runtime. The earlier version of this comment called the
 * concatenation "impossible to reintroduce silently", which was an overclaim: a
 * guard that promises more than it checks is worse than a narrow one, because
 * the next lane trusts the promise instead of reading the regexes. Walking the
 * full reachable surface (`helpers/reachable-write-surface.ts`) is the tool if
 * this ever needs to be airtight; one hop is what the observed defect needed.
 */
const SWEPT_PAGES = [
  "app/(app)/reports/page.tsx",
  "app/(app)/engagement/page.tsx",
  "app/(app)/engagement/[campaignId]/page.tsx",
  "app/(app)/models/[modelId]/page.tsx",
  "app/(app)/models/page.tsx",
  "app/(app)/scenarios/page.tsx",
  "app/(app)/scenarios/[scenarioSetId]/page.tsx",
  "app/(app)/invoicing/_components/reimbursement-lane.tsx",
  "app/(app)/aerial/missions/[missionId]/page.tsx",
  "app/(app)/grants/page.tsx",
  // The report detail page reaches the same defect through its own component.
  "components/reports/report-read-failure-notice.tsx",
];

/**
 * Every local name a file has bound the operator's text to.
 *
 * The window is bounded by `[^;{}]*` in both directions so a match cannot run
 * across a statement or a block boundary and invent a binding that is not there.
 * `writtenColumns` in `helpers/reachable-write-surface.ts` resolves an
 * identifier the same way and for the same reason: the readable way to write
 * something is also the way it escapes a scan that only reads the call site.
 */
function operatorTextAliases(source: string): string[] {
  const aliases = new Set<string>();
  for (const call of source.matchAll(/\.messages\(\)/g)) {
    const at = call.index ?? 0;
    const before = source.slice(Math.max(0, at - 240), at);
    const binding = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^;{}=]*)?=\s*[^;{}]*$/);
    if (binding) aliases.add(binding[1]);
  }
  return [...aliases];
}

/** `.messages()` written out, as a regex fragment the matcher can splice in. */
const DIRECT_CALL = "\\.messages\\(\\)";

/** An identifier as a whole-word fragment. `$` is legal in a name and in a regex. */
function identifierFragment(name: string): string {
  return `(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`;
}

/**
 * The three positions where a string becomes copy the planner reads. `fragment`
 * is spliced into a regex, so callers pass an escaped one — the two producers
 * are `DIRECT_CALL` and `identifierFragment`.
 */
function plannerRenderSites(source: string, fragment: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ["interpolated into a planner sentence", new RegExp(`\\$\\{[^}]*${fragment}`)],
    ["rendered as text", new RegExp(`>\\s*\\{[^}]*${fragment}`)],
    [
      "passed as a planner-facing prop",
      new RegExp(`\\b(?:description|title|label)\\s*=\\s*\\{[^}]*${fragment}`),
    ],
  ];
  return patterns.filter(([, pattern]) => pattern.test(source)).map(([why]) => why);
}

describe("the pages that used to concatenate the database's words into a planner's sentence", () => {
  it.each(SWEPT_PAGES)("%s discloses failed reads through the shared notice", (relative) => {
    const source = readFileSync(path.join(APP_ROOT, relative), "utf8");
    expect(source).toContain("ReadFailureNotice");

    // `messages()` may still be READ on these pages, but never rendered into a
    // string a planner is shown — inline, or through a local name.
    const offences = [
      ...plannerRenderSites(source, DIRECT_CALL).map((why) => `reads.messages() ${why}`),
      ...operatorTextAliases(source).flatMap((alias) =>
        plannerRenderSites(source, identifierFragment(alias)).map(
          (why) => `\`${alias}\` (bound to .messages()) ${why}`
        )
      ),
    ];

    expect(
      offences,
      `${relative} puts the database's own words in front of a planner. Pass the operator text to ` +
        "`<OperatorDetail>` (ReadFailureNotice already does) instead of into the sentence."
    ).toEqual([]);
  });

  /**
   * NEGATIVE CONTROL. Both helpers above run over real files that are expected
   * to be clean, so an extractor that found nothing and a matcher that matched
   * nothing would produce exactly the same green. These two assertions are the
   * only thing standing between this file and that.
   */
  it("finds the indirection it claims to find", () => {
    const reintroduced = [
      "const detail = reads.messages().join(' · ');",
      "return <ReadFailureNotice reads={reads} description={`${reads.describe()} ${detail}`} />;",
    ].join("\n");

    expect(operatorTextAliases(reintroduced)).toEqual(["detail"]);
    expect(plannerRenderSites(reintroduced, identifierFragment("detail"))).toContain(
      "interpolated into a planner sentence"
    );

    // The inline form, and the prop form that neither original regex saw.
    expect(plannerRenderSites("<p>{reads.messages().join(' ')}</p>", DIRECT_CALL)).toContain(
      "rendered as text"
    );
    expect(
      plannerRenderSites("<StateBlock description={reads.messages()[0]} />", DIRECT_CALL)
    ).toContain("passed as a planner-facing prop");

    // A whole-word fragment: `detail` must not fire on `detailedMessages`.
    expect(
      plannerRenderSites("<p>{detailedMessages}</p>", identifierFragment("detail"))
    ).toEqual([]);

    // And does not invent a binding across a statement boundary.
    expect(operatorTextAliases("const summary = other;\nlog(reads.messages());")).toEqual([]);
  });
});

// ── Operator plumbing in planner copy ────────────────────────────────────────

describe("the reminder panel", () => {
  it("says reminders are switched off without naming the secret in the planner's line", async () => {
    renderInbox(await inboxFrom([]), false);

    const planner = plannerText();
    expect(planner).toContain("switched off");
    expect(planner).toContain("listed below");
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).not.toContain("CRON_SECRET");
    expect(planner).not.toContain("/api/cron/");

    // Both halves of the operator's fix survive: the variable and the schedule.
    const operator = operatorText();
    expect(operator).toContain("CRON_SECRET");
    expect(operator).toContain("/api/cron/sweep-deadlines");
    expectClosedAndLabelled();
  });

  it("calls it the daily check, not a sweep", async () => {
    renderInbox(
      await inboxFrom([
        {
          id: "n-1",
          recipient_user_id: ALICE,
          is_read: false,
          kind: "deliverable_due",
          title: "Public review draft",
          body: "Deliverable on Corridor study — was due Aug 1, 2026 and is now overdue.",
          due_on: "2026-08-01",
          project_id: null,
          created_at: "2026-08-11T13:00:00.000Z",
        },
      ])
    );

    const planner = plannerText();
    expect(planner).toContain("the daily check");
    // "Sweep" is the cron job's name in the codebase, not a word a planner has
    // been given any way to understand.
    expect(planner).not.toMatch(/\bsweep\b/i);
  });

  it("keeps the database's message out of the failed-read sentence and inside the disclosure", async () => {
    renderInbox(await inboxFrom([], { message: "connection reset by peer" }));

    const planner = plannerText();
    expect(planner).toContain("does not mean nothing is due");
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).not.toContain("connection reset by peer");

    expect(operatorText()).toContain("connection reset by peer");
    expectClosedAndLabelled();
  });

  it("keeps the migration number out of the pending-migration sentence", async () => {
    renderInbox(await inboxFrom([], { message: 'relation "public.work_notifications" does not exist' }));

    const planner = plannerText();
    expect(planner).toContain("pending migrations");
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).not.toContain("20260811000007");

    expect(operatorText()).toContain("20260811000007");
    expectClosedAndLabelled();
  });
});

describe("the my-work board", () => {
  it("keeps the assignee migration number out of the planner's sentence", async () => {
    const { result } = await loadSeededMyWork({
      roster: ROSTER,
      failures: { project_deliverables: "column project_deliverables.assignee_user_id does not exist" },
    });
    render(
      <MyWorkBoard
        scope={result.scope}
        items={result.items}
        perSource={result.perSource}
        limitPerSource={result.limitPerSource}
        readFailureSummary={result.reads.describe()}
        roster={ROSTER}
        departedIncludedInUnassigned={result.departedIncludedInUnassigned}
        isViewer={false}
      />
    );

    const planner = plannerText();
    expect(planner).toContain("Assigned work cannot be listed on this deployment yet");
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).not.toContain("20260811000006");
    expect(planner).not.toContain("assignee_user_id");

    expect(operatorText()).toContain("20260811000006");
    expectClosedAndLabelled();
  });
});

describe("the maps that cannot draw", () => {
  const ORIGINAL_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_ACCESS_TOKEN;
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_TOKEN;
  });

  it("tells a resident what is missing without naming the variable", async () => {
    const { LocationDisplayMap } = await import("@/components/engagement/location-display-map");
    render(
      <LocationDisplayMap
        items={
          [
            {
              id: "item-1",
              content: "The crossing here floods every winter.",
              latitude: 39.2,
              longitude: -121.1,
              geometry: null,
              support_count: 0,
            },
          ] as never
        }
      />
    );

    const notice = screen.getByTestId("engagement-map-unavailable");
    const planner = plannerText(notice);
    expect(planner).toContain("no map key configured");
    expect(planner).toContain("Commenting and surveys work without it");
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).not.toContain("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");

    expect(operatorText(notice)).toContain("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
    expectClosedAndLabelled(notice);
  });

  it("tells a planner the crash map cannot draw without naming the variable", async () => {
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");
    // `styleUrl` is empty on purpose: with no map key the basemap registry
    // resolves to no choices at all, and this notice is what a planner sees
    // instead of a map. It is the state the prop was made required for.
    render(<SafetyCrashMap collection={null} bbox={null} styleUrl="" />);

    const notice = screen.getByTestId("safety-crash-map-unavailable");
    const planner = plannerText(notice);
    expect(planner).toContain("can't be drawn");
    // What still works, so an empty map is not read as missing crash data.
    expect(planner).toContain("crash counts and rates on this page are unaffected");
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).not.toContain("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");

    expect(operatorText(notice)).toContain("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
    expectClosedAndLabelled(notice);
  });
});

describe("the mission map's preview notice", () => {
  it("keeps the service-role key out of the planner's line and on the page", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
    vi.resetModules();
    const { AerialMissionMap } = await import("@/components/aerial/aerial-mission-map");
    render(
      <AerialMissionMap
        missionId="11111111-1111-4111-8111-111111111111"
        preview={null}
        previewNotice="This deployment could not mint a display link for held imagery, so the map cannot draw the preview. The custody records below are unaffected, and whoever runs this OpenPlan can fix the deployment setting behind it."
        previewNoticeDetail="The Supabase service-role key is not configured on this deployment, so signed display links cannot be minted."
      />
    );

    const notice = screen.getByTestId("aerial-mission-map");
    const planner = plannerText(notice);
    expect(planner).toContain("could not mint a display link for held imagery");
    expect(planner).toMatch(PLANNER_CAN_ACT);
    expect(planner).not.toContain("service-role key");

    expect(operatorText(notice)).toContain("service-role key is not configured");
    expectClosedAndLabelled(notice);
  });
});

/**
 * The loader is where the database's own words enter the aerial lane. It has
 * to hand them over as a separate field, or the page has nothing to fold away.
 */
describe("the ortho preview loader", () => {
  it("splits the failed custody read into a planner sentence and an operator message", async () => {
    const { loadAerialOrthoPreview } = await import("@/lib/aerial/ortho-preview");
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => ({ data: null, error: { message: "permission denied for table aerial_artifact_custody" } }),
            }),
          }),
        }),
      }),
    };
    const result = await loadAerialOrthoPreview({
      supabase: supabase as never,
      signer: { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } } as never,
      missionId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") throw new Error("unreachable");
    expect(result.detail).toContain("not a finding that no preview exists");
    expect(result.detail).not.toContain("permission denied");
    expect(result.operatorDetail).toContain("permission denied for table aerial_artifact_custody");
  });
});
