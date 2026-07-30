import { PortalOperatorText } from "@/components/engagement/portal-operator-text";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import { portalMessageView } from "@/lib/engagement/portal-i18n/provenance";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";

/**
 * HOW A RESIDENT WHO CANNOT USE THIS PAGE TAKES PART ANYWAY.
 *
 * The portal is a map, a form and a comment feed, and each of those has people
 * it does not work for: a screen-reader user placing a pin, somebody on a phone
 * with no data allowance, a resident who reads none of the languages this
 * campaign has been translated into, a person who would simply rather speak to
 * someone. For a consultation run by a public agency, "could not take part" is
 * not a usability complaint — it is the consultation failing to hear from
 * people it was required to reach.
 *
 * IT SAYS NOTHING ABOUT CONFORMANCE, and that is deliberate. OpenPlan has not
 * audited itself against any accessibility standard, so it makes no claim to
 * meet one; a page asserting it was accessible while a resident sat unable to
 * use it would be a worse failure than one that stayed quiet. What is offered
 * instead is a person to contact, which is true whatever the software's
 * conformance turns out to be.
 *
 * THE WORDS ARE THE AGENCY'S. The duty to provide another way to take part sits
 * with the body running the consultation, not with OpenPlan, so every value here
 * is operator-authored and nothing is defaulted — see 20260730000001. When an
 * agency has recorded nothing, this renders nothing rather than an empty heading
 * or an offer OpenPlan invented on their behalf. The omission is surfaced to the
 * OPERATOR, where it can still be fixed, not papered over for the resident.
 *
 * THE PROSE IS TRANSLATED; THE ADDRESSES ARE NOT. The person who most needs this
 * block is the one least able to read the rest of the page, so the label and the
 * alternate-formats text run through the same provenance-carrying resolver as
 * the campaign description. An email address and a phone number are not prose —
 * translating them would invite a machine-mangled contact that reaches nobody.
 */
export function PortalAccessibilityNotice({
  contactLabel,
  alternateFormats,
  email,
  phone,
  translator,
}: {
  contactLabel: PortalText | null;
  alternateFormats: PortalText | null;
  email: string | null;
  phone: string | null;
  translator: PortalTranslator;
}) {
  // Nothing recorded is not "no accommodations offered" — it is an agency that
  // has not said. Rendering a heading over an empty block would turn one into
  // the other.
  if (!contactLabel && !alternateFormats && !email && !phone) return null;

  const heading = portalMessageView(translator, "accessibility.heading");
  const intro = portalMessageView(translator, "accessibility.intro");

  return (
    <section className="public-note-block">
      <h2 lang={heading.lang} dir={heading.dir} className="text-sm font-semibold">
        {heading.sentence}
      </h2>
      <p lang={intro.lang} dir={intro.dir} className="mt-1 text-sm">
        {intro.sentence}
      </p>

      <dl className="mt-3 space-y-2 text-sm">
        {contactLabel ? (
          <div>
            <Term translator={translator} messageKey="accessibility.contactLabel" />
            <dd>
              <PortalOperatorText as="span" value={contactLabel} translator={translator} />
            </dd>
          </div>
        ) : null}
        {email ? (
          <div>
            <Term translator={translator} messageKey="accessibility.email" />
            {/* `dir="ltr"` because an address is left-to-right even inside an
                Arabic or Farsi page, where the surrounding direction would
                otherwise reorder its punctuation on screen. */}
            <dd dir="ltr">
              <a href={`mailto:${email}`} className="underline underline-offset-4">
                {email}
              </a>
            </dd>
          </div>
        ) : null}
        {phone ? (
          <div>
            <Term translator={translator} messageKey="accessibility.phone" />
            <dd dir="ltr">
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-4">
                {phone}
              </a>
            </dd>
          </div>
        ) : null}
        {alternateFormats ? (
          <div>
            <Term translator={translator} messageKey="accessibility.otherWays" />
            <dd>
              <PortalOperatorText as="span" value={alternateFormats} translator={translator} />
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

/**
 * A `<dt>` whose label carries its own language.
 *
 * Nine of the eleven locales have no catalog, so on those pages this word is
 * English sitting inside a page declared Korean or Farsi — the same reason every
 * other run of text on this portal carries its own `lang` and `dir`.
 */
function Term({
  translator,
  messageKey,
}: {
  translator: PortalTranslator;
  messageKey: "accessibility.contactLabel" | "accessibility.email" | "accessibility.phone" | "accessibility.otherWays";
}) {
  const view = portalMessageView(translator, messageKey);
  return (
    <dt lang={view.lang} dir={view.dir} className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {view.sentence}
    </dt>
  );
}
