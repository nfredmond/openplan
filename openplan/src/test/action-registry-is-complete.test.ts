import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { ACTION_REGISTRY } from "@/lib/runtime/action-registry";
import { assistantApprovalActionSchema } from "@/lib/assistant/action-approval-server";
import {
  buildAssistantChatTools,
  createChatToolBudget,
  isAssistantChatProposal,
} from "@/lib/assistant/chat-tools";
import type { AssistantContext } from "@/lib/assistant/context";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

/**
 * REGISTERING AN ACTION TOUCHES EIGHT FILES, AND THE COMPILER CHECKS TWO OF THEM.
 *
 * CLAUDE.md records the cost honestly: adding a variant to
 * `AssistantQuickLinkExecuteAction` makes the build fail in the two mapped types
 * over the union (`action-metadata.ts`, `action-registry.ts`) and NOWHERE ELSE.
 * Everything after that is hand-maintained against a type nothing compares it
 * to:
 *
 *   - `assistantApprovalActionSchema` is a zod union written by hand. A kind with
 *     no branch type-checks fine, and `buildAssistantProposalTools` then SKIPS it
 *     with a `console`-level warning — the action silently gets no `propose_`
 *     tool, so the model can never offer it.
 *   - reachability is nobody's compile error. An action can be registered,
 *     tiered, audited, and route-verified while no quick link and no chat tool
 *     can produce it — the shipped-invisible defect class, eleven instances and
 *     counting.
 *
 * WHAT THIS GUARD ADDS THAT THE NEIGHBOURS DO NOT.
 *   - `action-registry.test.ts` asserts the registry's key set against a
 *     HARDCODED array of eight strings. That is the debt this file is written to
 *     retire: every count and every list here is derived from `ACTION_METADATA`,
 *     so a ninth action is checked the moment it is added rather than when
 *     somebody remembers to extend a literal.
 *   - `every-action-route-verifies-its-own-approval.test.ts` covers the far end
 *     of the wire (does the ROUTE verify?). This file covers the near end (can
 *     the action be constructed, validated, and offered at all?).
 *
 * THE ZOD ASSERTION IS BEHAVIOURAL, DELIBERATELY. Scanning
 * `action-approval-server.ts` for the kind's name would pass on a branch whose
 * discriminator literal is wrong, on a branch commented out around a mention in
 * prose, and on a branch no payload can satisfy. So a minimal payload is
 * SYNTHESISED for each kind and pushed through the real
 * `assistantApprovalActionSchema.safeParse` and through the real `propose_`
 * tool. The schema either accepts a payload for that kind or it does not.
 */

type ActionKind = AssistantQuickLinkExecuteAction["kind"];

const KINDS = Object.keys(ACTION_METADATA) as ActionKind[];

/** The five fields `ActionMetadata` promises every entry declares. */
const REQUIRED_METADATA_FIELDS = ["kind", "description", "approval", "auditEvent", "regrounding"] as const;

const APPROVAL_TIERS = ["safe", "review", "approval_required"];
const REGROUNDING_MODES = ["refresh_preview", "none"];

const GUARD_STRING = "openplan-registry-guard";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

/* -------------------------------------------------------------------------- */
/* Minimal-payload synthesis                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Values a field schema itself names — enum members, literals — collected
 * without depending on a zod internal layout. Everything is discovered through
 * public-ish surfaces (`value`, `values`, `options`, `_def.values`,
 * `_def.entries`) and non-primitives are dropped, so a `ZodUnion`'s `.options`
 * (which holds schemas, not values) contributes nothing rather than garbage.
 */
function declaredValues(schema: unknown): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const push = (value: unknown) => {
    if (value === undefined) return;
    if (value !== null && typeof value === "object") return;
    if (typeof value === "function") return;
    if (seen.has(value)) return;
    seen.add(value);
    found.push(value);
  };

  const candidateSources = [
    (schema as { value?: unknown } | null)?.value,
    (schema as { values?: unknown } | null)?.values,
    (schema as { options?: unknown } | null)?.options,
    (schema as { _def?: { values?: unknown } } | null)?._def?.values,
    (schema as { _def?: { entries?: unknown } } | null)?._def?.entries,
  ];

  for (const source of candidateSources) {
    if (source === undefined || source === null) continue;
    if (Array.isArray(source)) source.forEach(push);
    else if (source instanceof Set) source.forEach(push);
    else if (typeof source === "object") Object.values(source as Record<string, unknown>).forEach(push);
    else push(source);
  }

  return found;
}

