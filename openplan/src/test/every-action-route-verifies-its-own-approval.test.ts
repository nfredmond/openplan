import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";
import { resolveActionApiPaths, resolveRouteFile } from "./helpers/action-route-resolution";

/**
 * THE APPROVAL TIER IS ENFORCED WHERE THE WRITE HAPPENS, OR IT IS NOT ENFORCED.
 *
 * `executeAction` refuses to run an `approval_required` action without evidence
 * (`src/lib/runtime/action-registry.ts`). That check runs in the BROWSER. It is
 * a good check and it stops the copilot from firing without an approval sheet;
 * it stops nothing at all from a fetch typed into a console with a session
 * cookie attached.
 *
 * The only real boundary is `verifyAssistantActionApproval` in the target route
 * — which recomputes the hash from its own parsed data, matches it against a
 * single-use row, and consumes it. Nothing forces a route to call it. An action
 * can be fully registered, tiered `approval_required`, and rendered behind the
 * amber approval sheet, while the route it targets checks nothing whatsoever.
 * The planner would see a consent dialog guarding a door with no lock.
 *
 * That is a defect class the eventual agentic layer would inherit at scale, so
 * it is closed here, mechanically, from the registry — no hand-written list of
 * routes to keep in sync.
 *
 * THE ASSERTION MATCHES THE CALL, NOT THE IMPORT. `import { verifyAssistant… }`
 * has no open paren after the name; `await verifyAssistantActionApproval({` has
 * one. A guard that matched the import would pass on a route that imported the
 * function and never called it, which is precisely the state it exists to catch.
 */

const KINDS = Object.keys(ACTION_METADATA) as AssistantQuickLinkExecuteAction["kind"][];

/** `name(` — a call — and never the bare identifier an import line contains. */
function callsFunction(source: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(source);
}

describe("every registered action's route enforces the seam itself", () => {
  for (const kind of KINDS) {
    const metadata = ACTION_METADATA[kind];

    it(`${kind} (${metadata.approval}) reaches a route that verifies approval and writes an audit row`, () => {
      const apiPaths = resolveActionApiPaths(kind);
      expect(apiPaths.length, `could not resolve any API path for ${kind}`).toBeGreaterThan(0);

      for (const apiPath of apiPaths) {
        const routeFile = resolveRouteFile(apiPath);
        expect(routeFile, `no route file matched ${apiPath} (for ${kind})`).not.toBeNull();

        const source = readFileSync(routeFile as string, "utf8");

        expect(
          callsFunction(source, "verifyAssistantActionApproval"),
          `${routeFile} is the execution path for ${kind}, but it never CALLS ` +
            "verifyAssistantActionApproval. The approval tier would be enforced only in the browser."
        ).toBe(true);

        // Either the wrapper or the row writer it wraps. `POST /api/reports`
        // calls `recordAssistantActionExecution` directly because its write is
        // not a single awaited body it can hand to a wrapper; the ledger row is
        // written either way, and requiring the wrapper specifically would be a
        // guard about code shape rather than about the ledger.
        expect(
          callsFunction(source, "withAssistantActionAudit") ||
            callsFunction(source, "recordAssistantActionExecution"),
          `${routeFile} is the execution path for ${kind}, but it never CALLS ` +
            "withAssistantActionAudit or recordAssistantActionExecution. The action would " +
            "execute with no row in the ledger."
        ).toBe(true);
      }
    });
  }
});

describe("the call-vs-import distinction this guard rests on", () => {
  it("does not count an import of the verifier as a use of it", () => {
    const importOnly = 'import { verifyAssistantActionApproval } from "@/lib/assistant/action-approval-server";';
    expect(callsFunction(importOnly, "verifyAssistantActionApproval")).toBe(false);
  });

  it("counts an awaited call", () => {
    expect(
      callsFunction("const approval = await verifyAssistantActionApproval({", "verifyAssistantActionApproval")
    ).toBe(true);
  });
});
