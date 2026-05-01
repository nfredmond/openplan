#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
DOCS_ROOT="$REPO_ROOT/docs/ops"
DEFAULT_ALIAS_URL="https://openplan-natford.vercel.app"
DEFAULT_ENV_FILE="/tmp/openplan.vercel.env"
TIMEZONE="America/Los_Angeles"

WORKSPACE_ID=""
BILLING_EMAIL=""
ALIAS_URL="$DEFAULT_ALIAS_URL"
ENV_FILE=""
SINCE_MINUTES=180
EVIDENCE_DIR=""
SKIP_ENV_PULL=0
VERCEL_PROTECTION_BYPASS_SECRET=""

usage() {
  cat <<USAGE
Usage:
  $0 --workspace-id <uuid> [--billing-email <email>] [--alias-url <url>] [--env-file <path>] [--since-minutes <n>] [--evidence-dir <path>] [--skip-env-pull] [--vercel-protection-bypass-secret <secret>]

Examples:
  $0 --workspace-id 11111111-2222-4333-8444-555555555555
  $0 --workspace-id 11111111-2222-4333-8444-555555555555 --billing-email owner@example.gov --since-minutes 240
  $0 --workspace-id 11111111-2222-4333-8444-555555555555 --env-file /tmp/openplan.vercel.env --evidence-dir ../docs/ops/2026-03-16-test-output/canary-preflight
  $0 --workspace-id 11111111-2222-4333-8444-555555555555 --vercel-protection-bypass-secret "\$OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET"
USAGE
}

require_bin() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required dependency: $name" >&2
    exit 1
  fi
}

workspace_snapshot_field() {
  local file="$1"
  local field="$2"
  python3 - "$file" "$field" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)

workspace = data.get("workspace") or {}
field = sys.argv[2]
if field == "name":
    print(workspace.get("name") or "unknown")
elif field == "status":
    print(workspace.get("subscription_status") or "n/a")
elif field == "plan":
    print(workspace.get("subscription_plan") or "n/a")
PY
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
    --vercel-protection-bypass-secret)
      VERCEL_PROTECTION_BYPASS_SECRET="${2:-}"
      shift 2
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
require_bin node
require_bin python3

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
ALIAS_BYPASS_HEADERS_LOG="$EVIDENCE_DIR/public-alias-bypass-headers.txt"
ALIAS_BYPASS_STATUS_LOG="$EVIDENCE_DIR/public-alias-bypass-status.txt"
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
STRIPE_WEBHOOK_SECRET="${OPENPLAN_STRIPE_WEBHOOK_SECRET:-}"
READINESS_SECRET="${OPENPLAN_BILLING_READINESS_SECRET:-${OPENPLAN_BILLING_USAGE_FLUSH_SECRET:-}}"
USAGE_FLUSH_SECRET="${OPENPLAN_BILLING_USAGE_FLUSH_SECRET:-}"
RUNS_METER_EVENT_NAME="${OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS:-${OPENPLAN_STRIPE_METER_EVENT_NAME:-}}"
WEBHOOK_URL="$ALIAS_URL/api/billing/webhook"
READINESS_URL="$ALIAS_URL/api/billing/readiness"
VERCEL_PROTECTION_BYPASS_SECRET="${VERCEL_PROTECTION_BYPASS_SECRET:-${OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET:-${VERCEL_AUTOMATION_BYPASS_SECRET:-}}}"
MONITOR_EMAIL_ARG=""
if [[ -n "$BILLING_EMAIL" ]]; then
  MONITOR_EMAIL_ARG=" --email $BILLING_EMAIL"
fi

BLOCKERS=()
ENV_FILE_PRESENT_OK=1
ENV_CORE_OK=1
ENV_SERVICE_ROLE_OK=1
ENV_STRIPE_WEBHOOK_SECRET_OK=1
ENV_USAGE_METERING_OK=1
ALIAS_CHECK_OK=0
PRICE_CHECK_OK=1
WEBHOOK_CHECK_OK=0
WORKSPACE_SNAPSHOT_OK=0
MONITOR_SNAPSHOT_OK=0
ALIAS_PRIMARY_STATUS="unknown"
ALIAS_PRIMARY_HEADERS=""
ALIAS_PROTECTION_STATE="unknown"
ALIAS_PROTECTION_DETAIL="Not yet checked"
ALIAS_EFFECTIVE_MODE="none"