/** Generic shapes tried after whatever the schema itself named. */
const FALLBACK_VALUES: unknown[] = [
  GUARD_STRING,
  1,
  true,
  false,
  [],
  [GUARD_STRING],
  {},
  null,
];

type FieldSchema = { safeParse(value: unknown): { success: boolean } };

function isOptionalField(schema: FieldSchema): boolean {
  return schema.safeParse(undefined).success;
}

/** The first value this field accepts, or `undefined` if nothing offered fits. */
function minimalValueFor(schema: FieldSchema): { ok: true; value: unknown } | { ok: false } {
  for (const candidate of [...declaredValues(schema), ...FALLBACK_VALUES]) {
    if (schema.safeParse(candidate).success) return { ok: true, value: candidate };
  }
  return { ok: false };
}

type SchemaBranch = {
  shape: Record<string, FieldSchema>;
};

/**
 * The branch of the discriminated union that claims this kind — found by asking
 * each branch's own `kind` schema whether it accepts the string, never by
 * reading source text.
 */
function branchForKind(kind: string): SchemaBranch | null {
  for (const option of assistantApprovalActionSchema.options) {
    const branch = option as unknown as SchemaBranch;
    const kindSchema = branch.shape?.kind;
    if (kindSchema && kindSchema.safeParse(kind).success) return branch;
  }
  return null;
}

type SynthesisResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; unsatisfiableFields: string[] };

/** Required fields only — an optional field left out is the minimal payload. */
function synthesizeMinimalPayload(branch: SchemaBranch, kind: string): SynthesisResult {
  const payload: Record<string, unknown> = { kind };
  const unsatisfiableFields: string[] = [];

  for (const [field, fieldSchema] of Object.entries(branch.shape)) {
    if (field === "kind") continue;
    if (isOptionalField(fieldSchema)) continue;

    const minimal = minimalValueFor(fieldSchema);
    if (!minimal.ok) {
      unsatisfiableFields.push(field);
      continue;
    }
    payload[field] = minimal.value;
  }

  if (unsatisfiableFields.length > 0) return { ok: false, unsatisfiableFields };
  return { ok: true, payload };
}

/* -------------------------------------------------------------------------- */
/* Quick-link call sites, read from the operations source                      */
/* -------------------------------------------------------------------------- */

const OPERATIONS_SOURCE_PATH = path.join(process.cwd(), "src/lib/assistant/operations.ts");

/**
 * The kinds that some `quickLink({ executeAction: { kind: … } })` call site can
 * actually emit. Extracted by balanced-brace parsing of each `executeAction:`
 * object rather than by grepping the whole file for the kind's name — the name
 * also appears in imports, comments, and neighbouring prose, none of which is a
 * call site a planner can reach.
 */
function extractQuickLinkActionKinds(source: string): string[] {
  const kinds: string[] = [];
  const marker = /executeAction:\s*\{/g;

  for (const match of source.matchAll(marker)) {
    const openIndex = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let closeIndex = -1;

    for (let index = openIndex; index < source.length; index += 1) {
      const character = source[index];
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }
    if (closeIndex === -1) continue;

    const objectSource = source.slice(openIndex, closeIndex + 1);
    const kindMatch = objectSource.match(/\bkind:\s*"([a-z0-9_]+)"/);
    if (kindMatch) kinds.push(kindMatch[1]);
  }

  return kinds;
}

const QUICK_LINK_ACTION_KINDS = new Set(
  extractQuickLinkActionKinds(readFileSync(OPERATIONS_SOURCE_PATH, "utf8"))
);

/* -------------------------------------------------------------------------- */
/* The real chat tool set                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `buildAssistantChatTools` reads exactly one thing off the context while
 * BUILDING tools — `context.workspace.id` — and everything else only inside a
 * tool body. A fuller fixture would describe a workspace this assertion never
 * looks at.
 */
function chatToolsContext(): AssistantContext {
  return {
    kind: "workspace",
    workspace: { id: WORKSPACE_ID, name: "Guard workspace", plan: null, role: "admin" },
  } as unknown as AssistantContext;
}

/** Every reference check resolves: this guard asks whether the tool can produce a proposal, not whether ids exist. */
function alwaysResolvingSupabase() {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const name of ["select", "eq", "in", "order", "limit", "gte", "lte", "is"]) {
    chain[name] = passthrough;
  }
  chain.maybeSingle = () => Promise.resolve({ data: { id: GUARD_STRING }, error: null });
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: [{ id: GUARD_STRING }], error: null }).then(resolve, reject);
  return { from: () => chain, rpc: () => Promise.resolve({ data: [], error: null }) };
}

