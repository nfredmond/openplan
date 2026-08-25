import { describe, expect, it } from "vitest";
import {
  PORTFOLIO_IMPORT_MAX_BYTES,
  PortfolioImportError,
  reviewPortfolioImport,
  type PortfolioImportDefaults,
} from "@/lib/projects/portfolio-import";

const defaults: PortfolioImportDefaults = {
  planType: "capital_program",
  status: "draft",
  deliveryPhase: "programming",
};

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("reviewPortfolioImport", () => {
  it("parses quoted Unicode cells and keeps unmapped fields out of project rows", () => {
    const review = reviewPortfolioImport({
      bytes: bytes(
        'Name,Description,Location,Ignored\n"Calle, Peatonal","Acceso para niñas y niños","Distrito 2",do not import'
      ),
      mapping: { name: 0, description: 1, sourceLocation: 2 },
      defaults,
    });

    expect(review.headers).toEqual(["Name", "Description", "Location", "Ignored"]);
    expect(review.rows[0]).toMatchObject({
      rowNumber: 2,
      name: "Calle, Peatonal",
      description: "Acceso para niñas y niños",
      sourceLocationText: "Distrito 2",
      decision: "skip",
      state: "clean",
    });
    expect(review.rows[0]).not.toHaveProperty("Ignored");
    expect(JSON.stringify(review.rows[0])).not.toContain("do not import");
  });

  it("keeps duplicate headers addressable by index", () => {
    const review = reviewPortfolioImport({
      bytes: bytes("Project,Project\nExternal-7,Main Street"),
      mapping: { sourceId: 0, name: 1 },
      defaults,
    });

    expect(review.duplicateHeaders).toEqual([{ header: "project", indexes: [0, 1] }]);
    expect(review.rows[0]).toMatchObject({ sourceId: "External-7", name: "Main Street" });
  });

  it("refuses reused or out-of-range mappings", () => {
    expect(() =>
      reviewPortfolioImport({
        bytes: bytes("Name,Cost\nOne,4"),
        mapping: { name: 0, description: 0 },
        defaults,
      })
    ).toThrowError(expect.objectContaining({ code: "duplicate_mapping" }));
    expect(() =>
      reviewPortfolioImport({
        bytes: bytes("Name\nOne"),
        mapping: { name: 4 },
        defaults,
      })
    ).toThrowError(expect.objectContaining({ code: "invalid_mapping" }));
  });

  it("requires explicit cost metadata and accepts only plain positive decimals", () => {
    expect(() =>
      reviewPortfolioImport({
        bytes: bytes("Name,Cost\nOne,1.25"),
        mapping: { name: 0, estimatedCost: 1 },
        defaults,
      })
    ).toThrowError(expect.objectContaining({ code: "missing_cost_defaults" }));

    const review = reviewPortfolioImport({
      bytes: bytes("Name,Cost\nClean,1.25\nSmall,0.01\nWhole,1000\nComma,1,000\nCurrency,$25\nZero,0\nExponent,1e4"),
      mapping: { name: 0, estimatedCost: 1 },
      defaults: {
        ...defaults,
        cost: { currency: "EUR", scale: "millions", priceYear: 2024 },
      },
    });

    expect(review.rows[0].estimatedCost).toEqual({
      amount: "1250000",
      currency: "EUR",
      priceYear: 2024,
    });
    expect(review.rows[1].estimatedCost?.amount).toBe("10000");
    expect(review.rows[2].estimatedCost?.amount).toBe("1000000000");
    expect(review.rows.slice(3).every((row) => row.errors.length > 0)).toBe(true);
    expect(review.rows.slice(3).map((row) => row.errors.map((entry) => entry.code))).toEqual([
      ["column_count"],
      ["invalid_cost"],
      ["invalid_cost"],
      ["invalid_cost"],
    ]);
  });

  it("blocks every repeated source ID after trimming and case folding", () => {
    const review = reviewPortfolioImport({
      bytes: bytes("ID,Name\nTIP-9,First phase\n tip-9 ,Second phase\nTIP-10,Separate"),
      mapping: { sourceId: 0, name: 1 },
      defaults,
      rowReviews: [
        { rowNumber: 2, decision: "create" },
        { rowNumber: 3, decision: "create" },
        { rowNumber: 4, decision: "create" },
      ],
    });

    expect(review.rows.slice(0, 2).map((row) => row.state)).toEqual(["blocked", "blocked"]);
    expect(review.rows.slice(0, 2).map((row) => row.decision)).toEqual(["skip", "skip"]);
    expect(review.rows[2]).toMatchObject({ state: "clean", decision: "create", canCreate: true });
    expect(review.counts).toMatchObject({ selectedForCreate: 1, conflicted: 2 });
  });

  it("requires individual confirmation for exact normalized-name matches", () => {
    const input = {
      bytes: bytes("Name\n  MAIN   STREET  "),
      mapping: { name: 0 },
      defaults,
      existingProjects: [{ id: "project-1", name: "Main Street" }],
    };
    const unconfirmed = reviewPortfolioImport({
      ...input,
      rowReviews: [{ rowNumber: 2, decision: "create" as const }],
    });
    expect(unconfirmed.rows[0]).toMatchObject({ state: "warning", canCreate: false });
    expect(unconfirmed.rows[0].warnings.map((entry) => entry.code)).toContain(
      "name_match_confirmation_required"
    );

    const confirmed = reviewPortfolioImport({
      ...input,
      rowReviews: [{ rowNumber: 2, decision: "create", confirmNameMatch: true }],
    });
    expect(confirmed.rows[0]).toMatchObject({ state: "warning", canCreate: true, decision: "create" });
  });

  it("applies validated row overrides", () => {
    const review = reviewPortfolioImport({
      bytes: bytes("Name\nOne"),
      mapping: { name: 0 },
      defaults,
      rowReviews: [
        {
          rowNumber: 2,
          decision: "create",
          planType: "bridge_replacement",
          status: "active",
          deliveryPhase: "delivery",
        },
      ],
    });
    expect(review.rows[0]).toMatchObject({
      planType: "bridge_replacement",
      status: "active",
      deliveryPhase: "delivery",
      canCreate: true,
    });
  });

  it("refuses duplicate or out-of-range row decisions", () => {
    const input = { bytes: bytes("Name\nOne"), mapping: { name: 0 }, defaults };
    expect(() =>
      reviewPortfolioImport({
        ...input,
        rowReviews: [
          { rowNumber: 2, decision: "skip" },
          { rowNumber: 2, decision: "create" },
        ],
      })
    ).toThrowError(expect.objectContaining({ code: "invalid_mapping" }));
    expect(() =>
      reviewPortfolioImport({
        ...input,
        rowReviews: [{ rowNumber: 3, decision: "create" }],
      })
    ).toThrowError(expect.objectContaining({ code: "invalid_mapping" }));
  });

  it("locks a previously created source row to skip", () => {
    const first = reviewPortfolioImport({
      bytes: bytes("Name\nOne"),
      mapping: { name: 0 },
      defaults,
    });
    const rerun = reviewPortfolioImport({
      bytes: bytes("Name\nOne"),
      mapping: { name: 0 },
      defaults,
      rowReviews: [{ rowNumber: 2, decision: "create" }],
      previouslyCreatedRows: [
        {
          sourceHash: first.sourceHash,
          rowNumber: 2,
          rowFingerprint: first.rows[0].fingerprint,
          projectId: "project-created",
        },
      ],
    });
    expect(rerun.rows[0]).toMatchObject({
      state: "created_before",
      decision: "skip",
      canCreate: false,
      previouslyCreatedProjectId: "project-created",
    });
  });

  it("produces deterministic row and preview hashes and changes approval when review state changes", () => {
    const input = { bytes: bytes("Name\nOne"), mapping: { name: 0 }, defaults };
    const first = reviewPortfolioImport(input);
    const second = reviewPortfolioImport(input);
    const selected = reviewPortfolioImport({
      ...input,
      rowReviews: [{ rowNumber: 2, decision: "create" }],
    });
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.rows[0].fingerprint).toBe(second.rows[0].fingerprint);
    expect(first.previewHash).toBe(second.previewHash);
    expect(selected.previewHash).not.toBe(first.previewHash);
  });

  it("enforces the 2,000-row and 10 MiB ceilings", () => {
    const tooManyRows = `Name\n${Array.from({ length: 2_001 }, (_, index) => `Project ${index}`).join("\n")}`;
    expect(() =>
      reviewPortfolioImport({ bytes: bytes(tooManyRows), mapping: { name: 0 }, defaults })
    ).toThrowError(expect.objectContaining({ code: "row_limit" }));

    expect(() =>
      reviewPortfolioImport({
        bytes: new Uint8Array(PORTFOLIO_IMPORT_MAX_BYTES + 1),
        mapping: { name: 0 },
        defaults,
      })
    ).toThrowError(expect.objectContaining({ code: "size_limit" }));
  });

  it("refuses missing headers and invalid UTF-8", () => {
    expect(() => reviewPortfolioImport({ bytes: bytes(""), mapping: { name: 0 }, defaults })).toThrow(
      PortfolioImportError
    );
    expect(() =>
      reviewPortfolioImport({ bytes: new Uint8Array([0xff, 0xfe]), mapping: { name: 0 }, defaults })
    ).toThrowError(expect.objectContaining({ code: "invalid_utf8" }));
  });
});
