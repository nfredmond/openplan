import { NextResponse } from "next/server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function safeCommitSha(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !/^[a-f0-9]{7,40}$/i.test(trimmed)) return "unknown";
  return trimmed.slice(0, 12).toLowerCase();
}

function healthPayload() {
  return {
    status: "ok",
    service: "openplan",
    checkedAt: new Date().toISOString(),
    deployment: {
      commit: safeCommitSha(process.env.VERCEL_GIT_COMMIT_SHA),
    },
    checks: {
      app: "ok",
      database: "not_checked",
      billing: "not_checked",
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
