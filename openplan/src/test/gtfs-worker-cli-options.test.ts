// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ run: vi.fn(async () => "pass_complete"), service: {} }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => stubs.service }));
vi.mock("@/lib/gtfs/managed-worker-queue", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/gtfs/managed-worker-queue")>(),
  runGtfsQueueService: stubs.run,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

it("the actual installed CLI passes its configured parse budget to the supervisor", async () => {
  const argv = process.argv, exitCode = process.exitCode;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("OPENPLAN_GTFS_INSTALLATION_ID", "ee000000-0000-4000-8000-000000000008");
  vi.stubEnv("OPENPLAN_GTFS_PARSER_BUILD", "a".repeat(40));
  vi.stubEnv("OPENPLAN_GTFS_PARSE_BUDGET_MS", String(45 * 60_000));
  vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    process.argv = [process.execPath, "gtfs-ingestion.ts", "--once"];
    await import("../../scripts/workers/gtfs-ingestion");
    await vi.waitFor(() => expect(stubs.run).toHaveBeenCalledTimes(1));
    expect(stubs.run).toHaveBeenCalledWith(expect.objectContaining({
      once: true, service: stubs.service,
      parser: expect.objectContaining({ maxRuntimeMs: 45 * 60_000 + 30_000 }),
    }));
  } finally { process.argv = argv; process.exitCode = exitCode; }
});
