import { describe, expect, it } from "vitest";
import { buildPilotReadinessPacket } from "@/app/(app)/admin/pilot-readiness/ExportButton";

describe("pilot readiness export packet", () => {
  it("includes the source proof document for each tracked lane", () => {
    const packet = buildPilotReadinessPacket(
      [
        {
          lane: "Authenticated Auth",
          status: "PASS",
          lastRun: "2026-04-08",
          details: "2026-04-08-openplan-production-authenticated-smoke.md",
        },
      ],
      "2026-05-09T00:00:00.000Z",
    );

    expect(packet).toContain("Generated: 2026-05-09T00:00:00.000Z");
    expect(packet).toContain(
      "- **Authenticated Auth**: PASS (Last Run: 2026-04-08; Source: 2026-04-08-openplan-production-authenticated-smoke.md)",
    );
    expect(packet).toContain("Treat PASS lanes as citeable only when the named source document is available");
  });
});
