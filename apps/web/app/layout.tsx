import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const description =
  "Clean messy spreadsheets in your browser. A data health score, explained fixes you accept one by one, and a full audit trail — your data never leaves your device.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "refynr — spreadsheet quality, refined",
    template: "%s · refynr",
  },
  description,
  keywords: [
    "data cleaning",
    "spreadsheet cleaner",
    "CSV cleaner",
    "data quality",
    "deduplicate",
    "UK postcode validation",
    "privacy-first",
  ],
  openGraph: {
    title: "refynr — spreadsheet quality, refined",
    description,
    url: siteUrl,
    siteName: "refynr",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: "refynr — spreadsheet quality, refined",
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
      <Analytics />
    </html>
  );
}
