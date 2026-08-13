"use client";

import { useId, useState, type FormEvent } from "react";
import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PORTAL_DEFAULT_LOCALE, PORTAL_LOCALE_DIRECTION } from "@/lib/engagement/portal-i18n/locales";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";

/**
 * THE OFFER TO HEAR WHAT HAPPENS NEXT.
 *
 * Rendered ONLY when the campaign's email transport is configured (the portal
 * gates on `emailUpdatesAvailable`), so it never promises email that cannot send.
 *
 * ═══ THE BOX HAD NO NAME ═══
 *
 * Until 2026-08-13 the email field was a bare `<Input type="email">` with a
 * placeholder and nothing else. A placeholder is not a label: it is announced by
 * some screen readers and not others, it disappears the moment a character is
 * typed, and `getByLabelText` could not find this field because there was
 * nothing to find. What a blind resident heard at the one place this
 * consultation offers to keep them informed was "edit text". It now has a real
 * `<label htmlFor>`, and the placeholder stays as the example it always was.
 *
 * ═══ AND IT SPOKE ENGLISH TO EVERYONE ═══
 *
 * Every string here was an English literal on a surface that declares the
 * resident's language on its wrapper. They are catalog keys now. `translator` is
 * optional only because a caller outside the participant surfaces could exist;
 * with none the English source is used and marked as English, never spoken in
 * the page's phonology.
 *
 * ═══ WHAT THE SERVER SAYS BACK IS STILL ENGLISH ═══
 *
 * `/api/engage/[shareToken]/subscribe` answers with English sentences. Those are
 * more specific than anything this component could say, so they are preferred —
 * and, like every other server sentence on this surface, they are rendered with
 * `lang="en"` and their own direction so a Farsi page does not pronounce them as
 * Farsi or lay them out from the wrong edge.
 */
export function PublicSubscribeForm({
  shareToken,
  translator,
  previewMode = false,
}: {
  shareToken: string;
  /** The participant's language. Omitted only by a caller with no portal locale. */
  translator?: PortalTranslator;
  /** Operator preview: render the form, subscribe nobody. See `PublicEngagementPortal`. */
  previewMode?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  /** A sentence the SERVER wrote, in English, or null. */
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const emailFieldId = useId();

  /*
    The English fallbacks are the catalog's OWN English, copied here for the one
    caller that has no translator. They are not a second set of copy: when they
    and `EN_PORTAL_MESSAGES` disagree, the catalog wins, and
    `public-subscribe-form.test.tsx` asserts they are identical so the two cannot
    drift apart unnoticed.
  */
  const heading = translator?.t("portal.subscribeHeading") ?? "Get email updates";
  const hint =
    translator?.t("portal.subscribeHint") ??
    "We will email you when the project team posts an update. You can stop the emails at any time.";
  const emailLabel = translator?.t("portal.subscribeEmailLabel") ?? "Your email address";
  const submitLabel = translator?.t("portal.subscribeSubmit") ?? "Email me updates";
  const thanks =
    translator?.t("portal.subscribeThanks") ??
    "Thank you. Check your email and confirm, and we will keep you posted.";
  const failedSentence =
    translator?.t("portal.subscribeFailed") ??
    "We could not sign you up just now. Please try again.";

  const englishAttrs = {
    lang: PORTAL_DEFAULT_LOCALE,
    dir: PORTAL_LOCALE_DIRECTION[PORTAL_DEFAULT_LOCALE],
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewMode) return;
    setFailed(false);
    setServerMessage(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/engage/${shareToken}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setFailed(true);
        setServerMessage(typeof payload.error === "string" ? payload.error : null);
        return;
      }
      setDone(true);
      setServerMessage(typeof payload.message === "string" ? payload.message : null);
      setEmail("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-semibold text-foreground">{heading}</p>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {done ? (
        <p className="rounded-lg border border-emerald-300/60 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
          {serverMessage ? <span {...englishAttrs}>{serverMessage}</span> : thanks}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              {/*
                A REAL LABEL, not a placeholder. Visible rather than `sr-only`:
                everyone benefits from knowing what the box wants before they
                type, and this form sits at the bottom of a long page where an
                unlabelled box reads as decoration.
              */}
              <label htmlFor={emailFieldId} className="mb-1 block text-xs font-medium text-foreground">
                {emailLabel}
              </label>
              <Input
                id={emailFieldId}
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                // Not translated on purpose: it is an example of the SHAPE of an
                // address, and an address has the same shape in every language.
                placeholder="you@example.com"
                onChange={(event) => setEmail(event.target.value)}
                className="w-full"
              />
            </div>
            <Button type="submit" disabled={busy || !email || previewMode} className="min-h-11">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {submitLabel}
            </Button>
          </div>
          {failed ? (
            <p role="status" className="text-xs text-destructive">
              {serverMessage ? <span {...englishAttrs}>{serverMessage}</span> : failedSentence}
            </p>
          ) : null}
        </>
      )}
      {/*
        Honeypot. Deliberately NOT translated and deliberately not in the
        catalog: it is `aria-hidden`, off-screen and out of the tab order, so no
        participant and no screen reader ever meets it, and a translated
        honeypot would be a tell.

        `-start-` rather than `-left-`, matching the other three honeypots in
        this module: on a right-to-left page `-left-[9999px]` puts the field in
        the middle of the layout rather than off the edge of it.

        `tabIndex={-1}` keeps a keyboard user out of it and `autoComplete="off"`
        keeps a browser's address autofill out of it — either one would classify
        a real person as a bot, and the submit route discards a flagged
        submission without telling anybody.
      */}
      <div className="absolute -start-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="subscribe-website">Website</label>
        <input
          id="subscribe-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
    </form>
  );
}
