import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSmokeStatus, parseSmokeStatus } from "@/lib/operations/pilot-readiness";

const tempDirs: string[] = [];

async function makeOpsDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "openplan-pilot-readiness-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pilot readiness status parsing", () => {
  it("recognizes explicit status headers", () => {
    expect(parseSmokeStatus("**Status**: PASS\n\nProof follows.")).toBe("PASS");
    expect(parseSmokeStatus("Status: FAIL\n\nBroken.")).toBe("FAIL");
  });

  it("recognizes line-item PASS evidence when no status header exists", () => {
    expect(parseSmokeStatus("# Smoke\n\n- PASS: Created QA auth user.\n- PASS: Rendered report detail.")).toBe("PASS");
  });

  it("lets explicit headers win over line-item evidence", () => {
    expect(parseSmokeStatus("Status: PENDING\n\nPASS: old retained line item.")).toBe("PENDING");
  });

  it("uses the latest matching smoke doc for each tracked lane", async () => {
    const opsDir = await makeOpsDir();
    await writeFile(
      path.join(opsDir, "2026-04-05-openplan-production-authenticated-smoke.md"),
      "Status: FAIL\n",
      "utf8",
    );
    await writeFile(
      path.join(opsDir, "2026-04-08-openplan-production-authenticated-smoke.md"),
      "PASS: Created QA auth user.\nPASS: Dashboard rendered.\n",
      "utf8",
    );

    const statuses = getSmokeStatus(opsDir);
    expect(statuses.find((status) => status.lane === "Authenticated Auth")).toMatchObject({
      status: "PASS",
      lastRun: "2026-04-08",
      details: "2026-04-08-openplan-production-authenticated-smoke.md",
    });
  });
});
