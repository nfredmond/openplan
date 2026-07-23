import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SURVEY_QUESTION_TYPES_LIST } from "@/lib/engagement/survey";

// Guards against catalog drift: the survey.ts vocabulary and every DB
// question_type CHECK list must stay identical. Adding a 10th type to only one
// side fails here.
const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260722000007_engagement_survey_builder.sql"),
  "utf8"
);

function extractCheckLists(sql: string): string[][] {
  const lists: string[][] = [];
  const re = /question_type\s+IN\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const values = Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1]);
    lists.push(values);
  }
  return lists;
}

describe("survey catalog ↔ DB CHECK parity", () => {
  const lists = extractCheckLists(migrationSql);

  it("finds the question_type CHECK on both the questions and answers tables", () => {
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });

  it("every DB question_type CHECK list equals SURVEY_QUESTION_TYPES_LIST", () => {
    const expected = [...SURVEY_QUESTION_TYPES_LIST].sort();
    for (const list of lists) {
      expect([...list].sort()).toEqual(expected);
    }
  });

  it("SURVEY_QUESTION_TYPES_LIST has exactly the 9 supported types, no duplicates", () => {
    expect(new Set(SURVEY_QUESTION_TYPES_LIST).size).toBe(SURVEY_QUESTION_TYPES_LIST.length);
    expect(SURVEY_QUESTION_TYPES_LIST.length).toBe(9);
  });
});
