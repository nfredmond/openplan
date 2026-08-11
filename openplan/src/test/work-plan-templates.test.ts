import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import genericProjectTemplate from "@/lib/work-plans/templates/generic_project_v0.1.json";
import { BUILT_IN_WORK_PLAN_TEMPLATE_REGISTRATIONS, workPlanTemplateRegistry } from "@/lib/work-plans/built-in";
import { buildWorkPlanApplication, parseAnchorDate } from "@/lib/work-plans/apply";
import {
  createWorkPlanTemplateRegistry,
  validateWorkPlanTemplateArtifact,
  WORK_PLAN_EXCLUDED_MILESTONE_TYPES,
  WORK_PLAN_MILESTONE_TYPES,
  WORK_PLAN_PHASE_CODES,
  type WorkPlanTemplateDocument,
} from "@/lib/work-plans/template-registry";

/**
 * THE WORK-PLAN TEMPLATE MACHINERY.
 *
 * Three things are worth failing a build over, and they are what this file
 * asserts:
 *
 *   1. The resolver NEVER hands back a template nobody chose. A wrong work plan
 *      is not read like a wrong checklist — it is WORKED, because applying it
 *      writes dated records into a project and into teammates' queues.
 *   2. A template's vocabulary is the DATABASE'S. The milestone type and phase
 *      lists are read out of the migrations here rather than trusted from the
 *      source file, because a template naming a value Postgres rejects would
 *      fail in front of a planner mid-apply.
 *   3. Applying a template can never name a person, and the inserts it builds
 *      are a SUBSET of the columns the ordinary record-create route writes —
 *      asserted against that route's own source, so the two cannot drift into
 *      being two ways to make a deliverable.
 *
 * MUTATION-VERIFIED (2026-08-11), each reverted after; see the report.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

/** The EFFECTIVE CHECK vocabulary for a column: the last migration that defines it wins. */
function effectiveCheckValues(column: string): string[] {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  let latest: string[] | null = null;
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const pattern = new RegExp(`CHECK\\s*\\(\\s*\\n?\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "gis");
    for (const match of sql.matchAll(pattern)) {
      latest = [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
    }
  }
  if (!latest) throw new Error(`No CHECK constraint found for ${column}`);
  return latest;
}

describe("the template vocabulary is the database's", () => {
  it("covers exactly the milestone types the CHECK allows, minus the one deliberate exclusion", () => {
    const allowed = effectiveCheckValues("milestone_type").sort();
    // `obligation` mirrors a funding award and carries funding_award_id; a
    // template has no award to mirror. Anything else added to the column must
    // be considered here rather than silently unavailable to templates.
    expect([...WORK_PLAN_MILESTONE_TYPES, ...WORK_PLAN_EXCLUDED_MILESTONE_TYPES].sort()).toEqual(allowed);
  });

  it("covers exactly the phase codes the CHECK allows", () => {
    expect([...WORK_PLAN_PHASE_CODES].sort()).toEqual(effectiveCheckValues("phase_code").sort());
  });
});

describe("artifact validation", () => {
  const valid = genericProjectTemplate as unknown;

  it("accepts the shipped template", () => {
    const result = validateWorkPlanTemplateArtifact(valid);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("collects EVERY problem rather than stopping at the first", () => {
    const result = validateWorkPlanTemplateArtifact({
      template_name: "",
      version: "0.1",
      practice_area: "aviation",
      anchor: "someday",
      applies_to_plan_types: ["corridor_plan"],
      scope_notes: [],
      deliverables: [{ key: "a", title: "A", offset_days: -3 }],
      milestones: [{ key: "b", title: "B", offset_days: 1, milestone_type: "obligation" }],
    });
    expect(result.ok).toBe(false);
    const joined = result.errors.join(" | ");
    // Five independent problems, all reported from one call.
    expect(joined).toContain("template_id is required");
    expect(joined).toContain("practice_area must be one of");
    expect(joined).toContain("anchor must be one of");
    expect(joined).toContain("scope_notes is required");
    expect(joined).toContain("offset_days must be a whole number");
    expect(joined).toContain("may not be authored by a template");
  });

  it("refuses a template with no scope notes — the honesty text is not optional", () => {
    const withoutNotes = { ...(valid as Record<string, unknown>) };
    delete withoutNotes.scope_notes;
    const result = validateWorkPlanTemplateArtifact(withoutNotes);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("scope_notes is required");
  });

  it("refuses duplicate item keys", () => {
    const document = valid as WorkPlanTemplateDocument;
    const result = validateWorkPlanTemplateArtifact({
      ...document,
      deliverables: [...document.deliverables, { ...document.deliverables[0], title: "Something else" }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("duplicate key");
  });
});

describe("the resolver never defaults", () => {
  function registry(documents: Array<Record<string, unknown>>) {
    return createWorkPlanTemplateRegistry(documents.map((artifact) => ({ artifact })));
  }

  const base = {
    template_name: "T",
    version: "0.1",
    practice_area: "transportation",
    anchor: "kickoff",
    scope_notes: ["A standard-practice starting point — edit to your scope."],
    deliverables: [{ key: "d", title: "D", offset_days: 10 }],
    milestones: [],
  };

  it("answers no_template rather than offering the only registered one", () => {
    const resolved = registry([{ ...base, template_id: "a", applies_to_plan_types: ["corridor_plan"] }]);
    expect(resolved.findForProject({ planType: "housing_element" }).kind).toBe("no_template");
    // Nor for a project whose plan type is not recorded at all.
    expect(resolved.findForProject({ planType: null }).kind).toBe("no_template");
  });

  it("answers ambiguous rather than picking between two equally-covering templates", () => {
    const resolved = registry([
      { ...base, template_id: "a", applies_to_plan_types: ["corridor_plan"] },
      { ...base, template_id: "b", applies_to_plan_types: ["Corridor_Plan"] },
    ]);
    const match = resolved.findForProject({ planType: "corridor_plan" });
    expect(match.kind).toBe("ambiguous");
    expect(match.kind === "ambiguous" && match.entries).toHaveLength(2);
  });

  it("offers a jurisdiction-scoped template only to a project in that jurisdiction", () => {
    const resolved = registry([
      { ...base, template_id: "neutral", applies_to_plan_types: ["housing_plan"] },
      {
        ...base,
        template_id: "ca",
        applies_to_plan_types: ["housing_plan"],
        jurisdiction: { country: "US", subdivision: "CA", label: "California, United States" },
      },
    ]);
    // In California, the state pack is the more specific tier and wins outright.
    const inCa = resolved.findForProject({
      planType: "housing_plan",
      jurisdiction: { country: "US", subdivision: "CA" },
    });
    expect(inCa.kind === "matched" && inCa.entry.descriptor.templateId).toBe("ca");

    // In Ohio, and where the subdivision is not established, only the neutral
    // one is a candidate — offering the California pack there is the exact
    // substitution this registry exists to prevent.
    for (const subdivision of ["OH", null]) {
      const elsewhere = resolved.findForProject({
        planType: "housing_plan",
        jurisdiction: { country: "US", subdivision },
      });
      expect(elsewhere.kind === "matched" && elsewhere.entry.descriptor.templateId).toBe("neutral");
    }
  });

  it("refuses to register two templates under one id", () => {
    expect(() =>
      registry([
        { ...base, template_id: "a", applies_to_plan_types: [] },
        { ...base, template_id: "a", applies_to_plan_types: [] },
      ])
    ).toThrow(/Duplicate/);
  });
});

describe("the shipped registry", () => {
  it("registers the one proof template and describes it", () => {
    const listed = workPlanTemplateRegistry.list();
    expect(listed).toHaveLength(BUILT_IN_WORK_PLAN_TEMPLATE_REGISTRATIONS.length);
    const descriptor = listed[0];
    expect(descriptor.templateId).toBe("generic_project_v0.1");
    expect(descriptor.scopeNotes.length).toBeGreaterThan(0);
    expect(descriptor.deliverableCount).toBe(4);
    expect(descriptor.milestoneCount).toBe(3);
    expect(descriptor.spanDays).toBe(330);
    // Jurisdiction-neutral: the field is absent, not a country nobody chose.
    expect(descriptor.jurisdiction).toBeUndefined();
  });

  it("cannot be reached by the resolver, so one template cannot become a default", () => {
    expect(workPlanTemplateRegistry.list()[0].appliesToPlanTypes).toEqual([]);
    for (const planType of ["corridor_plan", "general_plan", "anything"]) {
      expect(workPlanTemplateRegistry.findForProject({ planType }).kind).toBe("no_template");
    }
    // It is still gettable BY NAME, which is the only way it is ever applied.
    expect(workPlanTemplateRegistry.get("generic_project_v0.1")).not.toBeNull();
  });
});

describe("anchor dates", () => {
  it("accepts a real calendar date and refuses one that does not exist", () => {
    expect(parseAnchorDate("2026-08-11")?.toISOString()).toBe("2026-08-11T00:00:00.000Z");
    expect(parseAnchorDate("2026-02-30")).toBeNull();
    expect(parseAnchorDate("11/08/2026")).toBeNull();
    expect(parseAnchorDate("")).toBeNull();
    expect(parseAnchorDate(null)).toBeNull();
  });
});

describe("applying a template", () => {
  const document = (genericProjectTemplate as unknown as WorkPlanTemplateDocument);
  const PROJECT = "11111111-0000-4000-8000-000000000001";
  const USER = "44444444-0000-4000-8000-000000000004";

  function apply(anchorDate: string, existing: { deliverables?: string[]; milestones?: string[] } = {}) {
    const anchor = parseAnchorDate(anchorDate);
    if (!anchor) throw new Error("fixture anchor is not a date");
    return buildWorkPlanApplication({
      document,
      projectId: PROJECT,
      createdBy: USER,
      anchor,
      existingDeliverableTitles: existing.deliverables ?? [],
      existingMilestoneTitles: existing.milestones ?? [],
    });
  }

  it("counts every date forward from the anchor the planner supplied — VARIED, not one fixture", () => {
    // TWO anchors, because one cannot tell "threads the anchor through" from
    // "hardcodes a date": both would pass a single-fixture assertion.
    const march = apply("2026-03-02");
    const july = apply("2026-07-15");

    expect(march.deliverables.map((row) => row.due_date)).toEqual([
      "2026-03-23", // +21
      "2026-05-31", // +90
      "2026-09-28", // +210
      "2026-12-27", // +300
    ]);
    expect(july.deliverables.map((row) => row.due_date)).toEqual([
      "2026-08-05",
      "2026-10-13",
      "2027-02-10",
      "2027-05-11",
    ]);
    expect(march.milestones[0].target_date).toBe("2026-03-02");
    expect(july.milestones[0].target_date).toBe("2026-07-15");
    // Every offset moved by exactly the gap between the two anchors.
    const gapDays =
      (Date.parse(july.deliverables[0].due_date) - Date.parse(march.deliverables[0].due_date)) / 86_400_000;
    expect(gapDays).toBe(135);
  });

  it("does not shift a date across a day boundary for a reader west of UTC", () => {
    // A plain DATE column must round-trip the day a planner typed. Parsing with
    // the local constructor and adding days is how the 2nd becomes the 1st.
    const plan = apply("2026-01-01");
    expect(plan.anchorDate).toBe("2026-01-01");
    expect(plan.milestones[0].target_date).toBe("2026-01-01");
  });

  it("never names a person, on either record kind", () => {
    const plan = apply("2026-03-02");
    for (const row of [...plan.deliverables, ...plan.milestones]) {
      expect(Object.keys(row)).not.toContain("assignee_user_id");
      expect(Object.keys(row)).not.toContain("owner_label");
      expect(JSON.stringify(row)).not.toContain(USER.replace(/^/, "").slice(0, 8) + "-x");
    }
    // created_by IS set — that is who ran the apply, not who owes the work.
    expect(plan.deliverables[0].created_by).toBe(USER);
  });

  it("skips a title the project already has instead of duplicating it, and says which", () => {
    const plan = apply("2026-03-02", {
      deliverables: ["  existing conditions summary  ", "Something unrelated"],
      milestones: ["Project kickoff meeting"],
    });
    expect(plan.deliverables.map((row) => row.title)).toEqual([
      "Work plan and schedule",
      "Draft plan document",
      "Final plan document",
    ]);
    // Trimmed and case-folded: that is what a person means by "the same one".
    expect(plan.skippedDeliverableTitles).toEqual(["Existing conditions summary"]);
    expect(plan.skippedMilestoneTitles).toEqual(["Project kickoff meeting"]);
  });

  it("writes the database's own defaults for a milestone that declares neither", () => {
    const plan = buildWorkPlanApplication({
      document: {
        ...document,
        milestones: [{ key: "x", title: "Untyped checkpoint", offset_days: 5 }],
      },
      projectId: PROJECT,
      createdBy: USER,
      anchor: parseAnchorDate("2026-03-02") as Date,
      existingDeliverableTitles: [],
      existingMilestoneTitles: [],
    });
    expect(plan.milestones[0].milestone_type).toBe("schedule");
    expect(plan.milestones[0].phase_code).toBe("initiation");
  });
});

describe("a template writes the same columns the record-create route writes", () => {
  const ROUTE = path.join(
    process.cwd(),
    "src/app/api/projects/[projectId]/records/route.ts"
  );

  /** The insert block for one table in the records route, as source text. */
  function insertBlock(table: string): string {
    const source = readFileSync(ROUTE, "utf8");
    const start = source.indexOf(`.from("${table}")`);
    expect(start, `records route does not insert into ${table}`).toBeGreaterThan(-1);
    // BALANCED, not "up to the first `})`". These inserts contain conditional
    // spreads (`...(x !== undefined ? { assignee_user_id: x } : {})`), so a
    // naive scan stops three columns in — and the assertion below then passes
    // or fails on where a brace happened to be rather than on what is written.
    const insertAt = source.indexOf(".insert({", start);
    let depth = 0;
    let end = insertAt;
    for (let index = insertAt; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    return source.slice(insertAt, end);
  }

  it("emits only columns the ordinary create path also writes", () => {
    // TWO WAYS TO MAKE A DELIVERABLE IS ONE WAY TOO MANY. This does not force
    // the two to be identical — the template path deliberately writes fewer
    // columns — but a column the template writes and the route does not is a
    // second, unreviewed shape of the same row.
    const anchor = parseAnchorDate("2026-03-02") as Date;
    const plan = buildWorkPlanApplication({
      document: genericProjectTemplate as unknown as WorkPlanTemplateDocument,
      projectId: "11111111-0000-4000-8000-000000000001",
      createdBy: "44444444-0000-4000-8000-000000000004",
      anchor,
      existingDeliverableTitles: [],
      existingMilestoneTitles: [],
    });

    const deliverableBlock = insertBlock("project_deliverables");
    for (const key of Object.keys(plan.deliverables[0])) {
      expect(deliverableBlock, `project_deliverables.${key}`).toContain(`${key}:`);
    }

    const milestoneBlock = insertBlock("project_milestones");
    for (const key of Object.keys(plan.milestones[0])) {
      expect(milestoneBlock, `project_milestones.${key}`).toContain(`${key}:`);
    }
  });
});
