/**
 * EVERY OFFERED LANGUAGE EXCEPT DINÉ BIZAAD SHIPS A CATALOG (2026-10-11).
 *
 * Nineteen catalogs were machine-translated from the English source. What a
 * test can hold them to is structure: the same keys, nothing empty, every
 * placeholder intact, and a page that says a machine wrote them. Whether the
 * words are RIGHT is a question for fluent readers; the review note lists the
 * languages the translators were least sure of.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PortalLanguageNotice, PortalLanguagePicker } from "@/components/engagement/portal-language-picker";
import {
  buildPortalMessageBundle,
  EN_PORTAL_MESSAGES,
  PORTAL_MACHINE_TRANSLATED_LOCALES,
  PORTAL_MESSAGE_CATALOGS,
  portalMessageCoverage,
} from "@/lib/engagement/portal-i18n/messages";
import { PORTAL_LOCALES, resolvePortalLocale, type PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

const EN_KEYS = Object.keys(EN_PORTAL_MESSAGES).sort();
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const MACHINE = PORTAL_LOCALES.filter((locale) => !["en", "es", "nv"].includes(locale));

describe("the machine-translated catalogs", () => {
  it("cover every offered language except English, Spanish and Diné Bizaad", () => {
    expect([...PORTAL_MACHINE_TRANSLATED_LOCALES].sort()).toEqual([...MACHINE].sort());
    expect(MACHINE).toHaveLength(19);
    // OpenPlan does not machine-translate Diné Bizaad; written by people, or not at all.
    expect(PORTAL_MESSAGE_CATALOGS.nv).toBeUndefined();
    expect(PORTAL_MACHINE_TRANSLATED_LOCALES.has("nv")).toBe(false);
  });

  it.each(MACHINE)("%s carries every key, none empty, and nothing the English does not have", (locale) => {
    const catalog = PORTAL_MESSAGE_CATALOGS[locale as PortalLocale] ?? {};
    expect(Object.keys(catalog).sort()).toEqual(EN_KEYS);
    for (const [key, value] of Object.entries(catalog)) {
      expect(value?.trim(), `${locale} ${key}`).toBeTruthy();
    }
    expect(portalMessageCoverage(locale as PortalLocale).complete).toBe(true);
  });

  it.each(MACHINE)("%s keeps every placeholder, and fills them all", (locale) => {
    const translator = createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({ requested: locale })));
    for (const [key, english] of Object.entries(EN_PORTAL_MESSAGES)) {
      const value = PORTAL_MESSAGE_CATALOGS[locale as PortalLocale]?.[key as keyof typeof EN_PORTAL_MESSAGES] ?? "";
      expect(placeholders(value), `${locale} ${key}`).toEqual(placeholders(english));
      const names = placeholders(english);
      if (names.length === 0) continue;
      const filled = (translator.t as (k: string, v: Record<string, string>) => string)(
        key,
        Object.fromEntries(names.map((name) => [name, "X"]))
      );
      expect(filled, `${locale} ${key}`).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("a page says when a machine wrote its words", () => {
  function picker(locale: string) {
    const resolved = resolvePortalLocale({ requested: locale });
    return render(
      <PortalLanguagePicker locale={resolved} messages={buildPortalMessageBundle(resolved)} pathname="/engage/token" />
    );
  }

  it("as a label on the language, in that language", () => {
    picker("ko");
    const label = screen.getByTestId("portal-language-machine-label");
    expect(label).toHaveAttribute("lang", "ko");
    expect(label.textContent).toContain(PORTAL_MESSAGE_CATALOGS.ko?.["provenance.machine.label"]);
    expect(label.textContent).toContain(PORTAL_MESSAGE_CATALOGS.ko?.["language.machineNotice"]);
  });

  it("not on English, Spanish or Diné Bizaad", () => {
    for (const locale of ["en", "es", "nv"]) {
      const { unmount } = picker(locale);
      expect(screen.queryByTestId("portal-language-machine-label"), locale).toBeNull();
      unmount();
    }
  });

  it("without adding another notice box above the page", () => {
    const resolved = resolvePortalLocale({ requested: "ko" });
    const { container } = render(
      <PortalLanguageNotice locale={resolved} messages={buildPortalMessageBundle(resolved)} />
    );
    expect(container.textContent).not.toContain(PORTAL_MESSAGE_CATALOGS.ko?.["language.machineNotice"]);
  });
});
