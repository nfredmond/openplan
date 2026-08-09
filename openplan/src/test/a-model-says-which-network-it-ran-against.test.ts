import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  NETWORK_DIGEST_ABSENT_NOTE,
  NETWORK_DIGEST_MEANING,
  shortDigest,
} from "@/lib/models/digest-display";

/**
 * WHICH NETWORK DID THIS MODEL RUN AGAINST?
 *
 * `network_package_versions.file_hash` carried the comment "SHA-256 hash of the
 * primary network bundle for integrity verification" from migration
 * 20260318000029 and was written by nothing until 2026-08-08 — the unread-column
 * sweep found it. It is now computed at ingest and, before this change, still
 * read by nothing: a column that made the schema look like it verified
 * something while answering no question a planner could ask.
 *
 * The question it DOES answer is provenance — two runs against the same digest
 * used the same nodes and links — which is what a planner defending a model
 * gets asked. It cannot answer "is this file uncorrupted?", because there is no
 * file: network content arrives as parsed GeoJSON in a request body. The copy
 * shipped beside it has to say the narrower thing, not the column's old promise.
 */

const PAGE = path.join(process.cwd(), "src/app/(app)/models/[modelId]/page.tsx");

describe("shortDigest", () => {
  it("shows enough of a digest to compare by eye", () => {
    const hash = "3f7a91c4b8e20d5619ab77cc4e10f2836b9d0aa4517e2c3d8f6b1094ee27ab53";
    expect(shortDigest(hash)).toBe("3f7a91c4b8e2…");
  });

  it("leaves a short value whole rather than adding a misleading ellipsis", () => {
    expect(shortDigest("abc123")).toBe("abc123");
    expect(shortDigest("123456789012")).toBe("123456789012");
  });

  it("returns null for an absent digest, never an empty string", () => {
    // An empty string renders as a blank where a value should be, which reads
    // as a value that failed to load rather than one that was never recorded.
    expect(shortDigest(null)).toBeNull();
    expect(shortDigest(undefined)).toBeNull();
    expect(shortDigest("")).toBeNull();
    expect(shortDigest("   ")).toBeNull();
  });
});

describe("what the copy beside a digest is allowed to claim", () => {
  it("claims provenance and explicitly disclaims integrity", () => {
    // The column's ORIGINAL comment promised integrity verification, which this
    // digest cannot deliver — it hashes the parsed payload, so two identical
    // networks with different key ordering digest differently. Repeating that
    // promise on a planner-facing page would be the overclaim the sweep found.
    expect(NETWORK_DIGEST_MEANING).toMatch(/same network|same digest/i);
    expect(NETWORK_DIGEST_MEANING).toMatch(/not a checksum of a file/i);
    expect(NETWORK_DIGEST_MEANING).toMatch(/cannot detect a corrupted upload/i);
  });

  it("treats an absent digest as a known absence, not an uncertainty", () => {
    expect(NETWORK_DIGEST_ABSENT_NOTE).toMatch(/ingested before/i);
    // "Unknown" would blur a precise fact about the record into a doubt about
    // the network — the shape of every honesty defect in this repository.
    expect(NETWORK_DIGEST_ABSENT_NOTE.toLowerCase()).not.toContain("unknown");
    // And it names the way out, so the note is actionable rather than a dead end.
    expect(NETWORK_DIGEST_ABSENT_NOTE).toMatch(/re-ingest/i);
  });
});

describe("the digest reaches the page that renders it", () => {
  it("asks the database for the column it renders", () => {
    /**
     * The assertion a mocked Supabase client cannot make. The clients are
     * untyped by convention, so dropping `file_hash` from the `.select()` leaves
     * every other test green while the page renders nothing — which is
     * indistinguishable, on screen, from a version that genuinely has no digest.
     * That failure mode is worse than a blank: it silently reports the absent
     * note as if it were true.
     */
    const source = readFileSync(PAGE, "utf8");
    const versionRead = source.slice(source.indexOf('.from("network_package_versions")'));
    const projection = /\.select\(\s*"([^"]*)"/.exec(versionRead)?.[1];
    expect(projection, "could not find the network_package_versions projection").toBeTypeOf("string");
    expect(projection!.split(",").map((column) => column.trim())).toContain("file_hash");
  });

  it("renders the digest and the sentence that qualifies it", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain('data-testid="network-basis-digest"');
    expect(source).toContain("NETWORK_DIGEST_MEANING");
    expect(source).toContain("NETWORK_DIGEST_ABSENT_NOTE");
    // Through the shared helper, so this page and the run evidence panel cannot
    // disagree about what a digest looks like.
    expect(source).toContain("shortDigest(networkBasisVersion?.file_hash");
  });

  it("keeps one digest formatter for both surfaces", () => {
    /**
     * `shortHash` used to live inside the run evidence panel, which is one of
     * its two callers — the arrangement this repository has repeatedly seen
     * reimplemented, slightly differently, by the second caller. For a
     * provenance string "slightly differently" means two surfaces disagreeing
     * about whether two runs used the same inputs.
     */
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/models/model-run-evidence-panel.tsx"),
      "utf8"
    );
    expect(panel).toContain('from "@/lib/models/digest-display"');
    expect(panel).not.toContain("function shortHash");
  });
});