if [[ -z "$STRIPE_KEY" ]]; then
  ENV_CORE_OK=0
  BLOCKERS+=("Missing OPENPLAN_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY) in $ENV_FILE")
fi
if [[ -z "$STRIPE_WEBHOOK_SECRET" ]]; then
  ENV_STRIPE_WEBHOOK_SECRET_OK=0
  BLOCKERS+=("Missing OPENPLAN_STRIPE_WEBHOOK_SECRET in $ENV_FILE")
fi
if [[ -z "$READINESS_SECRET" ]]; then
  ENV_USAGE_METERING_OK=0
  BLOCKERS+=("Missing OPENPLAN_BILLING_READINESS_SECRET or OPENPLAN_BILLING_USAGE_FLUSH_SECRET in $ENV_FILE")
fi
if [[ -z "$USAGE_FLUSH_SECRET" ]]; then
  ENV_USAGE_METERING_OK=0
  BLOCKERS+=("Missing OPENPLAN_BILLING_USAGE_FLUSH_SECRET in $ENV_FILE")
fi
if [[ -z "$RUNS_METER_EVENT_NAME" ]]; then
  ENV_USAGE_METERING_OK=0
  BLOCKERS+=("Missing OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS or OPENPLAN_STRIPE_METER_EVENT_NAME in $ENV_FILE")
fi
if [[ -z "$SUPABASE_URL" ]]; then
  ENV_CORE_OK=0
  BLOCKERS+=("Missing NEXT_PUBLIC_SUPABASE_URL in $ENV_FILE")
fi
if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  ENV_SERVICE_ROLE_OK=0
  BLOCKERS+=("Missing SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE (this is the current production-proof blocker for deeper reruns)")
fi

curl -sSI "$ALIAS_URL" | tee "$ALIAS_HEADERS_LOG" >/dev/null
curl -sS -o /dev/null -w 'status=%{http_code}\nfinal_url=%{url_effective}\nredirect_url=%{redirect_url}\n' "$ALIAS_URL/billing" | tee "$ALIAS_STATUS_LOG" >/dev/null
ALIAS_PRIMARY_STATUS="$(awk -F= '/^status=/{print $2}' "$ALIAS_STATUS_LOG" | tail -n 1)"
ALIAS_PRIMARY_HEADERS="$(tr '[:upper:]' '[:lower:]' < "$ALIAS_HEADERS_LOG")"

if [[ "$ALIAS_PRIMARY_STATUS" =~ ^(200|301|302|307|308)$ ]]; then
  ALIAS_CHECK_OK=1
  ALIAS_PROTECTION_STATE="open"
  ALIAS_PROTECTION_DETAIL="Canonical alias returned HTTP $ALIAS_PRIMARY_STATUS without needing a bypass secret."
  ALIAS_EFFECTIVE_MODE="direct"
