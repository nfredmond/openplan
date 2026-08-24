/**
 * Binds a workspace or project to a stage-gate template.
 *
 * The templates themselves live in `template-registry.ts`; this module answers
 * one question — "which template does this caller get, and did it actually
 * choose it?" — and records the answer on the binding so the product can be
 * honest about the difference.
 *
 * There are three ways to get a template, in descending order of authority:
 *
 *   1. the caller named one (`explicitly_requested`);
 *   2. the workspace's own jurisdiction has a registered pack
 *      (`jurisdiction_matched`) — this is what a workspace's home geography
 *      buys, and it is why every surface should hand its geography in;
 *   3. neither, so an explicitly-labeled interim default applies
 *      (`interim_unconfigured_default`), carrying the REASON it applied.
 *
 * Case 3 is not a silent fallback and must never be rendered as one. See
 * `describeStageGateBinding`, which produces the sentence a planner has to be
 * shown before they act on gates nobody chose for them.
 *
 * Surfaces reading an existing workspace should call
 * `resolveWorkspaceStageGateBinding`, which reconciles the template id stored on
 * the row against that workspace's geography — the stored id has a database
 * default, so on its own it cannot tell a choice from an assumption.
 */

import {
  INTERIM_DEFAULT_RATIONALE,
  stageGateTemplateRegistry,
  type StageGateJurisdiction,
  type StageGateJurisdictionQuery,
  type StageGateTemplateDescriptor,
  type StageGateTemplateRegistry,
} from "@/lib/stage-gates/template-registry";
import {
  parseWorkspaceHomeGeography,
  resolveJurisdiction,
} from "@/lib/workspaces/home-geography";

/**
 * The template applied when a caller names none.
 *
 * Derived from the registry rather than written down, so registering a
 * different interim default is a data change. Callers that persist a template id
 * should persist the resolved binding's `templateId`, not this constant.
 */
export const DEFAULT_STAGE_GATE_TEMPLATE_ID: string =
  stageGateTemplateRegistry.defaultTemplateId ?? "";

/**
 * Every template id the DATABASE COLUMN DEFAULT on
 * `workspaces.stage_gate_template_id` has EVER stamped onto a row.
 *
 * WHY THIS IS A SET AND NOT "the registry's current default": the sign-up
 * trigger inserts only (name, slug), so a workspace born under any of these
 * defaults holds the id with nobody having chosen it — and at read time that
 * stored id is byte-for-byte indistinguishable from one an agency deliberately
 * picked. When the registry's default later changes (as it did on 2026-08-05,
 * CA pack → US federal-aid floor), comparing the stored id against the CURRENT
 * default would reclassify every workspace born under the OLD default as having
 * EXPLICITLY REQUESTED another jurisdiction's gates. That is the exact
 * assumed-presented-as-chosen substitution this module exists to prevent, so a
 * stored id in this set that diverges from the geography answer is always
 * labeled assumed (`interim_unconfigured_default`), never chosen.
 *
 * Grows append-only: every migration that sets a new column default adds its id
 * here, and no id is ever removed while a database anywhere might still carry
 * rows born under it.
 */
export const KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  // Migration 20260305000009 — the column's original default.
  "ca_stage_gates_v0_1",
  // Migration 20260805000001 — the nationwide federal-aid floor.
  "us_federal_aid_stage_gates_v0_1",
]);

export type StageGateBindingMode = "workspace_bootstrap_interim" | "project_create_v0_2";

/**
 * Whether the bound template was chosen, derived, or assumed.
 *
 * `interim_unconfigured_default` means nobody picked it — see
 * `INTERIM_DEFAULT_RATIONALE`. Any surface that shows gates bound this way must
 * disclose that the jurisdiction was assumed, and offer a way to change it.
 */
export type StageGateTemplateSelection =
  | "explicitly_requested"
  | "jurisdiction_matched"
  | "interim_unconfigured_default";

/**
 * Why an interim default applied. Each case needs a different thing from the
 * user, so collapsing them into one message would waste the disclosure:
 *
 *   - `no_workspace_jurisdiction`  → tell us where you work.
 *   - `no_template_for_jurisdiction` → we know where you work and have not
 *     authored your pack yet. Nothing the user can do; OpenPlan owes them one.
 *   - `ambiguous_jurisdiction_templates` → more than one pack covers you; pick.
 *   - `jurisdiction_template_not_bound` → a pack for your jurisdiction IS
 *     registered, but this workspace is still holding a database default it was
 *     created with (today's, or a superseded one — see
 *     `KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS`). Rebind it. (See
 *     `resolveWorkspaceStageGateBinding`, which is where the stored binding and
 *     the workspace's geography are compared.)
 */
