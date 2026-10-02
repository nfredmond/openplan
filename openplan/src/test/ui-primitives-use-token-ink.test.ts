import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/**
 * A SHARED PRIMITIVE MAY NOT HARDCODE ITS TEXT COLOUR.
 *
 * The secondary button paired `bg-[color:var(--sand)]` with `text-[#1f2428]`.
 * In dark mode `--sand` is #1a2226, so "Generate the report packet" rendered at
 * about 1.05:1 (KI-2026-09-05-062). The destructive button paired `--urgent`
 * with `text-white`, which is 2.69:1 against the dark-mode coral. Both are the
 * Tailwind form of the defect `themed-surfaces-pair-their-ink` catches in raw
 * CSS, in the one directory where a single literal reaches hundreds of screens.
 *
 * Blind category: this reads class strings in `components/ui` only. It does not
 * see literal ink in feature components, and it does not measure contrast.
 */

const UI_DIR = path.join(process.cwd(), "src/components/ui");
const LITERAL_INK = /(?<![\w-])text-(?:white|black|\[#[0-9a-fA-F]{3,8}\])/g;

function literalInk(source: string): string[] {
  return stripSourceComments(source).match(LITERAL_INK) ?? [];
}

describe("ui primitives use token ink", () => {
  it("finds no literal text colour in any shared primitive", () => {
    const offenders = readdirSync(UI_DIR)
      .filter((file) => file.endsWith(".tsx"))
      .flatMap((file) =>
        literalInk(readFileSync(path.join(UI_DIR, file), "utf8")).map((hit) => `${file}: ${hit}`)
      );

    expect(offenders, "use a paired token such as text-secondary-foreground").toEqual([]);
  });

  it("would catch the two classes that shipped", () => {
    expect(literalInk('secondary: "bg-[color:var(--sand)] text-[#1f2428]"')).toEqual(["text-[#1f2428]"]);
    expect(literalInk('destructive: "bg-destructive text-white"')).toEqual(["text-white"]);
    expect(literalInk('ok: "text-secondary-foreground text-destructive-foreground"')).toEqual([]);
  });
});
