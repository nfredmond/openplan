import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A gate verdict belongs to ONE project, and a generated report packet is a
 * document an agency sends to a funder or a board.
 *
 * `stage_gate_decisions` carried no project until 20260728000011, so every
 * reader filtered on `workspace_id` alone and then presented the result in a
 * project's context. A workspace with two projects would therefore state that
 * this project passed a gate when the decision that passed it was recorded
 * against the other one — frozen into a packet, cited by the evidence chain,
 * and unrecoverable afterwards. It read as correct for exactly as long as a
 * workspace had one project.
 *
 * This inventory is the ratchet. Every place in `src/` that touches the table
 * has to be classified here, so a new reader cannot be added workspace-wide
 * without someone writing down what it is and why that is safe.
 */

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set(["test"]);

type DecisionTableCall = {
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
  return content
    .slice(startIndex, semicolonIndex === -1 ? undefined : semicolonIndex + 1)
    .replace(/\s+/g, " ");
}

function collectDecisionTableCalls(): DecisionTableCall[] {
  const tablePattern = /\.from\(["']stage_gate_decisions["']\)/g;

  return collectSourceFiles(SOURCE_ROOT).flatMap((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    return Array.from(content.matchAll(tablePattern)).map((match) => ({
      filePath: path.relative(process.cwd(), filePath).split(path.sep).join("/"),
      chain: readCallChain(content, match.index ?? 0),
    }));
  });
}

function filtersOnProject(chain: string): boolean {
  return /\.eq\(["']project_id["']\s*,/.test(chain);
}

function classifyCall(call: DecisionTableCall): string | null {
  if (call.filePath === "src/lib/stage-gates/decision-queries.ts" && filtersOnProject(call.chain)) {
    // The one read that builds a PROJECT'S board. Every surface that shows a
    // board — the project page, the assistant, the report detail page — goes
    // through it rather than querying the table itself.
    return "project-board-loader";
  }

  if (
    call.filePath === "src/app/api/reports/[reportId]/generate/route.ts" &&
    filtersOnProject(call.chain)
  ) {
    // The packet generator. Kept inline rather than on the loader so a failed
    // read refuses generation outright instead of being softened into an
    // "unreadable" board a packet would then have to interpret.
    return "report-packet-generator";
  }

  if (
    call.filePath === "src/app/api/stage-gates/decisions/route.ts" &&
    call.chain.includes(".insert(")
  ) {
    // The append-only recorder, which stamps the project the decision is about.
    // Tested behaviourally in stage-gate-decisions-route.test.ts.
    return "decision-recorder-insert";
  }

  // Checked after the insert, because the recorder chain ends with its own
  // `.select()` of the row it wrote.
  if (
    call.filePath === "src/app/api/stage-gates/decisions/route.ts" &&
    call.chain.includes(".select(")
  ) {
    // The decision LIST endpoint. It returns the rows themselves for whatever
    // the caller asked for — a run, a project, or the whole workspace — and
    // never presents them as one project's gate posture, which is why its
    // project filter is a caller-supplied option rather than a default. Rows
    // written before the column exists are only reachable here.
    return "decision-list-endpoint";
  }

  return null;
}

describe("a report packet cannot assert another project's gate decision", () => {
  it("keeps every stage_gate_decisions caller classified, so no new one reads workspace-wide", () => {
    const classifications = collectDecisionTableCalls().map((call) => ({
      filePath: call.filePath,
      classification: classifyCall(call),
    }));

    expect(classifications).toEqual([
      {
        filePath: "src/app/api/reports/[reportId]/generate/route.ts",
        classification: "report-packet-generator",
      },
      {
        filePath: "src/app/api/stage-gates/decisions/route.ts",
        classification: "decision-list-endpoint",
      },
      {
        filePath: "src/app/api/stage-gates/decisions/route.ts",
        classification: "decision-recorder-insert",
      },
      {
        filePath: "src/lib/stage-gates/decision-queries.ts",
        classification: "project-board-loader",
      },
    ]);
  });

  it("scopes the read that a packet's frozen gate snapshot is built from", () => {
    const generatorCalls = collectDecisionTableCalls().filter(
      (call) => call.filePath === "src/app/api/reports/[reportId]/generate/route.ts"
    );

    expect(generatorCalls).toHaveLength(1);
    expect(generatorCalls[0].chain).toContain('.eq("workspace_id"');
    expect(filtersOnProject(generatorCalls[0].chain)).toBe(true);
  });

  it("leaves the report detail page and the assistant with no decision read of their own", () => {
    // Both used to query the table workspace-wide and then speak about one
    // project: the page as live drift against the packet's snapshot, the
    // assistant as "no stage gate is currently on hold". They now share the
    // loader, which is also where an unreadable log stops looking like an empty
    // one.
    const converted = [
      "src/app/(app)/reports/[reportId]/page.tsx",
      "src/lib/assistant/context.ts",
    ];

    for (const filePath of converted) {
      const content = fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");

      expect(content).not.toContain('.from("stage_gate_decisions")');
      expect(content).toContain("loadProjectStageGateBoard");
    }
  });
});
