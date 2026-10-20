import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-display-face",
  subsets: ["latin"],
});

// Condensed caps for labels on colour bars and tiles (`font-label`).
const label = Barlow_Condensed({
  variable: "--font-label-face",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Job Finder", template: "%s · Job Finder" },
  description: "Find job postings that match your resume, track applications, and get a morning digest.",
  applicationName: "Job Finder",
};

export const viewport: Viewport = {
  themeColor: "#1c1c1e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${label.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
