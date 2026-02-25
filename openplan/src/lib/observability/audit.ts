import { NextRequest } from "next/server";

type AuditLevel = "info" | "warn" | "error";

const SENSITIVE_KEY =
  /(authorization|token|api[-_]?key|secret|password|cookie|set-cookie|session|credential)/i;

const MAX_DEPTH = 5;
const MAX_ARRAY = 20;
const MAX_STRING = 500;

function truncate(value: string): string {
  if (value.length <= MAX_STRING) return value;
  return `${value.slice(0, MAX_STRING)}…[truncated:${value.length}]`;
}

function redactByKey(key: string | undefined, value: unknown): unknown {
  if (key && SENSITIVE_KEY.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  return value;
}

function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncate(error.message),
      stack: error.stack ? truncate(error.stack) : undefined,
    };
  }

  return error;
}

export function sanitizeForAudit(
  value: unknown,
  key?: string,
  depth = 0
): unknown {
  if (depth > MAX_DEPTH) return "[max-depth]";

  const redacted = redactByKey(key, value);

  if (redacted === null || redacted === undefined) return redacted;
  if (typeof redacted === "string") return redacted;
  if (typeof redacted === "number") return Number.isFinite(redacted) ? redacted : String(redacted);
  if (typeof redacted === "boolean") return redacted;
  if (typeof redacted === "bigint") return redacted.toString();

  if (redacted instanceof Date) return redacted.toISOString();

  if (redacted instanceof Error) {
    return safeError(redacted);
  }

  if (Array.isArray(redacted)) {
    return redacted.slice(0, MAX_ARRAY).map((item) => sanitizeForAudit(item, undefined, depth + 1));
  }

  if (typeof redacted === "object") {
    const source = redacted as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(source)) {
      out[k] = sanitizeForAudit(v, k, depth + 1);
    }

    return out;
  }

  return String(redacted);
}

function firstHeader(request: NextRequest, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = request.headers.get(key);
    if (value) return value;
  }
  return undefined;
}

function requestMeta(request: NextRequest) {
  const requestId =
    firstHeader(request, ["x-request-id", "x-vercel-id", "x-amzn-trace-id"]) ??
    crypto.randomUUID();

  return {
    requestId,
    method: request.method,
    path: request.nextUrl.pathname,
    userAgent: request.headers.get("user-agent") ?? "unknown",
    clientIp:
      firstHeader(request, ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"]) ??
      "unknown",
  };
}

export function createApiAuditLogger(route: string, request: NextRequest) {
  const base = requestMeta(request);

  const emit = (level: AuditLevel, event: string, context?: Record<string, unknown>) => {
    const payload = {
      ts: new Date().toISOString(),
      subsystem: "openplan/api",
      route,
      level,
      event,
      ...base,
      context: sanitizeForAudit(context ?? {}),
    };

    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.info(line);
  };

  return {
    requestId: base.requestId,
    info(event: string, context?: Record<string, unknown>) {
      emit("info", event, context);
    },
    warn(event: string, context?: Record<string, unknown>) {
      emit("warn", event, context);
    },
    error(event: string, context?: Record<string, unknown>) {
      emit("error", event, context);
    },
  };
}
