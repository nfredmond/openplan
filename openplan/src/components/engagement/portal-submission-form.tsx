"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import type { PortalMapFraming } from "@/lib/engagement/public-portal-data";
import { submitPortalInput } from "@/lib/engagement/submit-portal-input";
import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { PORTAL_DEFAULT_LOCALE, PORTAL_LOCALE_DIRECTION } from "@/lib/engagement/portal-i18n/locales";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { formatPortalMegabytes, formatPortalNumber } from "@/lib/engagement/portal-i18n/format";
import { portalMapFramingSentence } from "@/lib/engagement/portal-i18n/map-framing-words";
import { buildGeometryPickerWords } from "@/lib/engagement/portal-i18n/drawing-map-words";
import {
  portalMessageView,
  portalTextDisclosureView,
  portalTextLang,
  type PortalDisclosureView,
} from "@/lib/engagement/portal-i18n/provenance";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import { GEOMETRY_PICKER_CAN_DRAW, GeometryPickerMap } from "./geometry-picker-map";

const PUBLIC_SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20";

const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type PortalFormCategory = {
  id: string;
  color?: string | null;
  labelText: PortalText;
};

/**
 * WHERE THE RESIDENT'S PLACE COMES FROM — the one thing that genuinely differs
 * between the three doors, expressed as data rather than as two components.
 *
 * `"stage"` — the map is the PAGE (`/engage/<token>`): a full-screen stage owns
 * the drawing, the shell owns the geometry, and this form owns only the buttons
 * that say what to draw. It cannot own the map, because the map is not inside it.
 *
 * `"inline"` — the map is a FIELD (`/engage/<token>/about`, `/embed/<token>`):
 * there is no stage, so the form mounts its own `GeometryPickerMap` in the
 * "where" step and holds the geometry itself.
 *
 * Everything else — every field, every validation rule, every payload key, every
 * sentence — is the same on all three, which is the entire point of this module.
 */
export type PortalFormPlace =
  | {
      source: "stage";
      geometry: EngagementGeometry | null;
      onClearGeometry: () => void;
      drawMode: EngagementDrawMode;
      onDrawModeChange: (mode: EngagementDrawMode) => void;
      /**
       * Whether there is a stage beside this form at all.
       *
       * FALSE CHANGES WHAT THE FIRST STEP IS, not just how it looks: with no map
       * a resident has no way to say WHERE, and on a surface built around a map
       * that gap is the whole point. The step becomes a plain text field, and
       * what they type is folded into the comment (there is no column for it)
       * under a labelled line in their own language.
       */
      mapAvailable: boolean;
    }
  | {
      source: "inline";
      /**
       * Where the form's own map opens AND why. The reason travels with the
       * camera because the form has to say something different when nothing
       * framed the map: a continent shown without comment reads as a study area.
       */
      mapFraming: PortalMapFraming;
      /** The campaign's published GIS context, drawn under the resident's sketch. */
      contextLayers: ParticipantContextLayerSet | null;
    };

/** The steps, in the order a person is walked through them. */
/**
 * A store that never changes, used only to tell the server render apart from the
 * hydrated client. `useSyncExternalStore` is React's own hydration-safe way to
 * ask that question; setting state in an effect would do the same thing and is
 * forbidden by lint here, for good reasons that happen not to apply.
 */
const subscribeToNothing = () => () => {};

type StepId = "where" | "what" | "extras" | "you" | "send";