export type StageGateInterimDefaultReason =
  | "no_workspace_jurisdiction"
  | "no_template_for_jurisdiction"
  | "ambiguous_jurisdiction_templates"
  | "jurisdiction_template_not_bound";

export type StageGateTemplateBinding = {
  templateId: string;
  templateName: string;
  templateVersion: string;
  /** Flat code as persisted/returned today; `jurisdictionLabel` is the readable form. */
  jurisdiction: string;
  jurisdictionLabel: string;
  /** Structured coverage declared by the template registration. */
  templateJurisdiction: StageGateJurisdiction;
  bindingMode: StageGateBindingMode;
  templateSelection: StageGateTemplateSelection;
  /** Null unless `templateSelection` is `interim_unconfigured_default`. */
  interimDefaultReason: StageGateInterimDefaultReason | null;
  /**
   * The workspace jurisdiction the resolver was given, or null when the caller
   * could not state one. Kept on the binding so a surface can say "we know you
   * are in US-OH and have no Ohio pack" rather than the vaguer "no jurisdiction".
   */
  workspaceJurisdiction: StageGateJurisdictionQuery | null;
  /**
   * Declared by the bound template, not by the binder: `null` for any template
   * whose jurisdiction has no Caltrans LAPM forms. It used to be a literal
   * stamped on every binding, which reported a California form-set status to
   * agencies nowhere near California.
   */
  lapmFormIdsStatus: string | null;
  /** The template's own description of itself, when the artifact carries one. */
  templateDescription?: string;
  /**
   * The template's own scope disclosures — what it does NOT cover — when the
   * artifact carries them. Surfaces that let a planner pick a template should
   * render these; they are the template being honest about its limits.
   */
  scopeNotes?: readonly string[];
};

/**
 * Resolution outcome. The two unresolved cases carry what was available so the
 * caller can say which templates *do* exist instead of a bare failure.
 */
export type StageGateTemplateResolution =
  | { kind: "resolved"; binding: StageGateTemplateBinding }
  | {
      kind: "unknown_template";
      requestedTemplateId: string;
      available: readonly StageGateTemplateDescriptor[];
    }
  | { kind: "no_default_template"; available: readonly StageGateTemplateDescriptor[] };

export type StageGateTemplateResolveOptions = {
  bindingMode?: StageGateBindingMode;
  /** Defaults to the built-in registry; injectable for tests and future template sources. */
  registry?: StageGateTemplateRegistry;
  /**
   * Where the workspace works, as `resolveJurisdiction()` reports it from the
   * workspace's home geography. `null`/omitted means the workspace has not said
   * — which is a fallback reason, never a licence to guess.
   */
  jurisdiction?: StageGateJurisdictionQuery | null;
};

/**
 * Resolve a template binding without throwing.
 *
 * An unknown id is a caller-handleable outcome, not an exception: the caller
 * decides whether to reject the request or offer the available templates. It is
 * never resolved to the default — silently substituting a jurisdiction the
 * caller did not ask for is the failure mode this module exists to prevent.
 *
 * With no requested id, the workspace's own jurisdiction decides; only when that
 * yields nothing does the labeled interim default apply.
 */
export function resolveStageGateTemplate(
  requestedTemplateId?: string,
  options?: StageGateTemplateResolveOptions
): StageGateTemplateResolution {
  const registry = options?.registry ?? stageGateTemplateRegistry;
  const bindingMode = options?.bindingMode ?? "workspace_bootstrap_interim";
  const jurisdiction = normalizeJurisdictionQuery(options?.jurisdiction);
  const normalizedRequestedTemplateId = requestedTemplateId?.trim();

  // An explicit id outranks geography: an agency that works in one place may
  // deliberately deliver under another jurisdiction's process (a consultant, a
  // federally-funded project, a tribe electing a state's checklist).
  if (normalizedRequestedTemplateId?.length) {
    const entry = registry.get(normalizedRequestedTemplateId);
    if (!entry) {
      return {
        kind: "unknown_template",
        requestedTemplateId: normalizedRequestedTemplateId,
        available: registry.list(),
      };
    }

    return {
      kind: "resolved",
      binding: toBinding(entry.descriptor, {
        bindingMode,
        templateSelection: "explicitly_requested",
        interimDefaultReason: null,
        workspaceJurisdiction: jurisdiction,
      }),
    };
  }

  if (jurisdiction) {
    const match = registry.findByJurisdiction(jurisdiction);
    if (match.kind === "matched") {
      return {
        kind: "resolved",
        binding: toBinding(match.entry.descriptor, {
          bindingMode,
          templateSelection: "jurisdiction_matched",
          interimDefaultReason: null,
          workspaceJurisdiction: jurisdiction,
        }),
      };
    }

    return interimDefaultResolution(registry, bindingMode, jurisdiction, {
      ambiguous: match.kind === "ambiguous",
    });
  }

  return interimDefaultResolution(registry, bindingMode, null, { ambiguous: false });
}