function buildRealChatTools() {
  return buildAssistantChatTools({
    supabase: alwaysResolvingSupabase(),
    context: chatToolsContext(),
    userId: USER_ID,
    audit: { info: () => {}, warn: () => {}, error: () => {} },
    budget: createChatToolBudget({ maxCalls: KINDS.length * 4 }),
  });
}

type ToolLike = { execute?: (input: unknown, options: { toolCallId: string }) => Promise<unknown> };

/* -------------------------------------------------------------------------- */
/* The guard                                                                   */
/* -------------------------------------------------------------------------- */

describe("the action registry is complete for every kind it declares", () => {
  it("has at least one registered action to check (the loops below are not vacuous)", () => {
    expect(KINDS.length).toBeGreaterThan(0);
  });

  for (const kind of KINDS) {
    describe(kind, () => {
      it("declares the five metadata fields", () => {
        const metadata = ACTION_METADATA[kind] as unknown as Record<string, unknown>;

        for (const field of REQUIRED_METADATA_FIELDS) {
          expect(
            metadata[field],
            `${kind} is in ACTION_METADATA but declares no ${field}. Approval UI, the audit ledger, ` +
              "and the regrounding step all read this entry."
          ).toBeDefined();
        }

        expect(metadata.kind, `${kind}'s metadata entry names a different kind (${String(metadata.kind)}).`).toBe(kind);
        expect(typeof metadata.description).toBe("string");
        expect(
          String(metadata.description).trim().length,
          `${kind} has an empty description. The description is the sentence a planner reads before approving.`
        ).toBeGreaterThan(0);
        expect(APPROVAL_TIERS, `${kind} declares an unknown approval tier.`).toContain(metadata.approval);
        expect(REGROUNDING_MODES, `${kind} declares an unknown regrounding mode.`).toContain(metadata.regrounding);
        expect(
          String(metadata.auditEvent).startsWith("planner_agent."),
          `${kind}'s auditEvent (${String(metadata.auditEvent)}) is not namespaced planner_agent.`
        ).toBe(true);
      });

      it("has an ActionRecord in the registry map", () => {
        const record = (ACTION_REGISTRY as Record<string, { kind?: string; effect?: unknown } | undefined>)[kind];

        expect(
          record,
          `${kind} is registered in ACTION_METADATA but has no ActionRecord in ACTION_REGISTRY. ` +
            "executeAction would throw at dispatch time."
        ).toBeDefined();
        expect(record?.kind, `${kind}'s ActionRecord is filed under the wrong key.`).toBe(kind);
        expect(typeof record?.effect, `${kind}'s ActionRecord has no effect function.`).toBe("function");
      });

      it("has a zod branch that accepts a minimal payload for the kind", () => {
        const branch = branchForKind(kind);
        expect(
          branch,
          `${kind} has no branch in assistantApprovalActionSchema. This type-checks fine — the schema is a ` +
            "hand-written union nothing compares to the action type — and the consequence is silent: " +
            "buildAssistantProposalTools skips the kind, so no propose_ tool is ever built and the approvals " +
            "route would reject the payload anyway."
        ).not.toBeNull();

        const synthesized = synthesizeMinimalPayload(branch as SchemaBranch, kind);
        expect(
          synthesized.ok,
          synthesized.ok
            ? ""
            : `${kind}'s zod branch has required field(s) no value satisfies: ` +
              `${(synthesized as { unsatisfiableFields: string[] }).unsatisfiableFields.join(", ")}. ` +
              "Either the branch is unsatisfiable (nothing could ever be approved) or this guard's candidate " +
              "values need to learn a new field shape — check which before relaxing anything."
        ).toBe(true);

        const payload = (synthesized as { payload: Record<string, unknown> }).payload;
        const parsed = assistantApprovalActionSchema.safeParse(payload);

        expect(
          parsed.success,
          `${kind}'s minimal payload was rejected by assistantApprovalActionSchema: ` +
            `${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`
        ).toBe(true);
        expect((parsed as { data: { kind: string } }).data.kind).toBe(kind);
      });

      it("is reachable — a quick link or a chat tool can actually produce it", async () => {
        const tools = buildRealChatTools() as Record<string, ToolLike>;
        const proposeTool = tools[`propose_${kind}`];
        const hasQuickLinkSite = QUICK_LINK_ACTION_KINDS.has(kind);

        expect(
          Boolean(proposeTool) || hasQuickLinkSite,
          `${kind} is registered but nothing can emit it: there is no propose_${kind} chat tool and no ` +
            "quickLink({ executeAction }) call site in src/lib/assistant/operations.ts. A registered action " +
            "no planner can reach is the shipped-invisible defect class."
        ).toBe(true);

        // Where the chat tool exists, prove it end-to-end rather than by name:
        // build the real tool, run it on the synthesized payload, and require an
        // actual proposal back.
        if (proposeTool?.execute) {
          const branch = branchForKind(kind);
          const synthesized = synthesizeMinimalPayload(branch as SchemaBranch, kind);
          if (!synthesized.ok) return; // already reported by the zod-branch test

          const input = { ...synthesized.payload } as Record<string, unknown>;
          delete input.kind;
          // The tool refuses a payload naming another workspace; the id it must
          // match is knowable only here.
          if ("workspaceId" in input) input.workspaceId = WORKSPACE_ID;

          const result = await proposeTool.execute(input, { toolCallId: `guard-${kind}` });

          expect(
            isAssistantChatProposal(result),
            `propose_${kind} exists but did not return a proposal for a minimal valid payload: ` +
              `${JSON.stringify(result)}`
          ).toBe(true);
          expect((result as { kind: string }).kind).toBe(kind);
        }
      });
    });
  }
});