elif [[ "$ALIAS_PRIMARY_STATUS" =~ ^(401|403)$ ]]; then
  if grep -qi '_vercel_sso_nonce\|x-vercel-protection-bypass\|x-vercel-set-bypass-cookie\|vercel authentication\|authentication required\|deployment protection' "$ALIAS_HEADERS_LOG"; then
    ALIAS_PROTECTION_STATE="protected"
    ALIAS_PROTECTION_DETAIL="Canonical alias returned HTTP $ALIAS_PRIMARY_STATUS and appears to be behind Vercel deployment protection."
    if [[ -n "$VERCEL_PROTECTION_BYPASS_SECRET" ]]; then
      curl -sSI -H "x-vercel-protection-bypass: $VERCEL_PROTECTION_BYPASS_SECRET" "$ALIAS_URL" | tee "$ALIAS_BYPASS_HEADERS_LOG" >/dev/null
      curl -sS -o /dev/null -w 'status=%{http_code}\nfinal_url=%{url_effective}\nredirect_url=%{redirect_url}\n' -H "x-vercel-protection-bypass: $VERCEL_PROTECTION_BYPASS_SECRET" "$ALIAS_URL/billing" | tee "$ALIAS_BYPASS_STATUS_LOG" >/dev/null
      ALIAS_BYPASS_STATUS="$(awk -F= '/^status=/{print $2}' "$ALIAS_BYPASS_STATUS_LOG" | tail -n 1)"
      if [[ "$ALIAS_BYPASS_STATUS" =~ ^(200|301|302|307|308)$ ]]; then
        ALIAS_CHECK_OK=1
        ALIAS_PROTECTION_DETAIL="Canonical alias is protected by Vercel, but the supplied bypass secret produced HTTP $ALIAS_BYPASS_STATUS on /billing."
        ALIAS_EFFECTIVE_MODE="bypass-header"
      else
        BLOCKERS+=("Canonical alias appears Vercel-protected and the supplied bypass secret did not unlock /billing (HTTP ${ALIAS_BYPASS_STATUS:-unknown})")
      fi
    else
      BLOCKERS+=("Canonical alias appears Vercel-protected (HTTP $ALIAS_PRIMARY_STATUS) and no bypass secret was supplied for proof automation")
    fi
  else
    BLOCKERS+=("Canonical alias returned HTTP $ALIAS_PRIMARY_STATUS for /billing and did not clearly identify as Vercel protection")
  fi
else
  BLOCKERS+=("Canonical alias returned unexpected HTTP ${ALIAS_PRIMARY_STATUS:-unknown} for /billing")
fi

if [[ -n "$STRIPE_KEY" ]]; then
  curl -sS https://api.stripe.com/v1/webhook_endpoints \
    -u "$STRIPE_KEY:" > "$WEBHOOKS_JSON"

  if EXPECTED_WEBHOOK_URL="$WEBHOOK_URL" python3 - "$WEBHOOKS_JSON" <<'PY'
import json
import os
import sys

path = sys.argv[1]
expected = os.environ["EXPECTED_WEBHOOK_URL"]
required = {
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
}

with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

ok = any(
    item.get("url") == expected
    and item.get("status") == "enabled"
    and required.issubset(set(item.get("enabled_events") or []))
    for item in (data.get("data") or [])
)

sys.exit(0 if ok else 1)
PY
  then
    WEBHOOK_CHECK_OK=1
  else
    BLOCKERS+=("Stripe does not show an enabled webhook endpoint at $WEBHOOK_URL with the required subscription events")
  fi
fi

WORKSPACE_NAME="unknown"
WORKSPACE_STATUS="unavailable"
WORKSPACE_PLAN="unavailable"
STARTER_PRICE_SUMMARY="not checked - direct OpenPlan checkout disabled"
STARTER_PRICE_DISPLAY="not applicable"

