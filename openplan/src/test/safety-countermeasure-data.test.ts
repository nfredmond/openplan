/**
 * The countermeasure list is a versioned, cited data file, and a crash
 * modification factor can only enter it with its CMF Clearinghouse entry.
 *
 * Blind category: this checks the file's shape and citation rules. It cannot
 * check that the FHWA pages still say what the file summarizes, or that FHWA's
 * live list still matches the newest Internet Archive capture; the file's own
 * retrieval note marks both [VERIFY].
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import rawFile from "@/lib/safety/countermeasures/fhwa-proven-safety-countermeasures.v1.json";
import {
  COUNTERMEASURE_FUNDING_CHECK,
  countermeasureLabel,
  countermeasureListStatus,
  countermeasureListStatusDetail,
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

  it("cites a federal source page for every countermeasure, archived for an item FHWA removed", () => {
    for (const entry of SAFETY_COUNTERMEASURES) {
      expect(entry.sourceUrl, entry.id).toMatch(
        entry.fhwaList.status === "on_list"
          ? /^https:\/\/highways\.dot\.gov\//
          : /^https:\/\/web\.archive\.org\/web\/\d{8}\/https:\/\/highways\.dot\.gov\/safety\/proven-safety-countermeasures\//,
      );
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

  // D6: FHWA's list page, read 2026-11-13, groups six items under Roadway
  // Departure. Each carries FHWA's exact name and its own FHWA page.
  it("carries every roadway-departure item on FHWA's list, each with its own FHWA page", () => {
    const expected: Array<[string, string]> = [
      ["Enhanced Delineation for Horizontal Curves", "enhanced-delineation-horizontal-curves"],
      ["Longitudinal Rumble Strips and Stripes on Two-Lane Roads", "longitudinal-rumble-strips-and-stripes-two-lane-roads"],
      ["Median Barriers", "median-barriers"],
      ["Roadside Design Improvements at Curves", "roadside-design-improvements-curves"],
      ["SafetyEdge℠", "safetyedgesm"],
      ["Wider Edge Lines", "wider-edge-lines"],
    ];
    const roadwayDeparture = SAFETY_COUNTERMEASURES.filter((entry) => entry.focusArea === "roadway_departure");
    expect(roadwayDeparture.map((entry) => [entry.name, entry.sourceUrl])).toEqual(
      expected.map(([name, slug]) => [name, `https://highways.dot.gov/safety/proven-safety-countermeasures/${slug}`]),
    );
    for (const entry of roadwayDeparture) expect(entry.crashTypes, entry.id).toContain("roadway_departure");
  });

  it("dates its list count to the day the list was read", () => {
    expect(SAFETY_COUNTERMEASURE_FILE.version).toBe(SAFETY_COUNTERMEASURE_FILE.source.retrievedOn);
    expect(SAFETY_COUNTERMEASURE_FILE.listNote).toContain(`read ${SAFETY_COUNTERMEASURE_FILE.source.retrievedOn}`);
  });

  it("prints the source and retrieval date on one line", () => {
    const line = describeCountermeasureSource();
    expect(line).toContain(SAFETY_COUNTERMEASURE_FILE.source.url);
    expect(line).toContain(`Retrieved ${SAFETY_COUNTERMEASURE_FILE.source.retrievedOn}`);
    expect(line).toContain(`list version ${SAFETY_COUNTERMEASURE_FILE.version}`);
  });
});

/**
 * KI-2026-11-14-071: Internet Archive captures of FHWA's list page show these
 * four items on it on 2026-06-30 and absent from 2026-07-10 through the newest
 * capture read, 2026-11-04. Their former FHWA pages return 404 in the newest
 * captures, so each cites the capture of its former page instead. Source: the
 * lead's FHWA list finding (research task 19), read 2026-11-13.
 */
const REMOVED_FROM_FHWA_LIST: Record<string, { slug: string; capturedOn: string }> = {
  "road-diets": { slug: "road-diets-roadway-reconfiguration", capturedOn: "2026-05-06" },
  "bicycle-lanes": { slug: "bicycle-lanes", capturedOn: "2026-06-09" },
  "appropriate-speed-limits": { slug: "appropriate-speed-limits-all-road-users", capturedOn: "2026-06-11" },
  "speed-safety-cameras": { slug: "speed-safety-cameras", capturedOn: "2026-06-03" },
};
const LIST_CAPTURE = "https://web.archive.org/web/20261104165113/https://highways.dot.gov/safety/proven-safety-countermeasures";

