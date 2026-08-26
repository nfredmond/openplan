import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_PALETTE, PALETTES } from "@/lib/theme/palettes";
import { OPENPLAN_OG_IMAGE_PATH, OPENPLAN_SITE_NAME, resolveSiteOrigin } from "@/lib/public-page-metadata";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

/**
 * The valid palette ids, inlined into the pre-paint script. Derived from the
 * registry rather than restated, so a palette added to `PALETTES` cannot be
 * silently rejected by the script that runs before React exists.
 */
const PALETTE_IDS = PALETTES.map((palette) => palette.id);

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
      className={`${spaceGrotesk.variable} ${jetBrainsMono.variable} dark`}
      data-palette={DEFAULT_PALETTE}
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
            __html: `(function(){try{var d=document.documentElement;var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){d.classList.remove("light","dark");d.classList.add(t);d.style.colorScheme=t;}var p=localStorage.getItem("theme-palette");if(p&&${JSON.stringify(
              PALETTE_IDS
            )}.indexOf(p)>-1){d.setAttribute("data-palette",p);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider defaultTheme="dark">{children}</ThemeProvider>
      </body>
    </html>
  );
}
