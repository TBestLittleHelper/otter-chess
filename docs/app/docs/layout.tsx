import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Installation guide, quickstart, model card, and API reference for OtterModel — the skill-conditioned chess move prediction model. Covers WebGPU/WASM inference and input/output formats.",
  alternates: {
    canonical: "/docs",
  },
  openGraph: {
    title: "Otter Chess Docs",
    description:
      "Installation guide, quickstart, model card, and API reference for OtterModel, the skill-conditioned chess move prediction model.",
    url: "/docs",
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