describe("items FHWA removed from its list say so (KI-2026-11-14-071)", () => {
  it("marks exactly the four removed items, each with its captures and archived former page", () => {
    const removed = SAFETY_COUNTERMEASURES.filter((entry) => entry.fhwaList.status === "removed");
    expect(removed.map((entry) => entry.id).sort()).toEqual(Object.keys(REMOVED_FROM_FHWA_LIST).sort());
    for (const entry of removed) {
      const expected = REMOVED_FROM_FHWA_LIST[entry.id];
      expect(entry.fhwaList, entry.id).toEqual({
        status: "removed",
        lastSeenOnList: "2026-06-30",
        firstMissingFromList: "2026-07-10",
        stillMissingOn: "2026-11-04",
        listCaptureUrl: LIST_CAPTURE,
        formerPageCapturedOn: expected.capturedOn,
        readOn: "2026-11-13",
      });
      expect(entry.sourceUrl, entry.id).toBe(
        `https://web.archive.org/web/${expected.capturedOn.replace(/-/g, "")}/https://highways.dot.gov/safety/proven-safety-countermeasures/${expected.slug}`,
      );
    }
  });

  it("gives every removed item a status line and every other item none", () => {
    for (const entry of SAFETY_COUNTERMEASURES) {
      const line = countermeasureListStatus(entry);
      if (entry.id in REMOVED_FROM_FHWA_LIST) {
        expect(line, entry.id).toBe("Not on FHWA's Proven Safety Countermeasures list since July 2026.");
        expect(countermeasureLabel(entry), entry.id).toBe(`${entry.name} (not on FHWA's Proven Safety Countermeasures list since July 2026)`);
        expect(countermeasureListStatusDetail(entry), entry.id).toContain(
          "show it on June 30, 2026 and not on July 10, 2026 or November 4, 2026",
        );
      } else {
        expect(line, entry.id).toBeNull();
        expect(countermeasureListStatusDetail(entry), entry.id).toBeNull();
        expect(countermeasureLabel(entry), entry.id).toBe(entry.name);
      }
    }
  });

  it("refuses a removed item cited by a live FHWA URL, and a listed item cited by a capture", () => {
    const live = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    live.countermeasures.find((entry) => entry.id === "bicycle-lanes")!.sourceUrl =
      "https://highways.dot.gov/safety/proven-safety-countermeasures/bicycle-lanes";
    expect(() => parseCountermeasureFile(live)).toThrow(/removed item cites the capture/);

    const relabeled = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    relabeled.countermeasures.find((entry) => entry.id === "bicycle-lanes")!.fhwaList = { status: "on_list" };
    expect(() => parseCountermeasureFile(relabeled)).toThrow(/item on FHWA's list cites its FHWA page/);

    const both = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    const roadDiet = both.countermeasures.find((entry) => entry.id === "road-diets")!;
    roadDiet.fhwaList = { ...(roadDiet.fhwaList as Record<string, unknown>), onList: true };
    expect(() => parseCountermeasureFile(both)).toThrow();

    const unlabeled = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    delete unlabeled.countermeasures.find((entry) => entry.id === "walkways")!.fhwaList;
    expect(() => parseCountermeasureFile(unlabeled)).toThrow();
  });

  it("refuses removal dates out of order", () => {
    const broken = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    const entry = broken.countermeasures.find((item) => item.id === "speed-safety-cameras")!;
    entry.fhwaList = { ...(entry.fhwaList as Record<string, unknown>), firstMissingFromList: "2026-06-01" };
    expect(() => parseCountermeasureFile(broken)).toThrow(/date order/);
  });

  it("uses FHWA's former road diet name in sentence case and no dead or redirecting FHWA link", () => {
    const roadDiet = SAFETY_COUNTERMEASURES.find((entry) => entry.id === "road-diets")!;
    expect(roadDiet.name).toBe("Road diets (roadway reconfiguration)");
    for (const entry of SAFETY_COUNTERMEASURES) {
      expect(entry.sourceUrl, entry.id).not.toContain("road-diets-roadway-configuration");
      expect(entry.sourceUrl, entry.id).not.toContain("speed-safety-cameras-frequently-asked-questions");
      if (entry.fhwaList.status === "removed") expect(entry.cmfNote ?? "", entry.id).not.toMatch(/proven countermeasure/i);
    }
  });

  it("describes FHWA's list as the captures show it", () => {
    const file = SAFETY_COUNTERMEASURE_FILE;
    expect(file.source.newestCaptureOn).toBe("2026-11-04");
    expect(file.source.newestCaptureUrl).toBe(LIST_CAPTURE);
    expect(file.listNote).toContain("names 23 countermeasures in four groups: Pedestrian (6), Roadway Departure (6), Intersections (7) and Crosscutting (4)");
    expect(file.listNote).toContain("Internet Archive captures (newest 2026-11-04)");
    expect(file.source.retrievalNote).toContain("HTTP 403");
    expect(file.source.retrievalNote).toContain("[VERIFY]");
    expect(file.listNote).not.toMatch(/\[VERIFY\] whether FHWA withdrew/);
  });

  it("adds the removal note and the funding check to the source line only when a removed item is in scope", () => {
    const whole = describeCountermeasureSource();
    expect(whole).toContain("read from Internet Archive captures, newest 2026-11-04");
    expect(whole).toContain("cites the Internet Archive capture of its former FHWA page");
    expect(whole).toContain(COUNTERMEASURE_FUNDING_CHECK);

    const current = describeCountermeasureSource({ ids: ["walkways", "lighting"] });
    expect(current).not.toContain("former FHWA page");
    expect(current).not.toContain(COUNTERMEASURE_FUNDING_CHECK);

    expect(describeCountermeasureSource({ ids: ["walkways", "road-diets"] })).toContain(COUNTERMEASURE_FUNDING_CHECK);
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
