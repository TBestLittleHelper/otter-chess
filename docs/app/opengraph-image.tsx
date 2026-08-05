import { ImageResponse } from "next/og";

// Required by `output: "export"` — the image is rendered once at build time.
export const dynamic = "force-static";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#FAFAF6",
          color: "#11120D",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 28,
            letterSpacing: 2,
            color: "#5C8A2E",
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              backgroundColor: "#5C8A2E",
            }}
          />
          Otter Chess
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 600,
            lineHeight: 1.15,
            marginTop: 28,
            maxWidth: 980,
          }}
        >
          A chess engine that plays like you.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#525447",
            marginTop: 32,
            maxWidth: 900,
          }}
        >
          Skill-conditioned move prediction, running locally in your browser with WebGPU.
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
