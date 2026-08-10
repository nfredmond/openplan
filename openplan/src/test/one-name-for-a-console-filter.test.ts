import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assistantLocalConsoleFilterSchema,
  describeConsoleFilter,
  type AssistantLocalConsoleFilter,
} from "@/lib/assistant/local-console-state";
import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * ONE NAME FOR A CONSOLE FILTER.
 *
 * The four planner-facing filter names were written twice: as a switch in
 * `local-console-state.ts`, and again as an inline ternary chain in
 * `app-copilot.tsx`. They had already drifted apart once and were brought back
 * into agreement by a copy pass, which is agreement by coincidence — nothing
 * stopped it happening again.
 *
 * Both copies reach a planner. The lib's name goes into the board-state cue the
 * assistant reads back ("Filter: work to review soon"); the component's went
 * into the sentence offering to widen the view ("Switch to the full view to see
 * …"). Two names for one filter in the same panel is the kind of small wrongness
 * that makes a planner distrust the rest of it.
 *
 * The duplication was flagged with a suggestion to fix it opportunistically,
 * "next time someone is in that file for real work". That is a convention, and
 * this repo's own record is that a convention only written down gets violated at
 * least once. So it is a test.
 */

const SOURCE_ROOT = path.join(process.cwd(), "src");
const DEFINITION = "src/lib/assistant/local-console-state.ts";

/**
 * The `review_soon` label, used as the detector.
 *
 * Deliberately this one of the four: "everything", "what needs doing now" and
 * "background context" all appear in legitimate prose elsewhere in the copilot
 * (five occurrences of "what needs doing now" alone, in sentences that are not
 * this mapping). "work to review soon" is the label and nothing else, so it
 * finds a second copy without firing on ordinary writing.
 */
const REVIEW_SOON_LABEL = "work to review soon";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function filesNamingTheReviewSoonFilter(): string[] {
  return sourceFiles(SOURCE_ROOT)
    .map((full) => path.relative(process.cwd(), full).split(path.sep).join("/"))
    .filter((rel) => !rel.startsWith("src/test/"))
    .filter((rel) => {
      // Comments stripped: a note explaining the label is not a second copy of
      // it. Guards in this repo have been defeated in BOTH directions by their
      // own prose reaching the matcher.
      const source = stripSourceComments(readFileSync(path.join(process.cwd(), rel), "utf8"));
      return source.includes(REVIEW_SOON_LABEL);
    });
}

describe("a console filter has one planner-facing name", () => {
  it("detects the label at all — this guard is not vacuous", () => {
    // If the detector stops matching, the assertion below passes by finding
    // nothing. Anchored to the real definition rather than to a sample.
    expect(describeConsoleFilter("review_soon")).toBe(REVIEW_SOON_LABEL);
    expect(filesNamingTheReviewSoonFilter()).toContain(DEFINITION);
  });

  it("names it in exactly one place", () => {
    const files = filesNamingTheReviewSoonFilter();

    expect(
      files,
      `${files.join(", ")} each name a console filter. There must be one definition: import ` +
        "describeConsoleFilter from @/lib/assistant/local-console-state instead of writing the " +
        "labels again. Two copies of these four strings already drifted apart once."
    ).toEqual([DEFINITION]);
  });

  it("gives every filter a name, so none can fall through to the default", () => {
    // A switch with a `default` returns "everything" for anything it forgot,
    // which reads as a working label rather than a gap. Driving the schema's own
    // vocabulary means a new filter value has to be named here too.
    const filters = assistantLocalConsoleFilterSchema.options as AssistantLocalConsoleFilter[];
    expect(filters.length).toBeGreaterThan(1);

    const names = filters.map((filter) => describeConsoleFilter(filter));
    expect(new Set(names).size).toBe(filters.length);
    for (const name of names) {
      expect(name.trim().length).toBeGreaterThan(0);
    }
    expect(describeConsoleFilter("all")).toBe("everything");
  });
});
