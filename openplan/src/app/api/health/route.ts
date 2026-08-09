import { NextResponse } from "next/server";
import { APP_VERSION, appCommitSha } from "@/lib/runtime/app-version";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function safeCommitSha(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !/^[a-f0-9]{7,40}$/i.test(trimmed)) return "unknown";
  return trimmed.slice(0, 12).toLowerCase();
}

/**
 * WHY THIS ASKS `appCommitSha()` INSTEAD OF READING AN ENV VAR ITSELF.
 *
 * It used to read `VERCEL_GIT_COMMIT_SHA` and nothing else, so every instance
 * NOT hosted on Vercel — which is the entire self-hosting posture, and every
 * agency running its own copy — answered `commit: "unknown"` no matter how
 * carefully its operator set `OPENPLAN_COMMIT_SHA`. `app-version.ts` exists
 * precisely so an instance can name itself and already honours both variables;
 * this route reimplemented half of it and lost the half that self-hosting needs.
 *
 * Measured cost, 2026-08-08: the always-on walkthrough instance on :3000 was
 * 174 commits behind `main`, and a browser-testing pass spent half an hour
 * diagnosing a bug that had already been fixed, because the one endpoint whose
 * job is to say what is running could not say it. `/api/health` is the cheapest
 * question anyone — an operator, a monitor, a future session — can ask a
 * deployment, and it has to be able to answer.
 *
 * The version travels with it because the commit alone does not survive a fork:
 * an agency deploying from their own branch has a SHA nobody else can resolve,
 * and the version is what makes it comparable.
 */
function healthPayload() {
  return {
    status: "ok",
    service: "openplan",
    checkedAt: new Date().toISOString(),
    deployment: {
      commit: safeCommitSha(appCommitSha()),
      version: APP_VERSION,
    },
    checks: {
      app: "ok",
      database: "not_checked",
    },
  };
}

export function GET() {
  return NextResponse.json(healthPayload(), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
