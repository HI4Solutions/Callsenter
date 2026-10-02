import type { MetadataRoute } from "next";
import { palette } from "@/lib/tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VeriQall",
    short_name: "VeriQall",
    description: "Dokumentert og verifisert telefonsalg for callsentre.",
    lang: "nb",
    start_url: "/",
    display: "standalone",
    background_color: palette.paper,
    theme_color: palette.stamp,
    icons: [
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
