"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/global-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#0f172a",
          color: "#f8fafc",
        }}
      >
        <main style={{ maxWidth: "36rem", width: "100%" }}>
          <div
            role="alert"
            style={{
              border: "1px solid rgba(248,113,113,0.4)",
              background: "rgba(248,113,113,0.08)",
              padding: "1.25rem",
              borderRadius: "0.5rem",
            }}
          >
            <p style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
              OpenPlan could not render this page.
            </p>
            <p style={{ fontSize: "0.875rem", marginTop: "0.5rem", opacity: 0.85 }}>
              {error.digest
                ? `A critical error interrupted the app. Reference ${error.digest}.`
                : "A critical error interrupted the app."}
            </p>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  padding: "0.4rem 0.9rem",
                  border: "1px solid rgba(248,113,113,0.5)",
                  background: "transparent",
                  color: "inherit",
                  borderRadius: "0.25rem",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
              <a
                href="/"
                style={{
                  padding: "0.4rem 0.9rem",
                  border: "1px solid rgba(248,250,252,0.25)",
                  borderRadius: "0.25rem",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                Go home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
