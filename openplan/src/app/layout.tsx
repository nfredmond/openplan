import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { OPENPLAN_OG_IMAGE_PATH, OPENPLAN_SITE_NAME, resolveSiteOrigin } from "@/lib/public-page-metadata";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono-sys",
});

export const metadata: Metadata = {
  // Undefined when unconfigured, so Next infers THIS deployment's origin rather
  // than inheriting a hardcoded one. See resolveSiteOrigin.
  metadataBase: resolveSiteOrigin(),
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
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "OpenPlan | Free, open-source planning software",
    description:
      "Inspectable planning software for maps, engagement, project records, and delivery packets. Every number carries its provenance.",
    url: "/",
    siteName: OPENPLAN_SITE_NAME,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: OPENPLAN_OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "OpenPlan: free, open-source planning software for agencies, tribes, counties, cities, and consultants.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenPlan | Free, open-source planning software",
    description:
      "An Apache-2.0 planning workbench for agencies, tribes, counties, cities, non-profits, and consultants. Free, with no paid tier.",
    images: [OPENPLAN_OG_IMAGE_PATH],
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
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider defaultTheme="dark">{children}</ThemeProvider>
      </body>
    </html>
  );
}
