import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const description =
  "Clean messy spreadsheets entirely in your browser — CSV, Excel, JSON and Parquet. A data health score, explained fixes you review one by one, version diffs, replayable cleaning recipes, and an audit report to prove what changed. Your data never leaves your device.";

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
    "Excel cleaner",
    "data quality",
    "deduplicate",
    "CSV diff",
    "data audit trail",
    "data cleaning recipes",
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
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
