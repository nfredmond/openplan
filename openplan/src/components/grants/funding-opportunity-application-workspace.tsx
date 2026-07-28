"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CloudOff,
  FileCheck2,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { NarrativeGroundingSummaryLine } from "@/components/grants/narrative-grounding-line";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";
import { stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import {
  parseApplicationAttachmentRow,
  parseApplicationSectionRow,
  type ApplicationAttachmentRow,
  type ApplicationAttachmentStatus,
  type ApplicationSectionRow,
  type ApplicationSectionStatus,
} from "@/lib/grants/application";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";

/**
 * The application workspace for one funding opportunity: initialize from a
 * catalog template (explicit key only) or as a custom scaffold, walk each
 * section from not-started to final with grounded AI drafting support, and
 * work the attachment checklist against workspace evidence.
 *
 * Everything here talks to the application routes; nothing is decided
 * client-side. The two rules the surface must keep visible:
 *  - a section pinned never-AI (budgets, fees, certifications) offers no
 *    drafting affordance and says why;
 *  - an UNEDITED AI draft can only be finalized when the server's grounding
 *    gate passes — a refusal surfaces the flagged sentences for review
 *    instead of hiding them.
 */

export type ApplicationSectionDraftView = {
  id: string;
  section_id: string;
  draft_markdown: string;
  model: string | null;
  grounding_json?: unknown;
  grounded_sentence_count?: number | null;
  total_sentence_count?: number | null;
  created_at: string;
};

export type KnowledgeBaseAttachOption = { id: string; title: string };

export type ReportArtifactAttachOption = {
  id: string;
  reportTitle: string;
  artifactKind: string | null;
  generatedAt: string | null;
};

type FlaggedSentencePayload = {
  text: string;
  reason: string;
  unknown_fact_ids?: string[];
  unfaithful_claims?: string[];
};

const SECTION_STATUS_LABELS: Record<ApplicationSectionStatus, string> = {
  not_started: "Not started",
  drafting: "Drafting",
  operator_review: "Operator review",
  final: "Final",
};

const SECTION_STATUS_TONES: Record<
  ApplicationSectionStatus,
  "neutral" | "info" | "warning" | "success"
> = {
  not_started: "neutral",
  drafting: "info",
  operator_review: "warning",
  final: "success",
};

const ATTACHMENT_STATUS_LABELS: Record<ApplicationAttachmentStatus, string> = {
  missing: "Missing",
  in_progress: "In progress",
  attached: "Attached",
  not_applicable: "Not applicable",
};

const ATTACHMENT_STATUS_TONES: Record<
  ApplicationAttachmentStatus,
  "neutral" | "info" | "warning" | "success"
> = {
  missing: "warning",
  in_progress: "info",
  attached: "success",
  not_applicable: "neutral",
};

const NEVER_AI_NOTE =
  "Drafted by you, never by AI — budget figures, cost estimates, fee schedules, and certifications come from your own estimates, records, and signatories.";

function parseSectionRows(rows: unknown): ApplicationSectionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(parseApplicationSectionRow)
    .filter((row): row is ApplicationSectionRow => row !== null)
    .sort((left, right) => left.sort_order - right.sort_order);
}

function parseAttachmentRows(rows: unknown): ApplicationAttachmentRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(parseApplicationAttachmentRow)
    .filter((row): row is ApplicationAttachmentRow => row !== null)
    .sort((left, right) => left.sort_order - right.sort_order);
}

