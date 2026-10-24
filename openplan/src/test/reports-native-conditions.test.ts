// @vitest-environment node
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The config declares the expected condition independently of observed exports.
// This marker grants no LIVE_RLS mode, session, fixture or target admission.
const expectsServerExport = process.env.OPENPLAN_REPORTS_NATIVE_CONDITIONS === "react-server";
const serverOnlyPackage: string = "server-only";
const requirePackage = createRequire(import.meta.url);
const expectedPath = fileURLToPath(new URL(
  `../../node_modules/server-only/${expectsServerExport ? "empty.js" : "index.js"}`,
  import.meta.url,
));
const refusal = "This module cannot be imported from a Client Component module. It should only be used from a Server Component.";

describe("Reports server-only package conditions", () => {
  it("Node createRequire resolves and loads the configured original export", () => {
    expect(requirePackage.resolve(serverOnlyPackage)).toBe(expectedPath);
    if (expectsServerExport) {
      expect(() => requirePackage(serverOnlyPackage)).not.toThrow();
    } else {
      expect(() => requirePackage(serverOnlyPackage)).toThrow(refusal);
    }
  });

  it("Vitest dynamic import loads or refuses the configured original export", async () => {
    // A package-name variable avoids claiming type declarations that this
    // untyped marker package does not publish. Vitest still loads the package.
    if (expectsServerExport) {
      await expect(import(serverOnlyPackage)).resolves.toBeDefined();
    } else {
      await expect(import(serverOnlyPackage)).rejects.toThrow(refusal);
    }
  });
});
