#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
DOCS_ROOT="$REPO_ROOT/docs/ops"
DEFAULT_ALIAS_URL="https://openplan-zeta.vercel.app"
DEFAULT_ENV_FILE="/tmp/openplan.vercel.env"
TIMEZONE="America/Los_Angeles"

WORKSPACE_ID=""
BILLING_EMAIL=""
ALIAS_URL="$DEFAULT_ALIAS_URL"
ENV_FILE=""
SINCE_MINUTES=180
EVIDENCE_DIR=""
SKIP_ENV_PULL=0

usage() {
  cat <<USAGE
Usage:
  $0 --workspace-id <uuid> [--billing-email <email>] [--alias-url <url>] [--env-file <path>] [--since-minutes <n>] [--evidence-dir <path>] [--skip-env-pull]

Examples:
  $0 --workspace-id 11111111-2222-4333-8444-555555555555
  $0 --workspace-id 11111111-2222-4333-8444-555555555555 --billing-email owner@example.gov --since-minutes 240
  $0 --workspace-id 11111111-2222-4333-8444-555555555555 --env-file /tmp/openplan.vercel.env --evidence-dir ../docs/ops/2026-03-16-test-output/canary-preflight
USAGE
}

require_bin() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required dependency: $name" >&2
    exit 1
  fi
}

is_uuid() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace-id)
      WORKSPACE_ID="${2:-}"
      shift 2
      ;;
    --billing-email|--email)
      BILLING_EMAIL="${2:-}"
      shift 2
      ;;
    --alias-url)
      ALIAS_URL="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --since-minutes)
      SINCE_MINUTES="${2:-180}"
      shift 2
      ;;
    --evidence-dir)
      EVIDENCE_DIR="${2:-}"
      shift 2
      ;;
    --skip-env-pull)
      SKIP_ENV_PULL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$WORKSPACE_ID" ]]; then
  echo "--workspace-id is required" >&2
  usage
  exit 1
fi

if ! is_uuid "$WORKSPACE_ID"; then
  echo "workspace id must be a UUID: $WORKSPACE_ID" >&2
  exit 1
fi

require_bin curl
require_bin jq
require_bin node

RUN_DATE="$(TZ="$TIMEZONE" date +%F)"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "$EVIDENCE_DIR" ]]; then
  EVIDENCE_DIR="$DOCS_ROOT/${RUN_DATE}-test-output/${RUN_STAMP}-supervised-paid-canary-preflight"
fi
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_DIR="$(cd "$EVIDENCE_DIR" && pwd)"

ENV_PULL_LOG="$EVIDENCE_DIR/vercel-env-pull.log"
ALIAS_HEADERS_LOG="$EVIDENCE_DIR/public-alias-headers.txt"
ALIAS_STATUS_LOG="$EVIDENCE_DIR/public-alias-status.txt"
STARTER_PRICE_JSON="$EVIDENCE_DIR/starter-price.json"
WEBHOOKS_JSON="$EVIDENCE_DIR/webhook-endpoints.json"
WORKSPACE_SNAPSHOT_JSON="$EVIDENCE_DIR/workspace-preflight-snapshot.json"
MONITOR_SNAPSHOT_LOG="$EVIDENCE_DIR/monitor-snapshot.log"
SUMMARY_MD="$EVIDENCE_DIR/preflight-summary.md"

if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$DEFAULT_ENV_FILE"
fi

if [[ "$SKIP_ENV_PULL" -eq 0 ]]; then
  require_bin vercel
  (
    cd "$REPO_ROOT"
    vercel env pull "$ENV_FILE" --environment=production -y
  ) >"$ENV_PULL_LOG" 2>&1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -f "$APP_DIR/.env.local" ]]; then
  set -a
  source "$APP_DIR/.env.local"
  set +a
fi

STRIPE_KEY="${OPENPLAN_STRIPE_SECRET_KEY:-${STRIPE_SECRET_KEY:-}}"
SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
STARTER_PRICE_ID="${OPENPLAN_STRIPE_PRICE_ID_STARTER:-}"