/**
 * THE ONE FORM A MEMBER OF THE PUBLIC FILLS IN — guided, one question at a time,
 * in plain words, on every route that asks them anything.
 *
 * ================== WHY THIS FILE EXISTS: TWO FORMS, ONE JOB ==================
 *
 * Until 2026-08-14 there were two implementations of this form. `/engage/<token>`
 * rendered a guided rail beside the full-screen map; `/engage/<token>/about` and
 * `/embed/<token>` rendered `SubmissionForm`, a stacked wall of seven inputs
 * that lived inside `public-engagement-portal.tsx`. Both were reachable by the
 * public. They disagreed about real things, and every disagreement fell on the
 * older one:
 *
 *   - the rail answered a refusal from the API in the RESIDENT'S language and
 *     kept the server's English for the operator; the stacked form printed the
 *     API's literal "Invalid submission" to a Spanish reader;
 *   - the rail refused to send an empty comment on its own side; the stacked
 *     form relied on the browser's `required`, then showed the resident whatever
 *     English the API answered with;
 *   - the rail sent through `submitPortalInput`; the stacked form had its own
 *     copy of the two-step photo flow and the demographics shape, and trimmed
 *     nothing, so `title: "   "` reached the database as three spaces;
 *   - the rail printed the map's framing from the catalog; the stacked form
 *     printed English prose composed server-side.
 *
 * This repository has a recorded name for that shape: a shared capability living
 * inside one of its two callers gets reimplemented, wrongly, by the other. The
 * fix is not to keep them in step. It is for there to be one of them.
 *
 * WHAT IS NOT HERE, AND IS NOT LOST. The survey, the comment feed, the
 * close-the-loop record, the topic descriptions and the email subscription are
 * not part of the submission form on any route — they surround it on the context
 * page and the embed, and they are one link away from the map. This component
 * asks a resident what they think and sends it; nothing else.
 *
 * WHAT NO TEST OF THIS FILE CAN PROVE: jsdom applies no stylesheet, has no box
 * model, and does not run Mapbox GL. Nothing asserted about this component is
 * evidence about width, scrolling, or whether a map draws.
 */
