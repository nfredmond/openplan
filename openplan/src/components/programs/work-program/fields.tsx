"use client";
import type { ReactNode } from "react";
export const fieldClass = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export function Field({ label, value, onChange, multiline = false, type = "text" }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; type?: string }) {
  return <label className="block min-w-0 space-y-1 text-sm font-medium"><span>{label}</span>{multiline ? <textarea className={fieldClass} rows={4} value={value} onChange={(event) => onChange(event.target.value)} /> : <input className={fieldClass} type={type} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}
export function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1 text-sm font-medium"><span>{label}</span><select aria-label={label} className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}
