import type { MetadataRoute } from "next";
import { withBasePath } from "@/lib/site";

// Required by `output: "export"` — generated once at build time.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Otter Chess",
    short_name: "Otter",
    description:
      "A skill-conditioned chess move prediction AI running locally in your browser with WebGPU acceleration.",
    start_url: withBasePath("/"),
    display: "standalone",
    background_color: "#FAFAF6",
    theme_color: "#FAFAF6",
    icons: [
      {
        src: withBasePath("/favicon-96x96.png"),
        sizes: "96x96",
        type: "image/png",
      },
      {
        src: withBasePath("/web-app-manifest-192x192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: withBasePath("/web-app-manifest-512x512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
