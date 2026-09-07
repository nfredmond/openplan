'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
export function EngagementCategoryEditor({ campaignId, category }: { campaignId: string; category: { id: string; label: string; description: string | null; updated_at: string } }) {
  const router = useRouter();
  const [label, setLabel] = useState(category.label), [description, setDescription] = useState(category.description ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <details className="mt-3"><summary className="cursor-pointer">Edit {category.label}</summary><form className="mt-3 space-y-3" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/categories`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ categoryId: category.id, expectedUpdatedAt: category.updated_at, label, description }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Category could not be saved');
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Category could not be saved'); } finally { setBusy(false); }
  }}><label className="block">Category label<input className="block w-full rounded border p-2" required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /></label><label className="block">Category description<textarea className="block w-full rounded border p-2" maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label><p className="text-xs">Earlier contributions retain the definitions used when they were sent.</p>{error ? <p role="alert">{error}</p> : null}<Button disabled={busy}>{busy ? 'Saving…' : 'Save category'}</Button></form></details>;
}
