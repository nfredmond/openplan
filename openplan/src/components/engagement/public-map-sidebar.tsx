"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, MapPin, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ENGAGEMENT_PHOTO_MAX_BYTES } from "@/lib/engagement/photo";
import {
  AGE_BANDS,
  HOUSEHOLD_TENURE,
  LANGUAGES,
  RACE_ETHNICITY,
  demographicLabel,
} from "@/lib/engagement/demographics";
import type { EngagementGeometry } from "@/lib/engagement/geometry";
import type { EngagementDrawMode } from "@/lib/engagement/draw-state";
import { submitPortalInput } from "@/lib/engagement/submit-portal-input";
import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { PORTAL_DEFAULT_LOCALE, PORTAL_LOCALE_DIRECTION } from "@/lib/engagement/portal-i18n/locales";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { formatPortalMegabytes, formatPortalNumber } from "@/lib/engagement/portal-i18n/format";
import {
  portalMessageView,
  portalTextDisclosureView,
  portalTextLang,
  type PortalDisclosureView,
} from "@/lib/engagement/portal-i18n/provenance";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";

const PUBLIC_SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20";

const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type SidebarCategory = {
  id: string;
  color?: string | null;
  labelText: PortalText;
};

/** The steps, in the order a person is walked through them. */
type StepId = "where" | "what" | "extras" | "you" | "send";

/**
 * THE GUIDED RAIL — one question at a time, in plain words, beside the map.
 *
 * WHY A STEPPER AND NOT THE FORM THAT ALREADY EXISTS. The context page's
 * `SubmissionForm` shows every field at once: seven inputs, a map, a photo
 * picker and an optional demographics block, in a single scroll. That is a
 * reasonable shape for somebody sitting at a desk who came to fill in a form. It
 * is the wrong shape for the person this surface is for — someone who got a
 * postcard, opened a link on a phone, and does not yet know they are allowed to
 * answer only one question. A wall of optional fields reads as a wall of
 * required ones, and the measured cost of that is a resident who closes the tab.
 *
 * BOTH FORMS SEND THROUGH `submitPortalInput`, which is the seam that keeps them
 * honest: they may disagree about presentation and may never disagree about the
 * request.
 *
 * WHAT THIS RAIL DOES NOT CARRY. The survey, the comment feed, the
 * close-the-loop record, the topic descriptions and the email subscription are
 * one link away on the context page, not gone. Cramming them in here would
 * rebuild the page this shell exists to replace.
 *
 * WHAT NO TEST HERE CAN PROVE: jsdom applies no stylesheet and has no box model,
 * so nothing below is evidence about width, scrolling, or whether the rail is
 * visible beside a map.
 */
