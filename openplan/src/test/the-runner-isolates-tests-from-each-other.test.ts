import { describe, it, expect, vi } from "vitest";

/*
  These three switches live in `vitest.config.ts`, and nothing else in the suite
  can tell you whether they are still on. They were turned on 2026-08-22 after
  `--sequence.shuffle` kept finding failures whose cause was always the same
  shape: one file stubbed a global, an env var, or accumulated calls on a shared
  mock, and the next file in the same worker process inherited it. Vitest reuses
  a worker across test files, so "it passed in file-name order" was never
  evidence of isolation.

  Fixing that per-file is a convention — ~1,000 files each having to remember.
  The config is the mechanism. This file is what makes removing the mechanism
  fail out loud instead of quietly restoring order-dependence.

  Each assertion pairs a test that DIRTIES state with a following test that
  asserts the runner cleaned it. Verified 2026-08-22 by flipping each option to
  false and confirming the matching test fails; a version of this file that
  passes with the options off proves nothing.
*/

describe("the runner unstubs globals between tests", () => {
  it("stubs a global", () => {
    vi.stubGlobal("__openplanIsolationProbe", "stubbed");
    expect((globalThis as Record<string, unknown>).__openplanIsolationProbe).toBe("stubbed");
  });

  it("does not inherit the stubbed global", () => {
    expect((globalThis as Record<string, unknown>).__openplanIsolationProbe).toBeUndefined();
  });
});

describe("the runner unstubs env vars between tests", () => {
  it("stubs an env var", () => {
    vi.stubEnv("OPENPLAN_ISOLATION_PROBE", "stubbed");
    expect(process.env.OPENPLAN_ISOLATION_PROBE).toBe("stubbed");
  });

  it("does not inherit the stubbed env var", () => {
    expect(process.env.OPENPLAN_ISOLATION_PROBE).toBeUndefined();
  });
});

// Deliberately shared across tests, the way a module-level `vi.fn()` in a real
// test file is shared — that sharing is the whole hazard being guarded.
const sharedMock = vi.fn(() => "implementation survives");

describe("the runner clears mock call history between tests", () => {
  it("calls the shared mock", () => {
    sharedMock();
    expect(sharedMock).toHaveBeenCalledTimes(1);
  });

  it("does not inherit its call history", () => {
    expect(sharedMock).toHaveBeenCalledTimes(0);
  });

  it("still has its implementation — clearMocks is not mockReset", () => {
    expect(sharedMock()).toBe("implementation survives");
  });
});
