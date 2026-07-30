import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * A SELF-HOSTED INSTANCE HAS TO BE ABLE TO SAY WHAT IT IS.
 *
 * Every agency runs its own copy of OpenPlan and updates it when it chooses.
 * Once more than one instance exists, three ordinary questions become
 * unanswerable without a version on screen: what is this agency running, does
 * their instance have the fix, and what changed since last month.
 *
 * The version sat at 0.1.0 through 1,875 commits because nothing read it and
 * nothing displayed it. This file exists so that cannot recur quietly.
 */

const APP = process.cwd();

describe("a deployment can name itself", () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.OPENPLAN_COMMIT_SHA;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("reports the version package.json actually declares", async () => {
    const declared = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8")).version as string;
    const { APP_VERSION } = await import("@/lib/runtime/app-version");

    // Read, never restated. A second copy is a second thing to forget, and its
    // failure mode is an instance confidently reporting a version it is not
    // running.
    expect(APP_VERSION).toBe(declared);
    expect(declared).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("says the commit is unrecorded rather than inventing one", async () => {
    const { buildIdentity } = await import("@/lib/runtime/app-version");
    const identity = buildIdentity();

    // No build environment set a commit. A reader who saw only a version could
    // not tell whether the commit was unknown or whether the surface forgot to
    // show it, so it is named as unrecorded.
    expect(identity.commit).toBeNull();
    expect(identity.label).toMatch(/commit unrecorded/i);
    expect(identity.label).toContain(identity.version);
  });

  it("uses the commit Vercel records on every build", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    const { buildIdentity } = await import("@/lib/runtime/app-version");

    const identity = buildIdentity();
    expect(identity.shortCommit).toBe("0123456");
    expect(identity.label).toContain("0123456");
    expect(identity.label).not.toMatch(/unrecorded/i);
  });

  it("lets a non-Vercel host record one too", async () => {
    // FIRST_DEPLOYMENT.md tells agencies to fork and deploy on Vercel, but
    // SELF_HOSTING.md supports any Node host, and those set nothing.
    process.env.OPENPLAN_COMMIT_SHA = "fedcba9876543210fedcba9876543210fedcba98";
    const { buildIdentity } = await import("@/lib/runtime/app-version");

    expect(buildIdentity().shortCommit).toBe("fedcba9");
  });

  it("treats a blank commit variable as no commit at all", async () => {
    // A host that sets the variable to an empty string has recorded nothing.
    // Rendering "OpenPlan 0.2.0 · " with a dangling separator would read as a
    // display bug rather than as missing information.
    process.env.VERCEL_GIT_COMMIT_SHA = "   ";
    const { buildIdentity } = await import("@/lib/runtime/app-version");

    expect(buildIdentity().commit).toBeNull();
    expect(buildIdentity().label).toMatch(/commit unrecorded/i);
  });

  it("is rendered on the dashboard, not merely available to it", () => {
    // The reachability check. `DeploymentHealthPanel` returns null when nothing
    // is wrong, so a healthy instance would show no version at all if this line
    // lived there — and a healthy instance is the common case, not the rare one.
    const dashboard = readFileSync(path.join(APP, "src/app/(app)/dashboard/page.tsx"), "utf8");

    expect(dashboard).toContain("BuildIdentityLine");
    expect(dashboard).toMatch(/<BuildIdentityLine\s*\/>/);
  });
});
