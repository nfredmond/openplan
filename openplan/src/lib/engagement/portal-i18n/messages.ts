/**
 * THE PARTICIPANT-FACING MESSAGE CATALOG — OpenPlan's own copy, in the
 * languages the engagement module claims to speak.
 *
 * SCOPE, and it is narrow on purpose: the PARTICIPANT surfaces only. The public
 * portal, the public survey, the close-the-loop page. The operator console, the
 * app shell and everything behind sign-in are NOT in here and must not be added
 * — this is a bounded catalog over a bounded surface, not the first half of a
 * whole-app i18n framework. A framework would have meant restructuring App
 * Router routing and adding a dependency to translate roughly a hundred
 * strings; a typed dictionary is the smaller correct answer.
 *
 * ENGLISH IS THE SOURCE OF TRUTH and is COMPLETE by construction: every key in
 * this file exists because `EN_PORTAL_MESSAGES` declares it, and
 * `PortalMessageKey` is derived from that object rather than declared beside
 * it. A key nobody wrote English for cannot be referenced, and a key referenced
 * with a typo does not compile.
 *
 * OTHER LOCALES MAY BE PARTIAL, and a partial locale is a fact the page has to
 * disclose. `buildPortalMessageBundle` reports exactly which keys fell back, so
 * an untranslated sentence sitting in an otherwise-Spanish page can be labelled
 * rather than read as something the agency chose to write in English. That
 * distinction is the whole reason this is a bundle and not a bare lookup.
 *
 * HOW A TRANSLATOR ADDS A LANGUAGE
 *
 *   1. Copy `ES_PORTAL_MESSAGES` to a new `<XX>_PORTAL_MESSAGES` constant typed
 *      `PortalMessageCatalog`, and translate the values. The type is
 *      `Partial<Record<PortalMessageKey, string>>`, so a key that no longer
 *      exists — or a key invented by a typo — is a compile error, while a key
 *      left out is simply not yet translated.
 *   2. Add it to `PORTAL_MESSAGE_CATALOGS` under its language code from
 *      `TRANSLATION_LANGUAGES`. There is no third list to update.
 *   3. Translate `language.partialNotice` and `language.pickerLabel` FIRST.
 *      They are the two strings a resident needs in order to understand that
 *      the rest is not translated yet, and to get back out.
 *
 * Nothing else changes. No route, no build step, no schema.
 */

import { PORTAL_DEFAULT_LOCALE, type PortalLocale, type ResolvedPortalLocale } from "./locales";
import type { PortalMessageBundle } from "./translator";

/**
 * `{name}` inside a value is a placeholder substituted at render time and typed
 * at compile time (see `translator.ts`). Keep placeholder NAMES identical
 * across locales — a translated string that renames `{count}` will render the
 * literal braces to a member of the public.
 */
