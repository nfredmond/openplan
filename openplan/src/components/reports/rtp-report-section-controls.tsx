"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createDefaultTargetedReportSections,
  describeRtpPacketPresetStage,
  type RtpPacketPresetStage,
} from "@/lib/reports/catalog";

type EditableSection = {
  id: string;
  sectionKey: string;
  title: string;
  enabled: boolean;
  sortOrder: number;
  configJson?: Record<string, unknown>;
};

function normalizePresetStage(status: string | null | undefined): RtpPacketPresetStage {
  switch (status) {
    case "draft":
    case "public_review":
    case "adopted":
    case "archived":
      return status;
    default:
      return "default";
  }
}

export function RtpReportSectionControls({
  reportId,
  cycleStatus,
  sections,
}: {
  reportId: string;
  cycleStatus: string | null;
  sections: EditableSection[];
}) {
  const router = useRouter();
  const [draftSections, setDraftSections] = useState<EditableSection[]>(sections);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presetStage = normalizePresetStage(cycleStatus);

  const hasChanges = useMemo(() => {
    if (draftSections.length !== sections.length) {
      return true;
    }

    return draftSections.some((section, index) => {
      const original = sections[index];
      return (
        section.sectionKey !== original.sectionKey ||
        section.title !== original.title ||
        section.enabled !== original.enabled ||
        section.sortOrder !== original.sortOrder
      );
    });
  }, [draftSections, sections]);

  function updateSections(next: EditableSection[]) {
    setDraftSections(
      next.map((section, index) => ({
        ...section,
        sortOrder: index,
      }))
    );
  }

  function toggleSection(index: number) {
    updateSections(
      draftSections.map((section, currentIndex) =>
        currentIndex === index ? { ...section, enabled: !section.enabled } : section
      )
    );
  }

  function moveSection(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= draftSections.length) {
      return;
    }

    const next = [...draftSections];
    const [section] = next.splice(index, 1);
    next.splice(targetIndex, 0, section);
    updateSections(next);
  }

  function resetToPreset() {
    const presetSections = createDefaultTargetedReportSections("board_packet", "rtp_cycle", {
      rtpCycleStatus: cycleStatus,
    });
    const bySectionKey = new Map(draftSections.map((section) => [section.sectionKey, section]));

    updateSections(
      presetSections.map((section, index) => {
        const current = bySectionKey.get(section.sectionKey);
        return {
          id: current?.id ?? `preset-${section.sectionKey}`,
          sectionKey: section.sectionKey,
          title: current?.title ?? section.title,
          enabled: section.enabled,
          sortOrder: index,
          configJson: {
            ...(current?.configJson ?? {}),
            ...(section.configJson ?? {}),
          },
        };
      })
    );
  }

  async function handleSave() {
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/reports/${reportId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sections: draftSections.map((section, index) => ({
            sectionKey: section.sectionKey,
            title: section.title,
            enabled: section.enabled,
            sortOrder: index,
            configJson: section.configJson ?? {},
          })),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update packet sections");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update packet sections");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={resetToPreset} disabled={isSaving}>
          <RotateCcw className="h-4 w-4" />
          Reset to preset
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={isSaving || !hasChanges}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save section layout
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {describeRtpPacketPresetStage(presetStage)} is the current default. You can tune the packet here, then reset back to the cycle-stage preset any time.
      </p>

      {error ? <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p> : null}

      <div className="space-y-2">
        {draftSections.map((section, index) => (
          <div key={`${section.id}-${section.sectionKey}`} className="module-row-card gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={section.enabled}
                  onChange={() => toggleSection(index)}
                  disabled={isSaving}
                />
                {section.enabled ? "Enabled" : "Disabled"}
              </label>
              <span className="text-xs text-muted-foreground">Sort {index}</span>
            </div>
            <p className="text-sm font-semibold tracking-tight">{section.title}</p>
            <p className="text-xs text-muted-foreground">{section.sectionKey}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => moveSection(index, -1)}
                disabled={isSaving || index === 0}
              >
                <ArrowUp className="h-3.5 w-3.5" />
                Move up
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => moveSection(index, 1)}
                disabled={isSaving || index === draftSections.length - 1}
              >
                <ArrowDown className="h-3.5 w-3.5" />
                Move down
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
