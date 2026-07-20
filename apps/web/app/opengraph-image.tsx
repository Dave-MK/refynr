import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "refynr — clean CSV, Excel, JSON & Parquet entirely in your browser, with explained, reviewable fixes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social-share card, generated at request time — no binary asset in the repo. */
export default function OpengraphImage() {
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
          background: "linear-gradient(135deg, #0b1120 0%, #111a2e 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span style={{ fontSize: 96, fontWeight: 700, color: "#f1f5f9" }}>
            refynr
          </span>
          <span style={{ fontSize: 96, fontWeight: 700, color: "#2dd4bf" }}>.</span>
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 38,
            lineHeight: 1.4,
            color: "#94a3b8",
            maxWidth: 960,
          }}
        >
          Clean CSV, Excel, JSON &amp; Parquet entirely in your browser. Every
          fix explained and reviewable — your data never leaves your device.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 44, gap: 16 }}>
          {["health score", "explained fixes", "version diff", "recipes", "audit report", "100% in-browser"].map(
            (t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  padding: "10px 22px",
                  borderRadius: 999,
                  border: "1px solid rgba(45,212,191,0.4)",
                  color: "#2dd4bf",
                  fontSize: 24,
                }}
              >
                {t}
              </div>
            ),
          )}
        </div>
      </div>
    ),
    size,
  );
}