export const EN_PORTAL_MESSAGES = {
  // ---------------------------------------------------------------- language
  "language.pickerLabel": "Language",
  "language.pickerHint": "Choose the language for this page.",
  "language.current": "Currently showing {language}",
  "language.switchTo": "Show this page in {language}",
  "language.partialNotice":
    "This page is only partly available in {language}. Anything not yet translated is shown in English.",
  "language.unsupportedNotice":
    "This page was opened with a language ({requested}) that is not available here, so it is showing {language}.",
  "language.shareHint": "The language is part of this page's web address, so a link you share opens in it too.",

  // ----------------------------------------------------------- accessibility
  // Deliberately says nothing about what this page CONFORMS to. OpenPlan has
  // not audited itself against any standard, and a portal that claimed to be
  // accessible while a resident sat unable to use it would be worse than one
  // that said nothing. What is offered here is a person to contact, which is
  // true regardless of the software's conformance.
  "accessibility.heading": "If you cannot use this page",
  "accessibility.intro":
    "Contact the project team and they will help you take part another way. You do not have to explain why.",
  "accessibility.contactLabel": "Who to contact",
  "accessibility.email": "Email",
  "accessibility.phone": "Phone",
  "accessibility.otherWays": "Other ways to take part",

  // -------------------------------------------------------------- provenance
  "provenance.machine.label": "Machine translation",
  "provenance.machine.caveat":
    "Translated by machine for convenience. The project team's original wording is the official version.",
  "provenance.untranslated.label": "Not translated",
  "provenance.untranslated.knownSource":
    "The project team has not published this in {language}. It is shown in {sourceLanguage}.",
  "provenance.untranslated.unknownSource":
    "The project team has not published this in {language}. It is shown as they wrote it.",
  "provenance.unreadable.label": "Translations unavailable",
  "provenance.unreadable.detail":
    "This page could not load its translations, so this text is shown as the project team wrote it. Whether a {language} version exists is not known.",

  // -------------------------------------------------------------------- page
  "page.kicker": "Community engagement",
  "page.linkedProject": "Linked project: {project}",
  "page.standalone": "Standalone public engagement page",
  "page.shareLane": "Share-ready public lane",
  "page.mode": "Mode: {mode}",
  "page.supports": "This input supports",
  "page.submissionStatus": "Submission status",
  "page.submissionsOpen": "Submissions open",
  "page.submissionsClosed": "Submissions closed",
  "page.submissionStatusDetail":
    "The project team reviews submissions before they are used in public-facing materials.",
  "page.publishedFeedback": "Published feedback",
  "page.publishedFeedbackDetail": "Approved community items currently visible on this campaign page.",
  "page.engagementMode": "Engagement mode",
  "page.engagementModeDetail": "Structured public input collected in a planning-grade workflow.",
  "page.posture": "Portal posture",
  "page.postureTitle": "Public input with review and traceability",
  "page.postureCopy":
    "This page gives the public a focused place to submit and review campaign feedback while preserving planning context, moderation, and category structure inside OpenPlan.",
  "page.postureItemReview":
    "Submissions are reviewed before they are reflected in public-facing summaries or technical materials.",
  "page.postureItemApproved":
    "Published feedback represents approved items from the campaign, not an unfiltered public message board.",
  "page.postureItemLocation":
    "Location-based comments can be tied to a specific place when that improves the planning record.",
  "page.lastUpdated": "Last updated {timestamp}",
  "page.defaultDescription":
    "Share your input on this project. Comments are reviewed before they appear publicly.",

  // --------------------------------------------------------- engagement type
  "engagementType.map_feedback": "Map-based community input",
  "engagementType.comment_collection": "Community feedback",
  "engagementType.meeting_intake": "Meeting intake",

  // ------------------------------------------------------------------ portal
  "portal.tab.submit": "Share your input",
  "portal.tab.feedback": "Community feedback",
  "portal.tab.survey": "Survey",
  "portal.tab.closeLoop": "You said / We did",
  "portal.about": "About this engagement",
  "portal.aboutProcess": "How the project team organizes input",
  "portal.topics": "Feedback topics",
  "portal.selectTopic": "Select a topic",
  "portal.yourInput": "What you want to tell us (we need this part)",
  "portal.yourInputHint": "Tell us what you noticed, where you are seeing it, and why it matters.",
  "portal.onlyRequiredField": "This is the only part of this form we need.",
  "portal.titleLabel": "A short title for what you wrote",
  "portal.optionalFields": "Only if you want to",
  "portal.aboutYou": "About you (only if you want to)",
  "portal.nameLabel": "Your name, or any name you want to use",
  "portal.nameHint": "Add a name if you want the team to know who sent this. You can leave it blank.",
  "portal.followUp": "Hearing back (only if you want to)",
  "portal.followUpHint": "The team may not be able to write back to you personally.",
  "portal.photoHint": "Attach one JPEG, PNG, or WebP photo up to {limit}.",
  "portal.photoTooLarge": "Photo is too large. The limit is {limit}.",
  "portal.photoWrongType": "Please choose a JPEG, PNG, or WebP image.",
  "portal.photoFailed": "We could not add your photo. You can try again, or send what you wrote without it.",
  "portal.photoPreviewAlt": "Preview of the attached photo",
  "portal.photoItemAlt": "Photo attached to this community comment",
  "portal.submit": "Send what I wrote",
  "portal.submitting": "Sending…",
  "portal.submitFailed": "We could not send what you wrote. Nothing has been lost — please try again.",
  "portal.received": "Thank you. We have what you sent.",
  "portal.receivedDetail": "What you wrote has gone to the project team.",
  "portal.whatHappensNext": "What happens next",
  "portal.reviewNotice":
    "Someone on the project team reads what you send before it is shown on this page or used in a report.",
  "portal.submissionsClosedNotice": "This project is not taking comments right now",
  "portal.sortNewest": "Newest",
  "portal.sortMostSupported": "Most supported",
  "portal.support": "Support",
  "portal.supported": "Supported",
  "portal.supportFailed": "Failed to record support",
  "portal.reply": "Reply",
  "portal.replyingTo": "Replying to:",
  "portal.located": "Located",
  "portal.noFeedbackYet": "No published feedback yet. Be the first to share something.",
  // Shown INSTEAD of noFeedbackYet when the comment read failed. "No feedback
  // yet" is a claim about this campaign; a query that failed cannot make it, and
  // on a public portal it tells residents nobody took part.
  "portal.feedbackUnavailable":
    "Published comments could not be loaded, so they are not shown. This does not mean no one has commented.",
  "portal.partOfPageUnavailable":
    "Part of this page could not be loaded. Anything that looks empty below may not be empty.",
  "portal.itemCount": "{count} published items",
  "portal.translateThis": "Translate this comment",
  "portal.translateInto": "Translate into",
  "portal.showOriginal": "Original",
  "portal.translating": "Translating…",
  "portal.translationUnavailable":
    "This comment could not be translated right now. The original is shown.",
  "portal.demographics": "About you (only if you want to)",
  "portal.demographicsHint":
    "These answers help the project team check whether it is hearing from the whole community. They are never shown publicly.",
  /*
    THE FIVE DEMOGRAPHIC QUESTION LABELS. They were typed as English literals in
    two components — the classic form's `PENDING_PORTAL_TEXT` and, a second time,
    the map-first rail. A label is prose and belongs in the catalog; only the
    ANSWER options stay English, because `demographicLabel` is shared with the
    operator console's aggregate views and the two must name a band identically.
    Wording is kept faithful to the question the data means: "your main language"
    is the same question as "primary language", where "the language you speak at
    home" would be a different one.
  */
  "portal.demographicsAge": "Your age range",
  "portal.demographicsZip": "Your ZIP code",
  "portal.demographicsPrimaryLanguage": "Your main language",
  "portal.demographicsTenure": "Do you rent or own your home?",
  "portal.demographicsRace": "Your race or ethnicity",
  "portal.preferNotToSay": "Prefer not to say",
  "portal.zipHint": "Only the first 3 digits are ever stored.",
  "portal.emailUpdates": "Email me updates about this project",

  // ------------------------------------------------- portal: the map surface
  /*
    THE MAP-FIRST PARTICIPANT SURFACE. Every string below is read by somebody who
    arrived from a mailed postcard or a flyer, on a phone, with no idea what a
    "campaign", a "geometry" or an "engagement mode" is. So: no terms of art, no
    term-plus-definition, no sentence that needs a second sentence. "Show us
    where", not "Add a spatial reference".

    The keyboard-help and announcement strings are read ALOUD by a screen reader
    rather than seen, which is why they are whole sentences and name the key by
    the word on it.
  */
  "portal.mapRoleDescription": "Map you can draw on",
  "portal.mapLabelDrawing": "Map of this project. Mark the place you mean.",
  "portal.mapLabelReading": "Map of this project and what other people have said.",
  "portal.mapKeyboardHelp":
    "Use the arrow keys to move the map and the plus and minus keys to zoom. Press Enter to mark the spot in the middle of the map. Press Backspace to undo the last mark. Press C to finish an area. Press Escape to start over.",
  "portal.mapKeyboardHelpReadOnly":
    "Use the arrow keys to move the map and the plus and minus keys to zoom.",
  "portal.drawPointPlaced": "Marked. Press Enter again to move it somewhere else.",
  "portal.drawVertexAdded": "Point added to your shape.",
  "portal.drawAreaClosed": "Area finished.",
  "portal.drawAreaAlreadyClosed": "This area is finished. Start over to draw a different one.",
  "portal.drawVertexLimit": "That is as many points as one shape can have.",
  "portal.drawCleared": "Your mark was removed.",
  "portal.drawUndone": "Last point removed.",
  "portal.drawModeLabel": "What are you marking?",
  "portal.drawModePoint": "A spot",
  "portal.drawModeLine": "A street or path",
  "portal.drawModeArea": "An area",

  // --------------------------------------------- portal: the step-by-step rail
  "portal.stepsHeading": "What you want to tell us",
  "portal.stepCounter": "Step {step} of {total}",
  "portal.next": "Next",
  "portal.back": "Back",
  "portal.stepWhereTitle": "Show us where",
  "portal.stepWhereHelp": "Tap the map where you mean. You can skip this if it is not about one place.",
  "portal.stepWhereHelpNoMap": "Type the street, corner, or landmark you mean. You can skip this.",
  "portal.stepWhatTitle": "Say what you think",
  "portal.stepWhatHelp": "In your own words. Anything you write here is read by the project team.",
  /*
    THE ONE THING WE NEED, said as a request rather than as a verdict on the
    resident. It is shown when somebody tries to move past this step, or to send,
    with nothing written — a state the browser's own "please fill in this field"
    can never cover here, because the box is not on screen on the send step and
    an off-screen required field simply blocks the form in silence.
  */
  "portal.commentNeeded": "Please write something first. It is the one thing we need.",
  "portal.stepExtrasTitle": "Add a photo or a topic",
  "portal.stepExtrasHelp": "Only if you want to. Nothing here is needed.",
  "portal.stepYouTitle": "About you",
  "portal.stepYouHelp": "All of this is optional. You can send your input without any of it.",
  "portal.stepSendTitle": "Send it",
  "portal.stepSendHelp": "Check it over, then send.",
  "portal.locationSet": "You marked a place on the map.",
  "portal.locationNone": "No place marked yet.",
  "portal.clearLocation": "Remove the place I marked",
  "portal.whereInWords": "Where is this? A street, corner, or landmark.",
  // The label the typed place is stored under. It goes INTO the comment text —
  // there is no column for it — so it must be a word the reader of the comment
  // understands, in the language the resident wrote in.
  "portal.whereRecorded": "Where: {place}",
  "portal.reviewHeading": "What you are sending",
  "portal.reviewNoLocation": "No place marked",

  // ----------------------------------------------- portal: the one way onward
  /*
    THE LABEL ON THE ONLY DOOR, and it names what is actually behind it.
    "About this project" reads as background, so a resident who came to answer a
    survey walks past the only link that leads to one — and to the comments, to
    the per-comment translation, to the record of what the team did, and to the
    email sign-up. Which sentence is used is decided per campaign from what that
    campaign really has, because a door promising a survey that does not exist
    costs the same trust as the door that promised nothing.
  */
  "portal.openDetailsSurveyAndComments": "See the survey and what other people said",
  "portal.openDetailsSurvey": "See the survey for this project",
  "portal.openDetailsComments": "See what other people said",
  "portal.openDetails": "See more about this project",
  "portal.openDetailsHint": "And what the team has done about it so far",
  "portal.backToMap": "Back to the map",
  "portal.addYourInput": "Tell us what you think",
  "portal.hideForm": "Hide",

  // ------------------------------------------------------ portal: no map here
  /*
    THE MAP CANNOT DRAW. Said to a member of the public, so it says what they can
    still do and stops. The reason — an unset access token — is an operator's
    problem and is disclosed separately through `OperatorDetail`, which is hidden
    from resident-facing copy by its own guard.
  */
  "portal.mapMissingTitle": "The map cannot be shown here",
  "portal.mapMissingBody":
    "You can still tell us what you think. Answer the questions below, and describe the place in your own words.",

  // ------------------------------------------- portal: the two map controls
  /*
    THE MAP CONTROLS SPEAK THE RESIDENT'S LANGUAGE. These were English literals
    inside the picker components, rendered inside a page that may declare Farsi
    or Arabic. The pickers still carry English defaults for any other caller;
    the participant map passes these.

    "What's on the map" and "Map background", never "layers" and never
    "basemap": nobody outside a GIS office has ever used either word.
  */
  "portal.layersHeading": "What's on the map",
  "portal.layersHint": "Turn things on and off. This only changes what you see.",
  "portal.layersReadFailure":
    "The project's map information could not be loaded, so none of it is drawn. That does not mean there is none.",
  "portal.layersShowAll": "Show all",
  "portal.layersHideAll": "Hide all",
  "portal.backgroundHeading": "Map background",
  "portal.backgroundHint": "Change what the map looks like underneath.",
  "portal.backgroundUnavailable": "not available on this site",

  /*
    THE NAME OF EVERY BACKGROUND ON OFFER, one key per id in
    `PUBLIC_BASEMAP_IDS`. These were literals in `basemaps.ts`, which meant the
    picker's HEADING was translated into all 22 languages while every option
    inside it stayed English — a control whose own label a resident could read
    and whose choices they could not.

    They stay in this catalog rather than becoming a `label` field per locale in
    the registry, because the registry is cartographic configuration read by the
    server and this is participant copy; and because a language added here must
    not require an edit to a file that names Mapbox style ids.

    `portal-basemap-labels.ts` binds a registry id to these two keys, and
    `portal-basemap-words.test.ts` fails if an id ever exists without them — an
    id added to the registry with no catalog entry would otherwise render as the
    raw key to the public.
  */
  "portal.background.streets.label": "Streets",
  "portal.background.streets.description": "Roads, place names and landmarks.",
  "portal.background.satellite.label": "Satellite",
  "portal.background.satellite.description": "Photographs from above, with street names on top.",
  "portal.background.terrain.label": "Terrain",
  "portal.background.terrain.description": "Hills, trails, parks and waterways.",
  "portal.background.light.label": "Plain and pale",
  "portal.background.light.description": "A quiet background, so the marked shapes stand out.",
  "portal.background.dark.label": "Plain and dark",
  "portal.background.dark.description": "A quiet dark background, easier at night.",

  // --------------------------------------------- portal: nothing framed this
  /*
    NOBODY SAID WHERE. The campaign, the project it belongs to and the agency
    itself all have no area on record, and nothing has been submitted yet, so
    the map opens wide — and a wide map presented as if it were the study area
    is a claim nobody made. Said plainly, and it goes away as soon as the
    resident moves the map, because by then they have taken over.
  */
  "portal.mapNoAreaTitle": "This map is not set to one place",
  "portal.mapNoAreaBody":
    "Nobody has said which area this page is about, so the map starts wide. Move and zoom it to the place you mean, or write where you mean in your own words in the form.",
  "portal.mapNoAreaDismiss": "OK",

  // ------------------------------------ portal: where this map opens, and why
  /*
    WHY THE MAP IS LOOKING WHERE IT IS LOOKING, in the resident's language.

    `resolvePortalMapFraming` composes this sentence server-side as English
    prose, and the shell used to print that prose verbatim under `lang="en"` on
    every page in every language. Two defects in one sentence: it was English on
    a Spanish page, and it was written in an administrator's vocabulary — "no
    study area has been set for this campaign" names two objects that exist in
    the software and nowhere in a resident's life.

    So the sentence is REBUILT here from the structured fields the resolver
    already carries (`origin`, `originLabel`, whether any candidate failed),
    rather than translated as a blob. The English prose survives for the surfaces
    that are not participant-facing — the operator preview's own reading of it,
    and a survey question's framing note — and is marked as English there.

    A named place is never translated: `{place}` is the agency's own name for it.
  */
  "portal.mapFramingOn": "This map opens on {place} — {source}.",
  "portal.mapFramingOnUnnamed": "This map opens on {source}.",
  "portal.mapFramingSourceCampaign": "the area this page is about",
  "portal.mapFramingSourceProject": "the area of the project this page is about",
  "portal.mapFramingSourceWorkspace": "the area this team normally works in",
  "portal.mapFramingSourcePins": "the places people have already marked here",
  "portal.mapFramingNoArea":
    "Nobody has said which area this page is about, so the map starts wide. Move it and zoom in to the place you mean.",
  "portal.mapFramingUnknownArea":
    "This map could not be set to one place, so it starts wide. Move it and zoom in to the place you mean.",

  // ----------------------------------------------- portal: the drawing map
  /*
    THE OTHER DRAWING MAP. `GeometryPickerMap` is the map on the context page
    and in the embed, and it spoke English to everyone: "Click the map or press
    Enter to drop a pin at the crosshair", "2 vertices · line ready", "Vertex
    limit reached". Terms of art ("vertex", "crosshair"), a mouse verb on a
    surface most people reach by phone, and none of it reaching the catalog.

    The picker keeps English defaults because the operator console mounts it too
    (the study-area picker, the project map); the participant surfaces pass
    these. `{count}` is a number of taps, so it is spelled as a count and not as
    a technical noun.
  */
  "portal.drawPointerHelp":
    "Tap or click the map to add a point. Right-click removes the last one.",
  "portal.drawHintPoint": "Tap the map to mark the place you mean.",
  "portal.drawHintPointPlaced": "Marked. Tap somewhere else to move it.",
  "portal.drawHintLine": "Tap the map to draw along a street or path.",
  "portal.drawHintLineStarted": "One point so far. Tap again to keep going.",
  "portal.drawHintLineMany": "{count} points so far. Keep tapping to make the line longer.",
  "portal.drawHintArea": "Tap the map to start outlining an area.",
  "portal.drawHintAreaFew": "{count} so far. An area needs at least three points.",
  "portal.drawHintAreaReady": "{count} points. Tap the first one again to finish the area.",
  "portal.drawHintAreaClosed": "Area finished, with {count} points.",
  "portal.drawNeedThreePoints": "Add at least three points before you finish the area.",
  "portal.drawFinishArea": "Finish the area",
  "portal.drawUndoLast": "Undo the last point",
  "portal.drawStartOver": "Start over",
  "portal.drawStartedOver": "Starting over. What you drew has been removed.",
  "portal.mapZoomHint": "Zoom in to your own street before you mark a spot.",

  // ------------------------------------------------- portal: email updates
  /*
    THE EMAIL SIGN-UP. Every string here was an English literal inside
    `public-subscribe-form.tsx`, including the only label the email box has —
    it had none at all, so a screen reader announced it as "edit text".

    "You can stop the emails at any time" rather than "unsubscribe anytime": the
    verb is the thing a person does, not the name of the mechanism.
  */
  "portal.subscribeHeading": "Get email updates",
  "portal.subscribeHint":
    "We will email you when the project team posts an update. You can stop the emails at any time.",
  "portal.subscribeEmailLabel": "Your email address",
  "portal.subscribeSubmit": "Email me updates",
  "portal.subscribeThanks": "Thank you. Check your email and confirm, and we will keep you posted.",
  "portal.subscribeFailed": "We could not sign you up just now. Please try again.",

  // --------------------------------------- portal: the classic comment form
  /*
    The last of the strings `public-engagement-portal.tsx` held in its own
    `PENDING_PORTAL_TEXT` object — English for every reader, on the page a
    resident reaches from the map. The object is gone; these are its keys.
  */
  "portal.cancelReply": "Cancel reply",
  "portal.removePhoto": "Remove photo",
  "portal.shareAnother": "Share another response",
  "portal.sortBy": "Sort by",

  // ------------------------------------------------------------------ survey
  "survey.title": "Survey",
  "survey.intro": "Takes about {minutes} minutes. One main response is required.",
  "survey.required": "Required",
  "survey.optional": "Optional",
  "survey.closed": "Survey closed",
  "survey.submit": "Submit survey",
  "survey.submitting": "Submitting…",
  "survey.submitFailed": "Survey submission failed",
  "survey.received": "Thank you — your survey response has been received.",
  "survey.selectOne": "Choose one",
  "survey.selectMany": "Choose all that apply",
  "survey.rankHint": "Drag or number the options from most to least important.",
  "survey.budgetRemaining": "{amount} left to allocate",
  "survey.mapHint": "Tap the map to place your answer.",
  "survey.requiredMissing": "Please answer the required questions before submitting.",

  // ------------------------------------------------- survey: save and resume
  // EVERY SENTENCE HERE IS A PROMISE ABOUT A RESIDENT'S OWN ANSWERS, so each one
  // says only what the product actually does. The draft is reachable from this
  // browser on this device because the resume credential is held there and
  // nowhere else (see survey-drafts.ts); `{days}` is
  // SURVEY_DRAFT_RETENTION_DAYS, the same constant the server enforces; and the
  // attachments really are not saved, because a stored file path outlives the
  // upload window and would fail at submission.
  "survey.saveForLater": "Save and finish later",
  "survey.savingDraft": "Saving…",
  "survey.draftDeviceOnly":
    "Saved answers stay in this browser on this device, and are kept for {days} days. Nobody else can open them.",
  "survey.draftSaved": "Saved. You can come back to this page on this device until {date}.",
  "survey.draftRestored": "We brought back the answers you saved on {date}.",
  "survey.draftGone": "The answers you saved earlier are no longer available, so this form is starting empty.",
  "survey.draftCheckFailed":
    "We could not check for saved answers just now. If you saved some, they have not been lost — reload this page to try again.",
  "survey.draftSaveFailed":
    "Your answers could not be saved just now. Nothing you have typed has been lost — you can try again.",
  "survey.draftFilesNotSaved":
    "Files you attached are not saved with your answers. You will need to attach them again.",
  "survey.draftDiscard": "Discard saved answers",
  "survey.draftDiscarded": "Your saved answers have been discarded.",
  "survey.draftLocationKept":
    "The location you saved earlier is still attached to this answer, even though the map is showing empty. Draw on the map again to replace it.",

  // ------------------------------------------------ survey: conditional logic
  "survey.conditionalNote": "Some questions appear only if they apply to your earlier answers.",

  // -------------------------------------------------------------- close loop
  "closeLoop.title": "You said / We did",
  "closeLoop.intro": "What the project team heard from the community, and how they responded.",
  "closeLoop.youSaid": "You said",
  "closeLoop.weDid": "We did",
  "closeLoop.empty": "The project team has not published any updates for this campaign yet.",
} as const;

