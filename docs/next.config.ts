import type { NextConfig } from "next";
import { BASE_PATH } from "./lib/site";

const nextConfig: NextConfig = {
  // GitHub Pages is a plain static host: no Node server, so pre-render
  // everything to `out/` at build time.
  output: "export",
  // Project sites live under https://<owner>.github.io/<repo>. See lib/site.ts.
  basePath: BASE_PATH,
  // Emit `out/docs/index.html` rather than `out/docs.html` — GitHub Pages only
  // resolves directory-style URLs.
  trailingSlash: true,
  // The Image Optimization API needs a server; there isn't one.
  images: { unoptimized: true },
};

export default nextConfig;
