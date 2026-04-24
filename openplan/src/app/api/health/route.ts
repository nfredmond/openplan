import { NextResponse } from "next/server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function healthPayload() {
  return {
    status: "ok",
    service: "openplan",
    checkedAt: new Date().toISOString(),
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
