/**
 * Published aerial interface — the aerial module's separability boundary.
 *
 * This is the ONLY aerial surface that NON-aerial code should depend on. The
 * aerial product ships its own accounts/RBAC and is independently sellable, so
 * the rest of OpenPlan must not reach into aerial internals (`./catalog`,
 * `./dji-export`, raw `aerial_*` table reads). Instead:
 *   - import posture/label/readiness helpers + their types from HERE
 *   - load aerial rows through the provider in `./queries` (not raw `.from()`)
 *
 * Aerial-internal code — `src/lib/aerial/*`, `src/app/(app)/aerial/*`,
 * `src/app/api/aerial/*`, `src/components/aerial/*` — may still import the
 * internal modules directly; everything else goes through this file. Keeping the
 * surface here means the aerial module can evolve its internals (or move its
 * tables) without touching a dozen unrelated call sites.
 */
export {
  buildAerialProjectPosture,
  describeAerialProjectPosture,
  summarizeAerialMissionPackagePosture,
  summarizeAerialEvidenceAttachmentReadiness,
  formatAerialMissionStatusLabel,
  aerialMissionStatusTone,
  formatAerialPackageStatusLabel,
  aerialPackageStatusTone,
  formatAerialVerificationReadinessLabel,
  aerialVerificationReadinessTone,
  formatAerialMissionTypeLabel,
} from "@/lib/aerial/catalog";

export type {
  AerialProjectPosture,
  AerialMissionStatus,
  AerialMissionType,
  AerialPackageStatus,
  AerialVerificationReadiness,
  AerialMissionPackagePosture,
  AerialEvidenceAttachmentReadiness,
  AerialEvidenceAttachmentUse,
  AerialEvidenceAttachmentSummary,
} from "@/lib/aerial/catalog";

export { isAoiPolygonGeoJson } from "@/lib/aerial/dji-export";
export type { AoiPolygonGeoJson } from "@/lib/aerial/dji-export";