/** The exact type of the English source, used to type placeholders. */
export type PortalMessageSource = typeof EN_PORTAL_MESSAGES;

export type PortalMessageKey = keyof PortalMessageSource;

/**
 * A non-English locale's copy. Partial on purpose — a translation lands key by
 * key, and the alternative (a locale that cannot ship until every string is
 * done) is how a language stays at zero for a year. An unknown key is still a
 * compile error, so "partial" never means "unchecked".
 */
export type PortalMessageCatalog = Partial<Record<PortalMessageKey, string>>;

/**
 * Spanish — the second COMPLETE locale.
 *
 * Complete deliberately: without one, the partial-locale machinery below would
 * only ever be exercised by a locale that translates nothing, and the branch
 * that matters most — a real translation with a few genuine gaps — would never
 * run. It is also the language most often asked for alongside English by US
 * agencies operating under Title VI, so it is the one most likely to be checked
 * by somebody who reads it.
 */
const ES_PORTAL_MESSAGES: PortalMessageCatalog = {
  "language.pickerLabel": "Idioma",
  "language.pickerHint": "Elija el idioma de esta página.",
  "language.current": "Mostrando actualmente en {language}",
  "language.switchTo": "Ver esta página en {language}",
  "language.partialNotice":
    "Esta página solo está disponible parcialmente en {language}. Lo que aún no está traducido se muestra en inglés.",
  "language.unsupportedNotice":
    "Esta página se abrió con un idioma ({requested}) que no está disponible aquí, por lo que se muestra en {language}.",
  "language.shareHint":
    "El idioma forma parte de la dirección web de esta página, así que un enlace que comparta se abrirá en ese idioma.",

  "accessibility.heading": "Si no puede usar esta página",
  "accessibility.intro":
    "Comuníquese con el equipo del proyecto y le ayudarán a participar de otra manera. No tiene que explicar por qué.",
  "accessibility.contactLabel": "A quién contactar",
  "accessibility.email": "Correo electrónico",
  "accessibility.phone": "Teléfono",
  "accessibility.otherWays": "Otras maneras de participar",

  "provenance.machine.label": "Traducción automática",
  "provenance.machine.caveat":
    "Traducido automáticamente por conveniencia. La redacción original del equipo del proyecto es la versión oficial.",
  "provenance.untranslated.label": "Sin traducir",
  "provenance.untranslated.knownSource":
    "El equipo del proyecto no ha publicado este texto en {language}. Se muestra en {sourceLanguage}.",
  "provenance.untranslated.unknownSource":
    "El equipo del proyecto no ha publicado este texto en {language}. Se muestra tal como lo escribió.",
  "provenance.unreadable.label": "Traducciones no disponibles",
  "provenance.unreadable.detail":
    "Esta página no pudo cargar sus traducciones, así que este texto se muestra tal como lo escribió el equipo del proyecto. No se sabe si existe una versión en {language}.",

  "page.kicker": "Participación comunitaria",
  "page.linkedProject": "Proyecto vinculado: {project}",
  "page.standalone": "Página de participación pública independiente",
  "page.shareLane": "Espacio público listo para compartir",
  "page.mode": "Modalidad: {mode}",
  "page.supports": "Esta participación apoya a",
  "page.submissionStatus": "Estado de los comentarios",
  "page.submissionsOpen": "Comentarios abiertos",
  "page.submissionsClosed": "Comentarios cerrados",
  "page.submissionStatusDetail":
    "El equipo del proyecto revisa los comentarios antes de usarlos en materiales públicos.",
  "page.publishedFeedback": "Comentarios publicados",
  "page.publishedFeedbackDetail":
    "Aportes de la comunidad aprobados y visibles actualmente en esta página.",
  "page.engagementMode": "Tipo de participación",
  "page.engagementModeDetail":
    "Aportes públicos estructurados, recopilados con un flujo de trabajo de calidad profesional.",
  "page.posture": "Enfoque del portal",
  "page.postureTitle": "Participación pública con revisión y trazabilidad",
  "page.postureCopy":
    "Esta página ofrece al público un lugar concreto para enviar y revisar comentarios de la campaña, conservando el contexto de planificación, la moderación y la estructura de temas dentro de OpenPlan.",
  "page.postureItemReview":
    "Los comentarios se revisan antes de reflejarse en resúmenes públicos o materiales técnicos.",
  "page.postureItemApproved":
    "Los comentarios publicados corresponden a aportes aprobados de la campaña, no a un foro público sin filtrar.",
  "page.postureItemLocation":
    "Los comentarios ubicados en el mapa pueden vincularse a un lugar concreto cuando eso mejora el registro de planificación.",
  "page.lastUpdated": "Última actualización: {timestamp}",
  "page.defaultDescription":
    "Comparta su opinión sobre este proyecto. Los comentarios se revisan antes de publicarse.",

  "engagementType.map_feedback": "Aportes de la comunidad sobre el mapa",
  "engagementType.comment_collection": "Comentarios de la comunidad",
  "engagementType.meeting_intake": "Registro de reuniones",

  "portal.tab.submit": "Comparta su opinión",
  "portal.tab.feedback": "Comentarios de la comunidad",
  "portal.tab.survey": "Encuesta",
  "portal.tab.closeLoop": "Usted dijo / Nosotros hicimos",
  "portal.about": "Sobre esta participación",
  "portal.aboutProcess": "Cómo organiza el equipo del proyecto los aportes",
  "portal.topics": "Temas de comentarios",
  "portal.selectTopic": "Seleccione un tema",
  "portal.yourInput": "Lo que nos quiere contar (esta parte sí hace falta)",
  "portal.yourInputHint": "Cuéntenos qué observó, dónde lo observa y por qué es importante.",
  "portal.onlyRequiredField": "Es la única parte de este formulario que hace falta.",
  "portal.titleLabel": "Un título corto para lo que escribió",
  "portal.optionalFields": "Solo si usted quiere",
  "portal.aboutYou": "Sobre usted (solo si usted quiere)",
  "portal.nameLabel": "Su nombre, o el nombre que quiera usar",
  "portal.nameHint": "Añada un nombre si quiere que el equipo sepa quién envió esto. Puede dejarlo en blanco.",
  "portal.followUp": "Recibir respuesta (solo si usted quiere)",
  "portal.followUpHint": "Puede que el equipo no le pueda responder a usted en persona.",
  "portal.photoHint": "Adjunte una foto JPEG, PNG o WebP de hasta {limit}.",
  "portal.photoTooLarge": "La foto es demasiado grande. El límite es {limit}.",
  "portal.photoWrongType": "Elija una imagen JPEG, PNG o WebP.",
  "portal.photoFailed":
    "No pudimos añadir su foto. Puede intentarlo otra vez, o enviar lo que escribió sin la foto.",
  "portal.photoPreviewAlt": "Vista previa de la foto adjunta",
  "portal.photoItemAlt": "Foto adjunta a este comentario de la comunidad",
  "portal.submit": "Enviar lo que escribí",
  "portal.submitting": "Enviando…",
  "portal.submitFailed":
    "No pudimos enviar lo que escribió. No se ha perdido nada: inténtelo otra vez, por favor.",
  "portal.received": "Gracias. Ya tenemos lo que nos envió.",
  "portal.receivedDetail": "Lo que escribió ha llegado al equipo del proyecto.",
  "portal.whatHappensNext": "Qué ocurre después",
  "portal.reviewNotice":
    "Alguien del equipo del proyecto lee lo que usted envía antes de mostrarlo en esta página o usarlo en un informe.",
  "portal.submissionsClosedNotice": "Este proyecto no está recibiendo comentarios en este momento",
  "portal.sortNewest": "Más recientes",
  "portal.sortMostSupported": "Con más apoyos",
  "portal.support": "Apoyar",
  "portal.supported": "Apoyado",
  "portal.supportFailed": "No se pudo registrar el apoyo",
  "portal.reply": "Responder",
  "portal.replyingTo": "Respondiendo a:",
  "portal.located": "Ubicado",
  "portal.noFeedbackYet": "Todavía no hay comentarios publicados. Sea la primera persona en compartir algo.",
  "portal.feedbackUnavailable":
    "No se pudieron cargar los comentarios publicados, por lo que no se muestran. Esto no significa que nadie haya comentado.",
  "portal.partOfPageUnavailable":
    "No se pudo cargar una parte de esta página. Lo que aparezca vacío a continuación puede no estarlo.",
  "portal.itemCount": "{count} aportes publicados",
  "portal.translateThis": "Traducir este comentario",
  "portal.translateInto": "Traducir a",
  "portal.showOriginal": "Original",
  "portal.translating": "Traduciendo…",
  "portal.translationUnavailable":
    "No se pudo traducir este comentario en este momento. Se muestra el original.",
  "portal.demographics": "Sobre usted (solo si usted quiere)",
  "portal.demographicsHint":
    "Estas respuestas ayudan al equipo del proyecto a comprobar si está escuchando a toda la comunidad. Nunca se muestran públicamente.",
  "portal.demographicsAge": "Su rango de edad",
  "portal.demographicsZip": "Su código postal",
  "portal.demographicsPrimaryLanguage": "Su idioma principal",
  "portal.demographicsTenure": "¿Alquila o es dueño de su vivienda?",
  "portal.demographicsRace": "Su raza u origen étnico",
  "portal.preferNotToSay": "Prefiero no responder",
  "portal.zipHint": "Solo se guardan los tres primeros dígitos.",
  "portal.emailUpdates": "Quiero recibir novedades de este proyecto por correo electrónico",

  "portal.mapRoleDescription": "Mapa en el que puede dibujar",
  "portal.mapLabelDrawing": "Mapa de este proyecto. Marque el lugar del que habla.",
  "portal.mapLabelReading": "Mapa de este proyecto y de lo que ha dicho otra gente.",
  "portal.mapKeyboardHelp":
    "Use las teclas de flecha para mover el mapa y las teclas más y menos para acercar o alejar. Pulse Intro para marcar el punto que está en el centro del mapa. Pulse Retroceso para deshacer la última marca. Pulse C para cerrar un área. Pulse Escape para empezar de nuevo.",
  "portal.mapKeyboardHelpReadOnly":
    "Use las teclas de flecha para mover el mapa y las teclas más y menos para acercar o alejar.",
  "portal.drawPointPlaced": "Marcado. Pulse Intro otra vez para moverlo a otro sitio.",
  "portal.drawVertexAdded": "Se añadió un punto a su figura.",
  "portal.drawAreaClosed": "Área terminada.",
  "portal.drawAreaAlreadyClosed": "Esta área ya está terminada. Empiece de nuevo para dibujar otra.",
  "portal.drawVertexLimit": "Esa es la cantidad máxima de puntos que puede tener una figura.",
  "portal.drawCleared": "Se quitó su marca.",
  "portal.drawUndone": "Se quitó el último punto.",
  "portal.drawModeLabel": "¿Qué está marcando?",
  "portal.drawModePoint": "Un punto",
  "portal.drawModeLine": "Una calle o un camino",
  "portal.drawModeArea": "Un área",

  /*
    The map-control and no-area strings, translated 2026-08-13. They arrived in
    English only, which quietly made the whole Spanish catalog partial — every
    Spanish page then carried "only partly available in Spanish" over copy that
    was in fact fully translated, and the portal's own pending-copy notice went
    silent because it defers to that one. A missing translation is never local to
    the key that is missing.
  */
  "portal.layersHeading": "Qué hay en el mapa",
  "portal.layersHint": "Active y desactive cosas. Esto solo cambia lo que usted ve.",
  "portal.layersReadFailure":
    "No se pudo cargar la información del mapa de este proyecto, así que no se dibuja nada de ella. Eso no significa que no haya ninguna.",
  "portal.layersShowAll": "Mostrar todo",
  "portal.layersHideAll": "Ocultar todo",
  "portal.backgroundHeading": "Fondo del mapa",
  "portal.backgroundHint": "Cambie el aspecto del mapa por debajo.",
  "portal.backgroundUnavailable": "no está disponible en este sitio",

  "portal.background.streets.label": "Calles",
  "portal.background.streets.description": "Calles, nombres de lugares y puntos de referencia.",
  "portal.background.satellite.label": "Satélite",
  "portal.background.satellite.description":
    "Fotografías desde el aire, con los nombres de las calles encima.",
  "portal.background.terrain.label": "Terreno",
  "portal.background.terrain.description": "Cerros, senderos, parques y ríos.",
  "portal.background.light.label": "Sencillo y claro",
  "portal.background.light.description":
    "Un fondo tranquilo, para que resalte lo que está marcado.",
  "portal.background.dark.label": "Sencillo y oscuro",
  "portal.background.dark.description": "Un fondo oscuro y tranquilo, más cómodo de noche.",

  "portal.mapFramingOn": "Este mapa se abre en {place}: {source}.",
  "portal.mapFramingOnUnnamed": "Este mapa se abre en {source}.",
  "portal.mapFramingSourceCampaign": "la zona de la que trata esta página",
  "portal.mapFramingSourceProject": "la zona del proyecto del que trata esta página",
  "portal.mapFramingSourceWorkspace": "la zona en la que normalmente trabaja este equipo",
  "portal.mapFramingSourcePins": "los lugares que ya ha marcado la gente aquí",
  "portal.mapFramingNoArea":
    "Nadie ha dicho de qué zona trata esta página, así que el mapa empieza muy abierto. Muévalo y acérquelo al lugar del que habla.",
  "portal.mapFramingUnknownArea":
    "No se pudo situar este mapa en un lugar concreto, así que empieza muy abierto. Muévalo y acérquelo al lugar del que habla.",

  "portal.drawPointerHelp":
    "Toque o haga clic en el mapa para añadir un punto. Con el botón derecho se quita el último.",
  "portal.drawHintPoint": "Toque el mapa para marcar el lugar del que habla.",
  "portal.drawHintPointPlaced": "Marcado. Toque en otro sitio para moverlo.",
  "portal.drawHintLine": "Toque el mapa para dibujar a lo largo de una calle o un camino.",
  "portal.drawHintLineStarted": "Un punto por ahora. Toque otra vez para seguir.",
  "portal.drawHintLineMany": "{count} puntos por ahora. Siga tocando para alargar la línea.",
  "portal.drawHintArea": "Toque el mapa para empezar a delinear un área.",
  "portal.drawHintAreaFew": "{count} por ahora. Un área necesita al menos tres puntos.",
  "portal.drawHintAreaReady": "{count} puntos. Toque otra vez el primero para terminar el área.",
  "portal.drawHintAreaClosed": "Área terminada, con {count} puntos.",
  "portal.drawNeedThreePoints": "Añada al menos tres puntos antes de terminar el área.",
  "portal.drawFinishArea": "Terminar el área",
  "portal.drawUndoLast": "Deshacer el último punto",
  "portal.drawStartOver": "Empezar de nuevo",
  "portal.drawStartedOver": "Empezando de nuevo. Se quitó lo que había dibujado.",
  "portal.mapZoomHint": "Acérquese a su propia calle antes de marcar un punto.",

  "portal.subscribeHeading": "Reciba novedades por correo electrónico",
  "portal.subscribeHint":
    "Le escribiremos cuando el equipo del proyecto publique una novedad. Puede dejar de recibir estos correos cuando quiera.",
  "portal.subscribeEmailLabel": "Su correo electrónico",
  "portal.subscribeSubmit": "Envíenme novedades",
  "portal.subscribeThanks":
    "Gracias. Revise su correo y confirme, y le mantendremos al tanto.",
  "portal.subscribeFailed": "No pudimos inscribirle en este momento. Inténtelo otra vez, por favor.",

  "portal.cancelReply": "Cancelar la respuesta",
  "portal.removePhoto": "Quitar la foto",
  "portal.shareAnother": "Enviar otro comentario",
  "portal.sortBy": "Ordenar por",

  "portal.mapNoAreaTitle": "Este mapa no está centrado en un lugar concreto",
  "portal.mapNoAreaBody":
    "Nadie ha dicho de qué zona trata esta página, así que el mapa empieza muy abierto. Muévalo y acérquelo al lugar del que habla, o escriba en el formulario con sus propias palabras a qué lugar se refiere.",
  "portal.mapNoAreaDismiss": "Aceptar",

  "portal.stepsHeading": "Lo que nos quiere contar",
  "portal.stepCounter": "Paso {step} de {total}",
  "portal.next": "Siguiente",
  "portal.back": "Atrás",
  "portal.stepWhereTitle": "Muéstrenos dónde",
  "portal.stepWhereHelp":
    "Toque el mapa en el lugar del que habla. Puede omitir esto si no se trata de un lugar concreto.",
  "portal.stepWhereHelpNoMap":
    "Escriba la calle, la esquina o el punto de referencia del que habla. Puede omitir esto.",
  "portal.stepWhatTitle": "Diga qué opina",
  "portal.stepWhatHelp": "Con sus propias palabras. El equipo del proyecto lee todo lo que escriba aquí.",
  "portal.commentNeeded": "Escriba algo primero, por favor. Es lo único que hace falta.",
  "portal.stepExtrasTitle": "Añada una foto o un tema",
  "portal.stepExtrasHelp": "Solo si quiere. Nada de esto hace falta.",
  "portal.stepYouTitle": "Sobre usted",
  "portal.stepYouHelp": "Todo esto es opcional. Puede enviar su comentario sin nada de esto.",
  "portal.stepSendTitle": "Envíelo",
  "portal.stepSendHelp": "Revíselo y envíelo.",
  "portal.locationSet": "Marcó un lugar en el mapa.",
  "portal.locationNone": "Todavía no ha marcado ningún lugar.",
  "portal.clearLocation": "Quitar el lugar que marqué",
  "portal.whereInWords": "¿Dónde es esto? Una calle, una esquina o un punto de referencia.",
  "portal.whereRecorded": "Dónde: {place}",
  "portal.reviewHeading": "Lo que va a enviar",
  "portal.reviewNoLocation": "Ningún lugar marcado",

  "portal.openDetailsSurveyAndComments": "Vea la encuesta y lo que dijo otra gente",
  "portal.openDetailsSurvey": "Vea la encuesta de este proyecto",
  "portal.openDetailsComments": "Vea lo que dijo otra gente",
  "portal.openDetails": "Vea más sobre este proyecto",
  "portal.openDetailsHint": "Y lo que el equipo ha hecho al respecto hasta ahora",
  "portal.backToMap": "Volver al mapa",
  "portal.addYourInput": "Cuéntenos qué opina",
  "portal.hideForm": "Ocultar",

  "portal.mapMissingTitle": "Aquí no se puede mostrar el mapa",
  "portal.mapMissingBody":
    "Aun así puede contarnos qué opina. Responda las preguntas de abajo y describa el lugar con sus propias palabras.",

  "survey.title": "Encuesta",
  "survey.intro": "Toma unos {minutes} minutos. Se requiere una respuesta principal.",
  "survey.required": "Obligatorio",
  "survey.optional": "Opcional",
  "survey.closed": "Encuesta cerrada",
  "survey.submit": "Enviar encuesta",
  "survey.submitting": "Enviando…",
  "survey.submitFailed": "No se pudo enviar la encuesta",
  "survey.received": "Gracias: hemos recibido su respuesta.",
  "survey.selectOne": "Elija una opción",
  "survey.selectMany": "Elija todas las opciones que correspondan",
  "survey.rankHint": "Ordene las opciones de más a menos importante.",
  "survey.budgetRemaining": "Queda {amount} por asignar",
  "survey.mapHint": "Toque el mapa para situar su respuesta.",
  "survey.requiredMissing": "Responda las preguntas obligatorias antes de enviar.",

  "survey.saveForLater": "Guardar y terminar más tarde",
  "survey.savingDraft": "Guardando…",
  "survey.draftDeviceOnly":
    "Las respuestas guardadas se quedan en este navegador y en este dispositivo, y se conservan {days} días. Nadie más puede abrirlas.",
  "survey.draftSaved": "Guardado. Puede volver a esta página desde este dispositivo hasta el {date}.",
  "survey.draftRestored": "Hemos recuperado las respuestas que guardó el {date}.",
  "survey.draftGone":
    "Las respuestas que guardó antes ya no están disponibles, así que este formulario empieza vacío.",
  "survey.draftCheckFailed":
    "No pudimos comprobar si hay respuestas guardadas en este momento. Si guardó algunas, no se han perdido: vuelva a cargar la página para intentarlo de nuevo.",
  "survey.draftSaveFailed":
    "No se pudieron guardar sus respuestas en este momento. No se ha perdido nada de lo que escribió: puede intentarlo de nuevo.",
  "survey.draftFilesNotSaved":
    "Los archivos que adjuntó no se guardan con sus respuestas. Tendrá que adjuntarlos otra vez.",
  "survey.draftDiscard": "Descartar las respuestas guardadas",
  "survey.draftDiscarded": "Se han descartado sus respuestas guardadas.",
  "survey.draftLocationKept":
    "La ubicación que guardó antes sigue asociada a esta respuesta, aunque el mapa aparezca vacío. Vuelva a dibujar en el mapa para reemplazarla.",

  "survey.conditionalNote": "Algunas preguntas solo aparecen si corresponden a sus respuestas anteriores.",

  "closeLoop.title": "Usted dijo / Nosotros hicimos",
  "closeLoop.intro": "Lo que el equipo del proyecto escuchó de la comunidad, y cómo respondió.",
  "closeLoop.youSaid": "Usted dijo",
  "closeLoop.weDid": "Nosotros hicimos",
  "closeLoop.empty": "El equipo del proyecto todavía no ha publicado novedades para esta campaña.",
};

