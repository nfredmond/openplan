#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-}"
WORKSPACE_ID=""
BILLING_EMAIL=""
SINCE_MINUTES=90
WATCH_SECONDS=0

usage() {
  cat <<USAGE
Usage:
  $0 [--workspace-id <uuid>] [--email <billing-email>] [--since-minutes <n>] [--watch <seconds>] [--env-file <path>]

Examples:
  $0 --workspace-id 11111111-2222-3333-4444-555555555555 --since-minutes 120
  $0 --email owner@example.gov --watch 20 --env-file /tmp/openplan.vercel.env
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace-id)
      WORKSPACE_ID="${2:-}"
      shift 2
      ;;
    --email)
      BILLING_EMAIL="${2:-}"
      shift 2
      ;;
    --since-minutes)
      SINCE_MINUTES="${2:-90}"
      shift 2
      ;;
    --watch)
      WATCH_SECONDS="${2:-0}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f /tmp/openplan.vercel.env ]]; then
    ENV_FILE="/tmp/openplan.vercel.env"
  elif [[ -f "$ROOT_DIR/.env.local" ]]; then
    ENV_FILE="$ROOT_DIR/.env.local"
  fi
fi

if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "Missing env file. Provide --env-file with OPENPLAN_STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# Fallback merge from .env.local for variables not present in pulled Vercel env snapshots.
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  source "$ROOT_DIR/.env.local"
  set +a
fi

