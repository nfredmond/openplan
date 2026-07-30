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
  "portal.yourInput": "Your input (required)",
  "portal.yourInputHint": "Tell us what you noticed, where you are seeing it, and why it matters.",
  "portal.onlyRequiredField": "This is the only required field in this form.",
  "portal.titleLabel": "Brief summary of your input",
  "portal.optionalFields": "Optional fields",
  "portal.aboutYou": "About you (optional)",
  "portal.nameLabel": "Name or alias",
  "portal.nameHint": "Add your name if you want the project team to know who sent this input.",
  "portal.followUp": "Follow-up (optional)",
  "portal.followUpHint": "Direct follow-up is not guaranteed unless the team chooses to reach back out.",
  "portal.photoHint": "Attach one JPEG, PNG, or WebP photo up to {limit}.",
  "portal.photoTooLarge": "Photo is too large. The limit is {limit}.",
  "portal.photoWrongType": "Please choose a JPEG, PNG, or WebP image.",
  "portal.photoFailed": "Photo upload failed",
  "portal.photoPreviewAlt": "Preview of the attached photo",
  "portal.photoItemAlt": "Photo attached to this community comment",
  "portal.submit": "Send my input",
  "portal.submitting": "Sending…",
  "portal.submitFailed": "Submission failed",
  "portal.received": "Your input has been received",
  "portal.receivedDetail": "Your submission has been received by the project team.",
  "portal.whatHappensNext": "What happens next",
  "portal.reviewNotice":
    "The project team reviews submissions before using them in summaries or reporting.",
  "portal.submissionsClosedNotice": "Submissions closed",
  "portal.sortNewest": "Newest",
  "portal.sortMostSupported": "Most supported",
  "portal.support": "Support",
  "portal.supported": "Supported",
  "portal.supportFailed": "Failed to record support",
  "portal.reply": "Reply",
  "portal.replyingTo": "Replying to:",
  "portal.located": "Located",
  "portal.noFeedbackYet": "No published feedback yet. Be the first to share something.",
  "portal.itemCount": "{count} published items",
  "portal.translateThis": "Translate this comment",
  "portal.translateInto": "Translate into",
  "portal.showOriginal": "Original",
  "portal.translating": "Translating…",
  "portal.translationUnavailable":
    "This comment could not be translated right now. The original is shown.",
  "portal.demographics": "About you (optional)",
  "portal.demographicsHint":
    "These answers help the project team check whether it is hearing from the whole community. They are never shown publicly.",
  "portal.preferNotToSay": "Prefer not to say",
  "portal.zipHint": "Only the first 3 digits are ever stored.",
  "portal.emailUpdates": "Email me updates about this project",

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
  "portal.yourInput": "Su comentario (obligatorio)",
  "portal.yourInputHint": "Cuéntenos qué observó, dónde lo observa y por qué es importante.",
  "portal.onlyRequiredField": "Este es el único campo obligatorio del formulario.",
  "portal.titleLabel": "Resumen breve de su comentario",
  "portal.optionalFields": "Campos opcionales",
  "portal.aboutYou": "Sobre usted (opcional)",
  "portal.nameLabel": "Nombre o seudónimo",
  "portal.nameHint": "Añada su nombre si desea que el equipo del proyecto sepa quién envió el comentario.",
  "portal.followUp": "Seguimiento (opcional)",
  "portal.followUpHint":
    "No se garantiza una respuesta directa, salvo que el equipo decida ponerse en contacto.",
  "portal.photoHint": "Adjunte una foto JPEG, PNG o WebP de hasta {limit}.",
  "portal.photoTooLarge": "La foto es demasiado grande. El límite es {limit}.",
  "portal.photoWrongType": "Elija una imagen JPEG, PNG o WebP.",
  "portal.photoFailed": "No se pudo subir la foto",
  "portal.photoPreviewAlt": "Vista previa de la foto adjunta",
  "portal.photoItemAlt": "Foto adjunta a este comentario de la comunidad",
  "portal.submit": "Enviar mi comentario",
  "portal.submitting": "Enviando…",
  "portal.submitFailed": "No se pudo enviar el comentario",
  "portal.received": "Hemos recibido su comentario",
  "portal.receivedDetail": "El equipo del proyecto ha recibido su envío.",
  "portal.whatHappensNext": "Qué ocurre después",
  "portal.reviewNotice":
    "El equipo del proyecto revisa los comentarios antes de usarlos en resúmenes o informes.",
  "portal.submissionsClosedNotice": "Comentarios cerrados",
  "portal.sortNewest": "Más recientes",
  "portal.sortMostSupported": "Con más apoyos",
  "portal.support": "Apoyar",
  "portal.supported": "Apoyado",
  "portal.supportFailed": "No se pudo registrar el apoyo",
  "portal.reply": "Responder",
  "portal.replyingTo": "Respondiendo a:",
  "portal.located": "Ubicado",
  "portal.noFeedbackYet": "Todavía no hay comentarios publicados. Sea la primera persona en compartir algo.",
  "portal.itemCount": "{count} aportes publicados",
  "portal.translateThis": "Traducir este comentario",
  "portal.translateInto": "Traducir a",
  "portal.showOriginal": "Original",
  "portal.translating": "Traduciendo…",
  "portal.translationUnavailable":
    "No se pudo traducir este comentario en este momento. Se muestra el original.",
  "portal.demographics": "Sobre usted (opcional)",
  "portal.demographicsHint":
    "Estas respuestas ayudan al equipo del proyecto a comprobar si está escuchando a toda la comunidad. Nunca se muestran públicamente.",
  "portal.preferNotToSay": "Prefiero no responder",
  "portal.zipHint": "Solo se guardan los tres primeros dígitos.",
  "portal.emailUpdates": "Quiero recibir novedades de este proyecto por correo electrónico",

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
 * fell back — never the other ten catalogs.
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
