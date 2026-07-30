import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import {
  portalTextDisclosureView,
  portalTextLang,
} from "@/lib/engagement/portal-i18n/provenance";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";

/**
 * A STRING A PUBLIC AGENCY WROTE, rendered on a participant surface with the
 * provenance that makes it citable — or with the admission that it is not.
 *
 * WHY THIS IS SHARED RATHER THAN LOCAL TO A PAGE. Two server-rendered
 * participant surfaces render the same operator strings: the full public page
 * at `/engage/<token>` and the embeddable widget at `/embed/<token>`. When this
 * lived as a private helper inside the public page, the embed route rendered
 * `campaign.title` and `campaign.public_description` RAW instead — the source
 * strings, in the source language, with no `lang` and no disclosure — so an
 * agency that embedded its Spanish consultation in an iframe published an
 * unlabelled English header over a Spanish body. The two surfaces did not
 * disagree because someone chose differently on each; they disagreed because
 * the second one could not reach the first one's helper.
 *
 * THE DISCLOSURE IS NOT DECORATION. An agency's own Spanish and a machine's
 * Spanish are different things a resident is entitled to tell apart, and an
 * untranslated English paragraph sitting silently inside a Spanish page reads
 * as something the agency chose to write that way. Under Title VI that is a
 * claim about what the agency published.
 *
 * THE DISCLOSURE CARRIES ITS OWN LANGUAGE, which is not always the page's.
 * Nine of the eleven locales have no message catalog, so on those pages this
 * sentence IS English sitting inside a page declared Farsi or Korean — and
 * inside a `dir="rtl"` page an English sentence with no direction of its own
 * lays out from the wrong edge. Labelling it with the page's `lang` would tell
 * a screen reader to pronounce English with Farsi phonology, which is the exact
 * failure the untranslated operator text above it already avoids.
 */
export function PortalOperatorText({
  value,
  translator,
  className,
  disclosureClassName = "mt-1 block text-xs text-muted-foreground",
  as: Tag = "p",
}: {
  value: PortalText;
  translator: PortalTranslator;
  className?: string;
  /** The two surfaces size their caption differently; the sentence is the same. */
  disclosureClassName?: string;
  as?: "p" | "h1" | "span";
}) {
  const disclosure = portalTextDisclosureView(value, translator);

  return (
    <>
      <Tag className={className} lang={portalTextLang(value)}>
        {value.text}
      </Tag>
      {disclosure ? (
        <span className={disclosureClassName} lang={disclosure.lang} dir={disclosure.dir}>
          {disclosure.sentence}
        </span>
      ) : null}
    </>
  );
}