/**
 * Resolve from a workspace row that carries the home-geography columns.
 *
 * This is the seam every workspace-aware caller should use: hand it the row and
 * the jurisdiction question is answered the same way everywhere. A row with no
 * geography resolves to the labeled interim default, exactly as a caller that
 * passes no jurisdiction at all does.
 */
export function resolveStageGateTemplateForWorkspace(
  workspaceRow: unknown,
  requestedTemplateId?: string,
  options?: Omit<StageGateTemplateResolveOptions, "jurisdiction">
): StageGateTemplateResolution {
  return resolveStageGateTemplate(requestedTemplateId, {
    ...options,
    jurisdiction: resolveJurisdiction(parseWorkspaceHomeGeography(workspaceRow)),
  });
}

/**
 * The binding a workspace ROW actually has — the stored template id reconciled
 * against the workspace's own jurisdiction. This is what a surface should call
 * before it shows anyone a gate name.
 *
 * WHY THE RECONCILIATION EXISTS. `workspaces.stage_gate_template_id` carries a
 * DATABASE DEFAULT (migration 20260305000009, re-pointed by 20260805000001) and
 * the sign-up trigger inserts only (name, slug), so a workspace in any
 * jurisdiction is born holding whichever default was current at its creation —
 * and at read time that stored id is indistinguishable from one an agency
 * deliberately chose. Reading it as a choice would let the product present
 * assumed gates as selected ones, which is the exact substitution
 * `template-registry.ts` exists to prevent. The set of ids this applies to is
 * `KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS`, because rows born under a SUPERSEDED
 * default are exactly as unchosen as rows born under the current one.
 *
 * So responsibility is split: the stored id decides WHICH template (it is the
 * binding of record), and the workspace's home geography decides whether that
 * template was matched to this workspace or merely assumed for it. The two agree
 * in the ordinary case; where they diverge the binding says which, rather than
 * choosing the comfortable story.
 *
 * A row with no stored id — a select that did not ask for the column, a
 * deployment predating it — falls back to the geography answer alone, which is
 * still a disclosed one.
 */
