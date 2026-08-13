/**
 * THE DRAWING MAP'S WORDS, from the participant catalog.
 *
 * `GeometryPickerMap` carries English defaults of its own — it has to, because
 * the operator console mounts it where no portal locale exists, and importing
 * the catalog into that client component would ship all 22 locales to a
 * resident's phone. This module is the other half: the binding from catalog keys
 * to that component's `words` shape, used by the two PARTICIPANT surfaces that
 * mount the picker (`public-engagement-portal.tsx` and the survey's `map_point`
 * question).
 *
 * The keys are the same ones the map-first surface already uses wherever the two
 * maps say the same thing — `portal.drawModePoint`, `portal.mapKeyboardHelp`,
 * `portal.mapMissingBody` — so a translator does not translate one drawing map's
 * vocabulary twice, and the two maps cannot end up calling the same gesture two
 * different things.
 *
 * `src/test/public-engagement-drawing-map-words.test.tsx` asserts that the
 * component's English defaults and the English catalog say the same thing, which
 * is what stops the two copies drifting.
 */

import type { GeometryPickerWords } from "@/components/engagement/geometry-picker-map";
import type { PortalTranslator } from "./translator";

export function buildGeometryPickerWords(translator: PortalTranslator): GeometryPickerWords {
  const { t } = translator;
  return {
    modeGroupLabel: t("portal.drawModeLabel"),
    roleDescription: t("portal.mapRoleDescription"),
    modePoint: t("portal.drawModePoint"),
    modeLine: t("portal.drawModeLine"),
    modeArea: t("portal.drawModeArea"),
    finishArea: t("portal.drawFinishArea"),
    undoLast: t("portal.drawUndoLast"),
    startOver: t("portal.drawStartOver"),
    hintPoint: t("portal.drawHintPoint"),
    hintPointPlaced: t("portal.drawHintPointPlaced"),
    hintLine: t("portal.drawHintLine"),
    hintLineStarted: t("portal.drawHintLineStarted"),
    hintLineMany: (count) => t("portal.drawHintLineMany", { count }),
    hintArea: t("portal.drawHintArea"),
    hintAreaFew: (count) => t("portal.drawHintAreaFew", { count }),
    hintAreaReady: (count) => t("portal.drawHintAreaReady", { count }),
    hintAreaClosed: (count) => t("portal.drawHintAreaClosed", { count }),
    needThreePoints: t("portal.drawNeedThreePoints"),
    vertexLimit: t("portal.drawVertexLimit"),
    pointPlaced: t("portal.drawPointPlaced"),
    vertexAdded: t("portal.drawVertexAdded"),
    areaAlreadyClosed: t("portal.drawAreaAlreadyClosed"),
    startedOver: t("portal.drawStartedOver"),
    undone: t("portal.drawUndone"),
    mapLabel: t("portal.mapLabelDrawing"),
    pointerHelp: t("portal.drawPointerHelp"),
    keyboardHelp: t("portal.mapKeyboardHelp"),
    mapUnavailable: t("portal.mapMissingBody"),
  };
}
