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

function classifyCall(call: KpiCall): string | null {
  const chain = normalizedChain(call.chain);

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
  it("keeps every direct app caller explicitly classified", () => {
    const calls = collectModelRunKpiCalls();
    const classifications = calls.map((call) => ({
      filePath: call.filePath,
      classification: classifyCall(call),
      chain: normalizedChain(call.chain),
    }));

    expect(classifications).toEqual([
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
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/route.ts",
        classification: "sketch-abm-run-kpi-writer",
      }),
      expect.objectContaining({
        filePath: "src/app/api/models/[modelId]/runs/route.ts",
        classification: "ite-trip-gen-run-kpi-writer",
      }),
      expect.objectContaining({
        filePath: "src/lib/models/behavioral-onramp-kpis.ts",
        classification: "behavioral-manifest-writer-delete",
      }),
      expect.objectContaining({
        filePath: "src/lib/models/behavioral-onramp-kpis.ts",
        classification: "behavioral-manifest-writer-insert",
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
