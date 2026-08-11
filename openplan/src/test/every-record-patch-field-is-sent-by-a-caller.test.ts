import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// PROSE IS NOT THE ARTIFACT. A comment inside a payload reading "…so `note:` is
// left alone" would register `note` as a field the product sends, and this
// guard would go quiet about the very gap it exists to find. One shared,
// tested stripper — see src/test/one-comment-stripper.test.ts.
import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * A FIELD THE ROUTE ACCEPTS THAT NO SURFACE SENDS IS A SHIPPED-INVISIBLE
 * CAPABILITY, and `every-api-route-has-a-caller` cannot see it.
 *
 * That guard asks whether a ROUTE has a caller. PATCH
 * /api/projects/[projectId]/records/[recordId] had two — and `assigneeUserId`,
 * complete with roster validation and six route tests, had none. Assignment was
 * create-time only for as long as that gap existed: nobody could reassign or
 * unassign an existing deliverable, milestone, submittal or issue, and a
 * departed member's work could not be handed to anyone. The route's own header
 * asserted a "reassignment UI" that had never been built.
 *
 * So this guard works one level down: for every field the route's zod schema
 * ACCEPTS, some non-test, non-route file in `src/` must actually send it.
 *
 * HOW IT AVOIDS BEING VACUOUS.
 * - Both halves are DERIVED, never listed here. The accepted fields are parsed
 *   out of the route's own schema; the sent fields are parsed out of the body
 *   of every `fetch(...)` in `src/` that targets this route. A list retyped in
 *   a test agrees with itself forever.
 * - Tests are excluded from the caller sweep on purpose. A route test posting
 *   a field proves the ROUTE handles it, which is exactly the evidence that
 *   made this defect invisible for as long as it lasted.
 * - The extraction is asserted on before it is used: no callers found, or no
 *   fields parsed, fails loudly rather than passing over nothing.
 *
 * KNOWN_UNSENT is a RATCHET, not an exemption list. An entry that becomes
 * sendable, or that leaves the schema, fails the build — so the list can only
 * shrink.
 *
 * WHAT IT DOES NOT PROVE, so nobody mistakes it for the whole answer: it finds
 * the FETCH, not the mount. A component that sends `assigneeUserId` and is
 * rendered by no page would satisfy this guard while remaining unreachable —
 * the same defect one level further out. That half is
 * `the-record-reassignment-control-is-reachable.test.tsx`, which drives the
 * real board and the real risk log. The two are complementary and neither
 * substitutes for the other.
 */

const ROUTE_FILE = path.join(
  process.cwd(),
  "src/app/api/projects/[projectId]/records/[recordId]/route.ts"
);

/** The URL shape every caller of this route writes. */
const ROUTE_URL_FRAGMENT = "/records/${";

/**
 * Fields the schema accepts that nothing in the product sends yet, each with
 * the reason it is still open. Delete an entry the moment a surface sends it —
 * a stale entry fails below.
 *
 * `note` (2026-08-11): the milestone and submittal branches accept a free-text
 * note, and only the CREATE composer ever writes one. Editing a recorded note
 * is the same shipped-invisible shape as reassignment was, found by this guard
 * on the day it was written, and left as its own change rather than smuggled
 * into the reassignment one.
 */
const KNOWN_UNSENT: Record<string, string> = {
  note: "Milestone/submittal notes are writable only at creation; no edit surface exists yet.",
};

/** A minimal core the parser must find, or the parser itself is broken. */
const PARSER_SANITY_FIELDS = ["recordType", "status", "assigneeUserId"];

function readRoute(): string {
  return fs.readFileSync(ROUTE_FILE, "utf8");
}

/**
 * The fields `updateRecordSchema` accepts, read out of the schema literal.
 *
 * Scoped to that one declaration so the route's OTHER schemas (`paramsSchema`)
 * cannot leak in — a params field is not something a request body carries.
 */
export function acceptedPatchFields(source: string): string[] {
  const start = source.indexOf("const updateRecordSchema");
  const end = source.indexOf("]).superRefine", start);
  if (start === -1 || end === -1) return [];
  const block = source.slice(start, end);
  return [...new Set([...block.matchAll(/(\w+):\s*z\./g)].map((match) => match[1]))].sort();
}

/** The text of a call/expression starting at `open`, balanced across delimiters. */
function balancedFrom(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open);
}

/**
 * The body keys every `fetch(...)` in `source` that targets this route sends.
 *
 * Only what is inside that call's `JSON.stringify(...)` counts, so `method` and
 * `headers` — request plumbing, not payload — stay out. Three literal forms all
 * count, because all three are how this repo's callers are actually written:
 * `field: value`, the shorthand `field,`, and a conditional spread
 * (`...(edited ? { budgetAmount: x } : {})`). An optional field is still a field
 * a planner can send.
 */
