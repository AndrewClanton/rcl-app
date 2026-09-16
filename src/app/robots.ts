import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Staff/customer-authenticated surfaces -- no SEO value, and a crawler
      // hitting them just bounces off a login redirect anyway.
      disallow: ["/admin", "/pos", "/account", "/login", "/display", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