describe("the registry's own edges — nothing extra, nothing orphaned", () => {
  it("registers exactly as many ActionRecords as there are metadata entries", () => {
    // Derived on both sides. A literal here would be the same debt this file
    // exists to retire.
    expect(Object.keys(ACTION_REGISTRY).length).toBe(Object.keys(ACTION_METADATA).length);
    expect(Object.keys(ACTION_REGISTRY).sort()).toEqual(Object.keys(ACTION_METADATA).sort());
  });

  it("carries no zod branch for a kind the registry does not declare", () => {
    const branchKinds = assistantApprovalActionSchema.options
      .map((option) => {
        const shape = (option as unknown as SchemaBranch).shape;
        return declaredValues(shape?.kind).find((value) => typeof value === "string") as string | undefined;
      })
      .filter((value): value is string => typeof value === "string");

    expect(branchKinds.length, "no branch discriminator could be read — the introspection is broken").toBe(
      assistantApprovalActionSchema.options.length
    );

    for (const branchKind of branchKinds) {
      expect(
        KINDS as string[],
        `assistantApprovalActionSchema accepts "${branchKind}", which is in no ACTION_METADATA entry. ` +
          "An approvable payload with no metadata has no approval tier and no audit event."
      ).toContain(branchKind);
    }
  });

  it("has no quick-link call site emitting an unregistered action kind", () => {
    expect(
      QUICK_LINK_ACTION_KINDS.size,
      "no executeAction call site was parsed out of operations.ts — the extractor is broken, and every " +
        "reachability assertion resting on it would pass by finding nothing"
    ).toBeGreaterThan(0);

    for (const quickLinkKind of QUICK_LINK_ACTION_KINDS) {
      expect(
        KINDS as string[],
        `src/lib/assistant/operations.ts offers a quick link with executeAction kind "${quickLinkKind}", ` +
          "which is in no ACTION_METADATA entry. resolveQuickLinkApproval would read undefined metadata."
      ).toContain(quickLinkKind);
    }
  });
});

describe("this guard's own machinery", () => {
  it("treats an optional field as omittable and a required one as needed", () => {
    const branch = branchForKind(KINDS[0]);
    expect(branch).not.toBeNull();
    const shape = (branch as SchemaBranch).shape;

    // Every action variant carries the three presentation-only post-action
    // fields, and all three are optional — so this is a stable probe.
    expect(isOptionalField(shape.postActionPrompt)).toBe(true);
    expect(isOptionalField(shape.kind)).toBe(false);
  });

  it("finds no value for an unsatisfiable field rather than inventing one", () => {
    const impossible: FieldSchema = { safeParse: () => ({ success: false }) };
    expect(minimalValueFor(impossible).ok).toBe(false);
  });

  it("reads a kind out of a nested executeAction object, and ignores mere mentions", () => {
    const source = `
      // create_funding_opportunity is discussed here in a comment.
      quickLink({
        id: "x",
        executeAction: {
          kind: "record_stage_gate_hold",
          missingArtifacts: { nested: "brace" },
        },
      });
      const unrelated = { kind: "create_project_record" };
    `;
    expect(extractQuickLinkActionKinds(source)).toEqual(["record_stage_gate_hold"]);
  });
});
