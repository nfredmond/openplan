import {
  PortalLanguageNotice,
  PortalLanguagePicker,
} from "@/components/engagement/portal-language-picker";
import type { ResolvedPortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { portalMessageView } from "@/lib/engagement/portal-i18n/provenance";
import {
  createPortalTranslator,
  type PortalMessageBundle,
} from "@/lib/engagement/portal-i18n/translator";

/**
 * What a resident reads after the comment period has ended: a notice, and
 * nothing else.
 *
 * Both `/engage/<token>` and `/engage/<token>/about` render this when the
 * loader answers `closed`. It takes the reader's language and OpenPlan's own
 * copy in it. It takes nothing from the campaign, because the loader reads
 * nothing from a closed campaign: staff close a campaign to take it offline,
 * and a campaign can be closed without ever having been public. So there is no
 * title, description, comment, response, count or map here, and there must not
 * be.
 */
export function ClosedCampaignPage({
  locale,
  messages,
  languagePickerPathname,
  languagePickerSearch,
}: {
  locale: ResolvedPortalLocale;
  messages: PortalMessageBundle;
  /** Where the `?lang=` links point. */
  languagePickerPathname: string;
  languagePickerSearch: string;
}) {
  const translator = createPortalTranslator(messages);
  const title = portalMessageView(translator, "closed.title");
  const body = portalMessageView(translator, "closed.body");

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-10 sm:px-6"
      dir={locale.direction}
      lang={locale.bcp47}
      data-testid="closed-campaign-page"
    >
      <div className="flex flex-col gap-2">
        <PortalLanguagePicker
          locale={locale}
          messages={messages}
          pathname={languagePickerPathname}
          search={languagePickerSearch}
        />
        <PortalLanguageNotice locale={locale} messages={messages} />
      </div>

      <div role="status" data-testid="closed-campaign-notice" className="mt-10 space-y-3">
        <h1 className="text-2xl font-semibold leading-tight text-foreground" lang={title.lang} dir={title.dir}>
          {title.sentence}
        </h1>
        <p className="text-base leading-7 text-muted-foreground" lang={body.lang} dir={body.dir}>
          {body.sentence}
        </p>
      </div>
    </div>
  );
}
