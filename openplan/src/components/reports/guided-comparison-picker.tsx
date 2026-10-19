"use client";
import { useEffect, useState, type SelectHTMLAttributes } from "react";
import type { GuidedComparisonOption } from "@/lib/reports/guided-comparison";

type GuidedComparisonPickerProps = {
  projectId: string | null; value: string | null; onChange: (snapshotId: string | null) => void;
  disabled?: boolean;
  fieldProps?: Pick<SelectHTMLAttributes<HTMLSelectElement>, "id" | "aria-invalid" | "aria-describedby">;
};

/** A project or enabled-state change starts a fresh discovery lifetime. */
export function GuidedComparisonPicker(props: GuidedComparisonPickerProps) {
  return <ProjectGuidedComparisonPicker key={`${props.projectId ?? ""}:${Boolean(props.disabled)}`} {...props} />;
}

/** Discovery offers identities only. Saving verifies the exact selected evidence. */
function ProjectGuidedComparisonPicker({ projectId, value, onChange, disabled = false, fieldProps }: GuidedComparisonPickerProps) {
  const enabled = Boolean(projectId) && !disabled;
  const [state, setState] = useState<{ options: GuidedComparisonOption[]; error: string | null; loading: boolean }>(
    { options: [], error: null, loading: enabled });
  useEffect(() => {
    if (!projectId || disabled) return;
    const controller = new AbortController();
    void fetch(`/api/reports/guided-comparisons?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { options?: GuidedComparisonOption[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Saved comparisons could not be read.");
        if (!controller.signal.aborted) setState({ options: payload.options ?? [], error: null, loading: false });
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ options: [], error: error instanceof Error ? error.message : "Saved comparisons could not be read.", loading: false });
      });
    return () => controller.abort();
  }, [projectId, disabled]);
  const options = enabled ? state.options.filter((option) => option.projectId === projectId) : [];
  return <div className="space-y-2">
    <label className="block text-sm font-medium">Saved baseline and build comparison
      <select {...fieldProps} disabled={disabled || !projectId} className="mt-2 block w-full rounded border p-2" value={disabled ? "" : value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">No saved comparison selected</option>
        {!disabled && value && !options.some((option) => option.id === value) ? <option value={value}>Saved selection {value} (not in current list)</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label} ({option.id})</option>)}
      </select>
    </label>
    <p className="text-sm text-muted-foreground">Choose an exact saved snapshot. It includes four separate model outputs. Saving checks that its files match the saved comparison. Prototype and inconclusive findings remain limited.</p>
    {disabled || !projectId ? <p className="text-sm text-muted-foreground">Saved comparisons apply to project analysis summaries. Choose a project and that report type to select one.</p> : null}
    {state.loading && !disabled && projectId ? <p role="status">Reading saved comparisons...</p> : null}
    {!disabled && projectId && state.error ? <p role="alert">{state.error}</p> : !disabled && projectId && !state.loading && options.length === 0 ? <p>No ready guided snapshots are available for this project.</p> : null}
  </div>;
}