/**
 * Every locale that has copy. A language present in `TRANSLATION_LANGUAGES` and
 * absent here is not broken — it falls back to English key by key and the page
 * says so. That is the honest state of a language nobody has translated yet,
 * and it is very different from pretending the portal has no such language.
 */
export const PORTAL_MESSAGE_CATALOGS: Partial<Record<PortalLocale, PortalMessageCatalog>> = {
  es: ES_PORTAL_MESSAGES,
};

const ALL_KEYS = Object.keys(EN_PORTAL_MESSAGES) as PortalMessageKey[];

/**
 * Resolve one locale into the serializable bundle a surface renders from.
 *
 * Runs SERVER-SIDE, once per page load, in `loadPublicPortalBundle`. What
 * crosses to the browser is this locale's strings and the list of keys that
 * fell back — never every other locale's catalog.
 */
export function buildPortalMessageBundle(locale: ResolvedPortalLocale): PortalMessageBundle {
  const catalog = PORTAL_MESSAGE_CATALOGS[locale.locale] ?? {};
  const messages = {} as Record<PortalMessageKey, string>;
  const fallbackKeys: PortalMessageKey[] = [];

  for (const key of ALL_KEYS) {
    const translated = catalog[key];
    if (typeof translated === "string" && translated.trim().length > 0) {
      messages[key] = translated;
      continue;
    }
    messages[key] = EN_PORTAL_MESSAGES[key];
    // English asking for English is not a fallback — there is nothing missing,
    // and reporting one would put a "not fully translated" banner on every
    // English portal in the product.
    if (locale.locale !== PORTAL_DEFAULT_LOCALE) fallbackKeys.push(key);
  }

  return {
    locale: locale.locale,
    direction: locale.direction,
    bcp47: locale.bcp47,
    nativeName: locale.nativeName,
    messages,
    fallbackKeys,
  };
}

/** Which of the catalog's keys a locale carries — for tests and operator tooling. */
export function portalMessageCoverage(locale: PortalLocale): {
  locale: PortalLocale;
  total: number;
  translated: number;
  missing: PortalMessageKey[];
  complete: boolean;
} {
  if (locale === PORTAL_DEFAULT_LOCALE) {
    return { locale, total: ALL_KEYS.length, translated: ALL_KEYS.length, missing: [], complete: true };
  }

  const catalog = PORTAL_MESSAGE_CATALOGS[locale] ?? {};
  const missing = ALL_KEYS.filter((key) => {
    const value = catalog[key];
    return typeof value !== "string" || value.trim().length === 0;
  });

  return {
    locale,
    total: ALL_KEYS.length,
    translated: ALL_KEYS.length - missing.length,
    missing,
    complete: missing.length === 0,
  };
}
