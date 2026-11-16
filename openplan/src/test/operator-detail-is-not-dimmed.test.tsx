import { readFileSync } from "node:fs";
import postcss from "postcss";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MapUnavailableNotice } from "@/components/ui/map-unavailable-notice";
import { OPERATOR_DETAIL_SUMMARY, OperatorDetail } from "@/components/ui/read-failure-notice";

/**
 * THE OPERATOR DISCLOSURE MAY NOT DIM THE COLOUR IT INHERITS.
 *
 * KI-2026-11-16-039: axe-core 4.11.1 reported color-contrast (serious) on the
 * Corridor Analysis screen in light mode, on one `.select-none` element. That
 * element is this disclosure's summary, inside the notice a map shows when it
 * cannot draw. The notice's text is the muted token, which passes on the page
 * background, and the summary lowered it to 80 percent opacity, which does
 * not. The third proven job requires that screen with no serious finding.
 *
 * The arithmetic below is the reason for the rule, kept as a test so the
 * numbers stay true when a palette changes. The class check is the rule.
 *
 * Blind to: a parent that dims the disclosure, a colour set by a caller's
 * `className`, and any palette but the default. axe on the rendered screen,
 * which the third job's journey runs, is the check for those.
 */

const sheet = postcss.parse(readFileSync("src/app/globals.css", "utf8"));

/** A custom property's value in the first rule with exactly this selector. */
function token(selector: string, name: string): string {
  let found: string | null = null;
  sheet.walkRules(selector, (rule) => {
    rule.walkDecls(name, (decl) => {
      found ??= decl.value;
    });
  });
  if (!found) throw new Error(`${selector} sets no ${name}`);
  return found;
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  return hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16)) as Rgb;
}

/** `ink` drawn at `opacity` over `paper`. */
function over(ink: Rgb, paper: Rgb, opacity: number): Rgb {
  return ink.map((value, index) => value * opacity + paper[index] * (1 - opacity)) as Rgb;
}

function luminance(color: Rgb) {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(a: Rgb, b: Rgb) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Tailwind utilities that draw an element at less than full opacity. */
const DIMMING_CLASS = /(?:^|\s)opacity-(?!100\b)\S+/;

describe("the operator disclosure keeps the contrast of the text around it", () => {
  it("muted text passes on the light page background, and fails at 80 percent opacity", () => {
    const muted = rgb(token(":root", "--muted"));
    const page = rgb(token(":root", "--bg"));
    expect(contrast(muted, page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(over(muted, page, 0.8), page)).toBeLessThan(4.5);
  });

  it("puts no opacity utility on the summary or on what it discloses", () => {
    const { container } = render(
      <OperatorDetail>
        <p>Set the map key and rebuild.</p>
      </OperatorDetail>
    );
    const summary = container.querySelector("summary");
    expect(summary?.textContent).toBe(OPERATOR_DETAIL_SUMMARY);
    const parts = [container.querySelector("details"), summary, summary?.nextElementSibling];
    expect(parts.every(Boolean)).toBe(true);
    for (const part of parts) expect(part!.className).not.toMatch(DIMMING_CLASS);
  });

  it("is not dimmed inside the notice Corridor Analysis shows when its map cannot draw", () => {
    const { container } = render(<MapUnavailableNotice />);
    const summary = container.querySelector("details > summary");
    expect(summary?.textContent).toBe(OPERATOR_DETAIL_SUMMARY);
    for (let node: Element | null = summary ?? null; node; node = node.parentElement) {
      expect(node.className).not.toMatch(DIMMING_CLASS);
    }
  });

  it("still recognises a dimmed element", () => {
    expect("cursor-pointer select-none opacity-80 transition").toMatch(DIMMING_CLASS);
    expect("mt-1.5 space-y-1 opacity-90").toMatch(DIMMING_CLASS);
    expect("transition hover:opacity-100 opacity-100").not.toMatch(DIMMING_CLASS);
  });
});
