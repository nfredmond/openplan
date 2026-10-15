import { expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

it("keeps project jurisdiction mutations outside the approved agent registry", () => {
  const jurisdictionWrite = (kind: string) => kind.includes("project") && kind.includes("jurisdiction");
  expect(jurisdictionWrite("set_project_jurisdiction_context")).toBe(true);
  expect(Object.keys(ACTION_METADATA).filter(jurisdictionWrite), "Project jurisdiction remains a human declaration, with no approved agent write.").toEqual([]);
  expect(Object.keys(ACTION_METADATA)).toContain("create_project_record");
});
