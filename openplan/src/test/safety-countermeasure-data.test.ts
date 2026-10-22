/**
 * The countermeasure list is a versioned, cited data file, and a crash
 * modification factor can only enter it with its CMF Clearinghouse entry.
 *
 * Blind category: this checks the file's shape and citation rules. It cannot
 * check that the FHWA pages still say what the file summarizes; the file's own
 * retrieval note marks that [VERIFY].
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import rawFile from "@/lib/safety/countermeasures/fhwa-proven-safety-countermeasures.v1.json";
import {
  describeCountermeasureSource,
  parseCountermeasureFile,
  SAFETY_COUNTERMEASURE_FILE,
  SAFETY_COUNTERMEASURES,
} from "@/lib/safety/countermeasures";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("the countermeasure data file", () => {
  it("parses and carries its source, retrieval date and version", () => {
    expect(SAFETY_COUNTERMEASURE_FILE.schema).toBe("openplan.safety_countermeasures.v1");
    expect(SAFETY_COUNTERMEASURE_FILE.source.url).toBe("https://highways.dot.gov/safety/proven-safety-countermeasures");
    expect(SAFETY_COUNTERMEASURE_FILE.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SAFETY_COUNTERMEASURE_FILE.source.retrievalNote).toContain("[VERIFY]");
    expect(SAFETY_COUNTERMEASURES.length).toBeGreaterThanOrEqual(10);
  });

  it("cites a federal source page for every countermeasure", () => {
    for (const entry of SAFETY_COUNTERMEASURES) {
      expect(entry.sourceUrl, entry.id).toMatch(/^https:\/\/highways\.dot\.gov\//);
      expect(entry.crashTypes.length, entry.id).toBeGreaterThan(0);
      expect(entry.addresses.trim(), entry.id).not.toBe("");
    }
  });

  it("shows no crash modification factor without a Clearinghouse entry, and marks the gap", () => {
    for (const entry of SAFETY_COUNTERMEASURES) {
      if (entry.cmf === null) {
        expect(entry.cmfNote, entry.id).toContain("[VERIFY]");
      } else {
        expect(entry.cmf.url).toBe(`https://cmfclearinghouse.fhwa.dot.gov/detail.php?facid=${entry.cmf.cmfId}`);
      }
    }
  });

  it("refuses a CMF value with no Clearinghouse citation", () => {
    const broken = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    broken.countermeasures[0].cmf = { value: 0.8, cmfId: 123, url: "https://example.com/cmf", appliesTo: "all crashes" };
    expect(() => parseCountermeasureFile(broken)).toThrow();
  });

  it("refuses a CMF that cites a different Clearinghouse entry than its ID", () => {
    const broken = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    broken.countermeasures[0].cmf = {
      value: 0.8,
      cmfId: 123,
      url: "https://cmfclearinghouse.fhwa.dot.gov/detail.php?facid=999",
      appliesTo: "all crashes",
    };
    expect(() => parseCountermeasureFile(broken)).toThrow();
  });

  it("refuses a missing CMF with no [VERIFY] note", () => {
    const broken = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    broken.countermeasures[0].cmfNote = "Not checked.";
    expect(() => parseCountermeasureFile(broken)).toThrow(/VERIFY/);
  });

  it("refuses a duplicate id and an unknown crash type", () => {
    const duplicate = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    duplicate.countermeasures.push(clone(duplicate.countermeasures[0]));
    expect(() => parseCountermeasureFile(duplicate)).toThrow(/Duplicate/);

    const unknownType = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    unknownType.countermeasures[0].crashTypes = ["distracted_driving"];
    expect(() => parseCountermeasureFile(unknownType)).toThrow();
  });

  it("refuses a file with no retrieval date", () => {
    const broken = clone(rawFile) as { source: Record<string, unknown> };
    delete broken.source.retrievedOn;
    expect(() => parseCountermeasureFile(broken)).toThrow();
  });

  it("prints the source and retrieval date on one line", () => {
    const line = describeCountermeasureSource();
    expect(line).toContain(SAFETY_COUNTERMEASURE_FILE.source.url);
    expect(line).toContain(`Retrieved ${SAFETY_COUNTERMEASURE_FILE.source.retrievedOn}`);
    expect(line).toContain(`list version ${SAFETY_COUNTERMEASURE_FILE.version}`);
  });
});

describe("components read the list instead of spelling it", () => {
  function sourceFiles(root: string): string[] {
    return readdirSync(root).flatMap((entry) => {
      const full = path.join(root, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it("names no countermeasure in a component file", () => {
    const files = sourceFiles(path.join(process.cwd(), "src/components"));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return SAFETY_COUNTERMEASURES.filter((entry) => entry.name.length > 12 && text.includes(entry.name)).map(
        (entry) => `${path.relative(process.cwd(), file)}: ${entry.name}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
