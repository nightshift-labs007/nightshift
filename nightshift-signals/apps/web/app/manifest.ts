import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nightshift Signals",
    short_name: "Nightshift Signals",
    description: "Every headline becomes an ETF trade in 60 seconds, graded in public at the market open.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d111a",
    theme_color: "#0d111a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
