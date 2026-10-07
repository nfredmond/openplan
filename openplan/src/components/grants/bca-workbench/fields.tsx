import type { ReactNode } from "react";
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  children,
}: {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  multiline?: boolean;
  children?: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      {children ??
        (multiline ? (
          <textarea
            className="min-h-24 w-full rounded-md border border-input bg-background p-2.5 font-normal"
            value={value ?? ""}
            onChange={(e) => onChange?.(e.target.value)}
          />
        ) : (
          <input
            className="w-full rounded-md border border-input bg-background p-2.5 font-normal"
            value={value ?? ""}
            onChange={(e) => onChange?.(e.target.value)}
          />
        ))}
    </label>
  );
}
export function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        step="any"
        className="w-full rounded-md border border-input bg-background p-2.5 font-normal tabular-nums"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    </Field>
  );
}
export const selectClass =
  "w-full rounded-md border border-input bg-background p-2.5 font-normal";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