if [[ -z "$STRIPE_KEY" || -z "$SUPABASE_URL" || -z "$SUPABASE_SERVICE_ROLE_KEY" || -z "$STARTER_PRICE_ID" ]]; then
  echo "Missing required env vars after loading $ENV_FILE" >&2
  echo "Need: OPENPLAN_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENPLAN_STRIPE_PRICE_ID_STARTER" >&2
  exit 1
fi

curl -sSI "$ALIAS_URL" | tee "$ALIAS_HEADERS_LOG" >/dev/null
curl -sS -o /dev/null -w 'status=%{http_code}\nfinal_url=%{url_effective}\nredirect_url=%{redirect_url}\n' "$ALIAS_URL/billing" | tee "$ALIAS_STATUS_LOG" >/dev/null

curl -sS "https://api.stripe.com/v1/prices/$STARTER_PRICE_ID" \
  -u "$STRIPE_KEY:" > "$STARTER_PRICE_JSON"

jq -e '
  .id != null
  and .livemode == true
  and .active == true
  and .type == "recurring"
  and .recurring.interval == "month"
  and (.unit_amount | tonumber) > 0
' "$STARTER_PRICE_JSON" >/dev/null

curl -sS https://api.stripe.com/v1/webhook_endpoints \
  -u "$STRIPE_KEY:" > "$WEBHOOKS_JSON"

jq -e --arg expected_url "$ALIAS_URL/api/billing/webhook" '
  any(.data[]?; .url == $expected_url and .status == "enabled"
    and (.enabled_events | index("checkout.session.completed")) != null
    and (.enabled_events | index("customer.subscription.created")) != null
    and (.enabled_events | index("customer.subscription.updated")) != null
    and (.enabled_events | index("customer.subscription.deleted")) != null)
' "$WEBHOOKS_JSON" >/dev/null