STRIPE_KEY="${OPENPLAN_STRIPE_SECRET_KEY:-${STRIPE_SECRET_KEY:-}}"
SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [[ -z "$STRIPE_KEY" || -z "$SUPABASE_URL" || -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "Required env vars missing after loading $ENV_FILE"
  echo "Need: OPENPLAN_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

SINCE_EPOCH="$(($(date +%s) - SINCE_MINUTES * 60))"

print_header() {
  echo "========================================"
  echo "OpenPlan Starter Canary Monitor"
  echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "Since: last ${SINCE_MINUTES} minutes (epoch >= ${SINCE_EPOCH})"
  echo "Workspace filter: ${WORKSPACE_ID:-<none>}"
  echo "Email filter: ${BILLING_EMAIL:-<none>}"
  echo "Env file: $ENV_FILE"
  echo "========================================"
}

fetch_stripe_events() {
  local type="$1"
  curl -sS -G "https://api.stripe.com/v1/events" \
    -u "${STRIPE_KEY}:" \
    --data-urlencode "type=${type}" \
    --data-urlencode "limit=100" \
    --data-urlencode "created[gte]=${SINCE_EPOCH}"
}

print_stripe_section() {
  echo "\n[Stripe events]"
  local types=(
    "checkout.session.completed"
    "customer.subscription.created"
    "customer.subscription.updated"
    "customer.subscription.deleted"
    "invoice.payment_succeeded"
    "invoice.payment_failed"
    "charge.refunded"
  )

  local any=0
  for t in "${types[@]}"; do
    local payload
    payload="$(fetch_stripe_events "$t")"

    local lines
    lines="$(printf '%s' "$payload" | jq -r --arg ws "$WORKSPACE_ID" --arg em "$BILLING_EMAIL" '
      .data[]
      | . as $evt
      | ($evt.data.object // {}) as $obj
      | ($obj.metadata.workspaceId // $obj.metadata.workspace_id // $obj.client_reference_id // "") as $workspace
      | ($obj.customer_email // $obj.customer_details.email // $obj.receipt_email // "") as $email
      | ($ws == "" or ($workspace == $ws)) as $wsMatch
      | ($em == "" or ((($email|ascii_downcase) == ($em|ascii_downcase)))) as $emMatch
      | select($wsMatch and $emMatch)
      | [(.id), (.type), (.created|tostring), ($workspace), ($email)]
      | @tsv
    ' || true)"

    if [[ -n "$lines" ]]; then
      any=1
      echo "$lines" | while IFS=$'\t' read -r id type created workspace email; do
        printf '  %s  %-35s created=%s workspace=%s email=%s\n' "$id" "$type" "$created" "${workspace:-n/a}" "${email:-n/a}"
      done
    fi
  done

  if [[ "$any" -eq 0 ]]; then
    echo "  (no matching Stripe events found yet)"
  fi
}

print_supabase_section() {
  echo "\n[Supabase billing evidence]"
  WORKSPACE_ID="$WORKSPACE_ID" BILLING_EMAIL="$BILLING_EMAIL" SINCE_EPOCH="$SINCE_EPOCH" \
  SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  node <<'NODE'
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId = process.env.WORKSPACE_ID || '';
const emailFilter = (process.env.BILLING_EMAIL || '').toLowerCase();
const sinceEpoch = Number(process.env.SINCE_EPOCH || 0);
const sinceIso = new Date(sinceEpoch * 1000).toISOString();

const sb = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  let workspacesQuery = sb
    .from('workspaces')
    .select('id,name,subscription_plan,subscription_status,stripe_customer_id,stripe_subscription_id,billing_updated_at,created_at')
    .order('billing_updated_at', { ascending: false, nullsFirst: false })
    .limit(20);

  if (workspaceId) {
    workspacesQuery = workspacesQuery.eq('id', workspaceId);
  }

  const { data: workspaces, error: workspacesError } = await workspacesQuery;
  if (workspacesError) {
    console.log(`  workspace query error: ${workspacesError.message}`);
  } else {
    const filtered = (workspaces || []).filter((row) => !workspaceId || row.id === workspaceId);
    if (!filtered.length) {
      console.log('  workspaces: no matching rows');
    } else {
      for (const row of filtered.slice(0, 5)) {
        console.log(`  workspace ${row.id} name=${row.name} sub_status=${row.subscription_status} sub_plan=${row.subscription_plan || 'n/a'} stripe_sub=${row.stripe_subscription_id || 'n/a'} billing_updated=${row.billing_updated_at || 'n/a'}`);
      }
    }
  }

  let eventsQuery = sb
    .from('billing_events')
    .select('id,workspace_id,event_type,source,payload,created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(50);

  if (workspaceId) {
    eventsQuery = eventsQuery.eq('workspace_id', workspaceId);
  }

  const { data: events, error: eventsError } = await eventsQuery;
  if (eventsError) {
    console.log(`  billing_events query error: ${eventsError.message}`);
  } else {
    const filtered = (events || []).filter((evt) => {
      if (!emailFilter) return true;
      const md = evt.payload || {};
      const email = String(md.userEmail || md.customerEmail || md.customer_email || '').toLowerCase();
      return email === emailFilter;
    });

    if (!filtered.length) {
      console.log('  billing_events: no matching rows');
    } else {
      console.log('  billing_events:');
      for (const evt of filtered.slice(0, 12)) {
        console.log(`    ${evt.id} ${evt.event_type} workspace=${evt.workspace_id} source=${evt.source} at=${evt.created_at}`);
      }
    }
  }

  const { data: receipts, error: receiptsError } = await sb
    .from('billing_webhook_receipts')
    .select('id,provider,event_id,event_type,status,workspace_id,created_at,processed_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(50);

  if (receiptsError) {
    console.log(`  webhook_receipts query error: ${receiptsError.message}`);
  } else {
    const filtered = (receipts || []).filter((r) => !workspaceId || r.workspace_id === workspaceId);
    if (!filtered.length) {
      console.log('  webhook_receipts: no matching rows');
    } else {
      console.log('  webhook_receipts:');
      for (const r of filtered.slice(0, 12)) {
        console.log(`    ${r.id} ${r.event_type} event_id=${r.event_id} status=${r.status} workspace=${r.workspace_id || 'n/a'} processed=${r.processed_at || 'n/a'}`);
      }
    }
  }
}

run().catch((error) => {
  console.error('  monitor query failure', error);
  process.exit(1);
});
NODE
}

run_once() {
  print_header
  print_stripe_section
  print_supabase_section
}

if [[ "$WATCH_SECONDS" -gt 0 ]]; then
  while true; do
    clear || true
    run_once
    sleep "$WATCH_SECONDS"
  done
else
  run_once
fi
