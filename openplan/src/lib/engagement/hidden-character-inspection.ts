export type HiddenCharacterKind = "joining" | "boundary" | "direction" | "tag" | "variation" | "invisible" | "control";
export type TextLanguageContext = { language?: string | null; script?: string | null };
export type HiddenCharacterCount = {
  codePoint: string;
  marker: string;
  name: string;
  kind: HiddenCharacterKind;
  count: number;
};

// Unicode 17, chapter 23 and UAX #9. These are display observations, not a
// blacklist. Default-ignorable coverage follows the host's Unicode tables.
const NAMED: Readonly<Record<number, readonly [string, HiddenCharacterKind]>> = {
  0x00a0: ["NO-BREAK SPACE", "boundary"],
  0x00ad: ["SOFT HYPHEN", "boundary"],
  0x034f: ["COMBINING GRAPHEME JOINER", "joining"],
  0x061c: ["ARABIC LETTER MARK", "direction"],
  0x200b: ["ZERO WIDTH SPACE", "boundary"],
  0x200c: ["ZERO WIDTH NON-JOINER", "joining"],
  0x200d: ["ZERO WIDTH JOINER", "joining"],
  0x200e: ["LEFT-TO-RIGHT MARK", "direction"],
  0x200f: ["RIGHT-TO-LEFT MARK", "direction"],
  0x202a: ["LEFT-TO-RIGHT EMBEDDING", "direction"],
  0x202b: ["RIGHT-TO-LEFT EMBEDDING", "direction"],
  0x202c: ["POP DIRECTIONAL FORMATTING", "direction"],
  0x202d: ["LEFT-TO-RIGHT OVERRIDE", "direction"],
  0x202e: ["RIGHT-TO-LEFT OVERRIDE", "direction"],
  0x202f: ["NARROW NO-BREAK SPACE", "boundary"],
  0x2060: ["WORD JOINER", "boundary"],
  0x2066: ["LEFT-TO-RIGHT ISOLATE", "direction"],
  0x2067: ["RIGHT-TO-LEFT ISOLATE", "direction"],
  0x2068: ["FIRST STRONG ISOLATE", "direction"],
  0x2069: ["POP DIRECTIONAL ISOLATE", "direction"],
  0xfeff: ["ZERO WIDTH NO-BREAK SPACE / BYTE ORDER MARK", "boundary"],
  0xe0001: ["LANGUAGE TAG", "tag"],
  0xe007f: ["CANCEL TAG", "tag"],
};
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const SCRIPT_LETTERS = [
  ["Arabic", /(?=\p{Letter})\p{Script_Extensions=Arabic}/u],
  ["Gurmukhi", /(?=\p{Letter})\p{Script_Extensions=Gurmukhi}/u],
  ["Devanagari", /(?=\p{Letter})\p{Script_Extensions=Devanagari}/u],
  ["Bengali", /(?=\p{Letter})\p{Script_Extensions=Bengali}/u],
  ["Thai", /(?=\p{Letter})\p{Script_Extensions=Thai}/u],
  ["Myanmar", /(?=\p{Letter})\p{Script_Extensions=Myanmar}/u],
  ["Khmer", /(?=\p{Letter})\p{Script_Extensions=Khmer}/u],
] as const;

function describeCharacter(code: number, character: string): readonly [string, HiddenCharacterKind] | null {
  if (NAMED[code]) return NAMED[code];
  if (code >= 0xe0020 && code <= 0xe007e) return [`TAG U+${(code - 0xe0000).toString(16).toUpperCase().padStart(4, "0")}`, "tag"];
  if ((code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef) || (code >= 0x180b && code <= 0x180d) || code === 0x180f) {
    return ["VARIATION SELECTOR", "variation"];
  }
  // Keep conventional tabs and newlines readable. Other C0/C1 controls receive
  // markers, including controls a browser might otherwise render as nothing.
  if ((code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code)) || (code >= 0x7f && code <= 0x9f)) return ["CONTROL CHARACTER", "control"];
  if (code >= 0xd800 && code <= 0xdfff) return ["UNPAIRED UTF-16 SURROGATE", "control"];
  return DEFAULT_IGNORABLE.test(character) ? ["DEFAULT-IGNORABLE CODE POINT", "invisible"] : null;
}

/** Derive a display-only inspection. Never normalize, trim, replace or serialize
 * this result back into evidence, provider input, revisions or canonical frames.
 * Offsets and intent are not inferred. Literal backslashes are doubled in the
 * diagnostic so participant-authored escape text differs from generated markers.
 */
export function inspectHiddenCharacters(original: string, context: TextLanguageContext = {}) {
  const counts = new Map<number, HiddenCharacterCount>();
  const escaped: string[] = [];
  let total = 0;
  for (const character of original) {
    const code = character.codePointAt(0)!;
    const description = describeCharacter(code, character);
    if (!description) {
      escaped.push(character === "\\" ? "\\\\" : character);
      continue;
    }
    const hex = code.toString(16).toUpperCase().padStart(4, "0");
    const marker = `\\u{${hex}}`;
    const previous = counts.get(code);
    if (previous) previous.count += 1;
    else counts.set(code, { codePoint: `U+${hex}`, marker, name: description[0], kind: description[1], count: 1 });
    escaped.push(marker);
    total += 1;
  }
  return {
    original,
    escaped: escaped.join(""),
    total,
    counts: [...counts.values()],
    // Script letters are observations, not a guess at the contributor's locale.
    observedScripts: SCRIPT_LETTERS.filter(([, pattern]) => pattern.test(original)).map(([name]) => name),
    language: context.language ?? null,
    script: context.script ?? null,
  };
}
