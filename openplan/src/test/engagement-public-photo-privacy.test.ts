import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ hiddenItem: false, hiddenParent: false, reply: false, reads: [] as Array<{ table: string; columns: string; filters: Record<string, unknown> }> }));
const download = vi.hoisted(() => vi.fn());
const campaignId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const parentId = '33333333-3333-4333-8333-333333333333';
const photoPath = `${campaignId}/44444444-4444-4444-8444-444444444444.jpg`;

vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => ({
  from(table: string) {
    let columns = ''; const filters: Record<string, unknown> = {};
    const query = {
      select(value: string) { columns = value; return query; },
      eq(key: string, value: unknown) { filters[key] = value; return query; },
      is(key: string, value: unknown) { filters[key] = value; return query; },
      async maybeSingle() {
        state.reads.push({ table, columns, filters });
        if (table === 'engagement_campaigns') {
          expect(columns).toBe('id');
          expect(filters).toEqual({ share_token: 'synthetic-photo-share', status: 'active' });
          return { data: { id: campaignId }, error: null };
        }
        expect(['engagement_public_items', 'engagement_items']).toContain(table);
        expect(filters.campaign_id).toBe(campaignId);
        expect(filters.status).toBe('approved');
        const parent = filters.id === parentId;
        expect(columns).toBe(parent ? 'id' : 'photo_path, parent_item_id');
        if (parent) expect(filters.parent_item_id).toBeNull();
        const hidden = parent ? state.hiddenParent : state.hiddenItem;
        // The raw table still retains private records. Only the restricted view excludes them.
        return { data: table === 'engagement_public_items' && hidden ? null : parent ? { id: parentId } : { photo_path: photoPath, parent_item_id: state.reply ? parentId : null }, error: null };
      },
    };
    return query;
  },
  storage: { from(bucket: string) { expect(bucket).toBe('engagement-photos'); return { download }; } },
}) }));

import { GET } from '@/app/api/engage/[shareToken]/items/[itemId]/photo/route';
const call = () => GET(new NextRequest(`http://localhost/api/engage/synthetic-photo-share/items/${itemId}/photo`), { params: Promise.resolve({ shareToken: 'synthetic-photo-share', itemId }) });

describe('public photo privacy', () => {
  beforeEach(() => {
    state.hiddenItem = false; state.hiddenParent = false; state.reply = false; state.reads.length = 0;
    download.mockReset().mockResolvedValue({ data: new Blob(['synthetic image bytes'], { type: 'image/jpeg' }), error: null });
  });
  it('streams an eligible photo without a bearer redirect', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('synthetic image bytes');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('location')).toBeNull();
    expect(download).toHaveBeenCalledWith(photoPath);
  });
  it('does not fetch bytes for an approved item excluded by privacy flags', async () => {
    state.hiddenItem = true;
    const response = await call();
    expect(response.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });
  it('rechecks a parent that became private after the reply lookup', async () => {
    state.reply = true; state.hiddenParent = true;
    const response = await call();
    expect(response.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });
});
