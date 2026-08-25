import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drops Tracker",
  description: "Track Target and Walmart TCG drops, market value, and ROI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
