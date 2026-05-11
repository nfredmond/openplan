import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { OPENPLAN_CANONICAL_ORIGIN, OPENPLAN_OG_IMAGE_PATH, OPENPLAN_SITE_NAME } from "@/lib/public-page-metadata";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

const spaceGroteskBody = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono-sys",
});

export const metadata: Metadata = {
  metadataBase: new URL(OPENPLAN_CANONICAL_ORIGIN),
  applicationName: OPENPLAN_SITE_NAME,
  title: {
    default: "OpenPlan | Open-source planning software with managed services",
    template: "%s · OpenPlan",
  },
  description:
    "Apache-2.0 planning software for agencies, tribes, RTPAs, counties, and consultants, backed by optional Nat Ford managed hosting, onboarding, support, and implementation services.",
  creator: "Nat Ford Planning",
  publisher: "Nat Ford Planning",
  category: "civic planning software",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "OpenPlan | Open-source planning software with managed services",
    description:
      "Inspectable planning software for maps, engagement, project records, and delivery packets, with Nat Ford services available when teams need an accountable operator.",
    url: "/",
    siteName: OPENPLAN_SITE_NAME,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: OPENPLAN_OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "OpenPlan: Apache-2.0 planning software with optional managed hosting and implementation services.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenPlan | Open-source planning software with managed services",
    description:
      "Apache-2.0 planning workbench with optional Nat Ford hosting, onboarding, support, and implementation services.",
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
      className={`${spaceGrotesk.variable} ${spaceGroteskBody.variable} ${jetBrainsMono.variable} dark`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider defaultTheme="dark">{children}</ThemeProvider>
      </body>
    </html>
  );
}
