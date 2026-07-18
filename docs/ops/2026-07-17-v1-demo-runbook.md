# OpenPlan v1 — Demo Runbook

How to take OpenPlan from a cold laptop to a live, public demo URL. Written for solo operation; every command runs from `openplan/` unless noted. Budget ~15 minutes before the call.

## 1. One-time prerequisites (already true on the dev machine)

- Docker running, Supabase CLI available via `npm exec supabase`
- `openplan/.env.local` contains:
  - `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` (a `pk.*` token — without it maps fall back to a gradient backdrop)
  - `ANTHROPIC_API_KEY` (funded; without it AI features show their explicit offline states)
  - `OPENPLAN_ASSISTANT_MODEL=claude-haiku-4-5` and `OPENPLAN_GRANTS_AI_MODEL=claude-haiku-4-5` (cost control — Haiku ≈ half a cent per copilot exchange, 1–2¢ per narrative draft)
  - `OPENPLAN_DEMO_USER_PASSWORD=<pick one>` (lets you sign in as the demo operator)
- `~/.local/bin/cloudflared` installed (no account needed)

## 2. Boot the stack (fresh every demo day)

```bash
npm exec supabase start          # local Postgres/Auth/Storage (skip if already up)
npm exec supabase db reset       # re-apply all migrations — clean slate
npm run seed:nctc                # Nevada County demo workspace, idempotent
npm run build && npm run start   # production server on :3000 (crisper than dev mode)
```

Sign-in: `nctc-demo@openplan-demo.natford.example` / the password you set in `OPENPLAN_DEMO_USER_PASSWORD`.

Smoke-check locally before exposing anything: `/dashboard` shows non-zero KPIs, the map backdrop renders, `/grants` has the program catalog and a seeded pipeline, the engagement campaign has approved comments with lines/polygon + vote counts.

## 3. Public URL (pick one)

**Cloudflare quick tunnel — zero-account, URL changes each session (default):**

```bash
~/.local/bin/cloudflared tunnel --url http://localhost:3000
```

Copy the printed `https://<random>.trycloudflare.com` URL into the meeting chat. Start it ~15 minutes early; keep the laptop on AC power with sleep disabled.

**Tailscale Funnel — stable URL, needs a free Tailscale account (better for links you send in advance):**

```bash
sudo tailscale up          # one-time login
tailscale funnel 3000      # serves https://<machine>.<tailnet>.ts.net
```

## 4. Public engagement link

In the app: Engagement → open the seeded campaign → Share controls → copy the public link (`/engage/<token>`). This is the URL to give "the public" during the demo — it works from any phone in the room, no sign-in.

## 5. Known failure modes (all fail visible, not silent)

| Symptom | Meaning | Action |
| --- | --- | --- |
| "Estimated" badges on analysis metrics | FARS/Overpass/LODES API down — fallback estimates labeled by design | Say so out loud; it's a trust feature, not a bug |
| "AI chat is offline" banner in copilot | `ANTHROPIC_API_KEY` missing/invalid | Deterministic briefs still work; fix the key after |
| Narrative panel shows offline box | Same cause | Same answer |
| Blank/gradient map | Mapbox token missing or offline | Check `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` |
| API rows missing after branch switch | PostgREST stale schema cache | `npm exec supabase db reset`, or `NOTIFY pgrst, 'reload schema';` via psql |

## 6. Costs while demoing

Every AI call records tokens + estimated cost server-side (visible in run/draft records). On Haiku, a full hour-long demo with a dozen AI interactions costs well under $1. Nothing autonomous runs in the background — AI spends only when someone clicks.

## 7. After the call

`Ctrl-C` the tunnel (kills the public URL immediately). The local stack can stay up. To wipe demo-visitor comments/votes before the next demo, just re-run steps 2's reset + seed.
