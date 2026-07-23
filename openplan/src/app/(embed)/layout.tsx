// Minimal-chrome layout for embeddable engagement widgets. No app shell, no
// top nav, no marketing footer — the agency frames this on their own site. The
// (embed)/* path is the ONLY path whose CSP relaxes frame-ancestors (see
// next.config.ts); everything else stays frame-ancestors 'none'.
export default function EmbedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
