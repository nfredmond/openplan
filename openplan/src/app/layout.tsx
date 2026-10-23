import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_PALETTE } from "@/lib/theme/palettes";
import { OPENPLAN_OG_IMAGE_PATH, OPENPLAN_SITE_NAME, resolveSiteOrigin } from "@/lib/public-page-metadata";
import { APPEARANCE_SCRIPT, DEFAULT_CORNERS } from "@/lib/theme/appearance";
import "./globals.css";

// Body and interface text (decision D7, October 1, 2026). Space Grotesk stays
// for page titles and large figures.
const publicSans = localFont({
  src: "./fonts/publicsans/PublicSans[wght].ttf",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-body-sys",
});

const spaceGrotesk = localFont({
  src: "./fonts/spacegrotesk/SpaceGrotesk[wght].ttf",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-display",
});

const jetBrainsMono = localFont({
  src: "./fonts/jetbrainsmono/JetBrainsMono[wght].ttf",
  weight: "400 500",
  style: "normal",
  display: "swap",
  variable: "--font-mono-sys",
});

const siteOrigin = resolveSiteOrigin();
const rootCanonicalUrl = siteOrigin?.toString() ?? null;
const rootSocialImageUrl = siteOrigin ? new URL(OPENPLAN_OG_IMAGE_PATH, siteOrigin).toString() : null;

export const metadata: Metadata = {
  metadataBase: siteOrigin,
  applicationName: OPENPLAN_SITE_NAME,
  title: {
    default: "OpenPlan | Free, open-source planning software",
    template: "%s · OpenPlan",
  },
  description:
    "Free, open-source Apache-2.0 planning software for agencies, tribes, RTPAs, counties, cities, non-profits, and consultants.",
  creator: OPENPLAN_SITE_NAME,
  publisher: OPENPLAN_SITE_NAME,
  category: "civic planning software",
  ...(rootCanonicalUrl ? { alternates: { canonical: rootCanonicalUrl } } : {}),
  openGraph: {
    title: "OpenPlan | Free, open-source planning software",
    description:
      "Inspectable planning software for maps, engagement, project records, and delivery packets. Every number carries its provenance.",
    ...(rootCanonicalUrl ? { url: rootCanonicalUrl } : {}),
    siteName: OPENPLAN_SITE_NAME,
    type: "website",
    locale: "en_US",
    ...(rootSocialImageUrl
      ? {
          images: [
            {
              url: rootSocialImageUrl,
              width: 1200,
              height: 630,
              alt: "OpenPlan: free, open-source planning software for agencies, tribes, counties, cities, and consultants.",
            },
          ],
        }
      : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenPlan | Free, open-source planning software",
    description:
      "An Apache-2.0 planning workbench for agencies, tribes, counties, cities, non-profits, and consultants. Free, with no paid tier.",
    ...(rootSocialImageUrl ? { images: [rootSocialImageUrl] } : {}),
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}
      data-palette={DEFAULT_PALETTE}
      data-corners={DEFAULT_CORNERS}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/*
          APPLY THE STORED THEME BEFORE FIRST PAINT.

          The server cannot know the reader's choice — it is in localStorage —
          so the markup ships the defaults and the provider corrects them in an
          effect, which runs AFTER the browser has already painted. That was
          survivable while the only mismatch was dark-vs-light on a page that
          renders in milliseconds. With palettes it is not: every seed token
          changes, so the whole product visibly repaints on each navigation for
          anyone not on the defaults.

          This runs synchronously in <head>, before <body> exists, so the first
          paint is already correct. It is deliberately tiny and dependency-free:
          it must not throw if storage is blocked, and it must not wait on the
          React bundle.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: APPEARANCE_SCRIPT,
          }}
        />
      </head>
      <body className="antialiased">
        {/*
          First focusable element on every page. Each route group's layout owns
          the `#main-content` landmark this points at.
        */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider defaultTheme="system">{children}</ThemeProvider>
      </body>
    </html>
  );
}