export function resolveWorkspaceStageGateBinding(
  workspaceRow: unknown,
  options?: Omit<StageGateTemplateResolveOptions, "jurisdiction">
): StageGateTemplateResolution {
  const registry = options?.registry ?? stageGateTemplateRegistry;
  const bindingMode = options?.bindingMode ?? "workspace_bootstrap_interim";

  // What this workspace's geography alone would bind it to.
  const geographyResolution = resolveStageGateTemplateForWorkspace(workspaceRow, undefined, options);
  const persistedTemplateId = readPersistedTemplateId(workspaceRow);
  const persistedSelection = readWorkspaceStageGateTemplateSelection(workspaceRow);

  if (!persistedTemplateId) return geographyResolution;

  // New rows record whether a person chose the template. That fact outranks a
  // later geography match: a consultant may deliberately deliver under a
  // different process, and changing the home geography must not rewrite it.
  if (persistedSelection === "explicitly_requested") {
    const entry = registry.get(persistedTemplateId);
    if (!entry) {
      return {
        kind: "unknown_template",
        requestedTemplateId: persistedTemplateId,
        available: registry.list(),
      };
    }
    const jurisdiction = normalizeJurisdictionQuery(
      resolveJurisdiction(parseWorkspaceHomeGeography(workspaceRow))
    );
    return {
      kind: "resolved",
      binding: toBinding(entry.descriptor, {
        bindingMode,
        templateSelection: "explicitly_requested",
        interimDefaultReason: null,
        workspaceJurisdiction: jurisdiction,
      }),
    };
  }

  // Stored and derived agree: keep the geography answer, which already carries
  // the honest selection — `jurisdiction_matched`, or the interim default plus
  // the reason it applied.
  if (
    geographyResolution.kind === "resolved" &&
    geographyResolution.binding.templateId === persistedTemplateId
  ) {
    return geographyResolution;
  }

  const entry = registry.get(persistedTemplateId);
  if (!entry) {
    // Bound to a template this deployment does not register. Substituting any
    // other one would render unrelated gates under the stored id, so the caller
    // is told instead and can say so.
    return {
      kind: "unknown_template",
      requestedTemplateId: persistedTemplateId,
      available: registry.list(),
    };
  }

  const jurisdiction = normalizeJurisdictionQuery(
    resolveJurisdiction(parseWorkspaceHomeGeography(workspaceRow))
  );

  // Divergence, and only two shapes reach here. Either the row still holds an
  // id a database default stamped on it — assumed, and fixable by the planner —
  // or it holds some other registered template, which nothing but a deliberate
  // write could have put there.
  //
  // MEMBERSHIP, NOT EQUALITY WITH THE CURRENT DEFAULT. The stored id is
  // compared against every id the column default has EVER been
  // (`KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS`): a workspace born before the
  // default changed diverges from today's default through no act of its own,
  // and calling that divergence "explicitly requested" would present gates
  // nobody chose as a deliberate selection.
  if (
    persistedSelection === "jurisdiction_matched" ||
    persistedSelection === "interim_unconfigured_default" ||
    (persistedSelection === null && KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS.has(persistedTemplateId))
  ) {
    return {
      kind: "resolved",
      binding: toBinding(entry.descriptor, {
        bindingMode,
        templateSelection: "interim_unconfigured_default",
        interimDefaultReason: divergenceInterimReason(registry, geographyResolution, jurisdiction),
        workspaceJurisdiction: jurisdiction,
      }),
    };
  }

  return {
    kind: "resolved",
    binding: toBinding(entry.descriptor, {
      bindingMode,
      templateSelection: "explicitly_requested",
      interimDefaultReason: null,
      workspaceJurisdiction: jurisdiction,
    }),
  };
}

/**
 * Which reason honestly describes an ASSUMED binding whose stored id diverges
 * from the geography answer, derived from what the workspace's own geography
 * could establish:
 *
 *   - geography matched a registered pack → `jurisdiction_template_not_bound`
 *     (a pack for this workspace exists; the row just still holds a database
 *     default — rebinding is the fix);
 *   - geography itself resolved to an interim default → that resolution's OWN
 *     reason is reused (`no_workspace_jurisdiction`,
 *     `no_template_for_jurisdiction`, `ambiguous_jurisdiction_templates`),
 *     because the divergence adds nothing the planner can act on beyond what
 *     the geography already could not answer.
 *
 * The fallback re-derives from the registry directly, for the one shape the
 * resolution cannot carry a reason through: an injected registry that declares
 * no interim default, where the geography answer is `no_default_template`.
 */
function divergenceInterimReason(
  registry: StageGateTemplateRegistry,
  geographyResolution: StageGateTemplateResolution,
  jurisdiction: StageGateJurisdictionQuery | null
): StageGateInterimDefaultReason {
  if (geographyResolution.kind === "resolved") {
    if (geographyResolution.binding.templateSelection === "jurisdiction_matched") {
      return "jurisdiction_template_not_bound";
    }
    if (geographyResolution.binding.interimDefaultReason) {
      return geographyResolution.binding.interimDefaultReason;
    }
  }

  if (!jurisdiction) return "no_workspace_jurisdiction";
  const match = registry.findByJurisdiction(jurisdiction);
  if (match.kind === "matched") return "jurisdiction_template_not_bound";
  if (match.kind === "ambiguous") return "ambiguous_jurisdiction_templates";
  return "no_template_for_jurisdiction";
}