export function PortalSubmissionForm({
  shareToken,
  acceptingSubmissions,
  categories,
  demographicsEnabled,
  translator,
  place,
  parentItemId = null,
  replyingToLabel = null,
  onCancelReply,
  previewMode = false,
  className,
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: PortalFormCategory[];
  demographicsEnabled: boolean;
  /** The participant's language. Every string below comes through it. */
  translator: PortalTranslator;
  place: PortalFormPlace;
  /**
   * REPLYING TO SOMEBODY ELSE'S COMMENT. Only the surfaces that show the feed
   * can start one, so only they ever set this — but the field travels in the
   * payload from every route, because a form that quietly dropped it would turn
   * a reply into a new top-level comment with no thread and no way back.
   */
  parentItemId?: string | null;
  replyingToLabel?: string | null;
  onCancelReply?: () => void;
  /** Operator preview: render the real form, send nothing. */
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
  /**
   * WHETHER THIS FORM CAN ACTUALLY ANSWER A CLICK YET.
   *
   * The step machine is React state, so before hydration the buttons are
   * server-rendered markup with no handler attached. A click that lands in that
   * window does nothing at all, and the button gives no sign of it — which on a
   * slow phone, or against a struggling server, reads exactly like a broken
   * product.
   *
   * A tester hit precisely this on 2026-08-14 and filed it as a blocker: "Next"
   * never advanced past step 1, by mouse, by forced click, and by keyboard, on
   * desktop and on mobile. It did not reproduce afterwards on a healthy server,
   * and the reason it looked total is that every one of those attempts landed
   * before the page could respond. The sibling stage-gate regression script
   * records the same mechanism on a different control and calls it "a real thing
   * a fast planner can hit, not just a test problem".
   *
   * So the button says so instead of lying. It is disabled until this effect
   * runs, which is the first moment a click can be heard. This form needs
   * JavaScript regardless — the whole step machine is state — so a disabled
   * moment is honest rather than a capability lost.
   */
  const canRespond = useSyncExternalStore(
    subscribeToNothing,
    () => true, // client, once hydrated
    () => false // server render, and the hydration pass that must match it
  );

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
    never shown to the resident as prose. The stacked form used to render it
    directly, so a resident on a Spanish or Farsi page who sent an empty comment
    was answered with the API's literal "Invalid submission".
  */
  const [operatorErrorDetail, setOperatorErrorDetail] = useState<string | null>(null);
  /*
    THE ONE REQUIRED ANSWER, ENFORCED BY THIS COMPONENT rather than by the
    browser. `required` on the textarea only fires while the textarea is on
    screen, and on the send step it is not — a resident could walk to the end
    without typing, press Send, and post an empty body.
  */
  const [needsBody, setNeedsBody] = useState(false);
  /*
    THE GEOMETRY THIS FORM OWNS — only in `inline` mode. In `stage` mode the
    shell owns it, because the map is not inside this component and two owners of
    one pin is a pin that disagrees with itself.
  */
  const [inlineGeometry, setInlineGeometry] = useState<EngagementGeometry | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const photoLimit = formatPortalMegabytes(ENGAGEMENT_PHOTO_MAX_BYTES, bcp47);
  const optionalHint = t("survey.optional");

  /*
    CAN A RESIDENT DRAW AT ALL, on this route, on this deployment? The two
    sources answer the same question about the same access token — the shell
    decides it server-side and hands it down; the picker reads it at module
    scope. Both are honoured rather than one, so no render site can produce a
    "where" step that offers a map that is not there.
  */
  const canDraw = place.source === "stage" ? place.mapAvailable : GEOMETRY_PICKER_CAN_DRAW;
  const geometry = place.source === "stage" ? place.geometry : inlineGeometry;

  const clearGeometry = () => {
    if (place.source === "stage") place.onClearGeometry();
    else setInlineGeometry(null);
  };

  /*
    THE MAP'S OWN WORDS, in the resident's language, memoised because the picker
    takes them as a prop and a fresh object every keystroke in the rail would
    remount nothing but would churn every child that depends on it.
  */
  const pickerWords = useMemo(() => buildGeometryPickerWords(translator), [translator]);

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
    const placeWords = whereWords.trim();
    if (!placeWords) return body;
    return `${body}\n\n${t("portal.whereRecorded", { place: placeWords })}`;
  }

  function resetForm() {
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
    clearGeometry();
    onCancelReply?.();
    setStep("where");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Belt behind the disabled button: a preview must never write to the public
    // record, however the submit was triggered.
    if (previewMode) return;

    /*
      A SUBMIT FROM ANYWHERE BUT THE REVIEW STEP IS NOT A DECISION TO SEND.

      The review step exists so a resident sees what they are about to hand to a
      public agency, under their own name, before it goes. Anything that posts
      without passing through it has taken that away from them — and there is
      more than one way in. A shared DOM node changing `type` under a "Next"
      click was the one measured on 2026-08-15 (four runs, four unreviewed
      comments in the database). Implicit submission is another: pressing Enter
      in the name field is a submit event from the "you" step, and the browser
      offers it for free on any single-input form.

      So the guard is here rather than only on the button. Whatever raised the
      event, an early submit becomes what the resident almost certainly meant —
      go to the review step — and `goToStep` still refuses to skip an empty
      comment box on the way.
    */
    if (step !== "send") {
      goToStep("send");
      return;
    }

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
      parentItemId,
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
        {/* The one promise the agency must not let a resident infer wrongly:
            being read is not the same as being written back to. */}
        <p className="text-sm text-muted-foreground">{t("portal.followUpHint")}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={resetForm}>
          {t("portal.shareAnother")}
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
    where: canDraw ? t("portal.stepWhereHelp") : t("portal.stepWhereHelpNoMap"),
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

  /**
   * THE "WHERE" STEP — the only place the three doors genuinely differ, and they
   * differ in what the map IS, never in what is asked.
   */
  const whereStep = () => {
    /*
      NO MAP ANYWHERE. Same answer on all three routes: ask in words, and fold
      what they type into the comment. The `inline` branch still mounts the
      picker, because the picker's own no-map notice is what explains the
      absence — and its sentence ends "describe the place in your own words",
      which until this field existed was a promise nothing on the page kept.
    */
    const wordsField = (
      <div className="space-y-1.5">
        <label htmlFor="portal-where-words" className="text-sm font-medium">
          {t("portal.whereInWords")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
        </label>
        <Input
          id="portal-where-words"
          value={whereWords}
          onChange={(event) => setWhereWords(event.target.value)}
          maxLength={200}
        />
      </div>
    );

    const locationStatus = (
      <>
        <p
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="portal-location-status"
        >
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {geometry ? t("portal.locationSet") : t("portal.locationNone")}
        </p>
        {geometry ? (
          <button
            type="button"
            onClick={clearGeometry}
            className="min-h-11 text-sm font-medium text-destructive underline-offset-2 hover:underline"
          >
            {t("portal.clearLocation")}
          </button>
        ) : null}
      </>
    );

    if (place.source === "stage") {
      if (!canDraw) return wordsField;
      return (
        <div className="space-y-3">
          {/*
            THE BUTTONS ONLY. The stage draws; this rail says what to draw. The
            same three words the inline picker puts on its own toggles, from the
            same catalog, so a resident who meets both surfaces meets one
            vocabulary.
          */}
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
                  onClick={() => place.onDrawModeChange(mode)}
                  aria-pressed={place.drawMode === mode}
                  className={cn(
                    "min-h-11 rounded-xl border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    place.drawMode === mode
                      ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-foreground"
                      : "border-border/70 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          {locationStatus}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">
          {t("survey.mapHint")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
        </p>

        {/*
          WHERE THIS MAP OPENS, AND WHAT IT WILL ACCEPT. Both sentences are
          SUPPRESSED with no map: each names "this map", and printing them above
          an absent one is a page describing something nobody can see.

          The first is the catalog's, built from the resolver's structured answer
          by the one function both participant surfaces call — it used to be
          `framing.summary`, English prose composed server-side in an
          administrator's vocabulary, printed to Spanish readers on this route
          for as long as this route has existed. The remaining two are still that
          prose, and are still marked as the English they are.
        */}
        {canDraw ? (
          <div className="space-y-1 text-xs text-muted-foreground" data-testid="portal-map-framing">
            <p>{portalMapFramingSentence(place.mapFraming, translator)}</p>
            {place.mapFraming.origin === "none" ? <p>{t("portal.mapZoomHint")}</p> : null}
            {place.mapFraming.unreadableNote ? (
              <p lang={PORTAL_DEFAULT_LOCALE} dir={PORTAL_LOCALE_DIRECTION[PORTAL_DEFAULT_LOCALE]}>
                {place.mapFraming.unreadableNote}
              </p>
            ) : null}
            {/*
              The submission rule, when this campaign has one (20260730000002).
              Rendered beside the one map whose submissions the rule actually
              governs — a survey `map_point` question is written by a different
              route that does not check it, and announcing the rule there would
              claim something nobody enforces.
            */}
            {place.mapFraming.submissionRule ? (
              <p lang={PORTAL_DEFAULT_LOCALE} dir={PORTAL_LOCALE_DIRECTION[PORTAL_DEFAULT_LOCALE]}>
                {place.mapFraming.submissionRule}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="public-map-frame public-map-frame--editor">
          <GeometryPickerMap
            onGeometryChange={setInlineGeometry}
            contextLayers={place.contextLayers}
            /*
              THE MAP SPEAKS THE RESIDENT'S LANGUAGE. Every sentence this picker
              produces is an English literal inside it by default — on a page
              that declares Spanish, Farsi or Arabic on its own wrapper. `words`
              is the catalog's answer and `lang` stamps what those words are
              actually written in.
            */
            words={pickerWords}
            lang={bcp47}
            {...(place.mapFraming.view
              ? { initialCenter: place.mapFraming.view.center, initialZoom: place.mapFraming.view.zoom }
              : {})}
          />
        </div>

        {canDraw ? locationStatus : wordsField}
      </div>
    );
  };

  return (
    <form
      className={cn("flex flex-col gap-4 p-5", className)}
      onSubmit={handleSubmit}
      data-testid="portal-guided-form"
    >
      {/*
        WHOSE COMMENT THIS ANSWERS, first in the form. A reply that lost its
        banner is a reply a resident cannot tell from a new comment, and the way
        out of it has to sit beside the thing it cancels.
      */}
      {replyingToLabel ? (
        <div
          className="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--pine)]/40 bg-[color:var(--pine)]/5 px-3.5 py-2.5"
          data-testid="portal-replying-to"
        >
          <p className="text-sm text-foreground">
            <span className="font-semibold">{t("portal.replyingTo")}</span>{" "}
            {/* A resident's OWN words: no `lang`, because nobody recorded which
                language the comment being replied to was written in. */}
            <span className="text-muted-foreground">{replyingToLabel}</span>
          </p>
          {onCancelReply ? (
            <button
              type="button"
              onClick={onCancelReply}
              className="min-h-11 shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("portal.cancelReply")}
            </button>
          ) : null}
        </div>
      ) : null}

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

        {step === "where" ? whereStep() : null}

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
                    // An <option> cannot carry a badge, so each one carries the
                    // language it is actually in — and its direction, because an
                    // Arabic topic name in a list of English ones renders its
                    // punctuation on the wrong side without it. The caveat is
                    // said once below the control.
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
              <Input
                id="portal-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
              />
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
                  {/*
                    A WAY TO UNDO IT. Clearing the file input is not something a
                    resident can do from the keyboard in every browser, and a
                    photo attached by accident is otherwise attached for good.
                  */}
                  <button
                    type="button"
                    className="min-h-11 text-xs font-medium text-destructive hover:underline"
                    onClick={clearPhoto}
                  >
                    {t("portal.removePhoto")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "you" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              {/* The heading the stacked form used above the same field. It names
                  what the field BUYS a resident — being written back to — which
                  the field's own label ("Your name") does not. */}
              <h4 className="text-sm font-semibold text-foreground">{t("portal.followUp")}</h4>
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
              <div
                className="space-y-4 border-t border-border/60 pt-4"
                data-testid="portal-demographics"
              >
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{t("portal.demographics")}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{t("portal.demographicsHint")}</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="portal-demo-age" className="text-sm font-medium">
                    {t("portal.demographicsAge")}{" "}
                    <span className="text-xs text-muted-foreground">({optionalHint})</span>
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
                    {t("portal.demographicsZip")}{" "}
                    <span className="text-xs text-muted-foreground">({optionalHint})</span>
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
                    {t("portal.demographicsPrimaryLanguage")}{" "}
                    <span className="text-xs text-muted-foreground">({optionalHint})</span>
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
                    {t("portal.demographicsTenure")}{" "}
                    <span className="text-xs text-muted-foreground">({optionalHint})</span>
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
                    {t("portal.demographicsRace")}{" "}
                    <span className="text-xs text-muted-foreground">({optionalHint})</span>
                  </legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
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
            <div>
              <p className="text-xs font-semibold text-foreground">{t("portal.whatHappensNext")}</p>
              <ul className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
                <li>{t("portal.reviewNotice")}</li>
                <li>{t("portal.followUpHint")}</li>
              </ul>
            </div>
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
        {/*
          THE KEYS ARE LOAD-BEARING. Without them React sees one <Button> in one
          position and REUSES the DOM node, changing `type` from "button" to
          "submit" in place. A resident's click on "Next" at the "About you"
          step then runs `goNext`, React flushes the re-render inside that same
          discrete event, and the browser performs the click's default action
          against the node's NEW type — posting the comment and skipping the
          review step entirely. Measured on 2026-08-15: four local runs, four
          comments in `engagement_items`, none of them ever shown to the person
          who wrote them. Distinct keys make React unmount one button and mount
          the other, so there is no shared node to change type underneath a
          click.
        */}
        {step === "send" ? (
          <Button
            key="portal-send"
            type="submit"
            disabled={isSubmitting || previewMode}
            className="min-h-11 flex-1 justify-center"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSubmitting ? t("portal.submitting") : t("portal.submit")}
          </Button>
        ) : (
          <Button
            key="portal-next"
            type="button"
            className="min-h-11 flex-1 justify-center"
            onClick={goNext}
            disabled={!canRespond}
          >
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
