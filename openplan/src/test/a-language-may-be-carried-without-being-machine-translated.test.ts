import { describe, expect, it } from "vitest";

import {
  MACHINE_TRANSLATION_UNAVAILABLE,
  TRANSLATION_LANGUAGES,
  machineTranslationUnavailableReason,
  supportsMachineTranslation,
  type TranslationLanguage,
} from "@/lib/engagement/translation-languages";
import { PORTAL_LOCALES, PORTAL_LOCALE_DIRECTION } from "@/lib/engagement/portal-i18n/locales";

/**
 * RENDERING A LANGUAGE AND GENERATING IT ARE TWO CAPABILITIES.
 *
 * Nathaniel's call, 2026-08-04: Diné Bizaad belongs in the portal because
 * OpenPlan names tribes as a primary audience and it is the largest Indigenous
 * language in the country — but ONLY as operator-authored text, because machine
 * translation quality for Navajo is not dependable and a bad translation on a
 * public consultation is worse than none in the one context where an agency's
 * words are legally binding.
 *
 * That makes a shape this codebase did not previously have: a language the
 * portal fully carries and a model may never write. The risk is that a later
 * change quietly closes the gap — someone adds a language to the taxonomy, or
 * "simplifies" a route by dropping a check, and Navajo starts getting machine
 * output again with nothing on screen to say so. These assertions are what makes
 * that a build failure rather than a discovery.
 */

describe("a language may be carried by the portal without being machine-translated", () => {
  it("carries Navajo as a full portal locale", () => {
    // The whole point of the decision: it is NOT a second-class language. It
    // renders, it has a direction, a picker can show it, an agency can publish
    // its consultation in it.
    expect(TRANSLATION_LANGUAGES).toContain("nv");
    expect(PORTAL_LOCALES).toContain("nv");
    expect(PORTAL_LOCALE_DIRECTION.nv).toBe("ltr");
  });

  it("refuses machine translation into Navajo, with a reason a person can read", () => {
    expect(supportsMachineTranslation("nv")).toBe(false);

    const reason = machineTranslationUnavailableReason("nv");
    expect(reason).toBeTruthy();
    // A refusal that does not say why teaches an operator the feature is broken.
    // It must name the language and say the translations here are human-written.
    expect(reason).toMatch(/Diné Bizaad|Navajo/);
    expect(reason).toMatch(/written by people|people write|human/i);
  });

  it("still offers machine translation for every other carried language", () => {
    const refused = TRANSLATION_LANGUAGES.filter(
      (language) => !supportsMachineTranslation(language)
    );
    // If this list grows, it is a product decision that removes a capability
    // planners may be using — it should arrive with its own reasoning, not as a
    // side effect. Failing here is the prompt to write that down.
    expect(refused).toEqual(["nv"]);
  });

  it("gives every refused language a reason, and no reason to a language it carries no entry for", () => {
    for (const [language, reason] of Object.entries(MACHINE_TRANSLATION_UNAVAILABLE)) {
      expect(TRANSLATION_LANGUAGES).toContain(language as TranslationLanguage);
      expect(typeof reason === "string" && reason.trim().length > 40).toBe(true);
    }
    expect(machineTranslationUnavailableReason("es")).toBeNull();
    expect(supportsMachineTranslation("es")).toBe(true);
  });

  it("keeps the refusal separate from the no-API-key case", () => {
    // Two different sentences for two different facts. Collapsing them would
    // send a planner to configure an Anthropic key that would not have helped,
    // which is the failure this separation exists to prevent.
    const reason = machineTranslationUnavailableReason("nv") ?? "";
    expect(reason).not.toMatch(/API key|Anthropic/i);
  });
});
