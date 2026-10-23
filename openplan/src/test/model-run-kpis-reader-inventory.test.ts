import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set(["test"]);

type KpiCall = {
  filePath: string;
  chain: string;
};

function collectSourceFiles(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const fullPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        return EXCLUDED_SEGMENTS.has(entry.name) ? [] : collectSourceFiles(fullPath);
      }

      return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
    });
}

function readCallChain(content: string, startIndex: number): string {
  const semicolonIndex = content.indexOf(";", startIndex);
  return content.slice(startIndex, semicolonIndex === -1 ? undefined : semicolonIndex + 1);
}

function collectModelRunKpiCalls(): KpiCall[] {
  const tablePattern = /\.from\(["']model_run_kpis["']\)/g;

  return collectSourceFiles(SOURCE_ROOT).flatMap((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    return Array.from(content.matchAll(tablePattern)).map((match) => ({
      filePath: path.relative(process.cwd(), filePath),
      chain: readCallChain(content, match.index ?? 0),
    }));
  });
}

function normalizedChain(chain: string): string {
  return chain.replace(/\s+/g, " ");
}

function hasRunIdFilter(chain: string): boolean {
  return /\.eq\(["']run_id["']\s*,/.test(chain);
}

function hasCountyRunBehavioralFilter(chain: string): boolean {
  return (
    /\.eq\(["']county_run_id["']\s*,/.test(chain) &&
    /\.eq\(["']kpi_category["']\s*,\s*["']behavioral_onramp["']\)/.test(chain)
  );
}

/** Match only the paged, four-measure read used by the report verifier. */
function isGuidedReportKpiRead(chain: string): boolean {
  return /^\.from\("model_run_kpis"\)\s*\.select\(GUIDED_REPORT_KPI_COLUMNS\)\s*\.in\("run_id", runIds\)\s*\.in\("kpi_name", \["total_trips", "daily_vmt", "activitysim_trips", "activitysim_daily_vmt"\]\)\s*\.order\("id"\)\s*\.range\(from, to\)(?!\s*\.)/.test(chain);
}

function classifyCall(call: KpiCall): string | null {
  const chain = normalizedChain(call.chain);

  if (
    call.filePath === "src/app/(app)/projects/[projectId]/page.tsx" &&
    chain.includes('.in("run_id"')
  ) {
    // RTP "why" engine: reads a linked run's VMT/GHG KPIs (by run ids) to show as
    // attributed modeling evidence next to the VMT/GHG priority criteria.
    return "rtp-priority-evidence-read-by-run-ids";
  }

  if (
    call.filePath === "src/app/(published)/plan/[shareToken]/page.tsx" &&
    chain.includes('.in("run_id"')
  ) {
    // RTP public "why" view: reads a linked run's VMT/GHG KPIs (by run ids) for the
    // read-only community page — service-role mediated, token + enabled gated.
    return "rtp-public-evidence-read-by-run-ids";
  }

  if (
    call.filePath === "src/lib/models/guided-comparison-evidence-server.ts" &&
    chain.includes('.in("run_id"') &&
    chain.includes('"total_trips"') &&
    chain.includes('"daily_vmt"') &&
    chain.includes('"activitysim_trips"') &&
    chain.includes('"activitysim_daily_vmt"')
  ) {
    // The guided comparison reads only the exact four linked runs and the two
    // same-unit measures it renders. The paired decision read keeps each
    // method's evidence state beside those values.
    return "guided-comparison-evidence-read-by-run-ids";
  }

  if (call.filePath === "src/lib/reports/guided-comparison-server.ts" && isGuidedReportKpiRead(chain)) {
    // Report creation and generation recheck these exact run-bound measures;
    // managed attempts and legacy receipts are verified by the owning loader.
    return "guided-report-evidence-read-by-run-ids";
  }

  if (
    [
      "src/app/api/models/project-comparison/route.ts",
      "src/app/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route.ts",
    ].includes(call.filePath) &&
    chain.includes('.in("run_id"') &&
    chain.includes('.eq("kpi_name", "activitysim_runtime_mode")')
  ) {
    // Both comparison surfaces verify the persisted runtime mode across the
    // exact guided-run set before presenting ActivitySim as runnable evidence.
    return "activitysim-runtime-evidence-read-by-run-ids";
  }

  if (chain.includes(".select(") && hasRunIdFilter(chain)) {
    return "model-run-read-by-run-id";
  }

  if (chain.includes(".delete()") && hasRunIdFilter(chain)) {
    return "model-run-cleanup-by-run-id";
  }

  if (
    call.filePath === "src/lib/models/behavioral-onramp-kpis.ts" &&
    chain.includes(".delete()") &&
    hasCountyRunBehavioralFilter(chain)
  ) {
    return "behavioral-manifest-writer-delete";
  }

  if (
    call.filePath === "src/lib/models/behavioral-onramp-kpis.ts" &&
    chain.includes(".insert(rows)")
  ) {
    return "behavioral-manifest-writer-insert";
  }

  if (
    call.filePath === "src/app/api/models/[modelId]/runs/[modelRunId]/kpis/route.ts" &&
    chain.includes(".insert(inserts)")
  ) {
    return "model-run-kpi-writer";
  }

  if (
    call.filePath === "src/app/api/models/[modelId]/runs/route.ts" &&
    chain.includes(".insert(kpiRows)")
  ) {
    // Synchronous sketch_abm launch branch registering run-scoped
    // screening-grade sketch KPIs (kpi_category "sketch_abm", run_id set).
    return "sketch-abm-run-kpi-writer";
  }

  if (
    call.filePath === "src/app/api/models/[modelId]/runs/route.ts" &&
    chain.includes(".insert(iteKpiRows)")
  ) {
    // Synchronous ite_trip_generation launch branch registering run-scoped
    // screening-grade trip-gen KPIs (kpi_category "ite_trip_generation",
    // run_id set, names disjoint from the CEQA KPI namespace).
    return "ite-trip-gen-run-kpi-writer";
  }

  return null;
}

describe("model_run_kpis reader inventory", () => {
  it("classifies the exact report read and refuses widened or unscoped queries", () => {
    const filePath = "src/lib/reports/guided-comparison-server.ts";
    const chain = '.from("model_run_kpis").select(GUIDED_REPORT_KPI_COLUMNS).in("run_id", runIds) ' +
      '.in("kpi_name", ["total_trips", "daily_vmt", "activitysim_trips", "activitysim_daily_vmt"]).order("id").range(from, to)';
    expect(classifyCall({ filePath, chain })).toBe("guided-report-evidence-read-by-run-ids");
    expect(classifyCall({ filePath, chain: chain.replace(" ", "\n  ") })).toBe("guided-report-evidence-read-by-run-ids");
    for (const gap of ["\n      ", "\t"]) {
      const spacedChain = chain.replace(/\)\s*\./g, `)${gap}.`);
      expect(classifyCall({ filePath, chain: spacedChain })).toBe("guided-report-evidence-read-by-run-ids");
    }
    for (const broken of [
      chain.replace('"model_run_kpis"', '"model_run_kpis "'),
      chain.replace("runIds", "allRunIds"),
      chain.replace('"daily_vmt"', '"daily vmt"'),
      chain.replace('.in("run_id", runIds)', ""),
      chain.replace('.select(GUIDED_REPORT_KPI_COLUMNS)', '.select("*")'),
      chain.replace('"activitysim_daily_vmt"', '"activitysim_daily_vmt", "private_household_value"'),
      chain.replace('.range(from, to)', ""),
      chain + '.update({ value: 0 })',
      chain.replace('.select(GUIDED_REPORT_KPI_COLUMNS)', '.delete()'),
    ]) expect(classifyCall({ filePath, chain: broken })).toBeNull();
  });
  it("keeps every direct app caller explicitly classified", () => {
    const calls = collectModelRunKpiCalls();
    const classifications = calls.map((call) => ({
      filePath: call.filePath,
      classification: classifyCall(call),
      chain: normalizedChain(call.chain),
    }));

    expect(classifications).toEqual([
      expect.objectContaining({
        filePath: "src/app/(app)/projects/[projectId]/page.tsx",
        classification: "rtp-priority-evidence-read-by-run-ids",
      }),
      expect.objectContaining({
        filePath: "src/app/(published)/plan/[shareToken]/page.tsx",
        classification: "rtp-public-evidence-read-by-run-ids",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/[modelRunId]/evidence-packet/route.ts",
        classification: "model-run-read-by-run-id",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/[modelRunId]/kpis/route.ts",
        classification: "model-run-read-by-run-id",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/[modelRunId]/kpis/route.ts",
        classification: "model-run-read-by-run-id",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/[modelRunId]/kpis/route.ts",
        classification: "model-run-kpi-writer",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts",
        classification: "model-run-cleanup-by-run-id",
      }),
      // The persisted VMT significance determination recomputes from the run's
      // STORED KPIs rather than trusting a figure in the request body — that
      // read is what keeps the KPI-namespace claim firewall in force when a
      // determination is saved.
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/[modelRunId]/vmt-significance/route.ts",
        classification: "model-run-read-by-run-id",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/route.ts",
        classification: "sketch-abm-run-kpi-writer",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/route.ts",
        classification: "ite-trip-gen-run-kpi-writer",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/project-comparison/route.ts",
        classification: "activitysim-runtime-evidence-read-by-run-ids",
      }),
      expect.objectContaining({
        filePath: "src/app/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route.ts",
        classification: "activitysim-runtime-evidence-read-by-run-ids",
      }),
      // The Planner Agent's get_model_run_results chat tool: a run_id-scoped
      // SELECT through the user-session client (RLS applies), after the tool has
      // verified the run belongs to the chat's workspace.
      expect.objectContaining({
        filePath: "src/lib/assistant/chat-tools.ts",
        classification: "model-run-read-by-run-id",
      }),
      expect.objectContaining({
        filePath: "src/lib/models/behavioral-onramp-kpis.ts",
        classification: "behavioral-manifest-writer-delete",
      }),
      expect.objectContaining({
        filePath: "src/lib/models/behavioral-onramp-kpis.ts",
        classification: "behavioral-manifest-writer-insert",
      }),
      expect.objectContaining({
        filePath: "src/lib/models/guided-comparison-evidence-server.ts",
        classification: "guided-comparison-evidence-read-by-run-ids",
      }),
      expect.objectContaining({
        filePath: "src/lib/reports/guided-comparison-server.ts",
        classification: "guided-report-evidence-read-by-run-ids",
      }),
    ]);
  });

  it("has no direct behavioral-onramp reader outside the consent-aware RPC", () => {
    const directBehavioralReaders = collectModelRunKpiCalls()
      .filter((call) => normalizedChain(call.chain).includes(".select("))
      .filter((call) => normalizedChain(call.chain).includes("behavioral_onramp"));

    expect(directBehavioralReaders).toEqual([]);
  });
});
