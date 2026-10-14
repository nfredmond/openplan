import type { MetadataRoute } from "next";
import { protectedRoutePrefixes } from "@/components/nav/nav-registry";

/**
 * Crawlers may read the public pages: the home page, examples, legal pages,
 * and the engagement and published pages an agency shares. They are asked to
 * stay out of the signed-in app, the API and the account pages. Every app
 * module comes from the navigation registry, so a new module is covered when
 * it is added. Robots rules are a request, not access control; sign-in and row
 * level security still guard the app.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/auth/",
        "/invitations/",
        "/reset-password",
        "/forgot-password",
        ...protectedRoutePrefixes(),
      ],
    },
  };
}
