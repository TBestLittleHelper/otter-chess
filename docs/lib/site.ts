// Single source of truth for where this site is deployed.
//
// On GitHub Pages the app lives under https://<owner>.github.io/<repo>, so every
// URL needs the `/<repo>` prefix. The deploy workflow sets NEXT_PUBLIC_BASE_PATH
// and NEXT_PUBLIC_SITE_URL from actions/configure-pages; `next dev` leaves both
// unset and serves from the root of localhost. Both are read at build time and
// inlined into the client bundle, so a base-path change needs a rebuild.

// configure-pages reports "/" for a root deployment (user site or custom
// domain), but Next requires basePath to be "" or a non-trailing-slash path.
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const BASE_PATH = rawBasePath === "/" ? "" : rawBasePath.replace(/\/$/, "");

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? `http://localhost:3000${BASE_PATH}`
).replace(/\/$/, "");

// Prefix a root-relative path with the base path. Only needed for URLs Next.js
// doesn't rewrite itself — plain <img src>, fetch(), new Worker(), and the
// metadata icon/manifest routes. `next/link` hrefs and anything resolved
// against `metadataBase` are prefixed automatically.
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
