import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectHiddenCharacters } from "@/lib/engagement/hidden-character-inspection";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// Authored source only, UNEXECUTED. These fixtures exercise formatting and byte
// custody, not translation quality, malicious intent or provider resistance.
describe("display-only hidden-character inspection", () => {
  it("keeps harmless text, ordinary tabs/newlines and combining accents intact", () => {
    const text = "Public input\tincludes café and cafe\u0301.\r\nNext line.\n";
    const result = inspectHiddenCharacters(text);
    expect(result.original).toBe(text);
    expect(result.escaped).toBe(text);
    expect(result.total).toBe(0);
    expect(result.counts).toEqual([]);
    expect(result.language).toBeNull();
    expect(result.script).toBeNull();
  });

  it("finds repeated tags and direction controls beyond a moderation snippet", () => {
    const text = "Readable start ".repeat(1000) + "\u202Ereorder\u202C\u{E0061}\u{E0061}\u{E007F} TAIL";
    const result = inspectHiddenCharacters(text);
    expect(result.total).toBe(5);
    expect(result.counts.map(({ codePoint, count, kind }) => ({ codePoint, count, kind }))).toEqual([
      { codePoint: "U+202E", count: 1, kind: "direction" },
      { codePoint: "U+202C", count: 1, kind: "direction" },
      { codePoint: "U+E0061", count: 2, kind: "tag" },
      { codePoint: "U+E007F", count: 1, kind: "tag" },
    ]);
    expect(result.escaped).toContain("\\u{202E}reorder\\u{202C}\\u{E0061}\\u{E0061}\\u{E007F} TAIL");
    expect(result.original).toBe(text);
    expect(digest(result.original)).toBe(digest(text));
  });

  it("exposes every bidi control in logical order, including isolated mixed writing", () => {
    const controls = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    const text = controls.map(code => String.fromCodePoint(code)).join("");
    const result = inspectHiddenCharacters(text);
    expect(result.total).toBe(controls.length);
    expect(result.counts.every(entry => entry.kind === "direction" && entry.count === 1)).toBe(true);
    expect(result.escaped).toBe(controls.map(code => `\\u{${code.toString(16).toUpperCase().padStart(4, "0")}}`).join(""));
    const mixed = "Route 7: \u2067لاہور ۱۲\u2069 stop";
    expect(inspectHiddenCharacters(mixed).original).toBe(mixed);
    expect(inspectHiddenCharacters(mixed).escaped).toBe("Route 7: \\u{2067}لاہور ۱۲\\u{2069} stop");
  });

  it.each([
    { language: "fa", script: "Arab", observed: "Arabic", text: "می\u200Cروم", marker: "\\u{200C}" },
    { language: "pa-Arab", script: "Arab", observed: "Arabic", text: "پنجابی\u200C زبان", marker: "\\u{200C}" },
    { language: "pa-Guru", script: "Guru", observed: "Gurmukhi", text: "ਕ੍\u200Dਹ", marker: "\\u{200D}" },
    { language: "hi", script: "Deva", observed: "Devanagari", text: "क्\u200Dष", marker: "\\u{200D}" },
    { language: "bn", script: "Beng", observed: "Bengali", text: "ক্\u200Cষ", marker: "\\u{200C}" },
    { language: "th", script: "Thai", observed: "Thai", text: "ภาษา\u200Bไทย", marker: "\\u{200B}" },
    { language: "my", script: "Mymr", observed: "Myanmar", text: "မြန်မာ\u200Bစာ", marker: "\\u{200B}" },
    { language: "km", script: "Khmr", observed: "Khmer", text: "ភាសា\u200Bខ្មែរ", marker: "\\u{200B}" },
  ])("preserves $language text while exposing formatting without a verdict", ({ language, script, observed, text, marker }) => {
    const bytes = Buffer.from(text, "utf8");
    const result = inspectHiddenCharacters(text, { language, script });
    expect(result.original).toBe(text);
    expect(Buffer.from(result.original, "utf8")).toEqual(bytes);
    expect(digest(result.original)).toBe(digest(text));
    expect(result.escaped).toContain(marker);
    expect(result.total).toBe(1);
    expect(result.language).toBe(language);
    expect(result.script).toBe(script);
    expect(result.observedScripts).toContain(observed);
    expect(inspectHiddenCharacters(text).language).toBeNull();
    expect(result).not.toHaveProperty("malicious");
    expect(result).not.toHaveProperty("suggested_action");
  });

  it("shows boundaries, selectors and emoji tags without dropping or rejecting them", () => {
    const text = "\uFEFFa\u00A0b\u202Fc\u2060d\u00ADe\u034F 👩\u200D💻 ❤️ \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} 字\u{E0100}";
    const result = inspectHiddenCharacters(text);
    expect(result.original).toBe(text);
    expect(Buffer.from(result.original)).toEqual(Buffer.from(text));
    expect(result.total).toBe(15);
    expect(result.counts.find(entry => entry.codePoint === "U+E0067")?.count).toBe(2);
    expect(result.escaped).toContain("字\\u{E0100}");
    expect(result.escaped).toContain("👩\\u{200D}💻");
  });

  it("distinguishes generated markers from literal participant escape text", () => {
    const result = inspectHiddenCharacters("literal \\u{202E}; actual \u202E");
    expect(result.total).toBe(1);
    expect(result.escaped).toBe("literal \\\\u{202E}; actual \\u{202E}");
  });

  it("covers other default-ignorables and adverse control boundaries, not all format-category characters", () => {
    const text = "\u2061\u180E\u0000\u001B\u0085\uD800\u0601";
    const result = inspectHiddenCharacters(text);
    expect(result.total).toBe(6);
    expect(result.counts.map(entry => entry.codePoint)).toEqual(["U+2061", "U+180E", "U+0000", "U+001B", "U+0085", "U+D800"]);
    expect(result.escaped).toBe("\\u{2061}\\u{180E}\\u{0000}\\u{001B}\\u{0085}\\u{D800}\u0601");
    // Unpaired UTF-16 is retained as a code unit. No original UTF-8 encoding is
    // invented for malformed input, and no input validation decision is made.
    expect(result.original).toBe(text);
    expect(inspectHiddenCharacters("").total).toBe(0);
  });
});
