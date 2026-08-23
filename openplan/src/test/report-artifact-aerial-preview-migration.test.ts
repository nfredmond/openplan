import { describe, expect, it } from "vitest";
import { readMigration } from "./migrations/read-migrations";

const sql = readMigration("20260823000001_report_artifact_aerial_preview_mime.sql");

describe("report artifact aerial-preview storage upgrade", () => {
  it("appends PNG without replacing an installation's existing MIME allowlist", () => {
    expect(sql).toMatch(/UPDATE storage\.buckets/i);
    expect(sql).toMatch(/WHERE id = 'report-artifacts'/i);
    expect(sql).toMatch(/array_append\(allowed_mime_types, 'image\/png'\)/i);
    expect(sql).toMatch(/NOT \('image\/png' = ANY\(allowed_mime_types\)\)/i);
    expect(sql).not.toMatch(/SET allowed_mime_types\s*=\s*ARRAY\[/i);
  });

  it("leaves an unrestricted NULL allowlist unrestricted", () => {
    expect(sql).toMatch(/allowed_mime_types IS NOT NULL/i);
  });
});