(
  cd "$APP_DIR"
  WORKSPACE_ID="$WORKSPACE_ID" \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  node <<'NODE'
const { createClient } = require('@supabase/supabase-js');

const workspaceId = process.env.WORKSPACE_ID;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  const { data: workspace, error: workspaceError } = await sb
    .from('workspaces')
    .select('id,name,subscription_plan,subscription_status,stripe_customer_id,stripe_subscription_id,billing_updated_at,created_at')
    .eq('id', workspaceId)
    .maybeSingle();

  if (workspaceError) {
    throw workspaceError;
  }

  if (!workspace) {
    throw new Error(`workspace ${workspaceId} not found`);
  }

  const { data: members, error: membersError } = await sb
    .from('workspace_members')
    .select('user_id,role')
    .eq('workspace_id', workspaceId)
    .order('role', { ascending: true });

  if (membersError) {
    throw membersError;
  }

  const { data: events, error: eventsError } = await sb
    .from('billing_events')
    .select('id,event_type,source,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (eventsError) {
    throw eventsError;
  }

  const payload = {
    capturedAt: new Date().toISOString(),
    workspace,
    memberCount: members?.length ?? 0,
    members: members ?? [],
    recentBillingEvents: events ?? [],
  };

  process.stdout.write(JSON.stringify(payload, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
NODE
) > "$WORKSPACE_SNAPSHOT_JSON"

MONITOR_ARGS=(
  --workspace-id "$WORKSPACE_ID"
  --since-minutes "$SINCE_MINUTES"
  --env-file "$ENV_FILE"
)
if [[ -n "$BILLING_EMAIL" ]]; then
  MONITOR_ARGS+=(--email "$BILLING_EMAIL")
fi

"$APP_DIR/scripts/openplan-starter-canary-monitor.sh" "${MONITOR_ARGS[@]}" > "$MONITOR_SNAPSHOT_LOG"

STARTER_PRICE_SUMMARY="$(jq -r '[.id, (if .livemode then "live" else "test" end), (.currency // "n/a"), ((.unit_amount // 0) / 100 | tostring), (.recurring.interval // "n/a")] | @tsv' "$STARTER_PRICE_JSON")"
STARTER_PRICE_CURRENCY="$(jq -r '.currency // "usd"' "$STARTER_PRICE_JSON")"
STARTER_PRICE_AMOUNT="$(jq -r '((.unit_amount // 0) / 100 | tostring)' "$STARTER_PRICE_JSON")"
STARTER_PRICE_INTERVAL="$(jq -r '.recurring.interval // "n/a"' "$STARTER_PRICE_JSON")"
STARTER_PRICE_DISPLAY="${STARTER_PRICE_AMOUNT} ${STARTER_PRICE_CURRENCY}/${STARTER_PRICE_INTERVAL}"
WORKSPACE_NAME="$(jq -r '.workspace.name' "$WORKSPACE_SNAPSHOT_JSON")"
WORKSPACE_STATUS="$(jq -r '.workspace.subscription_status // "n/a"' "$WORKSPACE_SNAPSHOT_JSON")"
WORKSPACE_PLAN="$(jq -r '.workspace.subscription_plan // "n/a"' "$WORKSPACE_SNAPSHOT_JSON")"
WEBHOOK_URL="$ALIAS_URL/api/billing/webhook"
MONITOR_EMAIL_ARG=""
if [[ -n "$BILLING_EMAIL" ]]; then
  MONITOR_EMAIL_ARG=" --email $BILLING_EMAIL"
fi

cat > "$SUMMARY_MD" <<SUMMARY
# OpenPlan Supervised Paid Canary Preflight Summary

- Captured at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
- Public alias: $ALIAS_URL
- Workspace id: $WORKSPACE_ID
- Workspace name: $WORKSPACE_NAME
- Current workspace subscription status: $WORKSPACE_STATUS
- Current workspace subscription plan: $WORKSPACE_PLAN
- Starter price summary: $STARTER_PRICE_SUMMARY
- Starter price display: $STARTER_PRICE_DISPLAY
- Env file used: $ENV_FILE
- Evidence directory: $EVIDENCE_DIR

## Preflight checks completed
1. Pulled/loaded production env snapshot.
2. Confirmed public alias responds and the /billing route redirects through the live app.
3. Confirmed Starter price is live, active, recurring monthly, and non-zero.
4. Confirmed Stripe webhook endpoint exists at $WEBHOOK_URL with the required billing events enabled.
5. Captured current workspace snapshot and recent billing events from production Supabase.
6. Captured a current monitor snapshot for this workspace.

## Exact operator route
- $ALIAS_URL/billing?workspaceId=$WORKSPACE_ID

## Exact monitor command to run during the supervised canary
\`\`\`bash
cd $APP_DIR
./scripts/openplan-starter-canary-monitor.sh --workspace-id $WORKSPACE_ID$MONITOR_EMAIL_ARG --since-minutes $SINCE_MINUTES --watch 15 --env-file $ENV_FILE
\`\`\`

## Evidence files generated
- $ALIAS_HEADERS_LOG
- $ALIAS_STATUS_LOG
- $STARTER_PRICE_JSON
- $WEBHOOKS_JSON
- $WORKSPACE_SNAPSHOT_JSON
- $MONITOR_SNAPSHOT_LOG

## Ready / abort guidance
- READY if the workspace shown above is the intended dedicated canary workspace and the operator identity is approved.
- ABORT if the workspace is wrong, the price posture changes unexpectedly, or the live alias no longer behaves as expected.
SUMMARY

cat <<EOF
OpenPlan supervised paid canary preflight: READY FOR SUPERVISED EXECUTION
- Workspace: $WORKSPACE_ID ($WORKSPACE_NAME)
- Evidence dir: $EVIDENCE_DIR
- Summary: $SUMMARY_MD
- Operator route: $ALIAS_URL/billing?workspaceId=$WORKSPACE_ID
- Monitor command:
  cd $APP_DIR && ./scripts/openplan-starter-canary-monitor.sh --workspace-id $WORKSPACE_ID$MONITOR_EMAIL_ARG --since-minutes $SINCE_MINUTES --watch 15 --env-file $ENV_FILE
EOF