export function fieldsSentByCaller(source: string): string[] {
  const sent = new Set<string>();
  let cursor = 0;
  for (;;) {
    const at = source.indexOf("fetch(", cursor);
    if (at === -1) break;
    cursor = at + 1;
    const call = balancedFrom(source, at + "fetch".length);
    if (!call.includes(ROUTE_URL_FRAGMENT)) continue;
    let bodyCursor = 0;
    for (;;) {
      const stringifyAt = call.indexOf("JSON.stringify(", bodyCursor);
      if (stringifyAt === -1) break;
      bodyCursor = stringifyAt + 1;
      const payload = stripSourceComments(balancedFrom(call, stringifyAt + "JSON.stringify".length));
      for (const match of payload.matchAll(/(\w+)\s*:/g)) sent.add(match[1]);
      // Shorthand: `{ recordType, status }` names two fields and colours no
      // colon. Missing this form is how a guard reports a wired field as unsent.
      for (const match of payload.matchAll(/[{,]\s*(\w+)\s*(?=[,}])/g)) sent.add(match[1]);
    }
  }
  return [...sent];
}

/** Every non-test, non-route source file under `src/`. */
function productSourceFiles(): string[] {
  const root = path.join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (full.endsWith(path.join("src", "test"))) continue;
        if (full.endsWith(path.join("src", "app", "api"))) continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  return files;
}

function callersOfTheRecordsPatchRoute(): Array<{ file: string; fields: string[] }> {
  return productSourceFiles()
    .map((file) => ({ file, source: fs.readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes(ROUTE_URL_FRAGMENT) && source.includes("PATCH"))
    .map(({ file, source }) => ({
      file: path.relative(process.cwd(), file),
      fields: fieldsSentByCaller(source),
    }))
    .filter((caller) => caller.fields.length > 0);
}

describe("the extraction this guard rests on", () => {
  // A broken walk would make every assertion below pass by finding nothing, so
  // the parsers are exercised on a sample whose answer is known by reading it.
  const SAMPLE = `
    await fetch(\`/api/projects/\${projectId}/records/\${recordId}\`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recordType,
        // A comment that mentions ghostField: and must not count.
        status: next,
        ...(edited ? { budgetAmount: amount } : {}),
      }),
    });
    await fetch("/api/somewhere/else", { body: JSON.stringify({ unrelated: 1 }) });
  `;

  it("reads shorthand, explicit and conditionally-spread keys, and no comment text", () => {
    expect(fieldsSentByCaller(SAMPLE).sort()).toEqual(["budgetAmount", "recordType", "status"]);
  });

  it("ignores fetches aimed at another route", () => {
    expect(fieldsSentByCaller(SAMPLE)).not.toContain("unrelated");
  });

  it("takes the accepted fields from the discriminated union, not from the params schema", () => {
    const accepted = acceptedPatchFields(readRoute());
    expect(accepted).toContain("recordType");
    // `projectId`/`recordId` live in `paramsSchema` — URL parameters, never
    // body fields. Counting them would demand a caller that cannot exist.
    expect(accepted).not.toContain("projectId");
    expect(accepted).not.toContain("recordId");
  });
});

describe("every field the project-record PATCH accepts is sent by something a planner can reach", () => {
  it("parses the route's own schema rather than a list retyped here", () => {
    const accepted = acceptedPatchFields(readRoute());
    // If this ever returns [] — a renamed schema, a reshaped union — every
    // assertion below would pass over nothing. Fail here instead.
    expect(accepted.length).toBeGreaterThan(3);
    for (const field of PARSER_SANITY_FIELDS) {
      expect(accepted, `the schema parser must find ${field}`).toContain(field);
    }
  });

  it("finds the real callers, and reads their payloads rather than their imports", () => {
    const callers = callersOfTheRecordsPatchRoute();
    // Two or more, always: the whole defect was one caller set that covered
    // some fields and looked like it covered all of them.
    expect(callers.length, "no product caller of the records PATCH route was found").toBeGreaterThanOrEqual(2);
    for (const caller of callers) {
      expect(caller.fields, `${caller.file} sends no payload keys`).toContain("recordType");
    }
  });

  it("leaves no accepted field that nothing in the product can send", () => {
    const accepted = acceptedPatchFields(readRoute());
    const sent = new Set(callersOfTheRecordsPatchRoute().flatMap((caller) => caller.fields));

    const unsent = accepted.filter((field) => !sent.has(field));
    const unexplained = unsent.filter((field) => !(field in KNOWN_UNSENT));

    expect(
      unexplained,
      `These fields are accepted by ${path.basename(ROUTE_FILE)} and sent by nothing in src/ ` +
        "outside tests and api routes. A field no surface sends is a capability no planner can " +
        "reach: wire a control that sends it, or record it in KNOWN_UNSENT with the reason."
    ).toEqual([]);
  });

  it("keeps KNOWN_UNSENT a ratchet: an entry that is now sendable, or gone, must be deleted", () => {
    const accepted = new Set(acceptedPatchFields(readRoute()));
    const sent = new Set(callersOfTheRecordsPatchRoute().flatMap((caller) => caller.fields));

    for (const [field, reason] of Object.entries(KNOWN_UNSENT)) {
      expect(
        accepted.has(field),
        `KNOWN_UNSENT names "${field}", which the route no longer accepts. Delete the entry.`
      ).toBe(true);
      expect(
        sent.has(field),
        `"${field}" is now sent by a product surface (${reason}). Delete its KNOWN_UNSENT entry ` +
          "so the list can only shrink."
      ).toBe(false);
    }
  });
});