function parseDraftView(value: unknown): ApplicationSectionDraftView | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.section_id !== "string" ||
    typeof record.draft_markdown !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    section_id: record.section_id,
    draft_markdown: record.draft_markdown,
    model: typeof record.model === "string" ? record.model : null,
    grounding_json: record.grounding_json,
    grounded_sentence_count:
      typeof record.grounded_sentence_count === "number" ? record.grounded_sentence_count : null,
    total_sentence_count:
      typeof record.total_sentence_count === "number" ? record.total_sentence_count : null,
    created_at: typeof record.created_at === "string" ? record.created_at : "",
  };
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function FundingOpportunityApplicationWorkspace({ opportunityId }: { opportunityId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schemaPendingMessage, setSchemaPendingMessage] = useState<string | null>(null);

  const [sections, setSections] = useState<ApplicationSectionRow[]>([]);
  const [attachments, setAttachments] = useState<ApplicationAttachmentRow[]>([]);
  const [latestDrafts, setLatestDrafts] = useState<Record<string, ApplicationSectionDraftView>>({});
  const [latestDraftsUnavailable, setLatestDraftsUnavailable] = useState(false);
  const [kbOptions, setKbOptions] = useState<KnowledgeBaseAttachOption[]>([]);
  const [artifactOptions, setArtifactOptions] = useState<ReportArtifactAttachOption[]>([]);
  const [attachSourcesDegraded, setAttachSourcesDegraded] = useState(false);

  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [initCatalogKey, setInitCatalogKey] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);

  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionGuidance, setNewSectionGuidance] = useState("");
  const [newSectionAiDrafting, setNewSectionAiDrafting] = useState(true);
  const [isAddingSection, setIsAddingSection] = useState(false);

  const [newAttachmentTitle, setNewAttachmentTitle] = useState("");
  const [newAttachmentRequired, setNewAttachmentRequired] = useState(false);
  const [isAddingAttachment, setIsAddingAttachment] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportOffenders, setExportOffenders] = useState<
    Array<{ title: string; flaggedSentences: FlaggedSentencePayload[] }>
  >([]);
  const [exportResult, setExportResult] = useState<{
    exportId: string;
    engineDisclosure: string | null;
    isDraftStamped: boolean;
    outstandingRequiredCount: number;
  } | null>(null);

  const catalogTemplateOptions = useMemo(
    () =>
      GRANT_PROGRAM_CATALOG.filter((entry) => (entry.applicationSections?.length ?? 0) > 0).map(
        (entry) => ({ key: entry.key, name: entry.name })
      ),
    []
  );

  const applyApplicationPayload = useCallback((payload: Record<string, unknown>) => {
    setSections(parseSectionRows(payload.sections));
    setAttachments(parseAttachmentRows(payload.attachments));
    const draftMap: Record<string, ApplicationSectionDraftView> = {};
    if (payload.latestDraftsBySectionId && typeof payload.latestDraftsBySectionId === "object") {
      for (const [sectionId, raw] of Object.entries(
        payload.latestDraftsBySectionId as Record<string, unknown>
      )) {
        const parsed = parseDraftView(raw);
        if (parsed) draftMap[sectionId] = parsed;
      }
    }
    setLatestDrafts(draftMap);
    setLatestDraftsUnavailable(payload.latestDraftsUnavailable === true);
    if (Array.isArray(payload.kbDocumentOptions)) {
      setKbOptions(
        (payload.kbDocumentOptions as Array<{ id?: unknown; title?: unknown }>).filter(
          (option): option is KnowledgeBaseAttachOption =>
            typeof option.id === "string" && typeof option.title === "string"
        )
      );
    }
    if (Array.isArray(payload.reportArtifactOptions)) {
      setArtifactOptions(
        (payload.reportArtifactOptions as Array<Record<string, unknown>>).flatMap((option) =>
          typeof option.id === "string" && typeof option.reportTitle === "string"
            ? [
                {
                  id: option.id,
                  reportTitle: option.reportTitle,
                  artifactKind: typeof option.artifactKind === "string" ? option.artifactKind : null,
                  generatedAt: typeof option.generatedAt === "string" ? option.generatedAt : null,
                },
              ]
            : []
        )
      );
    }
    setAttachSourcesDegraded(payload.attachSourcesDegraded === true);
  }, []);

  const loadApplication = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setSchemaPendingMessage(null);
    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/application`);
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to load the application"
        );
      }
      if (payload.schemaPending === true) {
        setSchemaPendingMessage(
          typeof payload.error === "string"
            ? payload.error
            : "This deployment's database predates the grant application tables."
        );
        setSections([]);
        setAttachments([]);
      } else {
        applyApplicationPayload(payload);
      }
      setHasLoaded(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load the application");
    } finally {
      setIsLoading(false);
    }
  }, [opportunityId, applyApplicationPayload]);

  function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && !hasLoaded && !isLoading) {
      void loadApplication();
    }
  }

  async function handleInitialize() {
    setIsInitializing(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/application`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(initCatalogKey ? { catalogKey: initCatalogKey } : {}),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (response.status === 409) {
        // Someone else already initialized it — show what exists.
        await loadApplication();
        return;
      }
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to initialize the application"
        );
      }
      setSections(parseSectionRows(payload.sections));
      setAttachments(parseAttachmentRows(payload.attachments));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to initialize the application");
    } finally {
      setIsInitializing(false);
    }
  }

  function replaceSection(updated: ApplicationSectionRow) {
    setSections((current) =>
      current.map((section) => (section.id === updated.id ? updated : section))
    );
  }

  async function patchSection(
    sectionId: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
    const response = await fetch(
      `/api/funding-opportunities/${opportunityId}/sections/${sectionId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const payload = (await response.json()) as Record<string, unknown>;
    if (response.ok) {
      const parsed = parseApplicationSectionRow(payload.section);
      if (parsed) replaceSection(parsed);
    }
    return { ok: response.ok, status: response.status, payload };
  }

  async function handleMoveSection(sectionId: string, direction: -1 | 1) {
    setActionError(null);
    const index = sections.findIndex((section) => section.id === sectionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const order = sections.map((section) => section.id);
    [order[index], order[target]] = [order[target], order[index]];
    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/application`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionOrder: order }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to reorder sections"
        );
      }
      setSections(parseSectionRows(payload.sections));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to reorder sections");
    }
  }

  async function handleAddSection() {
    if (!newSectionTitle.trim()) return;
    setIsAddingSection(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/sections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: newSectionTitle.trim(),
          guidance: newSectionGuidance.trim() || null,
          aiDraftingEnabled: newSectionAiDrafting,
        }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Failed to add section");
      }
      const parsed = parseApplicationSectionRow(payload.section);
      if (parsed) setSections((current) => [...current, parsed]);
      setNewSectionTitle("");
      setNewSectionGuidance("");
      setNewSectionAiDrafting(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to add section");
    } finally {
      setIsAddingSection(false);
    }
  }

  async function handleDeleteSection(sectionId: string) {
    setActionError(null);
    try {
      const response = await fetch(
        `/api/funding-opportunities/${opportunityId}/sections/${sectionId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const payload = (await response.json()) as Record<string, unknown>;
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to remove section"
        );
      }
      setSections((current) => current.filter((section) => section.id !== sectionId));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove section");
    }
  }

  async function handleAddAttachment() {
    if (!newAttachmentTitle.trim()) return;
    setIsAddingAttachment(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: newAttachmentTitle.trim(), required: newAttachmentRequired }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to add checklist item"
        );
      }
      const parsed = parseApplicationAttachmentRow(payload.attachment);
      if (parsed) setAttachments((current) => [...current, parsed]);
      setNewAttachmentTitle("");
      setNewAttachmentRequired(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to add checklist item");
    } finally {
      setIsAddingAttachment(false);
    }
  }

  async function patchAttachment(attachmentId: string, body: Record<string, unknown>) {
    setActionError(null);
    try {
      const response = await fetch(
        `/api/funding-opportunities/${opportunityId}/attachments/${attachmentId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to update checklist item"
        );
      }
      const parsed = parseApplicationAttachmentRow(payload.attachment);
      if (parsed) {
        setAttachments((current) =>
          current.map((attachment) => (attachment.id === parsed.id ? parsed : attachment))
        );
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to update checklist item");
    }
  }

  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    setExportOffenders([]);
    setExportResult(null);
    try {
      const response = await fetch(
        `/api/funding-opportunities/${opportunityId}/application/export`,
        { method: "POST" }
      );
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        if (Array.isArray(payload.offendingSections)) {
          setExportOffenders(
            (payload.offendingSections as Array<Record<string, unknown>>).map((section) => ({
              title: typeof section.title === "string" ? section.title : "Untitled section",
              flaggedSentences: Array.isArray(section.flaggedSentences)
                ? (section.flaggedSentences as FlaggedSentencePayload[])
                : [],
            }))
          );
        }
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to export the application"
        );
      }
      const exportRow = payload.export as { id?: unknown } | undefined;
      setExportResult({
        exportId: typeof exportRow?.id === "string" ? exportRow.id : "",
        engineDisclosure:
          typeof payload.engineDisclosure === "string" ? payload.engineDisclosure : null,
        isDraftStamped: payload.isDraftStamped === true,
        outstandingRequiredCount:
          typeof payload.outstandingRequiredCount === "number" ? payload.outstandingRequiredCount : 0,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to export the application");
    } finally {
      setIsExporting(false);
    }
  }

  const isEmptyApplication = hasLoaded && sections.length === 0 && attachments.length === 0;

  return (
    <div className="module-note mt-4 text-sm" data-testid="application-workspace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">Application workspace</p>
          <p className="mt-1 text-muted-foreground">
            Assemble this opportunity&apos;s application section by section: seed the structure from a
            catalog template or build it custom, draft narrative sections against workspace evidence,
            and track the attachment checklist. Every section is operator-reviewed before it is final.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleToggle}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {isOpen ? "Close application workspace" : "Open application workspace"}
        </Button>
      </div>

      {isOpen ? (
        <div className="mt-4 space-y-4">
          {isLoading ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading application…
            </p>
          ) : null}

          {loadError ? (
            <div className="text-destructive">
              <p>{loadError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void loadApplication()}>
                Retry
              </Button>
            </div>
          ) : null}

          {schemaPendingMessage ? (
            <div className="flex items-start gap-2 rounded-xl border border-[color:var(--copper)]/40 bg-[color:var(--copper)]/10 px-3 py-2.5 text-[color:var(--copper)]">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{schemaPendingMessage}</p>
            </div>
          ) : null}

          {actionError ? <p className="text-destructive">{actionError}</p> : null}

          {isEmptyApplication && !schemaPendingMessage ? (
            <div className="space-y-3" data-testid="application-init">
              <p className="text-muted-foreground">
                No application is set up for this opportunity yet. Seed it from a catalog program
                template (matched by explicit key only, and always verify against the current
                NOFO/guidelines) or start a custom scaffold — any funder anywhere works without a
                template.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Application template"
                  className="flex h-9 rounded-xl border border-input bg-background px-3 text-sm"
                  value={initCatalogKey}
                  onChange={(event) => setInitCatalogKey(event.target.value)}
                >
                  <option value="">Custom scaffold (no template)</option>
                  {catalogTemplateOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <Button type="button" size="sm" disabled={isInitializing} onClick={() => void handleInitialize()}>
                  {isInitializing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                  Initialize application
                </Button>
              </div>
            </div>
          ) : null}

          {hasLoaded && !isEmptyApplication && !schemaPendingMessage ? (
            <>
              {latestDraftsUnavailable ? (
                <p className="text-muted-foreground">
                  Stored draft history could not be loaded right now — sections may show no working
                  draft even though one exists.
                </p>
              ) : null}

              <div className="space-y-2" data-testid="application-sections">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
                  Sections
                </p>
                {sections.length === 0 ? (
                  <p className="text-muted-foreground">
                    No sections yet — add the first one below.
                  </p>
                ) : null}
                {sections.map((section, index) => (
                  <SectionRowView
                    key={section.id}
                    section={section}
                    index={index}
                    sectionCount={sections.length}
                    isExpanded={expandedSectionId === section.id}
                    latestDraft={latestDrafts[section.id] ?? null}
                    onToggle={() =>
                      setExpandedSectionId((current) => (current === section.id ? null : section.id))
                    }
                    onMove={(direction) => void handleMoveSection(section.id, direction)}
                    onPatch={(body) => patchSection(section.id, body)}
                    onDelete={() => void handleDeleteSection(section.id)}
                    onDraftStored={(draft) =>
                      setLatestDrafts((current) => ({ ...current, [section.id]: draft }))
                    }
                    opportunityId={opportunityId}
                  />
                ))}

                <div className="rounded-xl border border-dashed border-border/70 px-3 py-3">
                  <p className="font-semibold text-foreground">Add a custom section</p>
                  <div className="mt-2 space-y-2">
                    <Input
                      aria-label="New section title"
                      placeholder="Section title (as the funder names it)"
                      value={newSectionTitle}
                      onChange={(event) => setNewSectionTitle(event.target.value)}
                    />
                    <Textarea
                      aria-label="New section guidance"
                      rows={2}
                      placeholder="Optional guidance — what the current call asks this section to contain."
                      value={newSectionGuidance}
                      onChange={(event) => setNewSectionGuidance(event.target.value)}
                    />
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={newSectionAiDrafting}
                        onChange={(event) => setNewSectionAiDrafting(event.target.checked)}
                      />
                      Allow AI drafting support (uncheck for budget, fee, or certification content —
                      those are always drafted by you)
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isAddingSection || !newSectionTitle.trim()}
                      onClick={() => void handleAddSection()}
                    >
                      {isAddingSection ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Add section
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2" data-testid="application-attachments">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
                  Attachment checklist
                </p>
                {attachSourcesDegraded ? (
                  <p className="text-muted-foreground">
                    Some attachment sources could not be loaded — the pickers below may be missing
                    documents or report artifacts that do exist.
                  </p>
                ) : null}
                {attachments.length === 0 ? (
                  <p className="text-muted-foreground">
                    No checklist items yet — add what the current call requires.
                  </p>
                ) : null}
                {attachments.map((attachment) => (
                  <AttachmentRowView
                    key={attachment.id}
                    attachment={attachment}
                    kbOptions={kbOptions}
                    artifactOptions={artifactOptions}
                    onPatch={(body) => void patchAttachment(attachment.id, body)}
                  />
                ))}

                <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3" data-testid="application-export">
                  <p className="font-semibold text-foreground">Export application packet</p>
                  <p className="mt-1 text-muted-foreground">
                    Assembles the cover, every section (final text, or a disclosed outstanding
                    item), the attachment checklist, and a provenance appendix into one PDF.
                    Missing required attachments stamp the document DRAFT; they never disappear.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={isExporting}
                    onClick={() => void handleExport()}
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                    Export application packet (PDF)
                  </Button>
                  {exportError ? (
                    <div className="mt-2" data-testid="export-refusal">
                      <p className="text-destructive">{exportError}</p>
                      {exportOffenders.map((offender, index) => (
                        <div key={index} className="mt-1.5 text-xs text-muted-foreground">
                          <p className="font-semibold text-foreground/80">{offender.title}</p>
                          <ul className="mt-1 space-y-1 border-l-2 border-[color:var(--copper)]/40 pl-3">
                            {offender.flaggedSentences.map((sentence, sentenceIndex) => (
                              <li key={sentenceIndex}>
                                {stripFactCitationTokens(sentence.text)}{" "}
                                <span className="uppercase tracking-wide">
                                  — {sentence.reason.replace(/_/g, " ")}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {exportResult ? (
                    <div className="mt-2 space-y-1" data-testid="export-result">
                      {exportResult.isDraftStamped ? (
                        <p className="font-semibold text-[color:var(--copper)]">
                          Stamped DRAFT — {exportResult.outstandingRequiredCount} required
                          attachment(s) outstanding.
                        </p>
                      ) : null}
                      {exportResult.engineDisclosure ? (
                        <p className="text-muted-foreground">{exportResult.engineDisclosure}</p>
                      ) : null}
                      {exportResult.exportId ? (
                        <a
                          className="font-semibold text-[color:var(--pine)] underline-offset-2 hover:underline"
                          href={`/api/funding-opportunities/${opportunityId}/application/export/${exportResult.exportId}/download`}
                        >
                          Download PDF
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-dashed border-border/70 px-3 py-3">
                  <p className="font-semibold text-foreground">Add a checklist item</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="New attachment title"
                      className="max-w-xs"
                      placeholder="Attachment title"
                      value={newAttachmentTitle}
                      onChange={(event) => setNewAttachmentTitle(event.target.value)}
                    />
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={newAttachmentRequired}
                        onChange={(event) => setNewAttachmentRequired(event.target.checked)}
                      />
                      Required
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isAddingAttachment || !newAttachmentTitle.trim()}
                      onClick={() => void handleAddAttachment()}
                    >
                      {isAddingAttachment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Add item
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionRowView({
  section,
  index,
  sectionCount,
  isExpanded,
  latestDraft,
  onToggle,
  onMove,
  onPatch,
  onDelete,
  onDraftStored,
  opportunityId,
}: {
  section: ApplicationSectionRow;
  index: number;
  sectionCount: number;
  isExpanded: boolean;
  latestDraft: ApplicationSectionDraftView | null;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
  onPatch: (
    body: Record<string, unknown>
  ) => Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }>;
  onDelete: () => void;
  onDraftStored: (draft: ApplicationSectionDraftView) => void;
  opportunityId: string;
}) {
  return (
    <div
      className="rounded-xl border border-border/70 bg-background/70 px-3 py-2.5"
      data-testid={`application-section-${section.section_key}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-left font-semibold text-foreground"
          onClick={onToggle}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {section.title}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={SECTION_STATUS_TONES[section.status]}>
            {SECTION_STATUS_LABELS[section.status]}
          </StatusBadge>
          {section.source === "custom" ? <StatusBadge tone="neutral">Custom</StatusBadge> : null}
          {!section.ai_drafting_enabled ? (
            <StatusBadge tone="warning">Never AI-drafted</StatusBadge>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Move ${section.title} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Move ${section.title} down`}
            disabled={index === sectionCount - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {isExpanded ? (
        <SectionDetailView
          section={section}
          latestDraft={latestDraft}
          onPatch={onPatch}
          onDelete={onDelete}
          onDraftStored={onDraftStored}
          opportunityId={opportunityId}
        />
      ) : null}
    </div>
  );
}

function SectionDetailView({
  section,
  latestDraft,
  onPatch,
  onDelete,
  onDraftStored,
  opportunityId,
}: {
  section: ApplicationSectionRow;
  latestDraft: ApplicationSectionDraftView | null;
  onPatch: (
    body: Record<string, unknown>
  ) => Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }>;
  onDelete: () => void;
  onDraftStored: (draft: ApplicationSectionDraftView) => void;
  opportunityId: string;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAiOffline, setIsAiOffline] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizeFlagged, setFinalizeFlagged] = useState<FlaggedSentencePayload[]>([]);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const [showEditedFinal, setShowEditedFinal] = useState(false);
  const [editedFinalText, setEditedFinalText] = useState("");

  const [isEditingSection, setIsEditingSection] = useState(false);
  const [editTitle, setEditTitle] = useState(section.title);
  const [editGuidance, setEditGuidance] = useState(section.guidance ?? "");

  const displayDraftHtml = useMemo(
    () =>
      latestDraft
        ? renderChapterMarkdownToHtml(stripFactCitationTokens(latestDraft.draft_markdown))
        : null,
    [latestDraft]
  );

  const displayFinalHtml = useMemo(
    () =>
      section.final_markdown
        ? renderChapterMarkdownToHtml(stripFactCitationTokens(section.final_markdown))
        : null,
    [section.final_markdown]
  );

  async function handleGenerateDraft() {
    setIsGenerating(true);
    setIsAiOffline(false);
    setDraftError(null);
    try {
      const response = await fetch(
        `/api/funding-opportunities/${opportunityId}/sections/${section.id}/draft`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(latestDraft ? { revisionOfDraftId: latestDraft.id } : {}),
            ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          }),
        }
      );
      if (response.status === 503) {
        const payload = (await response.json()) as { error?: string };
        if (payload.error === "ai_offline") {
          setIsAiOffline(true);
          return;
        }
        throw new Error(payload.error || "Drafting is unavailable right now");
      }
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        draft?: unknown;
      };
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Failed to draft this section");
      }
      const parsed = parseDraftView(payload.draft);
      if (!parsed) throw new Error("The stored draft came back malformed");
      onDraftStored(parsed);
      setInstructions("");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Failed to draft this section");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleStatusMove(status: ApplicationSectionStatus) {
    setFinalizeError(null);
    setFinalizeFlagged([]);
    const result = await onPatch({ status });
    if (!result.ok) {
      setFinalizeError(
        typeof result.payload.error === "string" ? result.payload.error : "Failed to update status"
      );
    }
  }

  async function handleFinalizeUnedited() {
    if (!latestDraft) return;
    setIsFinalizing(true);
    setFinalizeError(null);
    setFinalizeFlagged([]);
    const result = await onPatch({ status: "final", finalizedFromDraftId: latestDraft.id });
    if (!result.ok) {
      setFinalizeError(
        typeof result.payload.error === "string"
          ? result.payload.error
          : "This draft cannot be finalized unedited"
      );
      if (Array.isArray(result.payload.flaggedSentences)) {
        setFinalizeFlagged(result.payload.flaggedSentences as FlaggedSentencePayload[]);
      }
    }
    setIsFinalizing(false);
  }

  async function handleFinalizeEdited() {
    if (!editedFinalText.trim()) return;
    setIsFinalizing(true);
    setFinalizeError(null);
    setFinalizeFlagged([]);
    const result = await onPatch({
      status: "final",
      finalMarkdown: editedFinalText,
      ...(latestDraft ? { finalizedFromDraftId: latestDraft.id } : {}),
    });
    if (!result.ok) {
      setFinalizeError(
        typeof result.payload.error === "string" ? result.payload.error : "Failed to finalize"
      );
    } else {
      setShowEditedFinal(false);
    }
    setIsFinalizing(false);
  }

  async function handleSaveSectionEdit() {
    if (!editTitle.trim()) return;
    const result = await onPatch({
      title: editTitle.trim(),
      guidance: editGuidance.trim() || null,
    });
    if (result.ok) setIsEditingSection(false);
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      {section.guidance ? (
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground/80">Guidance:</span> {section.guidance}
        </p>
      ) : null}

      {section.final_markdown ? (
        <div className="space-y-1.5">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
            {section.status === "final" ? "Final text" : "Previously approved text"}
          </p>
          <div
            className="chapter-markdown rounded-xl border border-border/70 bg-background px-4 py-3 leading-7 text-foreground/90"
            dangerouslySetInnerHTML={{ __html: displayFinalHtml ?? "" }}
          />
        </div>
      ) : null}

      {!section.ai_drafting_enabled ? (
        <p className="text-muted-foreground" data-testid="never-ai-note">
          {NEVER_AI_NOTE}
        </p>
      ) : (
        <div className="space-y-2" data-testid="section-draft-panel">
          {latestDraft ? (
            <div className="space-y-2">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
                AI draft{latestDraft.model ? ` · ${latestDraft.model}` : ""} ·{" "}
                {formatDate(latestDraft.created_at)} — review before use
              </p>
              <NarrativeGroundingSummaryLine
                groundingJson={latestDraft.grounding_json}
                groundedCount={latestDraft.grounded_sentence_count ?? null}
                totalCount={latestDraft.total_sentence_count ?? null}
              />
              <div
                className="chapter-markdown rounded-xl border border-border/70 bg-background px-4 py-3 leading-7 text-foreground/90"
                dangerouslySetInnerHTML={{ __html: displayDraftHtml ?? "" }}
              />
            </div>
          ) : (
            <p className="text-muted-foreground">
              No working draft yet. Facts are rebuilt fresh from workspace evidence on every
              generation, and every draft is validated sentence by sentence.
            </p>
          )}

          <Textarea
            aria-label={`Revision instructions for ${section.title}`}
            rows={2}
            placeholder={
              latestDraft
                ? "Revision instructions — tone or emphasis only; revisions can restyle prose but can never add unverified claims."
                : "Optional drafting instructions — tone or emphasis only."
            }
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isGenerating}
              onClick={() => void handleGenerateDraft()}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : latestDraft ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <PenLine className="h-4 w-4" />
              )}
              {latestDraft ? "Revise draft" : "Draft with AI"}
            </Button>
          </div>

          {isAiOffline ? (
            <div className="flex items-start gap-2 rounded-xl border border-[color:var(--copper)]/40 bg-[color:var(--copper)]/10 px-3 py-2.5 text-[color:var(--copper)]">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                AI drafting is offline — no Anthropic API key is configured for this deployment.
                Stored drafts remain available; write and finalize your own text below.
              </p>
            </div>
          ) : null}
          {draftError ? <p className="text-destructive">{draftError}</p> : null}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {section.status !== "final" && section.status !== "operator_review" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleStatusMove("operator_review")}
            >
              Send to operator review
            </Button>
          ) : null}
          {section.status === "operator_review" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleStatusMove("drafting")}
            >
              Back to drafting
            </Button>
          ) : null}
          {section.status === "final" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleStatusMove("operator_review")}
            >
              Reopen for review
            </Button>
          ) : null}
          {section.status !== "final" && latestDraft && section.ai_drafting_enabled ? (
            <Button
              type="button"
              size="sm"
              disabled={isFinalizing}
              onClick={() => void handleFinalizeUnedited()}
            >
              {isFinalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
              Finalize AI draft unedited
            </Button>
          ) : null}
          {section.status !== "final" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowEditedFinal((current) => !current);
                setEditedFinalText(latestDraft?.draft_markdown ?? section.final_markdown ?? "");
              }}
            >
              Finalize edited text
            </Button>
          ) : null}
        </div>

        {section.status !== "final" && latestDraft && section.ai_drafting_enabled ? (
          <p className="text-xs text-muted-foreground">
            An unedited AI draft can only be finalized when every sentence is grounded in workspace
            facts and passed the numeric-faithfulness check; otherwise the flagged sentences come
            back here for your review.
          </p>
        ) : null}

        {finalizeError ? (
          <div data-testid="finalize-refusal">
            <p className="text-destructive">{finalizeError}</p>
            {finalizeFlagged.length > 0 ? (
              <ul className="mt-2 space-y-1.5 border-l-2 border-[color:var(--copper)]/40 pl-3 text-xs text-muted-foreground">
                {finalizeFlagged.map((sentence, index) => (
                  <li key={index}>
                    <span className="text-foreground/80">
                      {stripFactCitationTokens(sentence.text)}
                    </span>{" "}
                    <span className="uppercase tracking-wide">— {sentence.reason.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {showEditedFinal ? (
          <div className="space-y-2">
            <Textarea
              aria-label={`Final text for ${section.title}`}
              rows={6}
              value={editedFinalText}
              onChange={(event) => setEditedFinalText(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={isFinalizing || !editedFinalText.trim()}
              onClick={() => void handleFinalizeEdited()}
            >
              Save as final
            </Button>
            <p className="text-xs text-muted-foreground">
              Edited text is your reviewed work product — you, not a stored validation verdict, are
              the authority for it.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditingSection((current) => !current)}>
          Edit section
        </Button>
        {section.source === "custom" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${section.title}`}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
            Remove section
          </Button>
        ) : null}
      </div>

      {isEditingSection ? (
        <div className="space-y-2">
          <Input
            aria-label={`Title for ${section.title}`}
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
          />
          <Textarea
            aria-label={`Guidance for ${section.title}`}
            rows={2}
            value={editGuidance}
            onChange={(event) => setEditGuidance(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!editTitle.trim()}
            onClick={() => void handleSaveSectionEdit()}
          >
            Save section
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentRowView({
  attachment,
  kbOptions,
  artifactOptions,
  onPatch,
}: {
  attachment: ApplicationAttachmentRow;
  kbOptions: KnowledgeBaseAttachOption[];
  artifactOptions: ReportArtifactAttachOption[];
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [selectedKbId, setSelectedKbId] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [noteText, setNoteText] = useState(attachment.note ?? "");

  return (
    <div
      className="rounded-xl border border-border/70 bg-background/70 px-3 py-2.5"
      data-testid={`application-attachment-${attachment.attachment_key}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-foreground">{attachment.title}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={attachment.required ? "warning" : "neutral"}>
            {attachment.required ? "Required" : "Optional"}
          </StatusBadge>
          <StatusBadge tone={ATTACHMENT_STATUS_TONES[attachment.status]}>
            {ATTACHMENT_STATUS_LABELS[attachment.status]}
          </StatusBadge>
        </div>
      </div>

      {attachment.guidance ? <p className="mt-1 text-muted-foreground">{attachment.guidance}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label={`Status for ${attachment.title}`}
          className="flex h-9 rounded-xl border border-input bg-background px-3 text-sm"
          value={attachment.status}
          onChange={(event) => onPatch({ status: event.target.value })}
        >
          {(Object.keys(ATTACHMENT_STATUS_LABELS) as ApplicationAttachmentStatus[]).map((status) => (
            <option key={status} value={status}>
              {ATTACHMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <Input
          aria-label={`Note for ${attachment.title}`}
          className="max-w-xs"
          placeholder="Note"
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onPatch({ note: noteText.trim() || null })}
        >
          Save note
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label={`Attach Knowledge Base document to ${attachment.title}`}
          className="flex h-9 max-w-56 rounded-xl border border-input bg-background px-3 text-sm"
          value={selectedKbId}
          onChange={(event) => setSelectedKbId(event.target.value)}
        >
          <option value="">
            {kbOptions.length === 0 ? "No Knowledge Base documents" : "Knowledge Base document…"}
          </option>
          {kbOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selectedKbId}
          onClick={() => {
            onPatch({ kbDocumentId: selectedKbId });
            setSelectedKbId("");
          }}
        >
          Attach document
        </Button>

        <select
          aria-label={`Attach report artifact to ${attachment.title}`}
          className="flex h-9 max-w-56 rounded-xl border border-input bg-background px-3 text-sm"
          value={selectedArtifactId}
          onChange={(event) => setSelectedArtifactId(event.target.value)}
        >
          <option value="">
            {artifactOptions.length === 0 ? "No report artifacts" : "Report artifact…"}
          </option>
          {artifactOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.reportTitle}
              {option.artifactKind ? ` — ${option.artifactKind.toUpperCase()}` : ""}
              {option.generatedAt ? ` (${formatDate(option.generatedAt)})` : ""}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selectedArtifactId}
          onClick={() => {
            onPatch({ reportArtifactId: selectedArtifactId });
            setSelectedArtifactId("");
          }}
        >
          Attach report artifact
        </Button>
      </div>

      {attachment.kb_document_id || attachment.report_artifact_id ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {attachment.kb_document_id ? (
            <>
              <span>
                Fulfilled by Knowledge Base document{" "}
                {kbOptions.find((option) => option.id === attachment.kb_document_id)?.title ??
                  attachment.kb_document_id}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onPatch({ kbDocumentId: null })}
              >
                Detach document
              </Button>
            </>
          ) : null}
          {attachment.report_artifact_id ? (
            <>
              <span>
                Fulfilled by report artifact{" "}
                {artifactOptions.find((option) => option.id === attachment.report_artifact_id)
                  ?.reportTitle ?? attachment.report_artifact_id}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onPatch({ reportArtifactId: null })}
              >
                Detach artifact
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
