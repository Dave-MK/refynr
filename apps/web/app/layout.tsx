import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "refynr — spreadsheet quality, refined",
  description:
    "Upload any spreadsheet. Get a data health score, AI-driven recommendations, and a safe, non-destructive repair preview in under a minute.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
