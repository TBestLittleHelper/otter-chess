import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Play",
  description:
    "Play chess against Otter, a rating-conditioned AI opponent from 800 to 2600 Elo. Runs locally in your browser with WebGPU acceleration — analyze games, set up positions, and study move-by-move predictions.",
  alternates: {
    canonical: "/play",
  },
  openGraph: {
    title: "Play Otter Chess",
    description:
      "Play chess against Otter, a rating-conditioned AI opponent from 800 to 2600 Elo, running locally in your browser with WebGPU acceleration.",
    url: "/play",
  },
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
