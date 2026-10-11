/**
 * A catalog that supplies nothing is English throughout, and the page's
 * partial-translation notice already says so. Calling it machine-translated as
 * well would be a second, false sentence. Amharic stands in for any such file.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/engagement/portal-i18n/catalogs/am", () => ({ AM_PORTAL_MESSAGES: {} }));

import { PortalLanguagePicker } from "@/components/engagement/portal-language-picker";
import { buildPortalMessageBundle, EN_PORTAL_MESSAGES } from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";

describe("an empty machine catalog", () => {
  it("is not labelled machine-translated", () => {
    const resolved = resolvePortalLocale({ requested: "am" });
    const bundle = buildPortalMessageBundle(resolved);
    expect(bundle.machineTranslated).toBe(false);
    const { container } = render(<PortalLanguagePicker locale={resolved} messages={bundle} pathname="/engage/token" />);
    expect(container.querySelector('[data-testid="portal-language-machine-label"]')).toBeNull();
    expect(container.textContent).not.toContain(EN_PORTAL_MESSAGES["language.machineNotice"]);
  });
});