if [[ -n "$SUPABASE_URL" && -n "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  if (
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

  if (workspaceError) throw workspaceError;
  if (!workspace) throw new Error(`workspace ${workspaceId} not found`);

  const { data: members, error: membersError } = await sb
    .from('workspace_members')
    .select('user_id,role')
    .eq('workspace_id', workspaceId)
    .order('role', { ascending: true });
  if (membersError) throw membersError;

  const { data: events, error: eventsError } = await sb
    .from('billing_events')
    .select('id,event_type,source,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (eventsError) throw eventsError;

  process.stdout.write(JSON.stringify({
    capturedAt: new Date().toISOString(),
    workspace,
    memberCount: members?.length ?? 0,
    members: members ?? [],
    recentBillingEvents: events ?? [],
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
NODE
  ) > "$WORKSPACE_SNAPSHOT_JSON"; then
    WORKSPACE_SNAPSHOT_OK=1
    WORKSPACE_NAME="$(workspace_snapshot_field "$WORKSPACE_SNAPSHOT_JSON" name)"
    WORKSPACE_STATUS="$(workspace_snapshot_field "$WORKSPACE_SNAPSHOT_JSON" status)"
    WORKSPACE_PLAN="$(workspace_snapshot_field "$WORKSPACE_SNAPSHOT_JSON" plan)"
  else
    BLOCKERS+=("Failed to capture production workspace snapshot from Supabase service-role access")
  fi

  MONITOR_ARGS=(
    --workspace-id "$WORKSPACE_ID"
    --since-minutes "$SINCE_MINUTES"
    --env-file "$ENV_FILE"
  )
  if [[ -n "$BILLING_EMAIL" ]]; then
    MONITOR_ARGS+=(--email "$BILLING_EMAIL")
  fi

  if "$APP_DIR/scripts/openplan-starter-canary-monitor.sh" "${MONITOR_ARGS[@]}" > "$MONITOR_SNAPSHOT_LOG"; then
    MONITOR_SNAPSHOT_OK=1
  else
    BLOCKERS+=("Failed to capture current monitor snapshot for the canary workspace")
  fi
fi

if [[ ${#BLOCKERS[@]} -eq 0 ]]; then
  READY_STATE="READY FOR SUPERVISED EXECUTION"
else
  READY_STATE="BLOCKED — operator action required"
fi

cat > "$SUMMARY_MD" <<SUMMARY
# OpenPlan Supervised Paid Canary Preflight Summary

- Captured at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
- Status: $READY_STATE
- Public alias: $ALIAS_URL
- Canonical webhook URL: $WEBHOOK_URL
- Billing readiness URL: $READINESS_URL
- Alias protection state: $ALIAS_PROTECTION_STATE
- Alias protection detail: $ALIAS_PROTECTION_DETAIL
- Alias effective proof mode: $ALIAS_EFFECTIVE_MODE
- Workspace id: $WORKSPACE_ID
- Workspace name: $WORKSPACE_NAME
- Current workspace subscription status: $WORKSPACE_STATUS
- Current workspace subscription plan: $WORKSPACE_PLAN
- Legacy OpenPlan price summary: $STARTER_PRICE_SUMMARY
- Legacy OpenPlan price display: $STARTER_PRICE_DISPLAY
- Env file used: $ENV_FILE
- Evidence directory: $EVIDENCE_DIR

## Preflight check status
1. Production env snapshot file loaded: $( [[ "$ENV_FILE_PRESENT_OK" -eq 1 ]] && echo YES || echo NO )
2. Required core env posture present (Stripe key, public Supabase URL): $( [[ "$ENV_CORE_OK" -eq 1 ]] && echo YES || echo NO )
3. Supabase service-role proof posture present: $( [[ "$ENV_SERVICE_ROLE_OK" -eq 1 ]] && echo YES || echo NO )
4. Stripe webhook signing secret present: $( [[ "$ENV_STRIPE_WEBHOOK_SECRET_OK" -eq 1 ]] && echo YES || echo NO )
5. Usage flush + readiness + runs meter env present: $( [[ "$ENV_USAGE_METERING_OK" -eq 1 ]] && echo YES || echo NO )
6. Canonical alias/browser proof route reachable in current proof mode: $( [[ "$ALIAS_CHECK_OK" -eq 1 ]] && echo YES || echo NO )
7. OpenPlan direct price posture skipped: $( [[ "$PRICE_CHECK_OK" -eq 1 ]] && echo YES || echo NO )
8. Canonical Stripe webhook endpoint posture valid: $( [[ "$WEBHOOK_CHECK_OK" -eq 1 ]] && echo YES || echo NO )
9. Production workspace snapshot captured via Supabase service role: $( [[ "$WORKSPACE_SNAPSHOT_OK" -eq 1 ]] && echo YES || echo NO )
10. Current monitor snapshot captured: $( [[ "$MONITOR_SNAPSHOT_OK" -eq 1 ]] && echo YES || echo NO )

## Env posture details
- Env file present: $( [[ "$ENV_FILE_PRESENT_OK" -eq 1 ]] && echo YES || echo NO )
- Core env posture: $( [[ "$ENV_CORE_OK" -eq 1 ]] && echo READY || echo BLOCKED )
- Service-role proof posture: $( [[ "$ENV_SERVICE_ROLE_OK" -eq 1 ]] && echo READY || echo BLOCKED )
- Stripe webhook signing secret posture: $( [[ "$ENV_STRIPE_WEBHOOK_SECRET_OK" -eq 1 ]] && echo READY || echo BLOCKED )
- Usage metering env posture: $( [[ "$ENV_USAGE_METERING_OK" -eq 1 ]] && echo READY || echo BLOCKED )
- Current env blocker note: $( [[ "$ENV_SERVICE_ROLE_OK" -eq 1 ]] && echo "None" || echo "Missing SUPABASE_SERVICE_ROLE_KEY prevents service-role-backed workspace and monitor proof." )

## Alias proof details
- Raw /billing status without bypass header: ${ALIAS_PRIMARY_STATUS:-unknown}
- Protection posture: $ALIAS_PROTECTION_STATE
- Effective proof mode: $ALIAS_EFFECTIVE_MODE
- Detail: $ALIAS_PROTECTION_DETAIL
- Supplied bypass secret: $( [[ -n "$VERCEL_PROTECTION_BYPASS_SECRET" ]] && echo YES || echo NO )

## Exact operator route
- $ALIAS_URL/billing?workspaceId=$WORKSPACE_ID

## Exact billing readiness dry-run command
\`\`\`bash
curl -sS -X POST "$READINESS_URL" \\
  -H "authorization: Bearer \$OPENPLAN_BILLING_USAGE_FLUSH_SECRET" \\
  -H "content-type: application/json" \\
  -d '{"workspaceId":"$WORKSPACE_ID","includeUsageDryRun":true,"bucketKey":"runs","limit":250}'
\`\`\`

## Exact monitor command to run during the supervised canary
\`\`\`bash
cd $APP_DIR
./scripts/openplan-starter-canary-monitor.sh --workspace-id $WORKSPACE_ID$MONITOR_EMAIL_ARG --since-minutes $SINCE_MINUTES --watch 15 --env-file $ENV_FILE
\`\`\`

## Explicit blockers
$(if [[ ${#BLOCKERS[@]} -eq 0 ]]; then echo "- None."; else for blocker in "${BLOCKERS[@]}"; do echo "- $blocker"; done; fi)

## Evidence files generated
- $ALIAS_HEADERS_LOG
- $ALIAS_STATUS_LOG
- $ALIAS_BYPASS_HEADERS_LOG
- $ALIAS_BYPASS_STATUS_LOG
- $WEBHOOKS_JSON
- $WORKSPACE_SNAPSHOT_JSON
- $MONITOR_SNAPSHOT_LOG

## Ready / abort guidance
- READY if blockers are empty, the workspace above is the intended dedicated canary workspace, and the operator identity is approved.
- ABORT or remediate first if any blocker remains. Most importantly: do not claim paid happy-path proof until the Supabase service-role snapshot and monitor evidence both exist.
- If the alias is Vercel-protected, either supply a valid bypass secret for automation or use an intentionally authenticated browser session and document that posture in the packet.
SUMMARY

cat <<EOF
OpenPlan supervised paid canary preflight: $READY_STATE
- Workspace: $WORKSPACE_ID ($WORKSPACE_NAME)
- Evidence dir: $EVIDENCE_DIR
- Summary: $SUMMARY_MD
- Operator route: $ALIAS_URL/billing?workspaceId=$WORKSPACE_ID
- Monitor command:
  cd $APP_DIR && ./scripts/openplan-starter-canary-monitor.sh --workspace-id $WORKSPACE_ID$MONITOR_EMAIL_ARG --since-minutes $SINCE_MINUTES --watch 15 --env-file $ENV_FILE
EOF

if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
  exit 2
fi