function readPersistedTemplateId(workspaceRow: unknown): string | null {
  if (!workspaceRow || typeof workspaceRow !== "object") return null;
  const value = (workspaceRow as Record<string, unknown>).stage_gate_template_id;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Null is intentional for rows created before selection provenance existed. */
export function readWorkspaceStageGateTemplateSelection(
  workspaceRow: unknown
): StageGateTemplateSelection | null {
  if (!workspaceRow || typeof workspaceRow !== "object") return null;
  const value = (workspaceRow as Record<string, unknown>).stage_gate_template_selection;
  return value === "explicitly_requested" ||
    value === "jurisdiction_matched" ||
    value === "interim_unconfigured_default"
    ? value
    : null;
}

/**
 * Throwing wrapper kept for the workspace-bootstrap, admin-provisioning, and
 * project-create routes, which already catch it and return 400. New callers
 * should use `resolveStageGateTemplate` and handle the unresolved cases
 * explicitly — they can then tell the operator which templates exist.
 */
export function resolveStageGateTemplateBinding(
  requestedTemplateId?: string,
  options?: StageGateTemplateResolveOptions
): StageGateTemplateBinding {
  const resolution = resolveStageGateTemplate(requestedTemplateId, options);

  if (resolution.kind === "unknown_template") {
    throw new Error(`Unsupported stage-gate template: ${resolution.requestedTemplateId}`);
  }

  if (resolution.kind === "no_default_template") {
    throw new Error("No stage-gate template is registered");
  }

  return resolution.binding;
}

/** Every registered template — the source for a jurisdiction picker. */
export function listStageGateTemplates(
  registry: StageGateTemplateRegistry = stageGateTemplateRegistry
): readonly StageGateTemplateDescriptor[] {
  return registry.list();
}

export { INTERIM_DEFAULT_RATIONALE };

/**
 * The sentence a planner must be shown alongside gates they did not choose.
 *
 * Returned for every binding, not only the assumed ones, so a surface renders
 * one thing unconditionally and cannot forget the disclosure by forgetting a
 * branch. `isJurisdictionAssumed` is the flag that decides how loudly.
 */
export type StageGateBindingDisclosure = {
  /** True only for `interim_unconfigured_default`. */
  isJurisdictionAssumed: boolean;
  headline: string;
  detail: string;
  /** What the reader can do about it, or null when there is nothing to do. */
  action: string | null;
};

export function describeStageGateBinding(
  binding: StageGateTemplateBinding
): StageGateBindingDisclosure {
  const known = formatJurisdictionQuery(binding.workspaceJurisdiction);

  if (binding.templateSelection === "explicitly_requested") {
    return {
      isJurisdictionAssumed: false,
      headline: `Stage gates: ${binding.jurisdictionLabel}`,
      detail: `This workspace was bound to the ${binding.templateName} template because it asked for it.`,
      action: null,
    };
  }

  if (binding.templateSelection === "jurisdiction_matched") {
    const matchedCountryFloor =
      Boolean(binding.workspaceJurisdiction?.subdivision) &&
      !binding.templateJurisdiction.subdivision &&
      binding.workspaceJurisdiction?.country === binding.templateJurisdiction.country;
    if (matchedCountryFloor) {
      return {
        isJurisdictionAssumed: false,
        headline: `Stage gates: ${binding.jurisdictionLabel}`,
        detail: `OpenPlan matched the country-level ${binding.templateName} template for ${known}. No subdivision-specific stage-gate pack is registered for ${known}; these gates do not state requirements unique to that jurisdiction.`,
        action: null,
      };
    }
    return {
      isJurisdictionAssumed: false,
      headline: `Stage gates: ${binding.jurisdictionLabel}`,
      detail: `These gates come from the template registered for this workspace's own jurisdiction (${known ?? binding.jurisdiction}).`,
      action: null,
    };
  }

  const headline = `Interim default gates — not ${known ? `${known}'s` : "your jurisdiction's"}`;
  const consequence = interimDefaultConsequence(binding.jurisdictionLabel);

  if (binding.interimDefaultReason === "no_template_for_jurisdiction") {
    return {
      isJurisdictionAssumed: true,
      headline,
      detail: `OpenPlan has no stage-gate template registered for ${known} yet, so this workspace is showing the ${binding.templateName} (${binding.jurisdictionLabel}) as an explicitly-labeled interim default. ${consequence}`,
      action: `Choose a registered template that matches how this agency delivers, or track it as a gap until a ${known} pack exists.`,
    };
  }

  if (binding.interimDefaultReason === "ambiguous_jurisdiction_templates") {
    return {
      isJurisdictionAssumed: true,
      headline,
      detail: `More than one registered stage-gate template covers ${known}, so none was chosen automatically and this workspace is showing the ${binding.templateName} (${binding.jurisdictionLabel}) as an explicitly-labeled interim default. ${consequence}`,
      action: "Pick the template this agency actually delivers under.",
    };
  }

  if (binding.interimDefaultReason === "jurisdiction_template_not_bound") {
    return {
      isJurisdictionAssumed: true,
      headline,
      detail: `A stage-gate template IS registered for ${known}, but this workspace is still bound to the ${binding.templateName} (${binding.jurisdictionLabel}) it was created with, as an explicitly-labeled interim default. ${consequence}`,
      action: `Rebind this workspace to the template registered for ${known}.`,
    };
  }

  return {
    isJurisdictionAssumed: true,
    headline,
    detail: `This workspace has not stated where it works, so no jurisdiction-specific pack could be matched to it and it is showing the ${binding.templateName} (${binding.jurisdictionLabel}) as an explicitly-labeled interim default. ${consequence}`,
    action: "Set the workspace's home geography so its gates come from its own jurisdiction.",
  };
}

/**
 * The consequence sentence every assumed binding carries.
 *
 * Naming the template's jurisdiction is not enough on its own: a planner reading
 * a gate called "PS&E" or an evidence id that looks like a form number will
 * reasonably assume it is the one their funder expects. The disclosure has to say
 * that it is not, in the same breath.
 */
function interimDefaultConsequence(jurisdictionLabel: string): string {
  return `Its gate names, evidence requirements, and exhibit/form ids are ${jurisdictionLabel}'s — they are not authoritative for this agency and must not be filed or cited as its own requirements.`;
}

/** "US-OH" / "US" — the readable form of what the resolver was told. */
function formatJurisdictionQuery(query: StageGateJurisdictionQuery | null): string | null {
  if (!query) return null;
  return query.subdivision ? `${query.country}-${query.subdivision}` : query.country;
}

function normalizeJurisdictionQuery(
  query: StageGateJurisdictionQuery | null | undefined
): StageGateJurisdictionQuery | null {
  const country = query?.country?.trim().toUpperCase();
  if (!country) return null;
  const subdivision = query?.subdivision?.trim().toUpperCase();
  return { country, subdivision: subdivision || null };
}

function interimDefaultResolution(
  registry: StageGateTemplateRegistry,
  bindingMode: StageGateBindingMode,
  jurisdiction: StageGateJurisdictionQuery | null,
  context: { ambiguous: boolean }
): StageGateTemplateResolution {
  if (!registry.defaultTemplateId) {
    return { kind: "no_default_template", available: registry.list() };
  }

  const fallback = registry.get(registry.defaultTemplateId);
  if (!fallback) {
    return { kind: "no_default_template", available: registry.list() };
  }

  const interimDefaultReason: StageGateInterimDefaultReason = !jurisdiction
    ? "no_workspace_jurisdiction"
    : context.ambiguous
      ? "ambiguous_jurisdiction_templates"
      : "no_template_for_jurisdiction";

  return {
    kind: "resolved",
    binding: toBinding(fallback.descriptor, {
      bindingMode,
      templateSelection: "interim_unconfigured_default",
      interimDefaultReason,
      workspaceJurisdiction: jurisdiction,
    }),
  };
}

function toBinding(
  descriptor: StageGateTemplateDescriptor,
  provenance: {
    bindingMode: StageGateBindingMode;
    templateSelection: StageGateTemplateSelection;
    interimDefaultReason: StageGateInterimDefaultReason | null;
    workspaceJurisdiction: StageGateJurisdictionQuery | null;
  }
): StageGateTemplateBinding {
  return {
    templateId: descriptor.templateId,
    templateName: descriptor.templateName,
    templateVersion: descriptor.templateVersion,
    jurisdiction: descriptor.jurisdictionCode,
    jurisdictionLabel: descriptor.jurisdiction.label,
    templateJurisdiction: { ...descriptor.jurisdiction },
    bindingMode: provenance.bindingMode,
    templateSelection: provenance.templateSelection,
    interimDefaultReason: provenance.interimDefaultReason,
    workspaceJurisdiction: provenance.workspaceJurisdiction,
    lapmFormIdsStatus: descriptor.lapmFormIdsStatus ?? null,
    ...(descriptor.templateDescription
      ? { templateDescription: descriptor.templateDescription }
      : {}),
    ...(descriptor.scopeNotes && descriptor.scopeNotes.length > 0
      ? { scopeNotes: descriptor.scopeNotes }
      : {}),
  };
}