export function PublicMapSidebar({
  shareToken,
  acceptingSubmissions,
  categories,
  demographicsEnabled,
  translator,
  geometry,
  onClearGeometry,
  drawMode,
  onDrawModeChange,
  mapAvailable,
  previewMode = false,
  className,
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: SidebarCategory[];
  demographicsEnabled: boolean;
  translator: PortalTranslator;
  /** What the resident drew on the stage, owned by the shell so the map and the rail agree. */
  geometry: EngagementGeometry | null;
  onClearGeometry: () => void;
  drawMode: EngagementDrawMode;
  onDrawModeChange: (mode: EngagementDrawMode) => void;
  /**
   * Whether there is a map beside this rail at all.
   *
   * FALSE CHANGES WHAT THE FIRST STEP IS, not just how it looks: with no map, a
   * resident has no way to say WHERE, and on a surface built around a map that
   * gap is the whole point. The step becomes a plain text field, and what they
   * type is folded into the comment (there is no column for it) under a labelled
   * line in their own language.
   */
  mapAvailable: boolean;
  previewMode?: boolean;
  className?: string;
}) {
  const { t, bcp47 } = translator;

  /*
    ALWAYS "where" FIRST, with or without a map. Starting at "what" when the map
    is missing was the same defect in miniature: it silently withdrew the only
    remaining way to say where, from exactly the residents whose page was already
    degraded.
  */
  const [step, setStep] = useState<StepId>("where");
  const [body, setBody] = useState("");
  const [whereWords, setWhereWords] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<PortalDisclosureView | null>(null);
  const [website, setWebsite] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [zip5, setZip5] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState("");
  const [raceEthnicity, setRaceEthnicity] = useState<string[]>([]);
  const [householdTenure, setHouseholdTenure] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<PortalDisclosureView | null>(null);
  /*
    THE SERVER'S OWN ENGLISH SENTENCE, kept for whoever runs the deployment and
    never shown to the resident as prose. It used to be rendered directly, so a
    resident on a Spanish or Farsi page who sent an empty comment was answered
    with the API's literal "Invalid submission".
  */
  const [operatorErrorDetail, setOperatorErrorDetail] = useState<string | null>(null);
  /*
    THE ONE REQUIRED ANSWER, ENFORCED BY THIS COMPONENT rather than by the
    browser. `required` on the textarea only fires while the textarea is on
    screen, and on the send step it is not — a resident could walk to the end
    without typing, press Send, and post an empty body.
  */
  const [needsBody, setNeedsBody] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const photoLimit = formatPortalMegabytes(ENGAGEMENT_PHOTO_MAX_BYTES, bcp47);
  const optionalHint = t("survey.optional");

  /*
    THE SAME FIVE STEPS WITH OR WITHOUT A MAP. "Where" survives a missing map
    rather than disappearing with it — that is the whole no-map rule in one
    place. A resident whose deployment has no map key still has to be able to say
    where they mean, and dropping the step would silently take the question away
    from exactly the people whose page is already degraded.
  */
  const steps: StepId[] = ["where", "what", "extras", "you", "send"];
  const stepIndex = steps.indexOf(step);
  const hasBody = body.trim().length > 0;

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  /*
    A resident sent back to the "what" step lands ON the box they have to fill.
    Without the focus the correction is a sentence in a rail they have to find,
    which on a phone is a scroll away from where their thumb already was.
  */
  useEffect(() => {
    if (needsBody && step === "what") bodyRef.current?.focus();
  }, [needsBody, step]);

  /*
    The topic caveat, said ONCE under the control. A `<select>` cannot put a
    provenance badge on an `<option>`, so each option carries the language it is
    actually written in and the sentence explaining machine translation is
    deduplicated beneath — ten machine-translated topics are one fact about this
    campaign, not ten.
  */
  const topicDisclosures = useMemo(() => {
    const seen = new Map<string, PortalDisclosureView>();
    for (const category of categories) {
      const view = portalTextDisclosureView(category.labelText, translator);
      if (view && !seen.has(view.sentence)) seen.set(view.sentence, view);
    }
    return [...seen.values()];
  }, [categories, translator]);

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoError(null);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function handlePhotoChange(file: File | null) {
    setPhotoError(null);
    if (!file) {
      clearPhoto();
      return;
    }
    if (!PHOTO_CONTENT_TYPES.includes(file.type)) {
      clearPhoto();
      setPhotoError(portalMessageView(translator, "portal.photoWrongType"));
      return;
    }
    if (file.size > ENGAGEMENT_PHOTO_MAX_BYTES) {
      clearPhoto();
      setPhotoError(portalMessageView(translator, "portal.photoTooLarge", { limit: photoLimit }));
      return;
    }
    setPhotoFile(file);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
  }

  /**
   * The comment as it will be stored.
   *
   * A typed place has NO COLUMN of its own — the schema records geometry, and a
   * sentence is not geometry. Rather than add a column for a field that only
   * exists when the map is broken, it is folded into the comment under a labelled
   * line, in the resident's own language, so the person reading the comment sees
   * it as part of what was written rather than as metadata that went missing.
   */
  function composeBody(): string {
    const place = whereWords.trim();
    if (!place) return body;
    return `${body}\n\n${t("portal.whereRecorded", { place })}`;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Belt behind the disabled button: a preview must never write to the public
    // record, however the submit was triggered.
    if (previewMode) return;

    /*
      NOTHING WRITTEN, NOTHING SENT. The API refuses an empty body with an
      English literal, so a request made from here would come back as a sentence
      in the wrong language for the resident and as a wasted round trip for the
      agency. Answered on this side, in their language, on the step that holds
      the box.
    */
    if (!hasBody) {
      setNeedsBody(true);
      setStep("what");
      setError(null);
      setOperatorErrorDetail(null);
      return;
    }

    setError(null);
    setOperatorErrorDetail(null);
    setIsSubmitting(true);

    const result = await submitPortalInput({
      shareToken,
      body: composeBody(),
      categoryId,
      title,
      submittedBy,
      geometry,
      photoFile,
      website,
      demographics: demographicsEnabled
        ? { ageBand, zip5, primaryLanguage, raceEthnicity, householdTenure }
        : null,
    });

    setIsSubmitting(false);

    if (result.ok) {
      setSubmitted(true);
      return;
    }

    /*
      WHAT A RESIDENT IS TOLD IS ALWAYS A TRANSLATED SENTENCE. Every route under
      `/api/engage/` answers in English literals — "Invalid submission", "Too
      many recent submissions from this connection" — and this surface may be
      showing Spanish or Farsi. Rendering the API's string put untranslated
      English in front of exactly the resident least able to read it, correctly
      marked `lang="en"` and still useless to them.

      The English is not thrown away: it is the only clue about WHY, and it is
      kept for whoever runs the deployment behind `OperatorDetail`, the same
      disclosure this surface already uses for the missing map key.
    */
    setError(
      portalMessageView(translator, result.stage === "photo" ? "portal.photoFailed" : "portal.submitFailed")
    );
    setOperatorErrorDetail(result.serverMessage);
  }

  if (!acceptingSubmissions) {
    return (
      <div className={cn("space-y-3 p-5", className)} data-testid="portal-sidebar-closed">
        <h2 className="text-lg font-semibold text-foreground">{t("portal.submissionsClosedNotice")}</h2>
        <p className="text-sm text-muted-foreground">{t("page.publishedFeedbackDetail")}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className={cn("space-y-3 p-5 text-center", className)} data-testid="portal-sidebar-received">
        <CheckCircle2 className="mx-auto h-9 w-9 text-[color:var(--pine)]" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground">{t("portal.received")}</h2>
        <p className="text-sm text-muted-foreground">{t("portal.receivedDetail")}</p>
        <p className="text-sm text-muted-foreground">{t("portal.reviewNotice")}</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setSubmitted(false);
            setBody("");
            setWhereWords("");
            setCategoryId("");
            setTitle("");
            setSubmittedBy("");
            clearPhoto();
            setWebsite("");
            setAgeBand("");
            setZip5("");
            setPrimaryLanguage("");
            setRaceEthnicity([]);
            setHouseholdTenure("");
            setError(null);
            setOperatorErrorDetail(null);
            setNeedsBody(false);
            onClearGeometry();
            setStep("where");
          }}
        >
          {t("portal.addYourInput")}
        </Button>
      </div>
    );
  }

  const stepTitle: Record<StepId, string> = {
    where: t("portal.stepWhereTitle"),
    what: t("portal.stepWhatTitle"),
    extras: t("portal.stepExtrasTitle"),
    you: t("portal.stepYouTitle"),
    send: t("portal.stepSendTitle"),
  };

  const stepHelp: Record<StepId, string> = {
    where: mapAvailable ? t("portal.stepWhereHelp") : t("portal.stepWhereHelpNoMap"),
    what: t("portal.stepWhatHelp"),
    extras: t("portal.stepExtrasHelp"),
    you: t("portal.stepYouHelp"),
    send: t("portal.stepSendHelp"),
  };

  /**
   * Move to a step, refusing to leave "what" behind with nothing written.
   *
   * EVERY WAY FORWARD GOES THROUGH HERE — the Next button and the numbered step
   * chips both — because a resident who can jump straight to "Send" from the
   * chips has the same empty submission by a different route. Going BACK is
   * never blocked: somebody returning to the map to mark a place has not done
   * anything wrong.
   */
  const goToStep = (target: StepId) => {
    const targetIndex = steps.indexOf(target);
    if (targetIndex > steps.indexOf("what") && !hasBody) {
      setNeedsBody(true);
      setStep("what");
      return;
    }
    setNeedsBody(false);
    setStep(target);
  };

  const goNext = () => goToStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  const goBack = () => setStep(steps[Math.max(stepIndex - 1, 0)]);

  return (
    <form className={cn("flex flex-col gap-4 p-5", className)} onSubmit={handleSubmit} data-testid="portal-guided-form">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("portal.stepsHeading")}</h2>
        {/* The counter is the promise that this ends. Without it a stepper is an
            unbounded corridor, which is worse than a long form. */}
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">
          {t("portal.stepCounter", {
            step: formatPortalNumber(stepIndex + 1, bcp47),
            total: formatPortalNumber(steps.length, bcp47),
          })}
        </p>
      </div>

      {/* Every step is a real button, so somebody who wants the whole form can
          jump straight to the one they care about. A stepper that traps a
          confident person is a stepper they fight. */}
      <ol className="flex flex-wrap gap-1.5" data-testid="portal-step-list">
        {steps.map((id, index) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => goToStep(id)}
              aria-current={id === step ? "step" : undefined}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                id === step
                  ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-foreground"
                  : "border-border/70 text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="me-1 tabular-nums">{formatPortalNumber(index + 1, bcp47)}</span>
              {stepTitle[id]}
            </button>
          </li>
        ))}
      </ol>

      <div className="space-y-3" data-testid={`portal-step-${step}`}>
        <div>
          <h3 className="text-base font-semibold text-foreground">{stepTitle[step]}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{stepHelp[step]}</p>
        </div>

        {step === "where" ? (
          mapAvailable ? (
            <div className="space-y-3">
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t("portal.drawModeLabel")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["point", t("portal.drawModePoint")],
                      ["line", t("portal.drawModeLine")],
                      ["area", t("portal.drawModeArea")],
                    ] as Array<[EngagementDrawMode, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onDrawModeChange(mode)}
                      aria-pressed={drawMode === mode}
                      className={cn(
                        "min-h-11 rounded-xl border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        drawMode === mode
                          ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-foreground"
                          : "border-border/70 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="portal-location-status">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {geometry ? t("portal.locationSet") : t("portal.locationNone")}
              </p>
              {geometry ? (
                <button
                  type="button"
                  onClick={onClearGeometry}
                  className="min-h-11 text-sm font-medium text-destructive underline-offset-2 hover:underline"
                >
                  {t("portal.clearLocation")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="portal-where-words" className="text-sm font-medium">
                {t("portal.whereInWords")}{" "}
                <span className="text-xs text-muted-foreground">({optionalHint})</span>
              </label>
              <Input
                id="portal-where-words"
                value={whereWords}
                onChange={(event) => setWhereWords(event.target.value)}
                maxLength={200}
              />
            </div>
          )
        ) : null}

        {step === "what" ? (
          <div className="space-y-1.5">
            <label htmlFor="portal-body" className="sr-only">
              {t("portal.yourInput")}
            </label>
            <Textarea
              id="portal-body"
              ref={bodyRef}
              rows={7}
              placeholder={t("portal.yourInputHint")}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                if (event.target.value.trim().length > 0) setNeedsBody(false);
              }}
              required
              aria-invalid={needsBody || undefined}
              aria-describedby={needsBody ? "portal-body-needed" : undefined}
              maxLength={4000}
            />
            {/*
              The one thing we need, said where the box is. `role="alert"` so a
              screen reader hears it at the moment the resident is sent back
              here, rather than only if they happen to read past the label.
            */}
            {needsBody ? (
              <p
                id="portal-body-needed"
                role="alert"
                data-testid="portal-body-needed"
                className="text-sm font-medium text-destructive"
              >
                {t("portal.commentNeeded")}
              </p>
            ) : null}
            <p className="text-end text-xs text-muted-foreground">
              {formatPortalNumber(body.length, bcp47)}/{formatPortalNumber(4000, bcp47)}
            </p>
          </div>
        ) : null}

        {step === "extras" ? (
          <div className="space-y-4">
            {categories.length > 0 ? (
              <div className="space-y-1.5">
                <label htmlFor="portal-category" className="text-sm font-medium">
                  {t("portal.topics")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
                </label>
                <select
                  id="portal-category"
                  className={PUBLIC_SELECT_CLASS}
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">{t("portal.selectTopic")}</option>
                  {categories.map((category) => (
                    <option
                      key={category.id}
                      value={category.id}
                      lang={portalTextLang(category.labelText)}
                      dir={PORTAL_LOCALE_DIRECTION[category.labelText.textLocale]}
                    >
                      {category.labelText.text}
                    </option>
                  ))}
                </select>
                {topicDisclosures.map((disclosure) => (
                  <p
                    key={disclosure.sentence}
                    className="text-xs leading-snug text-muted-foreground"
                    lang={disclosure.lang}
                    dir={disclosure.dir}
                  >
                    {disclosure.sentence}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="portal-title" className="text-sm font-medium">
                {t("portal.titleLabel")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
              </label>
              <Input id="portal-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="portal-photo" className="text-sm font-medium">
                {t("portal.photoHint", { limit: photoLimit })}{" "}
                <span className="text-xs text-muted-foreground">({optionalHint})</span>
              </label>
              <input
                id="portal-photo"
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground"
                onChange={(event) => handlePhotoChange(event.target.files?.[0] ?? null)}
              />
              {photoError ? (
                <p className="text-xs text-destructive" lang={photoError.lang} dir={photoError.dir}>
                  {photoError.sentence}
                </p>
              ) : null}
              {photoPreviewUrl ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img
                    src={photoPreviewUrl}
                    alt={t("portal.photoPreviewAlt")}
                    className="h-20 w-20 rounded-lg border border-border object-cover"
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "you" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="portal-name" className="text-sm font-medium">
                {t("portal.nameLabel")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
              </label>
              <Input
                id="portal-name"
                value={submittedBy}
                onChange={(event) => setSubmittedBy(event.target.value)}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">{t("portal.nameHint")}</p>
            </div>

            {demographicsEnabled ? (
              /*
                STILL LARGELY ENGLISH, and never hidden from a non-English reader
                for that reason: this is how a resident tells the agency they
                exist, and withholding it from the people least likely to be
                counted would invert the point of collecting it. Each English
                string carries `lang="en"` so a screen reader pronounces it as the
                English it is. `demographicLabel` is shared with the operator
                console's aggregate views and so cannot simply become catalog
                keys — the gap is reported, not hidden.
              */
              <div className="space-y-4 border-t border-border/60 pt-4">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{t("portal.demographics")}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{t("portal.demographicsHint")}</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="portal-demo-age" className="text-sm font-medium">
                    {t("portal.demographicsAge")}
                  </label>
                  <select
                    id="portal-demo-age"
                    className={PUBLIC_SELECT_CLASS}
                    value={ageBand}
                    onChange={(event) => setAgeBand(event.target.value)}
                  >
                    <option value="" lang={bcp47}>
                      {t("portal.preferNotToSay")}
                    </option>
                    {AGE_BANDS.filter((band) => band !== "prefer_not_to_say").map((band) => (
                      <option key={band} value={band} lang={PORTAL_DEFAULT_LOCALE}>
                        {demographicLabel(band)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="portal-demo-zip" className="text-sm font-medium">
                    {t("portal.demographicsZip")}
                  </label>
                  <Input
                    id="portal-demo-zip"
                    inputMode="numeric"
                    value={zip5}
                    onChange={(event) => setZip5(event.target.value.replace(/\D/g, "").slice(0, 5))}
                    maxLength={5}
                  />
                  <p className="text-xs text-muted-foreground">{t("portal.zipHint")}</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="portal-demo-language" className="text-sm font-medium">
                    {t("portal.demographicsPrimaryLanguage")}
                  </label>
                  <select
                    id="portal-demo-language"
                    className={PUBLIC_SELECT_CLASS}
                    value={primaryLanguage}
                    onChange={(event) => setPrimaryLanguage(event.target.value)}
                  >
                    <option value="" lang={bcp47}>
                      {t("portal.preferNotToSay")}
                    </option>
                    {LANGUAGES.filter((language) => language !== "prefer_not_to_say").map((language) => (
                      <option key={language} value={language} lang={PORTAL_DEFAULT_LOCALE}>
                        {demographicLabel(language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="portal-demo-tenure" className="text-sm font-medium">
                    {t("portal.demographicsTenure")}
                  </label>
                  <select
                    id="portal-demo-tenure"
                    className={PUBLIC_SELECT_CLASS}
                    value={householdTenure}
                    onChange={(event) => setHouseholdTenure(event.target.value)}
                  >
                    <option value="" lang={bcp47}>
                      {t("portal.preferNotToSay")}
                    </option>
                    {HOUSEHOLD_TENURE.filter((tenure) => tenure !== "prefer_not_to_say").map((tenure) => (
                      <option key={tenure} value={tenure} lang={PORTAL_DEFAULT_LOCALE}>
                        {demographicLabel(tenure)}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">
                    {t("portal.demographicsRace")}
                  </legend>
                  <div className="grid gap-1.5">
                    {RACE_ETHNICITY.filter((race) => race !== "prefer_not_to_say").map((race) => (
                      <label key={race} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={raceEthnicity.includes(race)}
                          onChange={(event) =>
                            setRaceEthnicity((previous) =>
                              event.target.checked ? [...previous, race] : previous.filter((value) => value !== race)
                            )
                          }
                        />
                        <span lang={PORTAL_DEFAULT_LOCALE}>{demographicLabel(race)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "send" ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("portal.reviewHeading")}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground" data-testid="portal-review-body">
                {body.trim() || t("portal.yourInputHint")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground" data-testid="portal-review-location">
                {geometry || whereWords.trim() ? t("portal.locationSet") : t("portal.reviewNoLocation")}
              </p>
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>{t("portal.reviewNotice")}</li>
              <li>{t("portal.followUpHint")}</li>
            </ul>
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          className="rounded-xl border border-red-300/80 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          role="alert"
          data-testid="portal-submit-error"
        >
          <p lang={error.lang} dir={error.dir}>
            {error.sentence}
          </p>
          {operatorErrorDetail ? (
            <OperatorDetail testId="portal-submit-error-operator-detail">
              {/* The API's own words, unchanged, and marked as the English they are. */}
              <p lang={PORTAL_DEFAULT_LOCALE} dir={PORTAL_LOCALE_DIRECTION[PORTAL_DEFAULT_LOCALE]}>
                {operatorErrorDetail}
              </p>
            </OperatorDetail>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {stepIndex > 0 ? (
          <Button type="button" variant="outline" className="min-h-11" onClick={goBack}>
            {t("portal.back")}
          </Button>
        ) : null}
        {step === "send" ? (
          <Button type="submit" disabled={isSubmitting || previewMode} className="min-h-11 flex-1 justify-center">
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSubmitting ? t("portal.submitting") : t("portal.submit")}
          </Button>
        ) : (
          <Button type="button" className="min-h-11 flex-1 justify-center" onClick={goNext}>
            {t("portal.next")}
          </Button>
        )}
      </div>

      {/*
        Honeypot. Deliberately NOT translated and deliberately not in the
        catalog: it is aria-hidden and off-screen, no participant or screen
        reader ever meets it, and a bot is the only reader. `-start-` rather than
        `-left-` so it hides off the correct edge in a right-to-left page.
      */}
      <div className="absolute -start-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="portal-website">Website</label>
        <input
          id="portal-website"
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
